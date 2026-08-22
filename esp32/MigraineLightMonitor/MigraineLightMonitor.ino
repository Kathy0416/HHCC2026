/*
  Migraine monitor: capture locally first, synchronize later.

  ESP32 DevKit V1 wiring:
    I2C OLED/BH1750/SHT31: SDA GPIO21, SCL GPIO22
    INMP441: BCLK GPIO18, WS GPIO19, SD GPIO23, L/R to GND
    Motor driver input: GPIO15
    User-reported migraine button: GPIO4 to GND (INPUT_PULLUP)

  Wi-Fi is used for captive-portal provisioning and NTP time synchronization.
  This firmware contains no BLE, JWT, database, or ML code.
*/

#include <Arduino.h>
#include <Wire.h>

#include "alerts.h"
#include "circular_buffer.h"
#include "config.h"
#include "display_manager.h"
#include "event_manager.h"
#include "network_manager.h"
#include "sensors.h"
#include "serial_console.h"
#include "storage.h"
#include "time_keeper.h"
#include "time_sync_manager.h"

namespace {
constexpr uint64_t MS_TO_US = 1000ULL;

TimeKeeper timeKeeper;
WifiProvisioningManager network;
TimeSyncManager timeSync(timeKeeper, network);
HistoryBuffer history;
StorageManager storage;
SensorManager sensors(timeKeeper);
AlertManager alerts;
DisplayManager displayManager;
EventManager events(sensors, timeKeeper, history, storage);
SerialConsole console(timeKeeper, storage, events, history, alerts, network,
                      timeSync);

bool lastRawButton = HIGH;
bool stableButton = HIGH;
uint64_t buttonChangedUs = 0;
uint64_t nextNormalSampleUs = 0;
uint64_t nextBaselineSampleUs = 0;
uint64_t nextFlashHealthUs = 0;
bool lastPortalActive = false;

void printSample(const SensorSample &sample) {
  Serial.print("[SAMPLE] mode=");
  Serial.print(samplingModeName(sample.mode));
  Serial.print(" mono_us=");
  char number[32];
  snprintf(number, sizeof(number), "%llu",
           static_cast<unsigned long long>(sample.monotonicUs));
  Serial.print(number);
  Serial.print(" utc_ms=");
  if (sample.utcEpochMs == 0) {
    Serial.print("null");
  } else {
    snprintf(number, sizeof(number), "%lld",
             static_cast<long long>(sample.utcEpochMs));
    Serial.print(number);
  }
  Serial.print(" light=");
  sampleFieldValid(sample, VALID_LIGHT) ? Serial.print(sample.lightLux, 1)
                                        : Serial.print("null");
  Serial.print(" temp=");
  sampleFieldValid(sample, VALID_TEMPERATURE)
      ? Serial.print(sample.temperatureC, 1)
      : Serial.print("null");
  Serial.print(" humidity=");
  sampleFieldValid(sample, VALID_HUMIDITY)
      ? Serial.print(sample.humidityPercent, 1)
      : Serial.print("null");
  Serial.print(" noise=");
  sampleFieldValid(sample, VALID_NOISE) ? Serial.print(sample.noiseDbSpl, 1)
                                        : Serial.print("null");
  Serial.println();
}

// 生成一行可供 HTTP 数据端点 GET /data 返回、且能被前端 Esp32Parser 解析的 [SAMPLE] 文本。
// 传感器无效字段输出 "null"（前端会跳过该行）；utc_ms 需 NTP 同步后才有值。
String formatSampleLine(const SensorSample &sample) {
  char number[40];
  String line = F("[SAMPLE] mode=");
  line += samplingModeName(sample.mode);
  line += F(" mono_us=");
  snprintf(number, sizeof(number), "%llu",
           static_cast<unsigned long long>(sample.monotonicUs));
  line += number;
  line += F(" utc_ms=");
  if (sample.utcEpochMs != 0) {
    snprintf(number, sizeof(number), "%lld",
             static_cast<long long>(sample.utcEpochMs));
    line += number;
  } else {
    line += F("null");
  }
  line += F(" light=");
  if (sampleFieldValid(sample, VALID_LIGHT)) {
    line += String(sample.lightLux, 1);
  } else {
    line += F("null");
  }
  line += F(" temp=");
  if (sampleFieldValid(sample, VALID_TEMPERATURE)) {
    line += String(sample.temperatureC, 1);
  } else {
    line += F("null");
  }
  line += F(" humidity=");
  if (sampleFieldValid(sample, VALID_HUMIDITY)) {
    line += String(sample.humidityPercent, 1);
  } else {
    line += F("null");
  }
  line += F(" noise=");
  if (sampleFieldValid(sample, VALID_NOISE)) {
    line += String(sample.noiseDbSpl, 1);
  } else {
    line += F("null");
  }
  return line;
}

void handleButton(uint64_t nowUs) {
  const bool raw = digitalRead(Config::BUTTON_PIN);
  if (raw != lastRawButton) {
    lastRawButton = raw;
    buttonChangedUs = nowUs;
  }
  if (raw == stableButton ||
      nowUs - buttonChangedUs <
          static_cast<uint64_t>(Config::BUTTON_DEBOUNCE_MS) * MS_TO_US) {
    return;
  }
  stableButton = raw;
  if (stableButton != LOW) {
    return;
  }

  const TriggerResult result = events.trigger(nowUs);
  switch (result) {
    case TriggerResult::STARTED:
      alerts.notifyFeedback(nowUs);
      displayManager.showTransient("Migraine reported", "Saving last hour",
                                   nowUs);
      break;
    case TriggerResult::ALREADY_RECORDING:
      alerts.notifyFeedback(nowUs);
      displayManager.showTransient("Already recording", "Button ignored",
                                   nowUs);
      break;
    case TriggerResult::STORAGE_FULL:
      alerts.notifyStorageRejected(nowUs);
      displayManager.showTransient("SYNC REQUIRED", "Flash reserve full",
                                   nowUs, 5000);
      Serial.println("[ERROR] Event rejected: no protected flash reserve");
      break;
    case TriggerResult::STORAGE_UNAVAILABLE:
      alerts.notifyStorageRejected(nowUs);
      displayManager.showTransient("STORAGE ERROR", "Event not started",
                                   nowUs, 5000);
      Serial.println("[ERROR] Event rejected: storage unavailable");
      break;
    case TriggerResult::WRITE_FAILED:
      alerts.notifyStorageRejected(nowUs);
      displayManager.showTransient("WRITE FAILED", "Partial preserved", nowUs,
                                   5000);
      Serial.println("[ERROR] Event rejected: initial flash write failed");
      break;
  }
}

}  // namespace

