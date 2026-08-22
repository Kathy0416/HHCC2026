/*
  Migraine Light Monitor

  Wiring:

    ESP32        OLED          BH1750       GY-SHT31
    3.3V         VCC           VCC          VCC/VIN
    GND          GND           GND          GND
    GPIO 21      SDA           SDA          SDA
    GPIO 22      SCL           SCL          SCL

    ESP32        INMP441 (I2S microphone)
    3.3V         VDD
    GND          GND
    GPIO 18      SCK/BCLK
    GPIO 19      WS/LRCL
    GPIO 23      SD
    GND          L/R (selects the left channel)

    ESP32        Motor module (pins: IN, VCC, GND)
    GPIO 15 (D15) IN
    GND          GND (the ESP32 and motor module must share ground)
    Rated supply VCC (use 3.3V or 5V only if specified by the module)

  The motor module must contain its own transistor/driver and flyback diode.
  Do not connect a bare motor directly to GPIO 15. Confirm that the module's
  IN pin accepts the ESP32's 3.3V logic level.

    ESP32        Migraine record button
    GPIO 4       One side of button
    GND          Opposite side of button

  Leave the BH1750 ADDR pin disconnected or connect it to GND.

  Required Arduino libraries:
    - BH1750 by Christopher Laws
    - Adafruit SSD1306
    - Adafruit GFX Library
    - Adafruit SHT31 Library
*/

#include <Wire.h>
#include <driver/i2s.h>
#include <math.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <BH1750.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_SHT31.h>

// Change these constants if your board or modules use different settings.
constexpr int I2C_SDA_PIN = 21;
constexpr int I2C_SCL_PIN = 22;
constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr uint8_t BH1750_ADDRESS = 0x23;
constexpr uint8_t SHT31_ADDRESS = 0x44;

constexpr i2s_port_t MIC_I2S_PORT = I2S_NUM_0;
constexpr int MIC_BCLK_PIN = 18;
constexpr int MIC_WS_PIN = 19;
constexpr int MIC_DATA_PIN = 23;
constexpr uint32_t MIC_SAMPLE_RATE = 48000;
constexpr size_t MIC_BLOCK_SAMPLES = 256;

// Adjust this after comparing the result with a reference sound-level meter.
constexpr float MIC_CALIBRATION_DB = 0.0F;
constexpr float MIC_DB_SPL_OFFSET = 120.0F;  // 94 dB SPL - (-26 dBFS)
constexpr float MIC_SMOOTHING_ALPHA = 0.20F;
constexpr float MIC_MIN_VALID_RMS = 1.0F;

constexpr int MOTOR_PIN = 15;
// Most three-pin motor modules turn on when IN is HIGH. Change this to LOW if
// your module is marked "low-level trigger" or runs when the ESP32 starts.
constexpr uint8_t MOTOR_ACTIVE_LEVEL = HIGH;
constexpr uint8_t MOTOR_INACTIVE_LEVEL =
    MOTOR_ACTIVE_LEVEL == HIGH ? LOW : HIGH;
constexpr float NOISE_THRESHOLD_DB = 80.0F;
constexpr float LIGHT_THRESHOLD_LUX = 1000.0F;
constexpr unsigned long NOISE_TRIGGER_MS = 3000;
constexpr unsigned long LIGHT_TRIGGER_MS = 5000;
constexpr unsigned long MOTOR_DURATION_MS = 5000;
constexpr unsigned long ALERT_COOLDOWN_MS = 60000;

constexpr int BUTTON_PIN = 4;
constexpr unsigned long BUTTON_DEBOUNCE_MS = 30;
constexpr unsigned long MIGRAINE_CONFIRMATION_MS = 10000;
constexpr unsigned long LOG_INTERVAL_MS = 1000;
constexpr unsigned long CLEAR_CONFIRMATION_MS = 5000;
constexpr size_t LOG_BUFFER_RECORDS = 10;
constexpr size_t LOG_SEGMENT_MAX_BYTES = 256UL * 1024UL;
constexpr const char *LOG_PATHS[2] = {"/migraine0.csv", "/migraine1.csv"};
constexpr const char *CSV_HEADER =
    "session,type,uptime_ms,session_ms,lux,light_level,temperature_c,"
    "humidity_percent,db_spl,light_valid,sht31_valid,mic_valid\n";

