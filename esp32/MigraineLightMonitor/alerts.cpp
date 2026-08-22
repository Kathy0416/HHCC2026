#include "alerts.h"

#include "config.h"

namespace {
constexpr uint64_t MS_TO_US = 1000ULL;
}

void AlertManager::begin() {
  pinMode(Config::MOTOR_PIN, OUTPUT);
  setMotor(false);
}

void AlertManager::setMotor(bool enabled) {
  motorOn_ = enabled;
  digitalWrite(Config::MOTOR_PIN,
               enabled ? Config::MOTOR_ACTIVE_LEVEL
                       : Config::MOTOR_INACTIVE_LEVEL);
}

uint8_t AlertManager::priority(AlertPattern pattern) const {
  return static_cast<uint8_t>(pattern);
}

uint8_t AlertManager::phaseCount(AlertPattern pattern) const {
  switch (pattern) {
    case AlertPattern::FEEDBACK:
    case AlertPattern::STORAGE_WARNING:
    case AlertPattern::ENVIRONMENT:
      return 1;
    case AlertPattern::STORAGE_URGENT:
      return 5;  // on/off/on/off/on
    case AlertPattern::STORAGE_CRITICAL:
      return 9;  // five pulses
    case AlertPattern::NONE:
      return 0;
  }
  return 0;
}

uint32_t AlertManager::phaseDurationMs(AlertPattern pattern,
                                       uint8_t phase) const {
  switch (pattern) {
    case AlertPattern::FEEDBACK:
      return 100;
    case AlertPattern::STORAGE_WARNING:
      return 200;
    case AlertPattern::STORAGE_URGENT:
      return 250;
    case AlertPattern::STORAGE_CRITICAL:
      return phaseMotorOn(phase) ? 400 : 200;
    case AlertPattern::ENVIRONMENT:
      return Config::ENVIRONMENT_ALERT_MS;
    case AlertPattern::NONE:
      return 0;
  }
  return 0;
}

void AlertManager::start(AlertPattern pattern, uint64_t nowUs) {
  activePattern_ = pattern;
  phase_ = 0;
  phaseStartedUs_ = nowUs;
  setMotor(pattern != AlertPattern::NONE && phaseMotorOn(phase_));
  if (pattern == AlertPattern::ENVIRONMENT) {
    environmentCooldownUntilUs_ =
        nowUs + static_cast<uint64_t>(Config::ENVIRONMENT_ALERT_MS +
                                      Config::ENVIRONMENT_COOLDOWN_MS) *
                    MS_TO_US;
  }
}

void AlertManager::request(AlertPattern pattern, uint64_t nowUs) {
  if (activePattern_ == AlertPattern::NONE) {
    start(pattern, nowUs);
  } else if (priority(pattern) > priority(queuedPattern_)) {
    queuedPattern_ = pattern;
  }
}

void AlertManager::updateMotor(uint64_t nowUs) {
  if (activePattern_ == AlertPattern::NONE) {
    if (queuedPattern_ != AlertPattern::NONE) {
      const AlertPattern next = queuedPattern_;
      queuedPattern_ = AlertPattern::NONE;
      start(next, nowUs);
    }
    return;
  }

  const uint64_t durationUs =
      static_cast<uint64_t>(phaseDurationMs(activePattern_, phase_)) *
      MS_TO_US;
  if (nowUs - phaseStartedUs_ < durationUs) {
    return;
  }
  ++phase_;
  if (phase_ >= phaseCount(activePattern_)) {
    setMotor(false);
    activePattern_ = AlertPattern::NONE;
    phase_ = 0;
    if (queuedPattern_ != AlertPattern::NONE) {
      const AlertPattern next = queuedPattern_;
      queuedPattern_ = AlertPattern::NONE;
      start(next, nowUs);
    }
    return;
  }
  phaseStartedUs_ = nowUs;
  setMotor(phaseMotorOn(phase_));
}