void setup() {
  pinMode(Config::BUTTON_PIN, INPUT_PULLUP);
  Serial.begin(115200);
  delay(250);
  Serial.println();
  Serial.println("[INFO] Migraine monitor starting");

  Wire.begin(Config::I2C_SDA_PIN, Config::I2C_SCL_PIN);
  timeKeeper.begin();
  alerts.begin();
  displayManager.begin(timeKeeper.monotonicUs());
  storage.begin();

  const uint64_t nowUs = timeKeeper.monotonicUs();
  sensors.begin(nowUs);
  events.begin();
  console.begin();
  timeSync.begin();
  network.begin(nowUs);
  // 让 ESP32 的 HTTP 数据端点 GET /data 返回最新环境样本（供前端 Sync ESP32 data 拉取）。
  network.setDataProvider([&]() -> String { return formatSampleLine(sensors.latest()); });

  nextNormalSampleUs = nowUs;
  nextBaselineSampleUs =
      nowUs + static_cast<uint64_t>(Config::BASELINE_INTERVAL_MS) * MS_TO_US;
  nextFlashHealthUs = nowUs;
  Serial.println("[INFO] Sensor sampling started");
}

void loop() {
  const uint64_t nowUs = timeKeeper.monotonicUs();
  sensors.update(nowUs);
  alerts.update(nowUs, sensors.latest());
  handleButton(nowUs);
  events.tick(nowUs);
  network.tick(nowUs);
  timeSync.tick(nowUs);
  console.tick(nowUs);

  if (network.portalActive() && !lastPortalActive) {
    displayManager.showNetworkSetup(network.portalSsid(),
                                    Config::WIFI_SETUP_PASSWORD, nowUs);
  }
  lastPortalActive = network.portalActive();

  if (!events.suspendsNormalSampling() && nowUs >= nextNormalSampleUs) {
    const SensorSample sample =
        sensors.snapshot(SamplingMode::NORMAL, nowUs);
    history.push(sample);
    printSample(sample);
    nextNormalSampleUs =
        nowUs + static_cast<uint64_t>(Config::NORMAL_INTERVAL_MS) * MS_TO_US;
  }

  if (events.state() == DeviceState::NORMAL &&
      nowUs >= nextBaselineSampleUs) {
    SensorSample baseline =
        sensors.snapshot(SamplingMode::BASELINE, nowUs);
    if (storage.appendBaseline(baseline)) {
      Serial.println("[INFO] Baseline sample persisted");
    }
    nextBaselineSampleUs =
        nowUs + static_cast<uint64_t>(Config::BASELINE_INTERVAL_MS) * MS_TO_US;
  }

  if (nowUs >= nextFlashHealthUs) {
    alerts.notifyStorageUsage(storage.usagePercent(), nowUs);
    storage.maintainCapacity();
    nextFlashHealthUs =
        nowUs +
        static_cast<uint64_t>(Config::FLASH_HEALTH_INTERVAL_MS) * MS_TO_US;
  }

  displayManager.update(
      nowUs, sensors.latest(), events.state(), events.activeSampleCount(),
      events.expectedActiveSampleCount(), storage.usagePercent(),
      storage.ready(), alerts);
  delay(1);
}