constexpr int SCREEN_WIDTH = 128;
constexpr int SCREEN_HEIGHT = 64;
constexpr int OLED_RESET_PIN = -1;
constexpr unsigned long REFRESH_INTERVAL_MS = 500;

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET_PIN);
BH1750 lightMeter;
Adafruit_SHT31 sht31 = Adafruit_SHT31();
Preferences preferences;

unsigned long lastRefreshMs = 0;
float smoothedDbSpl = NAN;
bool microphoneHasSignal = false;
bool microphoneReadFailed = false;
bool microphoneInitialized = false;

enum class AlertState {
  MONITORING,
  MOTOR_ACTIVE,
  COOLDOWN,
};

enum class AlertSource {
  NONE,
  NOISE,
  LIGHT,
  MANUAL,
};

void startMotorAlert(AlertSource source, unsigned long now);

const char *alertSourceName(AlertSource source) {
  if (source == AlertSource::NOISE) {
    return "NOISE";
  }
  if (source == AlertSource::LIGHT) {
    return "LIGHT";
  }
  if (source == AlertSource::MANUAL) {
    return "MANUAL TEST";
  }
  return "NONE";
}

AlertState alertState = AlertState::MONITORING;
AlertSource alertSource = AlertSource::NONE;
unsigned long alertStateStartedMs = 0;
unsigned long noiseThresholdStartedMs = 0;
unsigned long lightThresholdStartedMs = 0;
bool noiseThresholdActive = false;
bool lightThresholdActive = false;

float latestLux = NAN;
float latestTemperatureC = NAN;
float latestHumidityPercent = NAN;
bool latestLightValid = false;
bool latestSht31Valid = false;
bool latestMicrophoneValid = false;

bool storageReady = false;
bool logError = false;
bool migraineRecording = false;
uint32_t currentSessionNumber = 0;
uint32_t nextSessionNumber = 1;
uint8_t activeLogSegment = 0;
unsigned long migraineSessionStartedMs = 0;
unsigned long lastLogRecordMs = 0;
unsigned long migraineConfirmationStartedMs = 0;
const char *migraineConfirmationText = nullptr;
String logBuffer[LOG_BUFFER_RECORDS];
size_t logBufferCount = 0;
size_t logBufferBytes = 0;

bool lastRawButtonState = HIGH;
bool stableButtonState = HIGH;
unsigned long buttonStateChangedMs = 0;
bool clearConfirmationPending = false;
unsigned long clearConfirmationStartedMs = 0;

const char *classifyLight(float lux) {
  if (lux < 10.0F) {
    return "Dark";
  }
  if (lux < 100.0F) {
    return "Dim";
  }
  if (lux < 500.0F) {
    return "Normal";
  }
  return "Bright";
}

size_t getFileSize(const char *path) {
  File file = LittleFS.open(path, FILE_READ);
  if (!file) {
    return 0;
  }
  const size_t size = file.size();
  file.close();
  return size;
}

bool createLogFile(uint8_t segment) {
  File file = LittleFS.open(LOG_PATHS[segment], FILE_WRITE);
  if (!file) {
    return false;
  }
  const bool success = file.print(CSV_HEADER) == strlen(CSV_HEADER);
  file.close();
  return success;
}

void failLogging(const char *message) {
  Serial.print("LOG ERROR: ");
  Serial.println(message);
  logError = true;
  migraineRecording = false;
  logBufferCount = 0;
  logBufferBytes = 0;
}

bool initializeLogging() {
  if (!LittleFS.begin(true)) {
    return false;
  }

  preferences.begin("migraine", false);
  nextSessionNumber = preferences.getUInt("nextSession", 1);
  activeLogSegment = preferences.getUChar("logSegment", 0) % 2;

  if (!LittleFS.exists(LOG_PATHS[activeLogSegment]) &&
      !createLogFile(activeLogSegment)) {
    return false;
  }
  return true;
}

