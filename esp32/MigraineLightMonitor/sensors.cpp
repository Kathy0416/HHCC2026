#include "sensors.h"

#include <Wire.h>
#include <math.h>

#include "config.h"

namespace {
constexpr uint64_t MS_TO_US = 1000ULL;

bool inRange(float value, float minimum, float maximum) {
  return isfinite(value) && value >= minimum && value <= maximum;
}
}  // namespace

void SensorManager::begin(uint64_t nowUs) {
  latest_ = {};
  latest_.bootId = timeKeeper_.bootId();
  initializeLight(nowUs);
  initializeClimate(nowUs);
  initializeMicrophone(nowUs);
  refreshEnvironment(nowUs);
}

bool SensorManager::initializeLight(uint64_t nowUs) {
  lightInitialized_ = lightMeter_.begin(BH1750::CONTINUOUS_HIGH_RES_MODE,
                                        Config::BH1750_ADDRESS, &Wire);
  nextLightRetryUs_ =
      nowUs + static_cast<uint64_t>(Config::SENSOR_RETRY_MS) * MS_TO_US;
  Serial.println(lightInitialized_ ? "[INFO] BH1750 initialized"
                                   : "[ERROR] BH1750 initialization failed");
  return lightInitialized_;
}

bool SensorManager::initializeClimate(uint64_t nowUs) {
  climateInitialized_ = sht31_.begin(Config::SHT31_ADDRESS);
  nextClimateRetryUs_ =
      nowUs + static_cast<uint64_t>(Config::SENSOR_RETRY_MS) * MS_TO_US;
  Serial.println(climateInitialized_ ? "[INFO] SHT31 initialized"
                                     : "[ERROR] SHT31 initialization failed");
  return climateInitialized_;
}

bool SensorManager::initializeMicrophone(uint64_t nowUs) {
  if (microphoneInitialized_) {
    microphone_.end();
  }
  pinMode(Config::MIC_DATA_PIN, INPUT_PULLDOWN);
  microphone_.setPins(Config::MIC_BCLK_PIN, Config::MIC_WS_PIN, -1,
                      Config::MIC_DATA_PIN);
  microphoneInitialized_ = microphone_.begin(
      I2S_MODE_STD, Config::MIC_SAMPLE_RATE, I2S_DATA_BIT_WIDTH_32BIT,
      I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT);
  nextMicrophoneRetryUs_ =
      nowUs + static_cast<uint64_t>(Config::SENSOR_RETRY_MS) * MS_TO_US;
  Serial.println(microphoneInitialized_
                     ? "[INFO] INMP441 initialized with ESP_I2S"
                     : "[ERROR] INMP441 initialization failed");
  return microphoneInitialized_;
}

void SensorManager::rateLimitedError(const char *message, uint64_t nowUs) {
  if (lastErrorLogUs_ == 0 || nowUs - lastErrorLogUs_ >= 5000000ULL) {
    Serial.print("[ERROR] ");
    Serial.println(message);
    lastErrorLogUs_ = nowUs;
  }
}

void SensorManager::refreshEnvironment(uint64_t nowUs) {
  latest_.validMask &= static_cast<uint8_t>(
      ~(VALID_LIGHT | VALID_TEMPERATURE | VALID_HUMIDITY));

  if (lightInitialized_) {
    latest_.lightLux = lightMeter_.readLightLevel();
    if (inRange(latest_.lightLux, Config::LIGHT_MIN_LUX,
                Config::LIGHT_MAX_LUX)) {
      latest_.validMask |= VALID_LIGHT;
    } else {
      rateLimitedError("BH1750 read invalid", nowUs);
    }
  } else {
    latest_.lightLux = NAN;
  }

  if (climateInitialized_) {
    latest_.temperatureC = sht31_.readTemperature();
    latest_.humidityPercent = sht31_.readHumidity();
    if (inRange(latest_.temperatureC, Config::TEMPERATURE_MIN_C,
                Config::TEMPERATURE_MAX_C)) {
      latest_.validMask |= VALID_TEMPERATURE;
    } else {
      rateLimitedError("SHT31 temperature read invalid", nowUs);
    }
    if (inRange(latest_.humidityPercent, Config::HUMIDITY_MIN_PERCENT,
                Config::HUMIDITY_MAX_PERCENT)) {
      latest_.validMask |= VALID_HUMIDITY;
    } else {
      rateLimitedError("SHT31 humidity read invalid", nowUs);
    }
  } else {
    latest_.temperatureC = NAN;
    latest_.humidityPercent = NAN;
  }
}

