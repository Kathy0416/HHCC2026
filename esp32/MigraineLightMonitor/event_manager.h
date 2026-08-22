#pragma once

#include "circular_buffer.h"
#include "data_types.h"
#include "sensors.h"
#include "storage.h"
#include "time_keeper.h"

class EventManager {
 public:
  EventManager(SensorManager &sensors, TimeKeeper &timeKeeper,
               HistoryBuffer &history, StorageManager &storage)
      : sensors_(sensors),
        timeKeeper_(timeKeeper),
        history_(history),
        storage_(storage) {}

  void begin();
  TriggerResult trigger(uint64_t nowUs);
  void tick(uint64_t nowUs);

  DeviceState state() const { return state_; }
  bool suspendsNormalSampling() const;
  bool recording() const;
  uint32_t activeSampleCount() const { return writtenActiveCount_; }
  uint32_t expectedActiveSampleCount() const {
    return Config::EXPECTED_ACTIVE_SAMPLES;
  }
  const char *eventId() const { return metadata_.eventId; }
  uint32_t missedActiveSlots() const { return missedActiveSlots_; }

 private:
  bool buildMetadata(uint64_t nowUs, const HistoryWindow &window);
  void captureDueActiveSample(uint64_t nowUs);
  bool stageActiveSample(const SensorSample &sample);
  bool drainStagedActiveSamples();
  void writePreBatch();
  void setState(DeviceState next);
  void failEvent(const char *reason);
  void finalize(uint64_t nowUs);

  SensorManager &sensors_;
  TimeKeeper &timeKeeper_;
  HistoryBuffer &history_;
  StorageManager &storage_;

  DeviceState state_ = DeviceState::NORMAL;
  EventMetadata metadata_;
  HistoryWindow preWindow_;
  size_t nextPreIndex_ = 0;

  uint64_t eventStartUs_ = 0;
  uint64_t eventEndUs_ = 0;
  uint64_t nextActiveDueUs_ = 0;
  uint32_t writtenActiveCount_ = 0;
  uint32_t missedActiveSlots_ = 0;

  SensorSample activeStaging_[Config::ACTIVE_STAGING_CAPACITY] = {};
  size_t activeStageRead_ = 0;
  size_t activeStageWrite_ = 0;
  size_t activeStageCount_ = 0;
};