bool rotateLogSegment() {
  const uint8_t nextSegment = 1 - activeLogSegment;
  if (LittleFS.exists(LOG_PATHS[nextSegment]) &&
      !LittleFS.remove(LOG_PATHS[nextSegment])) {
    return false;
  }
  if (!createLogFile(nextSegment)) {
    return false;
  }

  activeLogSegment = nextSegment;
  preferences.putUChar("logSegment", activeLogSegment);
  Serial.print("Log rotated to segment ");
  Serial.println(activeLogSegment);
  return true;
}

bool flushLogBuffer() {
  if (logBufferCount == 0) {
    return true;
  }
  if (!storageReady) {
    failLogging("flash storage is unavailable");
    return false;
  }

  if (getFileSize(LOG_PATHS[activeLogSegment]) + logBufferBytes >
          LOG_SEGMENT_MAX_BYTES &&
      !rotateLogSegment()) {
    failLogging("could not rotate log files");
    return false;
  }

  File file = LittleFS.open(LOG_PATHS[activeLogSegment], FILE_APPEND);
  if (!file) {
    failLogging("could not open the active log file");
    return false;
  }

  bool success = true;
  for (size_t index = 0; index < logBufferCount; ++index) {
    if (file.print(logBuffer[index]) != logBuffer[index].length()) {
      success = false;
      break;
    }
  }
  file.flush();
  file.close();

  if (!success) {
    failLogging("flash write failed");
    return false;
  }

  for (size_t index = 0; index < logBufferCount; ++index) {
    logBuffer[index] = "";
  }
  logBufferCount = 0;
  logBufferBytes = 0;
  return true;
}

String csvFloat(float value, bool valid, uint8_t decimals) {
  if (!valid) {
    return String();
  }

  // Some ESP32 Arduino core versions expose overlapping String constructors
  // for floating-point values. snprintf avoids that overload ambiguity.
  char text[24];
  snprintf(text, sizeof(text), "%.*f", static_cast<int>(decimals),
           static_cast<double>(value));
  return String(text);
}

String makeLogRecord(const char *recordType, unsigned long now) {
  const unsigned long sessionElapsed =
      migraineRecording ? now - migraineSessionStartedMs : 0;
  String record;
  record.reserve(150);
  record += String(currentSessionNumber);
  record += ',';
  record += recordType;
  record += ',';
  record += String(now);
  record += ',';
  record += String(sessionElapsed);
  record += ',';
  record += csvFloat(latestLux, latestLightValid, 1);
  record += ',';
  record += latestLightValid ? classifyLight(latestLux) : "";
  record += ',';
  record += csvFloat(latestTemperatureC, latestSht31Valid, 1);
  record += ',';
  record += csvFloat(latestHumidityPercent, latestSht31Valid, 1);
  record += ',';
  record += csvFloat(smoothedDbSpl, latestMicrophoneValid, 1);
  record += ',';
  record += latestLightValid ? '1' : '0';
  record += ',';
  record += latestSht31Valid ? '1' : '0';
  record += ',';
  record += latestMicrophoneValid ? '1' : '0';
  record += '\n';
  return record;
}

bool queueLogRecord(const char *recordType, unsigned long now,
                    bool flushImmediately = false) {
  if (!storageReady || logError) {
    return false;
  }

  const String record = makeLogRecord(recordType, now);
  logBuffer[logBufferCount] = record;
  logBufferBytes += record.length();
  ++logBufferCount;

  if (flushImmediately || logBufferCount >= LOG_BUFFER_RECORDS) {
    return flushLogBuffer();
  }
  return true;
}

void startMigraineSession(unsigned long now) {
  if (!storageReady || logError) {
    Serial.println("Cannot record: flash log is unavailable.");
    return;
  }

  currentSessionNumber = nextSessionNumber++;
  preferences.putUInt("nextSession", nextSessionNumber);
  migraineRecording = true;
  migraineSessionStartedMs = now;
  lastLogRecordMs = now;
  migraineConfirmationText = "Migraine START";
  migraineConfirmationStartedMs = now;

  Serial.print("Migraine session ");
  Serial.print(currentSessionNumber);
  Serial.println(" STARTED.");
  queueLogRecord("START", now);
}

