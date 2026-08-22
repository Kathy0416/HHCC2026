#include "display_manager.h"

#include <Wire.h>
#include <string.h>

#include "config.h"

namespace {
constexpr uint64_t MS_TO_US = 1000ULL;
}

DisplayManager::DisplayManager()
    : display_(Config::SCREEN_WIDTH, Config::SCREEN_HEIGHT, &Wire,
               Config::OLED_RESET_PIN) {}

bool DisplayManager::begin(uint64_t nowUs) {
  ready_ = display_.begin(SSD1306_SWITCHCAPVCC, Config::OLED_ADDRESS);
  nextRetryUs_ =
      nowUs + static_cast<uint64_t>(Config::SENSOR_RETRY_MS) * MS_TO_US;
  if (!ready_) {
    Serial.println(
        "[ERROR] SSD1306 initialization failed; retrying independently");
    return false;
  }
  display_.clearDisplay();
  display_.setTextColor(SSD1306_WHITE);
  display_.setTextSize(1);
  display_.setCursor(0, 20);
  display_.println("Migraine monitor");
  display_.setCursor(0, 34);
  display_.println("Starting...");
  display_.display();
  return true;
}

void DisplayManager::showTransient(const char *line1, const char *line2,
                                   uint64_t nowUs, uint32_t durationMs) {
  strlcpy(transientLine1_, line1 == nullptr ? "" : line1,
          sizeof(transientLine1_));
  strlcpy(transientLine2_, line2 == nullptr ? "" : line2,
          sizeof(transientLine2_));
  networkSetupTransient_ = false;
  transientUntilUs_ = nowUs + static_cast<uint64_t>(durationMs) * MS_TO_US;
  lastRefreshUs_ = 0;
}

void DisplayManager::showNetworkSetup(const char *ssid, const char *password,
                                      uint64_t nowUs, uint32_t durationMs) {
  memset(setupSsidLine1_, 0, sizeof(setupSsidLine1_));
  memset(setupSsidLine2_, 0, sizeof(setupSsidLine2_));
  if (ssid != nullptr) {
    strncpy(setupSsidLine1_, ssid, sizeof(setupSsidLine1_) - 1U);
    if (strlen(ssid) > sizeof(setupSsidLine1_) - 1U) {
      strncpy(setupSsidLine2_, ssid + sizeof(setupSsidLine1_) - 1U,
              sizeof(setupSsidLine2_) - 1U);
    }
  }
  strlcpy(setupPassword_, password == nullptr ? "" : password,
          sizeof(setupPassword_));
  networkSetupTransient_ = true;
  transientUntilUs_ = nowUs + static_cast<uint64_t>(durationMs) * MS_TO_US;
  lastRefreshUs_ = 0;
}

const char *DisplayManager::classifyLight(float lux) const {
  if (lux < 10.0F) return "Dark";
  if (lux < 100.0F) return "Dim";
  if (lux < 500.0F) return "Normal";
  return "Bright";
}

void DisplayManager::printValueOrDash(float value, bool valid,
                                      uint8_t decimals) {
  if (valid) {
    display_.print(value, decimals);
  } else {
    display_.print("--");
  }
}

void DisplayManager::update(uint64_t nowUs, const SensorSample &sample,
                            DeviceState state, uint32_t activeCount,
                            uint32_t expectedActiveCount,
                            uint8_t flashPercent, bool storageReady,
                            const AlertManager &alerts) {
  if (!ready_) {
    if (nowUs >= nextRetryUs_) {
      begin(nowUs);
    }
    return;
  }
  if (lastRefreshUs_ != 0 &&
       nowUs - lastRefreshUs_ <
           static_cast<uint64_t>(Config::DISPLAY_REFRESH_MS) * MS_TO_US) {
    return;
  }
  lastRefreshUs_ = nowUs;
  display_.clearDisplay();
  display_.setTextColor(SSD1306_WHITE);
  display_.setTextSize(1);

  if (nowUs < transientUntilUs_) {
    if (networkSetupTransient_) {
      display_.setCursor(0, 0);
      display_.println("WiFi setup");
      display_.setCursor(0, 13);
      display_.println(setupSsidLine1_);
      display_.setCursor(0, 25);
      display_.println(setupSsidLine2_);
      display_.setCursor(0, 38);
      display_.println("Open 192.168.4.1");
      display_.setCursor(0, 50);
      display_.print("PW ");
      display_.println(setupPassword_);
      display_.display();
      return;
    }
    display_.drawFastHLine(0, 15, Config::SCREEN_WIDTH, SSD1306_WHITE);
    display_.setCursor(0, 20);
    display_.println(transientLine1_);
    display_.setCursor(0, 34);
    display_.println(transientLine2_);
    display_.display();
    return;
  }

  display_.setCursor(0, 0);
  const char *alertLabel = alerts.activeLabel();
  if (!storageReady || state == DeviceState::STORAGE_ERROR) {
    display_.print("STORAGE ERROR");
  } else if (state == DeviceState::SAVING_EVENT_PRE) {
    display_.print("Saving history");
  } else if (state == DeviceState::EVENT_RECORDING ||
             state == DeviceState::FINALIZING_EVENT) {
    display_.print("REC ");
    display_.print(activeCount);
    display_.print('/');
    display_.print(expectedActiveCount);
  } else if (alertLabel != nullptr) {
    display_.print(alertLabel);
  } else {
    display_.print("Monitoring");
  }
  display_.setCursor(101, 0);
  display_.print(flashPercent);
  display_.print('%');
  display_.drawFastHLine(0, 15, Config::SCREEN_WIDTH, SSD1306_WHITE);

  display_.setCursor(0, 18);
  display_.print("Light ");
  printValueOrDash(sample.lightLux, sampleFieldValid(sample, VALID_LIGHT), 1);
  display_.print(" ");
  display_.print(sampleFieldValid(sample, VALID_LIGHT)
                     ? classifyLight(sample.lightLux)
                     : "--");

  display_.setCursor(0, 29);
  display_.print("Temp  ");
  printValueOrDash(sample.temperatureC,
                   sampleFieldValid(sample, VALID_TEMPERATURE), 1);
  display_.print(" C");

  display_.setCursor(0, 40);
  display_.print("Hum   ");
  printValueOrDash(sample.humidityPercent,
                   sampleFieldValid(sample, VALID_HUMIDITY), 1);
  display_.print(" %");

  display_.setCursor(0, 51);
  display_.print("Noise ");
  printValueOrDash(sample.noiseDbSpl, sampleFieldValid(sample, VALID_NOISE), 1);
  display_.print(" dB");
  display_.display();
}
