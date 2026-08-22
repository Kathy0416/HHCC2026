#pragma once

#include <Arduino.h>

namespace Config {

// Hardware pins and addresses (classic ESP32 DevKit V1).
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;
constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr uint8_t BH1750_ADDRESS = 0x23;
constexpr uint8_t SHT31_ADDRESS = 0x44;

constexpr int MIC_BCLK_PIN = 18;
constexpr int MIC_WS_PIN = 19;
constexpr int MIC_DATA_PIN = 23;
constexpr uint32_t MIC_SAMPLE_RATE = 48000;
constexpr size_t MIC_BLOCK_SAMPLES = 256;
constexpr float MIC_CALIBRATION_DB = 0.0F;
constexpr float MIC_DB_SPL_OFFSET = 120.0F;
constexpr float MIC_SMOOTHING_ALPHA = 0.20F;
constexpr float MIC_MIN_VALID_RMS = 1.0F;

constexpr int MOTOR_PIN = 15;
constexpr uint8_t MOTOR_ACTIVE_LEVEL = HIGH;
constexpr uint8_t MOTOR_INACTIVE_LEVEL = LOW;
constexpr int BUTTON_PIN = 4;

constexpr int SCREEN_WIDTH = 128;
constexpr int SCREEN_HEIGHT = 64;
constexpr int OLED_RESET_PIN = -1;

// Acquisition intervals and history capacity.
constexpr uint32_t NORMAL_INTERVAL_MS = 5000;
constexpr uint32_t BASELINE_INTERVAL_MS = 300000;
constexpr uint32_t EVENT_INTERVAL_MS = 1000;
constexpr uint32_t PRE_EVENT_DURATION_MS = 3600000;
constexpr uint32_t EVENT_DURATION_MS = 600000;
constexpr size_t HISTORY_CAPACITY =
    PRE_EVENT_DURATION_MS / NORMAL_INTERVAL_MS;  // 720
constexpr size_t EXPECTED_ACTIVE_SAMPLES =
    EVENT_DURATION_MS / EVENT_INTERVAL_MS;  // 600
constexpr size_t PRE_WRITE_BATCH_RECORDS = 32;
constexpr size_t ACTIVE_STAGING_CAPACITY = 16;

// Periodic work.
constexpr uint32_t SENSOR_REFRESH_MS = 500;
constexpr uint32_t SENSOR_RETRY_MS = 30000;
constexpr uint32_t DISPLAY_REFRESH_MS = 500;
constexpr uint32_t FLASH_HEALTH_INTERVAL_MS = 60000;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 30;

// Sensor plausibility ranges. Raw finite values are retained even when their
// validity bit is cleared.
constexpr float LIGHT_MIN_LUX = 0.0F;
constexpr float LIGHT_MAX_LUX = 65535.0F;
constexpr float TEMPERATURE_MIN_C = -40.0F;
constexpr float TEMPERATURE_MAX_C = 125.0F;
constexpr float HUMIDITY_MIN_PERCENT = 0.0F;
constexpr float HUMIDITY_MAX_PERCENT = 100.0F;
constexpr float NOISE_MIN_DB_SPL = 0.0F;
constexpr float NOISE_MAX_DB_SPL = 140.0F;

// Existing environmental alerts.
constexpr float NOISE_THRESHOLD_DB = 80.0F;
constexpr float LIGHT_THRESHOLD_LUX = 1000.0F;
constexpr uint32_t NOISE_TRIGGER_MS = 3000;
constexpr uint32_t LIGHT_TRIGGER_MS = 5000;
constexpr uint32_t ENVIRONMENT_ALERT_MS = 5000;
constexpr uint32_t ENVIRONMENT_COOLDOWN_MS = 60000;

// Persistent storage policy.
constexpr uint8_t FLASH_WARNING_PERCENT = 80;
constexpr uint8_t FLASH_URGENT_PERCENT = 90;
constexpr uint8_t FLASH_CRITICAL_PERCENT = 95;
constexpr size_t EVENT_RESERVE_BYTES = 96UL * 1024UL;
constexpr size_t BASELINE_SEGMENT_RECORDS = 288;  // 24 hours at 5 minutes.
constexpr uint32_t STORAGE_WARNING_REMINDER_MS = 30UL * 60UL * 1000UL;
constexpr uint32_t STORAGE_URGENT_REMINDER_MS = 10UL * 60UL * 1000UL;
constexpr uint32_t STORAGE_CRITICAL_REMINDER_MS = 2UL * 60UL * 1000UL;

constexpr const char *EVENT_DIRECTORY = "/events";
constexpr const char *BASELINE_DIRECTORY = "/baseline";
constexpr const char *LEGACY_LOG_PATHS[2] = {"/migraine0.csv",
                                             "/migraine1.csv"};

// Production builds expose no Serial command that deletes event data. Set to
// true only in an explicitly disposable hardware-test build.
constexpr bool ENABLE_TEST_DELETE_COMMAND = false;

}  // namespace Config

static_assert(Config::HISTORY_CAPACITY == 720,
              "One-hour history must contain 720 five-second samples");
static_assert(Config::EXPECTED_ACTIVE_SAMPLES == 600,
              "Ten-minute active window must contain 600 one-second slots");