void stopMigraineSession(unsigned long now) {
  if (!migraineRecording) {
    return;
  }

  Serial.print("Migraine session ");
  Serial.print(currentSessionNumber);
  Serial.println(" STOPPED.");
  queueLogRecord("STOP", now, true);
  migraineRecording = false;
  migraineConfirmationText = "Migraine STOP";
  migraineConfirmationStartedMs = now;
}

void handleButton(unsigned long now) {
  const bool rawState = digitalRead(BUTTON_PIN);
  if (rawState != lastRawButtonState) {
    lastRawButtonState = rawState;
    buttonStateChangedMs = now;
  }

  if (rawState != stableButtonState &&
      now - buttonStateChangedMs >= BUTTON_DEBOUNCE_MS) {
    stableButtonState = rawState;
    if (stableButtonState == LOW) {
      if (migraineRecording) {
        stopMigraineSession(now);
      } else {
        startMigraineSession(now);
      }
    }
  }
}

void updateMigraineLogging(unsigned long now) {
  if (migraineRecording && now - lastLogRecordMs >= LOG_INTERVAL_MS) {
    lastLogRecordMs = now;
    queueLogRecord("DATA", now);
  }

  if (migraineConfirmationText != nullptr &&
      now - migraineConfirmationStartedMs >= MIGRAINE_CONFIRMATION_MS) {
    migraineConfirmationText = nullptr;
  }
}

void dumpFileToSerial(const char *path) {
  File file = LittleFS.open(path, FILE_READ);
  if (!file) {
    return;
  }
  while (file.available()) {
    Serial.write(file.read());
  }
  file.close();
}

void dumpLogs() {
  if (!storageReady) {
    Serial.println("LOG ERROR: flash storage is unavailable.");
    return;
  }
  const uint8_t olderSegment = 1 - activeLogSegment;
  Serial.println("--- MIGRAINE CSV LOG START ---");
  if (LittleFS.exists(LOG_PATHS[olderSegment])) {
    dumpFileToSerial(LOG_PATHS[olderSegment]);
  }
  dumpFileToSerial(LOG_PATHS[activeLogSegment]);
  Serial.println("--- MIGRAINE CSV LOG END ---");
}

bool clearLogs() {
  for (uint8_t segment = 0; segment < 2; ++segment) {
    if (LittleFS.exists(LOG_PATHS[segment]) &&
        !LittleFS.remove(LOG_PATHS[segment])) {
      return false;
    }
  }
  activeLogSegment = 0;
  preferences.putUChar("logSegment", activeLogSegment);
  return createLogFile(activeLogSegment);
}

void printLogStatus() {
  Serial.print("Recording: ");
  Serial.println(migraineRecording ? "YES" : "NO");
  Serial.print("Current/next session: ");
  Serial.print(currentSessionNumber);
  Serial.print('/');
  Serial.println(nextSessionNumber);
  Serial.print("Log bytes (older/current/buffered): ");
  Serial.print(getFileSize(LOG_PATHS[1 - activeLogSegment]));
  Serial.print('/');
  Serial.print(getFileSize(LOG_PATHS[activeLogSegment]));
  Serial.print('/');
  Serial.println(logBufferBytes);
}

