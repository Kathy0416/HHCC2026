#pragma once

#include <Adafruit_SHT31.h>
#include <BH1750.h>
#include <ESP_I2S.h>

#include "data_types.h"
#include "time_keeper.h"

class SensorManager {
 public:
  explicit SensorManager(TimeKeeper &timeKeeper) : timeKeeper_(timeKeeper) {}

  void begin(uint64_t nowUs);
  void update(uint64_t nowUs);
  SensorSample snapshot(SamplingMode mode, uint64_t nowUs) const;
  const SensorSample &latest() const { return latest_; }

  bool lightInitialized() const { return lightInitialized_; }
  bool climateInitialized() const { return climateInitialized_; }
  bool microphoneInitialized() const { return microphoneInitialized_; }

 private:
  bool initializeLight(uint64_t nowUs);
  bool initializeClimate(uint64_t nowUs);
  bool initializeMicrophone(uint64_t nowUs);
  void refreshEnvironment(uint64_t nowUs);
  void refreshMicrophone(uint64_t nowUs);
  void rateLimitedError(const char *message, uint64_t nowUs);

  TimeKeeper &timeKeeper_;
  BH1750 lightMeter_;
  Adafruit_SHT31 sht31_;
  I2SClass microphone_;

  bool lightInitialized_ = false;
  bool climateInitialized_ = false;
  bool microphoneInitialized_ = false;
  bool microphoneHasSignal_ = false;
  SensorSample latest_;
  float smoothedNoiseDbSpl_ = NAN;

  uint64_t lastEnvironmentRefreshUs_ = 0;
  uint64_t nextLightRetryUs_ = 0;
  uint64_t nextClimateRetryUs_ = 0;
  uint64_t nextMicrophoneRetryUs_ = 0;
  uint64_t lastErrorLogUs_ = 0;
};
