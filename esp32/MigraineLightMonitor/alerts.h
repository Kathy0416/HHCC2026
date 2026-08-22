#pragma once

#include <Arduino.h>

#include "data_types.h"

enum class AlertPattern : uint8_t {
  NONE = 0,
  FEEDBACK = 1,
  STORAGE_WARNING = 2,
  STORAGE_URGENT = 3,
  ENVIRONMENT = 4,
  STORAGE_CRITICAL = 5,
};

class AlertManager {
 public:
  void begin();
  void update(uint64_t nowUs, const SensorSample &latest);
  void notifyFeedback(uint64_t nowUs);
  void notifyStorageRejected(uint64_t nowUs);
  void notifyStorageUsage(uint8_t percent, uint64_t nowUs);
  void manualMotorTest(uint64_t nowUs);

  bool motorActive() const { return motorOn_; }
  const char *activeLabel() const;

 private:
  void request(AlertPattern pattern, uint64_t nowUs);
  void start(AlertPattern pattern, uint64_t nowUs);
  void updateMotor(uint64_t nowUs);
  uint8_t phaseCount(AlertPattern pattern) const;
  uint32_t phaseDurationMs(AlertPattern pattern, uint8_t phase) const;
  bool phaseMotorOn(uint8_t phase) const { return (phase % 2U) == 0; }
  uint8_t priority(AlertPattern pattern) const;
  void setMotor(bool enabled);
  void updateEnvironmentalQualification(uint64_t nowUs,
                                        const SensorSample &latest);

  AlertPattern activePattern_ = AlertPattern::NONE;
  AlertPattern queuedPattern_ = AlertPattern::NONE;
  uint8_t phase_ = 0;
  bool motorOn_ = false;
  uint64_t phaseStartedUs_ = 0;

  bool noiseQualifying_ = false;
  bool lightQualifying_ = false;
  uint64_t noiseStartedUs_ = 0;
  uint64_t lightStartedUs_ = 0;
  uint64_t environmentCooldownUntilUs_ = 0;

  uint8_t lastStorageBand_ = 0;
  uint64_t lastStorageWarningUs_ = 0;
};