void handleSerialCommands(unsigned long now) {
  if (clearConfirmationPending &&
      now - clearConfirmationStartedMs > CLEAR_CONFIRMATION_MS) {
    clearConfirmationPending = false;
    Serial.println("Clear confirmation expired.");
  }

  while (Serial.available() > 0) {
    char command = static_cast<char>(Serial.read());
    if (command >= 'a' && command <= 'z') {
      command -= ('a' - 'A');
    }
    if (command == '\r' || command == '\n' || command == ' ') {
      continue;
    }

    if (command == 'D') {
      clearConfirmationPending = false;
      if (migraineRecording) {
        Serial.println("D rejected: stop recording before dumping logs.");
      } else {
        dumpLogs();
      }
    } else if (command == 'C') {
      if (migraineRecording) {
        clearConfirmationPending = false;
        Serial.println("C rejected: stop recording before clearing logs.");
      } else if (!clearConfirmationPending) {
        clearConfirmationPending = true;
        clearConfirmationStartedMs = now;
        Serial.println("Send C again within 5 seconds to clear all logs.");
      } else {
        clearConfirmationPending = false;
        if (clearLogs()) {
          logError = false;
          Serial.println("All migraine logs cleared.");
        } else {
          failLogging("could not clear/recreate log files");
        }
      }
    } else if (command == 'S') {
      clearConfirmationPending = false;
      printLogStatus();
    } else if (command == 'M') {
      clearConfirmationPending = false;
      startMotorAlert(AlertSource::MANUAL, now);
    } else {
      Serial.println(
          "Commands: D=dump CSV, C=clear logs, S=status, M=motor test");
    }
  }
}

void showMessage(const char *line1, const char *line2 = nullptr) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  // Keep the message entirely below the two-color boundary (row 16) so the
  // yellow band never cuts a line of text in half.
  display.drawFastHLine(0, 15, SCREEN_WIDTH, SSD1306_WHITE);
  display.setCursor(0, 20);
  display.println(line1);

  if (line2 != nullptr) {
    display.setCursor(0, 34);
    display.println(line2);
  }

  display.display();
}

void showReadings(float lux, float temperatureC, float humidityPercent,
                  float decibelsSpl, bool microphoneValid,
                  unsigned long now) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  // Yellow status bar (rows 0..7). The status text stays inside the colored
  // band so sensor values below are never split by the color boundary.
  if (alertState == AlertState::MOTOR_ACTIVE) {
    display.setCursor(0, 0);
    display.print("ALERT: ");
    display.print(alertSourceName(alertSource));
  } else if (logError) {
    display.setCursor(0, 0);
    display.print("LOG ERROR");
  } else if (migraineConfirmationText != nullptr) {
    display.setCursor(0, 0);
    display.print(migraineConfirmationText);
  } else if (alertState == AlertState::COOLDOWN) {
    const unsigned long elapsed = now - alertStateStartedMs;
    const unsigned long remainingMs =
        elapsed < ALERT_COOLDOWN_MS ? ALERT_COOLDOWN_MS - elapsed : 0;
    display.setCursor(0, 0);
    display.print("Cooldown ");
    display.print((remainingMs + 999) / 1000);
    display.print("s");
  } else {
    display.setCursor(0, 0);
    display.print("Monitoring");
  }

  if (migraineRecording) {
    display.fillRect(103, 2, 3, 3, SSD1306_WHITE);
    display.setCursor(109, 0);
    display.print("REC");
  }

  // Divider between the colored status bar and the sensor data.
  display.drawFastHLine(0, 15, SCREEN_WIDTH, SSD1306_WHITE);

  // Blue sensor area (rows 18..62). Every row sits below the color boundary,
  // so the values read as one continuous block.
  display.setCursor(0, 18);
  display.print("Light:  ");
  if (latestLightValid) {
    display.print(lux, 1);
    display.print(" lux");
  } else {
    display.print("--");
  }

  display.setCursor(0, 27);
  display.print("Level:  ");
  display.println(latestLightValid ? classifyLight(lux) : "--");

  display.setCursor(0, 36);
  display.print("Temp:   ");
  if (latestSht31Valid) {
    display.print(temperatureC, 1);
    display.print(" C");
  } else {
    display.print("--");
  }

  display.setCursor(0, 45);
  display.print("Hum:    ");
  if (latestSht31Valid) {
    display.print(humidityPercent, 1);
    display.print(" %");
  } else {
    display.print("--");
  }

  display.setCursor(0, 54);
  display.print("Noise:  ");
  if (microphoneValid) {
    display.print(decibelsSpl, 1);
    display.print(" dB SPL");
  } else {
    display.print("MIC ERROR");
  }

  // The SSD1306 library draws into a memory buffer. This single call updates
  // the screen after the whole frame is ready, which minimizes flicker.
  display.display();
}