void AlertManager::updateEnvironmentalQualification(
    uint64_t nowUs, const SensorSample &latest) {
  if (nowUs < environmentCooldownUntilUs_) {
    noiseQualifying_ = false;
    lightQualifying_ = false;
    return;
  }

  const bool noiseHigh = sampleFieldValid(latest, VALID_NOISE) &&
                         latest.noiseDbSpl > Config::NOISE_THRESHOLD_DB;
  if (noiseHigh) {
    if (!noiseQualifying_) {
      noiseQualifying_ = true;
      noiseStartedUs_ = nowUs;
    } else if (nowUs - noiseStartedUs_ >=
               static_cast<uint64_t>(Config::NOISE_TRIGGER_MS) * MS_TO_US) {
      request(AlertPattern::ENVIRONMENT, nowUs);
      noiseQualifying_ = false;
      lightQualifying_ = false;
      Serial.println("[WARN] Environmental alert: sustained high noise");
      return;
    }
  } else {
    noiseQualifying_ = false;
  }

  const bool lightHigh = sampleFieldValid(latest, VALID_LIGHT) &&
                         latest.lightLux > Config::LIGHT_THRESHOLD_LUX;
  if (lightHigh) {
    if (!lightQualifying_) {
      lightQualifying_ = true;
      lightStartedUs_ = nowUs;
    } else if (nowUs - lightStartedUs_ >=
               static_cast<uint64_t>(Config::LIGHT_TRIGGER_MS) * MS_TO_US) {
      request(AlertPattern::ENVIRONMENT, nowUs);
      noiseQualifying_ = false;
      lightQualifying_ = false;
      Serial.println("[WARN] Environmental alert: sustained bright light");
    }
  } else {
    lightQualifying_ = false;
  }
}

void AlertManager::update(uint64_t nowUs, const SensorSample &latest) {
  updateMotor(nowUs);
  updateEnvironmentalQualification(nowUs, latest);
}

void AlertManager::notifyFeedback(uint64_t nowUs) {
  request(AlertPattern::FEEDBACK, nowUs);
}

void AlertManager::notifyStorageRejected(uint64_t nowUs) {
  request(AlertPattern::STORAGE_CRITICAL, nowUs);
}

void AlertManager::notifyStorageUsage(uint8_t percent, uint64_t nowUs) {
  uint8_t band = 0;
  AlertPattern pattern = AlertPattern::NONE;
  uint32_t reminderMs = 0;
  if (percent >= Config::FLASH_CRITICAL_PERCENT) {
    band = 3;
    pattern = AlertPattern::STORAGE_CRITICAL;
    reminderMs = Config::STORAGE_CRITICAL_REMINDER_MS;
  } else if (percent >= Config::FLASH_URGENT_PERCENT) {
    band = 2;
    pattern = AlertPattern::STORAGE_URGENT;
    reminderMs = Config::STORAGE_URGENT_REMINDER_MS;
  } else if (percent >= Config::FLASH_WARNING_PERCENT) {
    band = 1;
    pattern = AlertPattern::STORAGE_WARNING;
    reminderMs = Config::STORAGE_WARNING_REMINDER_MS;
  }

  if (band == 0) {
    lastStorageBand_ = 0;
    return;
  }
  const bool crossedBand = band > lastStorageBand_;
  const bool reminderDue =
      lastStorageWarningUs_ == 0 ||
      nowUs - lastStorageWarningUs_ >=
          static_cast<uint64_t>(reminderMs) * MS_TO_US;
  if (crossedBand || reminderDue) {
    request(pattern, nowUs);
    lastStorageWarningUs_ = nowUs;
  }
  lastStorageBand_ = band;
}

void AlertManager::manualMotorTest(uint64_t nowUs) {
  request(AlertPattern::ENVIRONMENT, nowUs);
}

const char *AlertManager::activeLabel() const {
  switch (activePattern_) {
    case AlertPattern::FEEDBACK:
      return "BUTTON";
    case AlertPattern::STORAGE_WARNING:
      return "FLASH 80%";
    case AlertPattern::STORAGE_URGENT:
      return "FLASH 90%";
    case AlertPattern::STORAGE_CRITICAL:
      return "FLASH FULL";
    case AlertPattern::ENVIRONMENT:
      return "ENV ALERT";
    case AlertPattern::NONE:
      return nullptr;
  }
  return nullptr;
}
