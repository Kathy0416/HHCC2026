#pragma once

#include <Arduino.h>
#include <math.h>

enum class SamplingMode : uint8_t {
  NORMAL = 0,
  EVENT_PRE = 1,
  EVENT_ACTIVE = 2,
  BASELINE = 3,
};

enum class TimeQuality : uint8_t {
  UNKNOWN = 0,
  SYNCED = 1,
  BACKFILLED = 2,
  ESTIMATED = 3,  // Reserved for a future browser/backend decision.
};

enum SensorValidity : uint8_t {
  VALID_LIGHT = 1U << 0,
  VALID_TEMPERATURE = 1U << 1,
  VALID_HUMIDITY = 1U << 2,
  VALID_NOISE = 1U << 3,
};

enum class DeviceState : uint8_t {
  NORMAL = 0,
  SAVING_EVENT_PRE = 1,
  EVENT_RECORDING = 2,
  FINALIZING_EVENT = 3,
  STORAGE_ERROR = 4,
};

enum class EventStatus : uint8_t {
  RECORDING = 0,
  COMPLETE = 1,
  INCOMPLETE_POWER_LOSS = 2,
  INCOMPLETE_STORAGE_ERROR = 3,
  CORRUPT = 4,
};

enum class TriggerResult : uint8_t {
  STARTED = 0,
  ALREADY_RECORDING = 1,
  STORAGE_UNAVAILABLE = 2,
  STORAGE_FULL = 3,
  WRITE_FAILED = 4,
};

struct SensorSample {
  uint64_t monotonicUs = 0;
  int64_t utcEpochMs = 0;  // Zero means unknown/null.
  uint32_t bootId = 0;
  float lightLux = NAN;
  float temperatureC = NAN;
  float humidityPercent = NAN;
  float noiseDbSpl = NAN;
  SamplingMode mode = SamplingMode::NORMAL;
  TimeQuality timeQuality = TimeQuality::UNKNOWN;
  uint8_t validMask = 0;
  uint8_t reserved = 0;
};

struct ClockAnchor {
  bool valid = false;
  uint32_t bootId = 0;
  uint64_t monotonicUs = 0;
  int64_t utcEpochMs = 0;
};

constexpr size_t EVENT_ID_CAPACITY = 64;
constexpr size_t DEVICE_ID_CAPACITY = 13;

struct EventMetadata {
  char eventId[EVENT_ID_CAPACITY] = {};
  char deviceId[DEVICE_ID_CAPACITY] = {};
  uint64_t eventSequence = 0;
  uint32_t randomNonce = 0;
  uint32_t bootId = 0;
  uint64_t eventMonotonicUs = 0;
  int64_t eventUtcMs = 0;
  TimeQuality timeQuality = TimeQuality::UNKNOWN;
  uint32_t preDurationMs = 0;
  uint32_t activeDurationMs = 0;
  uint32_t preIntervalMs = 0;
  uint32_t activeIntervalMs = 0;
  uint16_t expectedPreCount = 0;
  uint16_t expectedActiveCount = 0;
  uint16_t actualPreCount = 0;
  uint16_t sensorSchemaMask = 0;
};

struct EventDescriptor {
  char eventId[EVENT_ID_CAPACITY] = {};
  char path[112] = {};
  EventStatus status = EventStatus::CORRUPT;
  uint32_t sampleCount = 0;
  size_t fileSize = 0;
};

inline bool sampleFieldValid(const SensorSample &sample,
                             SensorValidity validity) {
  return (sample.validMask & static_cast<uint8_t>(validity)) != 0;
}

const char *samplingModeName(SamplingMode mode);
const char *timeQualityName(TimeQuality quality);
const char *deviceStateName(DeviceState state);
const char *eventStatusName(EventStatus status);
bool deviceStateTransitionAllowed(DeviceState from, DeviceState to);