void resetQualificationTimers() {
  noiseThresholdActive = false;
  lightThresholdActive = false;
  noiseThresholdStartedMs = 0;
  lightThresholdStartedMs = 0;
}

void setMotor(bool enabled) {
  digitalWrite(MOTOR_PIN,
               enabled ? MOTOR_ACTIVE_LEVEL : MOTOR_INACTIVE_LEVEL);
}

void startMotorAlert(AlertSource source, unsigned long now) {
  alertState = AlertState::MOTOR_ACTIVE;
  alertSource = source;
  alertStateStartedMs = now;
  resetQualificationTimers();
  setMotor(true);

  Serial.print("ALERT triggered by ");
  Serial.print(alertSourceName(source));
  Serial.println(". Motor ON for 5 seconds.");
}

void updateMotorAndCooldown(unsigned long now) {
  if (alertState == AlertState::MOTOR_ACTIVE &&
      now - alertStateStartedMs >= MOTOR_DURATION_MS) {
    setMotor(false);
    alertState = AlertState::COOLDOWN;
    alertStateStartedMs = now;
    Serial.println("Motor OFF. Cooldown started for 60 seconds.");
    return;
  }

  if (alertState == AlertState::COOLDOWN &&
      now - alertStateStartedMs >= ALERT_COOLDOWN_MS) {
    alertState = AlertState::MONITORING;
    alertSource = AlertSource::NONE;
    alertStateStartedMs = now;
    resetQualificationTimers();
    Serial.println("Cooldown complete. Alert monitoring resumed.");
  }
}

void updateAlertQualification(float lux, bool lightValid,
                              float decibelsSpl, bool microphoneValid,
                              unsigned long now) {
  if (alertState != AlertState::MONITORING) {
    resetQualificationTimers();
    return;
  }

  if (microphoneValid && decibelsSpl > NOISE_THRESHOLD_DB) {
    if (!noiseThresholdActive) {
      noiseThresholdActive = true;
      noiseThresholdStartedMs = now;
      Serial.println("Noise above 80 dB; starting 3-second timer.");
    } else if (now - noiseThresholdStartedMs >= NOISE_TRIGGER_MS) {
      startMotorAlert(AlertSource::NOISE, now);
      return;
    }
  } else {
    noiseThresholdActive = false;
  }

  if (lightValid && lux > LIGHT_THRESHOLD_LUX) {
    if (!lightThresholdActive) {
      lightThresholdActive = true;
      lightThresholdStartedMs = now;
      Serial.println("Light above 1000 lux; starting 5-second timer.");
    } else if (now - lightThresholdStartedMs >= LIGHT_TRIGGER_MS) {
      startMotorAlert(AlertSource::LIGHT, now);
    }
  } else {
    lightThresholdActive = false;
  }
}

bool initializeMicrophone() {
  const i2s_config_t i2sConfig = {
      .mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX),
      .sample_rate = MIC_SAMPLE_RATE,
      .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
      .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
      .communication_format = I2S_COMM_FORMAT_STAND_I2S,
      .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
      .dma_buf_count = 8,
      .dma_buf_len = MIC_BLOCK_SAMPLES,
      .use_apll = false,
      .tx_desc_auto_clear = false,
      .fixed_mclk = 0,
  };

  const i2s_pin_config_t pinConfig = {
      .bck_io_num = MIC_BCLK_PIN,
      .ws_io_num = MIC_WS_PIN,
      .data_out_num = I2S_PIN_NO_CHANGE,
      .data_in_num = MIC_DATA_PIN,
  };

  if (i2s_driver_install(MIC_I2S_PORT, &i2sConfig, 0, nullptr) != ESP_OK) {
    return false;
  }

  // Keep the data input at a defined level if the microphone is unplugged.
  pinMode(MIC_DATA_PIN, INPUT_PULLDOWN);
  if (i2s_set_pin(MIC_I2S_PORT, &pinConfig) != ESP_OK) {
    i2s_driver_uninstall(MIC_I2S_PORT);
    return false;
  }

  i2s_zero_dma_buffer(MIC_I2S_PORT);
  return true;
}

