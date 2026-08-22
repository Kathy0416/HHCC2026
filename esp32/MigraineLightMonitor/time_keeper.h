#pragma once

#include <Arduino.h>

#include "data_types.h"

class TimeKeeper {
 public:
  void begin();
  uint64_t monotonicUs() const;
  uint32_t bootId() const { return bootId_; }

  bool setUtcEpochMs(int64_t epochMs, uint64_t atMonotonicUs = 0);
  bool isSynchronized() const { return anchor_.valid; }
  int64_t utcFor(uint64_t sampleMonotonicUs,
                 TimeQuality &quality) const;
  bool backfill(SensorSample &sample) const;
  ClockAnchor anchor() const { return anchor_; }

 private:
  uint32_t bootId_ = 0;
  ClockAnchor anchor_;
};
