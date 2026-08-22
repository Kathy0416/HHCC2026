#include "binary_codec.h"

#include <string.h>

namespace BinaryCodec {
namespace {

void putU16(uint8_t *output, uint16_t value) {
  output[0] = static_cast<uint8_t>(value);
  output[1] = static_cast<uint8_t>(value >> 8U);
}

void putU32(uint8_t *output, uint32_t value) {
  for (uint8_t index = 0; index < 4; ++index) {
    output[index] = static_cast<uint8_t>(value >> (index * 8U));
  }
}

void putU64(uint8_t *output, uint64_t value) {
  for (uint8_t index = 0; index < 8; ++index) {
    output[index] = static_cast<uint8_t>(value >> (index * 8U));
  }
}

void putI64(uint8_t *output, int64_t value) {
  putU64(output, static_cast<uint64_t>(value));
}

void putFloat(uint8_t *output, float value) {
  uint32_t bits = 0;
  static_assert(sizeof(bits) == sizeof(value), "Unexpected float width");
  memcpy(&bits, &value, sizeof(bits));
  putU32(output, bits);
}

uint16_t getU16(const uint8_t *input) {
  return static_cast<uint16_t>(input[0]) |
         static_cast<uint16_t>(input[1]) << 8U;
}

uint32_t getU32(const uint8_t *input) {
  uint32_t value = 0;
  for (uint8_t index = 0; index < 4; ++index) {
    value |= static_cast<uint32_t>(input[index]) << (index * 8U);
  }
  return value;
}

uint64_t getU64(const uint8_t *input) {
  uint64_t value = 0;
  for (uint8_t index = 0; index < 8; ++index) {
    value |= static_cast<uint64_t>(input[index]) << (index * 8U);
  }
  return value;
}

int64_t getI64(const uint8_t *input) {
  return static_cast<int64_t>(getU64(input));
}

float getFloat(const uint8_t *input) {
  const uint32_t bits = getU32(input);
  float value = NAN;
  memcpy(&value, &bits, sizeof(value));
  return value;
}

bool magicMatches(const uint8_t *input, const char *magic) {
  return memcmp(input, magic, 4) == 0;
}

void copyFixedString(uint8_t *output, size_t capacity, const char *value) {
  memset(output, 0, capacity);
  if (value != nullptr) {
    strncpy(reinterpret_cast<char *>(output), value, capacity - 1U);
  }
}

void readFixedString(char *output, size_t capacity, const uint8_t *input,
                     size_t inputCapacity) {
  const size_t copyLength = min(capacity - 1U, inputCapacity);
  memcpy(output, input, copyLength);
  output[copyLength] = '\0';
}

}  // namespace

uint32_t crc32Begin() { return 0xFFFFFFFFUL; }

uint32_t crc32Update(uint32_t state, const uint8_t *data, size_t length) {
  for (size_t index = 0; index < length; ++index) {
    state ^= data[index];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      const uint32_t mask =
          static_cast<uint32_t>(-static_cast<int32_t>(state & 1U));
      state = (state >> 1U) ^ (0xEDB88320UL & mask);
    }
  }
  return state;
}

uint32_t crc32Finish(uint32_t state) { return state ^ 0xFFFFFFFFUL; }

uint32_t crc32(const uint8_t *data, size_t length) {
  return crc32Finish(crc32Update(crc32Begin(), data, length));
}

bool encodeHeader(const EventMetadata &metadata,
                  uint8_t output[EVENT_HEADER_BYTES]) {
  memset(output, 0, EVENT_HEADER_BYTES);
  memcpy(output, "MGEV", 4);
  putU16(output + 4, FORMAT_VERSION);
  putU16(output + 6, EVENT_HEADER_BYTES);
  copyFixedString(output + 8, EVENT_ID_CAPACITY, metadata.eventId);
  copyFixedString(output + 72, DEVICE_ID_CAPACITY, metadata.deviceId);
  output[85] = 1;  // USER_REPORTED_MIGRAINE
  output[86] = static_cast<uint8_t>(metadata.timeQuality);
  putU32(output + 88, metadata.bootId);
  putU64(output + 92, metadata.eventSequence);
  putU64(output + 100, metadata.eventMonotonicUs);
  putI64(output + 108, metadata.eventUtcMs);
  putU32(output + 116, metadata.preDurationMs);
  putU32(output + 120, metadata.activeDurationMs);
  putU32(output + 124, metadata.preIntervalMs);
  putU32(output + 128, metadata.activeIntervalMs);
  putU16(output + 132, metadata.expectedPreCount);
  putU16(output + 134, metadata.expectedActiveCount);
  putU16(output + 136, metadata.actualPreCount);
  putU16(output + 138, metadata.sensorSchemaMask);
  putU32(output + 140, metadata.randomNonce);
  putU16(output + 144, SAMPLE_RECORD_BYTES);
  putU32(output + 156, crc32(output, 156));
  return true;
}

