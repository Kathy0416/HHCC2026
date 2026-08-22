#pragma once

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#include "alerts.h"
#include "data_types.h"

class DisplayManager {
 public:
  DisplayManager();
  bool begin(uint64_t nowUs);
  bool ready() const { return ready_; }
  void showTransient(const char *line1, const char *line2, uint64_t nowUs,
                     uint32_t durationMs = 2500);
  void update(uint64_t nowUs, const SensorSample &sample, DeviceState state,
              uint32_t activeCount, uint32_t expectedActiveCount,
              uint8_t flashPercent, bool storageReady,
              const AlertManager &alerts);

 private:
  const char *classifyLight(float lux) const;
  void printValueOrDash(float value, bool valid, uint8_t decimals);

  Adafruit_SSD1306 display_;
  bool ready_ = false;
  uint64_t nextRetryUs_ = 0;
  uint64_t lastRefreshUs_ = 0;
  uint64_t transientUntilUs_ = 0;
  char transientLine1_[22] = {};
  char transientLine2_[22] = {};
};
