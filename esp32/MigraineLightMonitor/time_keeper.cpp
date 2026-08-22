#include "time_keeper.h"

#include <esp_system.h>
#include <esp_timer.h>

namespace {
constexpr int64_t MIN_REASONABLE_UTC_MS = 946684800000LL;   // 2000-01-01
constexpr int64_t MAX_REASONABLE_UTC_MS = 4102444800000LL;  // 2100-01-01
}

void TimeKeeper::begin() {
  bootId_ = esp_random();
  if (bootId_ == 0) {
    bootId_ = 1;
  }
  anchor_ = {};
  anchor_.bootId = bootId_;
}

uint64_t TimeKeeper::monotonicUs() const {
  return static_cast<uint64_t>(esp_timer_get_time());
}

bool TimeKeeper::setUtcEpochMs(int64_t epochMs, uint64_t atMonotonicUs) {
  if (epochMs < MIN_REASONABLE_UTC_MS || epochMs > MAX_REASONABLE_UTC_MS) {
    return false;
  }
  if (atMonotonicUs == 0) {
    atMonotonicUs = monotonicUs();
  }
  anchor_.valid = true;
  anchor_.bootId = bootId_;
  anchor_.monotonicUs = atMonotonicUs;
  anchor_.utcEpochMs = epochMs;
  return true;
}

int64_t TimeKeeper::utcFor(uint64_t sampleMonotonicUs,
                           TimeQuality &quality) const {
  if (!anchor_.valid) {
    quality = TimeQuality::UNKNOWN;
    return 0;
  }
  const int64_t deltaUs =
      static_cast<int64_t>(sampleMonotonicUs) -
      static_cast<int64_t>(anchor_.monotonicUs);
  quality = sampleMonotonicUs < anchor_.monotonicUs
                ? TimeQuality::BACKFILLED
                : TimeQuality::SYNCED;
  return anchor_.utcEpochMs + deltaUs / 1000LL;
}

bool TimeKeeper::backfill(SensorSample &sample) const {
  if (sample.utcEpochMs != 0 || sample.bootId != bootId_ || !anchor_.valid) {
    return false;
  }
  sample.utcEpochMs = utcFor(sample.monotonicUs, sample.timeQuality);
  return sample.utcEpochMs != 0;
}