void SensorManager::refreshMicrophone(uint64_t nowUs) {
  if (!microphoneInitialized_ || microphone_.available() <= 0) {
    return;
  }

  static int32_t samples[Config::MIC_BLOCK_SAMPLES];
  const size_t bytesRead = microphone_.readBytes(
      reinterpret_cast<char *>(samples), sizeof(samples));
  if (bytesRead < sizeof(int32_t)) {
    microphoneHasSignal_ = false;
    latest_.validMask &= static_cast<uint8_t>(~VALID_NOISE);
    rateLimitedError("INMP441 read returned no samples", nowUs);
    return;
  }

  const size_t count = bytesRead / sizeof(int32_t);
  double sum = 0.0;
  for (size_t index = 0; index < count; ++index) {
    sum += static_cast<double>(samples[index]);
  }
  const double mean = sum / static_cast<double>(count);

  double squareSum = 0.0;
  for (size_t index = 0; index < count; ++index) {
    const double centered = static_cast<double>(samples[index]) - mean;
    squareSum += centered * centered;
  }
  const double rms = sqrt(squareSum / static_cast<double>(count));
  if (rms < Config::MIC_MIN_VALID_RMS) {
    microphoneHasSignal_ = false;
    latest_.validMask &= static_cast<uint8_t>(~VALID_NOISE);
    return;
  }

  const double fullScale = 2147483647.0;
  const float dbFs = 20.0F * log10f(static_cast<float>(rms / fullScale));
  const float dbSpl =
      dbFs + Config::MIC_DB_SPL_OFFSET + Config::MIC_CALIBRATION_DB;
  if (!isfinite(dbSpl)) {
    microphoneHasSignal_ = false;
    latest_.validMask &= static_cast<uint8_t>(~VALID_NOISE);
    return;
  }

  if (!isfinite(smoothedNoiseDbSpl_)) {
    smoothedNoiseDbSpl_ = dbSpl;
  } else {
    smoothedNoiseDbSpl_ +=
        Config::MIC_SMOOTHING_ALPHA * (dbSpl - smoothedNoiseDbSpl_);
  }
  latest_.noiseDbSpl = smoothedNoiseDbSpl_;
  microphoneHasSignal_ =
      inRange(latest_.noiseDbSpl, Config::NOISE_MIN_DB_SPL,
              Config::NOISE_MAX_DB_SPL);
  if (microphoneHasSignal_) {
    latest_.validMask |= VALID_NOISE;
  } else {
    latest_.validMask &= static_cast<uint8_t>(~VALID_NOISE);
  }
}

void SensorManager::update(uint64_t nowUs) {
  if (!lightInitialized_ && nowUs >= nextLightRetryUs_) {
    initializeLight(nowUs);
  }
  if (!climateInitialized_ && nowUs >= nextClimateRetryUs_) {
    initializeClimate(nowUs);
  }
  if (!microphoneInitialized_ && nowUs >= nextMicrophoneRetryUs_) {
    initializeMicrophone(nowUs);
  }

  refreshMicrophone(nowUs);
  if (lastEnvironmentRefreshUs_ == 0 ||
      nowUs - lastEnvironmentRefreshUs_ >=
          static_cast<uint64_t>(Config::SENSOR_REFRESH_MS) * MS_TO_US) {
    lastEnvironmentRefreshUs_ = nowUs;
    refreshEnvironment(nowUs);
  }
}

SensorSample SensorManager::snapshot(SamplingMode mode,
                                     uint64_t nowUs) const {
  SensorSample sample = latest_;
  sample.monotonicUs = nowUs;
  sample.bootId = timeKeeper_.bootId();
  sample.mode = mode;
  sample.utcEpochMs = timeKeeper_.utcFor(nowUs, sample.timeQuality);
  return sample;
}
