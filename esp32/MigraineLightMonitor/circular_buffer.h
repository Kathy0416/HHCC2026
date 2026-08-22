#pragma once

#include <Arduino.h>

#include "config.h"
#include "data_types.h"

struct HistoryWindow {
  size_t logicalStart = 0;
  size_t count = 0;
};

template <size_t Capacity>
class SampleCircularBuffer {
 public:
  void push(const SensorSample &sample) {
    samples_[writeIndex_] = sample;
    writeIndex_ = (writeIndex_ + 1U) % Capacity;
    if (count_ < Capacity) {
      ++count_;
    }
  }

  void clear() {
    writeIndex_ = 0;
    count_ = 0;
  }

  size_t size() const { return count_; }
  constexpr size_t capacity() const { return Capacity; }
  bool full() const { return count_ == Capacity; }

  bool chronologicalAt(size_t logicalIndex, SensorSample &sample) const {
    if (logicalIndex >= count_) {
      return false;
    }
    const size_t oldest = count_ == Capacity ? writeIndex_ : 0;
    sample = samples_[(oldest + logicalIndex) % Capacity];
    return true;
  }

  HistoryWindow windowSince(uint64_t nowUs, uint64_t maximumAgeUs) const {
    HistoryWindow window;
    window.logicalStart = count_;
    for (size_t index = 0; index < count_; ++index) {
      SensorSample sample;
      chronologicalAt(index, sample);
      const bool notFromFuture = sample.monotonicUs <= nowUs;
      const bool recentEnough =
          notFromFuture && nowUs - sample.monotonicUs <= maximumAgeUs;
      if (recentEnough) {
        window.logicalStart = index;
        window.count = count_ - index;
        break;
      }
    }
    return window;
  }

 private:
  SensorSample samples_[Capacity] = {};
  size_t writeIndex_ = 0;
  size_t count_ = 0;
};

using HistoryBuffer = SampleCircularBuffer<Config::HISTORY_CAPACITY>;