bool decodeHeader(const uint8_t input[EVENT_HEADER_BYTES],
                  EventMetadata &metadata) {
  if (!magicMatches(input, "MGEV") || getU16(input + 4) != FORMAT_VERSION ||
      getU16(input + 6) != EVENT_HEADER_BYTES ||
      getU16(input + 144) != SAMPLE_RECORD_BYTES ||
      getU32(input + 156) != crc32(input, 156)) {
    return false;
  }

  metadata = {};
  readFixedString(metadata.eventId, sizeof(metadata.eventId), input + 8,
                  EVENT_ID_CAPACITY);
  readFixedString(metadata.deviceId, sizeof(metadata.deviceId), input + 72,
                  DEVICE_ID_CAPACITY);
  metadata.timeQuality = static_cast<TimeQuality>(input[86]);
  metadata.bootId = getU32(input + 88);
  metadata.eventSequence = getU64(input + 92);
  metadata.eventMonotonicUs = getU64(input + 100);
  metadata.eventUtcMs = getI64(input + 108);
  metadata.preDurationMs = getU32(input + 116);
  metadata.activeDurationMs = getU32(input + 120);
  metadata.preIntervalMs = getU32(input + 124);
  metadata.activeIntervalMs = getU32(input + 128);
  metadata.expectedPreCount = getU16(input + 132);
  metadata.expectedActiveCount = getU16(input + 134);
  metadata.actualPreCount = getU16(input + 136);
  metadata.sensorSchemaMask = getU16(input + 138);
  metadata.randomNonce = getU32(input + 140);
  return metadata.eventId[0] != '\0' && metadata.deviceId[0] != '\0';
}

bool encodeSample(const SensorSample &sample,
                  uint8_t output[SAMPLE_RECORD_BYTES]) {
  memset(output, 0, SAMPLE_RECORD_BYTES);
  putU64(output, sample.monotonicUs);
  putI64(output + 8, sample.utcEpochMs);
  putU32(output + 16, sample.bootId);
  putFloat(output + 20, sample.lightLux);
  putFloat(output + 24, sample.temperatureC);
  putFloat(output + 28, sample.humidityPercent);
  putFloat(output + 32, sample.noiseDbSpl);
  output[36] = static_cast<uint8_t>(sample.mode);
  output[37] = static_cast<uint8_t>(sample.timeQuality);
  output[38] = sample.validMask;
  output[39] = sample.reserved;
  putU32(output + 40, crc32(output, 40));
  return true;
}

bool decodeSample(const uint8_t input[SAMPLE_RECORD_BYTES],
                  SensorSample &sample) {
  if (getU32(input + 40) != crc32(input, 40)) {
    return false;
  }
  sample = {};
  sample.monotonicUs = getU64(input);
  sample.utcEpochMs = getI64(input + 8);
  sample.bootId = getU32(input + 16);
  sample.lightLux = getFloat(input + 20);
  sample.temperatureC = getFloat(input + 24);
  sample.humidityPercent = getFloat(input + 28);
  sample.noiseDbSpl = getFloat(input + 32);
  sample.mode = static_cast<SamplingMode>(input[36]);
  sample.timeQuality = static_cast<TimeQuality>(input[37]);
  sample.validMask = input[38];
  sample.reserved = input[39];
  return static_cast<uint8_t>(sample.mode) <=
         static_cast<uint8_t>(SamplingMode::BASELINE);
}

bool encodeFooter(const FooterData &footer,
                  uint8_t output[EVENT_FOOTER_BYTES]) {
  memset(output, 0, EVENT_FOOTER_BYTES);
  memcpy(output, "MEND", 4);
  putU16(output + 4, FORMAT_VERSION);
  output[6] = static_cast<uint8_t>(footer.status);
  output[7] = footer.anchor.valid ? 1U : 0U;
  putU32(output + 8, footer.preCount);
  putU32(output + 12, footer.activeCount);
  putU32(output + 16, footer.sampleCount);
  putU32(output + 20, footer.payloadCrc32);
  putU64(output + 24, footer.finalizedMonotonicUs);
  putI64(output + 32, footer.finalizedUtcMs);
  putU64(output + 40, footer.anchor.monotonicUs);
  putI64(output + 48, footer.anchor.utcEpochMs);
  putU32(output + 56, footer.anchor.bootId);
  putU32(output + 60, crc32(output, 60));
  return true;
}

bool decodeFooter(const uint8_t input[EVENT_FOOTER_BYTES],
                  FooterData &footer) {
  if (!magicMatches(input, "MEND") || getU16(input + 4) != FORMAT_VERSION ||
      getU32(input + 60) != crc32(input, 60)) {
    return false;
  }
  footer = {};
  footer.status = static_cast<EventStatus>(input[6]);
  footer.preCount = getU32(input + 8);
  footer.activeCount = getU32(input + 12);
  footer.sampleCount = getU32(input + 16);
  footer.payloadCrc32 = getU32(input + 20);
  footer.finalizedMonotonicUs = getU64(input + 24);
  footer.finalizedUtcMs = getI64(input + 32);
  footer.anchor.valid = input[7] != 0;
  footer.anchor.monotonicUs = getU64(input + 40);
  footer.anchor.utcEpochMs = getI64(input + 48);
  footer.anchor.bootId = getU32(input + 56);
  return footer.status == EventStatus::COMPLETE ||
         footer.status == EventStatus::INCOMPLETE_POWER_LOSS ||
         footer.status == EventStatus::INCOMPLETE_STORAGE_ERROR;
}

}  // namespace BinaryCodec