void sampleMicrophone() {
  static int32_t samples[MIC_BLOCK_SAMPLES];
  size_t bytesRead = 0;

  const esp_err_t result = i2s_read(
      MIC_I2S_PORT, samples, sizeof(samples), &bytesRead, pdMS_TO_TICKS(20));

  if (result != ESP_OK || bytesRead == 0) {
    microphoneReadFailed = true;
    microphoneHasSignal = false;
    return;
  }

  microphoneReadFailed = false;
  const size_t sampleCount = bytesRead / sizeof(samples[0]);

  // The INMP441's signed 24-bit sample is left-aligned in each 32-bit word.
  // Find and remove the block's DC component before calculating RMS.
  double sum = 0.0;
  for (size_t index = 0; index < sampleCount; ++index) {
    sum += static_cast<double>(samples[index]);
  }
  const double mean = sum / sampleCount;

  double squareSum = 0.0;
  for (size_t index = 0; index < sampleCount; ++index) {
    const double centered = static_cast<double>(samples[index]) - mean;
    squareSum += centered * centered;
  }
  const double rms = sqrt(squareSum / sampleCount);

  if (rms < MIC_MIN_VALID_RMS) {
    microphoneHasSignal = false;
    return;
  }

  const double fullScale = 2147483647.0;  // Maximum signed 32-bit amplitude.
  const float dbFs = 20.0F * log10f(static_cast<float>(rms / fullScale));
  const float dbSpl = dbFs + MIC_DB_SPL_OFFSET + MIC_CALIBRATION_DB;

  if (!isfinite(dbSpl)) {
    microphoneHasSignal = false;
    return;
  }

  if (isnan(smoothedDbSpl)) {
    smoothedDbSpl = dbSpl;
  } else {
    smoothedDbSpl += MIC_SMOOTHING_ALPHA * (dbSpl - smoothedDbSpl);
  }
  microphoneHasSignal = true;
}

void haltWithDisplayError(const char *serialMessage) {
  Serial.println(serialMessage);
  Serial.println("Check 3.3V, GND, SDA, SCL, and the I2C address.");

  // There is no usable OLED on which to show this error, so keep the message
  // visible in Serial Monitor and stop here.
  while (true) {
    delay(1000);
  }
}

void setup() {
  // Keep the motor module off throughout startup and sensor checks.
  pinMode(MOTOR_PIN, OUTPUT);
  setMotor(false);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.begin(115200);
  delay(250);
  Serial.println();
  Serial.println("Migraine Light Monitor starting...");

  storageReady = initializeLogging();
  if (!storageReady) {
    logError = true;
    Serial.println("LOG ERROR: LittleFS initialization failed.");
    Serial.println("Sensors will continue, but migraine recording is disabled.");
  } else {
    Serial.println("Migraine log storage initialized.");
    Serial.println(
        "Serial commands: D=dump CSV, C=clear logs, S=status, M=motor test");
  }

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    haltWithDisplayError("ERROR: SSD1306 OLED initialization failed.");
  }

  showMessage("Starting...", "Checking BH1750");

  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE,
                        BH1750_ADDRESS, &Wire)) {
    Serial.println("ERROR: BH1750 initialization failed.");
    Serial.println("Check 3.3V, GND, SDA, SCL, and ADDR.");
    showMessage("BH1750 ERROR", "Check wiring/ADDR");

    while (true) {
      delay(1000);
    }
  }

  showMessage("BH1750 ready", "Checking SHT31");

  if (!sht31.begin(SHT31_ADDRESS)) {
    Serial.println("ERROR: SHT31 initialization failed.");
    Serial.println("Check 3.3V, GND, SDA, SCL, and address 0x44.");
    showMessage("SHT31 ERROR", "Check wiring/ADDR");

    while (true) {
      delay(1000);
    }
  }

  showMessage("Sensors ready", "Checking INMP441");

  microphoneInitialized = initializeMicrophone();
  if (!microphoneInitialized) {
    Serial.println("ERROR: INMP441 I2S initialization failed.");
    Serial.println("Check GPIO 18 BCLK, GPIO 19 WS, and GPIO 23 SD.");
    showMessage("INMP441 ERROR", "I2S setup failed");
    delay(1500);
  }

  Serial.println("OLED initialized at address 0x3C.");
  Serial.println("BH1750 initialized at address 0x23.");
  Serial.println("SHT31 initialized at address 0x44.");
  if (microphoneInitialized) {
    Serial.println("INMP441 initialized on I2S port 0.");
  } else {
    Serial.println("INMP441 unavailable; other sensors will continue.");
  }
  Serial.println("Sensor readings:");
  showMessage("Sensors ready", "Reading data...");
  delay(750);
}

