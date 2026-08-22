#pragma once

#include <Arduino.h>

#include "data_types.h"

namespace BinaryCodec {

constexpr uint16_t FORMAT_VERSION = 1;
constexpr size_t EVENT_HEADER_BYTES = 160;
constexpr size_t SAMPLE_RECORD_BYTES = 44;
constexpr size_t EVENT_FOOTER_BYTES = 64;

uint32_t crc32Begin();
uint32_t crc32Update(uint32_t state, const uint8_t *data, size_t length);
uint32_t crc32Finish(uint32_t state);
uint32_t crc32(const uint8_t *data, size_t length);

bool encodeHeader(const EventMetadata &metadata,
                  uint8_t output[EVENT_HEADER_BYTES]);
bool decodeHeader(const uint8_t input[EVENT_HEADER_BYTES],
                  EventMetadata &metadata);

bool encodeSample(const SensorSample &sample,
                  uint8_t output[SAMPLE_RECORD_BYTES]);
bool decodeSample(const uint8_t input[SAMPLE_RECORD_BYTES],
                  SensorSample &sample);

struct FooterData {
  EventStatus status = EventStatus::CORRUPT;
  uint32_t preCount = 0;
  uint32_t activeCount = 0;
  uint32_t sampleCount = 0;
  uint32_t payloadCrc32 = 0;
  uint64_t finalizedMonotonicUs = 0;
  int64_t finalizedUtcMs = 0;
  ClockAnchor anchor;
};

bool encodeFooter(const FooterData &footer,
                  uint8_t output[EVENT_FOOTER_BYTES]);
bool decodeFooter(const uint8_t input[EVENT_FOOTER_BYTES],
                  FooterData &footer);

}  // namespace BinaryCodec
