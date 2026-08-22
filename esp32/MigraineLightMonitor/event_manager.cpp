#include "event_manager.h"

#include <esp_system.h>
#include <inttypes.h>
#include <string.h>

#include "config.h"

namespace {
constexpr uint64_t MS_TO_US = 1000ULL;
}

void EventManager::begin() {
  state_ = storage_.ready() ? DeviceState::NORMAL
                            : DeviceState::STORAGE_ERROR;
  metadata_ = {};
}

bool EventManager::suspendsNormalSampling() const {
  return state_ == DeviceState::SAVING_EVENT_PRE ||
         state_ == DeviceState::EVENT_RECORDING ||
         state_ == DeviceState::FINALIZING_EVENT;
}

bool EventManager::recording() const {
  return state_ == DeviceState::SAVING_EVENT_PRE ||
         state_ == DeviceState::EVENT_RECORDING ||
         state_ == DeviceState::FINALIZING_EVENT;
}

void EventManager::setState(DeviceState next) {
  if (!deviceStateTransitionAllowed(state_, next)) {
    Serial.print("[ERROR] Illegal event state transition: ");
    Serial.print(deviceStateName(state_));
    Serial.print(" -> ");
    Serial.println(deviceStateName(next));
    state_ = DeviceState::STORAGE_ERROR;
    return;
  }
  state_ = next;
}

bool EventManager::buildMetadata(uint64_t nowUs,
                                 const HistoryWindow &window) {
  metadata_ = {};
  const uint64_t sequence = storage_.allocateEventSequence();
  if (sequence == 0) {
    return false;
  }
  const uint32_t nonce = esp_random();
  TimeQuality quality = TimeQuality::UNKNOWN;
  const int64_t utcMs = timeKeeper_.utcFor(nowUs, quality);

  if (utcMs != 0) {
    snprintf(metadata_.eventId, sizeof(metadata_.eventId),
             "ESP32_%s_%lld_%010llu_%08lX", storage_.deviceId(),
             static_cast<long long>(utcMs / 1000LL),
             static_cast<unsigned long long>(sequence),
             static_cast<unsigned long>(nonce));
  } else {
    snprintf(metadata_.eventId, sizeof(metadata_.eventId),
             "ESP32_%s_U%08lX_%010llu_%08lX", storage_.deviceId(),
             static_cast<unsigned long>(timeKeeper_.bootId()),
             static_cast<unsigned long long>(sequence),
             static_cast<unsigned long>(nonce));
  }
  strlcpy(metadata_.deviceId, storage_.deviceId(),
          sizeof(metadata_.deviceId));
  metadata_.eventSequence = sequence;
  metadata_.randomNonce = nonce;
  metadata_.bootId = timeKeeper_.bootId();
  metadata_.eventMonotonicUs = nowUs;
  metadata_.eventUtcMs = utcMs;
  metadata_.timeQuality = quality;
  metadata_.preDurationMs = Config::PRE_EVENT_DURATION_MS;
  metadata_.activeDurationMs = Config::EVENT_DURATION_MS;
  metadata_.preIntervalMs = Config::NORMAL_INTERVAL_MS;
  metadata_.activeIntervalMs = Config::EVENT_INTERVAL_MS;
  metadata_.expectedPreCount = Config::HISTORY_CAPACITY;
  metadata_.expectedActiveCount = Config::EXPECTED_ACTIVE_SAMPLES;
  metadata_.actualPreCount = static_cast<uint16_t>(window.count);
  metadata_.sensorSchemaMask = VALID_LIGHT | VALID_TEMPERATURE |
                               VALID_HUMIDITY | VALID_NOISE;
  return true;
}

TriggerResult EventManager::trigger(uint64_t nowUs) {
  if (recording()) {
    return TriggerResult::ALREADY_RECORDING;
  }
  if (!storage_.ready() || state_ == DeviceState::STORAGE_ERROR) {
    return TriggerResult::STORAGE_UNAVAILABLE;
  }
  if (!storage_.ensureEventReserve()) {
    return TriggerResult::STORAGE_FULL;
  }

  preWindow_ = history_.windowSince(
      nowUs, static_cast<uint64_t>(Config::PRE_EVENT_DURATION_MS) * MS_TO_US);
  if (!buildMetadata(nowUs, preWindow_) ||
      !storage_.beginEvent(metadata_)) {
    return TriggerResult::WRITE_FAILED;
  }

  eventStartUs_ = nowUs;
  eventEndUs_ =
      nowUs + static_cast<uint64_t>(Config::EVENT_DURATION_MS) * MS_TO_US;
  nextActiveDueUs_ =
      nowUs + static_cast<uint64_t>(Config::EVENT_INTERVAL_MS) * MS_TO_US;
  nextPreIndex_ = 0;
  writtenActiveCount_ = 0;
  missedActiveSlots_ = 0;
  activeStageRead_ = 0;
  activeStageWrite_ = 0;
  activeStageCount_ = 0;
  setState(DeviceState::SAVING_EVENT_PRE);

  Serial.print("[INFO] USER_REPORTED_MIGRAINE event started: ");
  Serial.print(metadata_.eventId);
  Serial.print(" pre_samples=");
  Serial.println(preWindow_.count);
  return TriggerResult::STARTED;
}