void loop() {
  // Read microphone blocks continuously. The DMA-backed I2S driver gathers
  // samples while the rest of the sketch updates the other sensors/display.
  if (microphoneInitialized) {
    sampleMicrophone();
  }

  const unsigned long now = millis();
  updateMotorAndCooldown(now);
  handleButton(now);
  handleSerialCommands(now);

  if (now - lastRefreshMs < REFRESH_INTERVAL_MS) {
    return;
  }
  lastRefreshMs = now;

  latestLux = lightMeter.readLightLevel();
  latestTemperatureC = sht31.readTemperature();
  latestHumidityPercent = sht31.readHumidity();
  latestLightValid = latestLux >= 0.0F;
  latestSht31Valid = !isnan(latestTemperatureC) &&
                     !isnan(latestHumidityPercent);
  latestMicrophoneValid = microphoneInitialized &&
                          microphoneHasSignal &&
                          !microphoneReadFailed &&
                          !isnan(smoothedDbSpl);

  // Log only after refreshing the snapshot so every one-second DATA row uses
  // the newest readings and validity flags.
  updateMigraineLogging(now);

  // The BH1750 library returns a negative value when a measurement fails.
  if (!latestLightValid) {
    lightThresholdActive = false;
    lightThresholdStartedMs = 0;
    Serial.print("ERROR: BH1750 read failed (code ");
    Serial.print(latestLux);
    Serial.println(").");
  }

  if (!latestSht31Valid) {
    Serial.println("ERROR: SHT31 temperature/humidity read failed.");
  }

  Serial.print("Light: ");
  if (latestLightValid) {
    Serial.print(latestLux, 1);
    Serial.print(" lux (");
    Serial.print(classifyLight(latestLux));
  } else {
    Serial.print("INVALID (");
    Serial.print("unknown");
  }
  Serial.print(") | Temperature: ");
  if (latestSht31Valid) {
    Serial.print(latestTemperatureC, 1);
  } else {
    Serial.print("INVALID");
  }
  Serial.print(" C | Humidity: ");
  if (latestSht31Valid) {
    Serial.print(latestHumidityPercent, 1);
  } else {
    Serial.print("INVALID");
  }
  Serial.print(" % | Noise: ");

  updateAlertQualification(latestLux, latestLightValid, smoothedDbSpl,
                           latestMicrophoneValid, now);

  if (latestMicrophoneValid) {
    Serial.print(smoothedDbSpl, 1);
    Serial.println(" dB SPL (approx.)");
  } else {
    Serial.println("MIC ERROR / no I2S data");
  }

  if (alertState == AlertState::MOTOR_ACTIVE) {
    Serial.println("Alert state: MOTOR ACTIVE");
  } else if (alertState == AlertState::COOLDOWN) {
    const unsigned long elapsed = now - alertStateStartedMs;
    const unsigned long remainingMs =
        elapsed < ALERT_COOLDOWN_MS ? ALERT_COOLDOWN_MS - elapsed : 0;
    Serial.print("Alert state: COOLDOWN, ");
    Serial.print((remainingMs + 999) / 1000);
    Serial.println(" seconds remaining");
  } else {
    Serial.println("Alert state: MONITORING");
  }

  showReadings(latestLux, latestTemperatureC, latestHumidityPercent,
               smoothedDbSpl, latestMicrophoneValid, now);
}
