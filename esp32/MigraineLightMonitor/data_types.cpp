#include "data_types.h"

const char *samplingModeName(SamplingMode mode) {
  switch (mode) {
    case SamplingMode::NORMAL:
      return "NORMAL";
    case SamplingMode::EVENT_PRE:
      return "EVENT_PRE";
    case SamplingMode::EVENT_ACTIVE:
      return "EVENT_ACTIVE";
    case SamplingMode::BASELINE:
      return "BASELINE";
  }
  return "UNKNOWN";
}

const char *timeQualityName(TimeQuality quality) {
  switch (quality) {
    case TimeQuality::UNKNOWN:
      return "UNKNOWN";
    case TimeQuality::SYNCED:
      return "SYNCED";
    case TimeQuality::BACKFILLED:
      return "BACKFILLED";
    case TimeQuality::ESTIMATED:
      return "ESTIMATED";
  }
  return "UNKNOWN";
}

const char *deviceStateName(DeviceState state) {
  switch (state) {
    case DeviceState::NORMAL:
      return "NORMAL";
    case DeviceState::SAVING_EVENT_PRE:
      return "SAVING_EVENT_PRE";
    case DeviceState::EVENT_RECORDING:
      return "EVENT_RECORDING";
    case DeviceState::FINALIZING_EVENT:
      return "FINALIZING_EVENT";
    case DeviceState::STORAGE_ERROR:
      return "STORAGE_ERROR";
  }
  return "UNKNOWN";
}

const char *eventStatusName(EventStatus status) {
  switch (status) {
    case EventStatus::RECORDING:
      return "RECORDING";
    case EventStatus::COMPLETE:
      return "COMPLETE";
    case EventStatus::INCOMPLETE_POWER_LOSS:
      return "INCOMPLETE_POWER_LOSS";
    case EventStatus::INCOMPLETE_STORAGE_ERROR:
      return "INCOMPLETE_STORAGE_ERROR";
    case EventStatus::CORRUPT:
      return "CORRUPT";
  }
  return "UNKNOWN";
}

bool deviceStateTransitionAllowed(DeviceState from, DeviceState to) {
  if (from == to) {
    return true;
  }
  switch (from) {
    case DeviceState::NORMAL:
      return to == DeviceState::SAVING_EVENT_PRE ||
             to == DeviceState::STORAGE_ERROR;
    case DeviceState::SAVING_EVENT_PRE:
      return to == DeviceState::EVENT_RECORDING ||
             to == DeviceState::STORAGE_ERROR;
    case DeviceState::EVENT_RECORDING:
      return to == DeviceState::FINALIZING_EVENT ||
             to == DeviceState::STORAGE_ERROR;
    case DeviceState::FINALIZING_EVENT:
      return to == DeviceState::NORMAL ||
             to == DeviceState::STORAGE_ERROR;
    case DeviceState::STORAGE_ERROR:
      return to == DeviceState::NORMAL;
  }
  return false;
}