bool EventManager::stageActiveSample(const SensorSample &sample) {
  if (activeStageCount_ >= Config::ACTIVE_STAGING_CAPACITY) {
    return false;
  }
  activeStaging_[activeStageWrite_] = sample;
  activeStageWrite_ =
      (activeStageWrite_ + 1U) % Config::ACTIVE_STAGING_CAPACITY;
  ++activeStageCount_;
  return true;
}

bool EventManager::drainStagedActiveSamples() {
  while (activeStageCount_ > 0) {
    const SensorSample &sample = activeStaging_[activeStageRead_];
    if (!storage_.appendEventSample(sample, true)) {
      return false;
    }
    activeStageRead_ =
        (activeStageRead_ + 1U) % Config::ACTIVE_STAGING_CAPACITY;
    --activeStageCount_;
    ++writtenActiveCount_;
  }
  return true;
}

void EventManager::captureDueActiveSample(uint64_t nowUs) {
  if (nextActiveDueUs_ > eventEndUs_ || nowUs < nextActiveDueUs_) {
    return;
  }

  const uint64_t intervalUs =
      static_cast<uint64_t>(Config::EVENT_INTERVAL_MS) * MS_TO_US;
  if (nowUs > nextActiveDueUs_) {
    const uint64_t lateSlots = (nowUs - nextActiveDueUs_) / intervalUs;
    if (lateSlots > 0) {
      missedActiveSlots_ += static_cast<uint32_t>(lateSlots);
      nextActiveDueUs_ += lateSlots * intervalUs;
    }
  }
  if (nextActiveDueUs_ > eventEndUs_) {
    return;
  }

  SensorSample sample = sensors_.snapshot(SamplingMode::EVENT_ACTIVE, nowUs);
  bool success = true;
  if (state_ == DeviceState::SAVING_EVENT_PRE) {
    success = stageActiveSample(sample);
  } else {
    success = storage_.appendEventSample(sample, true);
    if (success) {
      ++writtenActiveCount_;
    }
  }
  nextActiveDueUs_ += intervalUs;
  if (!success) {
    failEvent("could not persist active sample");
  }
}

void EventManager::writePreBatch() {
  size_t writtenThisTick = 0;
  while (state_ == DeviceState::SAVING_EVENT_PRE &&
         nextPreIndex_ < preWindow_.count &&
         writtenThisTick < Config::PRE_WRITE_BATCH_RECORDS) {
    SensorSample sample;
    if (!history_.chronologicalAt(preWindow_.logicalStart + nextPreIndex_,
                                  sample)) {
      failEvent("history window changed during capture");
      return;
    }
    timeKeeper_.backfill(sample);
    sample.mode = SamplingMode::EVENT_PRE;
    if (!storage_.appendEventSample(sample, false)) {
      failEvent("could not persist pre-event sample");
      return;
    }
    ++nextPreIndex_;
    ++writtenThisTick;
  }

  if (state_ == DeviceState::SAVING_EVENT_PRE &&
      nextPreIndex_ >= preWindow_.count) {
    if (!storage_.flushEvent() || !drainStagedActiveSamples()) {
      failEvent("could not flush event history");
      return;
    }
    setState(DeviceState::EVENT_RECORDING);
    Serial.println("[INFO] Pre-event history saved; active recording continues");
  }
}

void EventManager::failEvent(const char *reason) {
  Serial.print("[ERROR] Event recording failed: ");
  Serial.println(reason);
  storage_.preserveOpenEventAsIncomplete(
      EventStatus::INCOMPLETE_STORAGE_ERROR);
  setState(DeviceState::STORAGE_ERROR);
}

void EventManager::finalize(uint64_t nowUs) {
  setState(DeviceState::FINALIZING_EVENT);
  if (!drainStagedActiveSamples() ||
      !storage_.finalizeEvent(EventStatus::COMPLETE, nowUs, timeKeeper_)) {
    if (storage_.eventOpen()) {
      storage_.preserveOpenEventAsIncomplete(
          EventStatus::INCOMPLETE_STORAGE_ERROR);
    }
    setState(DeviceState::STORAGE_ERROR);
    return;
  }
  Serial.print("[INFO] Event complete: ");
  Serial.print(metadata_.eventId);
  Serial.print(" pre=");
  Serial.print(metadata_.actualPreCount);
  Serial.print(" active=");
  Serial.print(writtenActiveCount_);
  Serial.print(" missed_slots=");
  Serial.println(missedActiveSlots_);
  setState(DeviceState::NORMAL);
}

void EventManager::tick(uint64_t nowUs) {
  if (!recording()) {
    return;
  }

  captureDueActiveSample(nowUs);
  if (state_ == DeviceState::STORAGE_ERROR) {
    return;
  }
  if (state_ == DeviceState::SAVING_EVENT_PRE) {
    writePreBatch();
  }
  if (state_ == DeviceState::EVENT_RECORDING && nowUs >= eventEndUs_ &&
      nextActiveDueUs_ > eventEndUs_) {
    finalize(nowUs);
  }
}
