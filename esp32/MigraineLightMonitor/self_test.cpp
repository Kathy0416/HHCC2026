#include "self_test.h"

#include <new>
#include <string.h>

#include "binary_codec.h"
#include "circular_buffer.h"
#include "time_keeper.h"

namespace {

void result(Print &output, const char *name, bool passed, bool &allPassed) {
  output.print(passed ? "[PASS] " : "[FAIL] ");
  output.println(name);
  allPassed = allPassed && passed;
}

}  // namespace

bool runFirmwareSelfTests(Print &output) {
  bool allPassed = true;
  output.println("--- FIRMWARE SELF TEST START ---");

  HistoryBuffer *history = new (std::nothrow) HistoryBuffer();
  if (history == nullptr) {
    result(output, "allocate 720-sample test buffer", false, allPassed);
  } else {
    for (uint32_t value = 1; value <= 725; ++value) {
      SensorSample sample;
      sample.monotonicUs = value;
      sample.lightLux = static_cast<float>(value);
      history->push(sample);
    }
    SensorSample first;
    SensorSample last;
    const bool order = history->size() == 720 &&
                       history->chronologicalAt(0, first) &&
                       history->chronologicalAt(719, last) &&
                       first.monotonicUs == 6 && last.monotonicUs == 725;
    result(output, "720-entry overwrite and chronological order", order,
           allPassed);
    const HistoryWindow window = history->windowSince(725, 9);
    result(output, "time-window filtering", window.count == 10, allPassed);
    delete history;
  }

  SensorSample sample;
  sample.monotonicUs = 123456789ULL;
  sample.utcEpochMs = 1755800000123LL;
  sample.bootId = 0xA842E391UL;
  sample.lightLux = 321.5F;
  sample.temperatureC = 26.4F;
  sample.humidityPercent = 61.2F;
  sample.noiseDbSpl = 72.3F;
  sample.mode = SamplingMode::EVENT_ACTIVE;
  sample.timeQuality = TimeQuality::SYNCED;
  sample.validMask = VALID_LIGHT | VALID_TEMPERATURE | VALID_HUMIDITY |
                     VALID_NOISE;
  uint8_t encoded[BinaryCodec::SAMPLE_RECORD_BYTES];
  BinaryCodec::encodeSample(sample, encoded);
  SensorSample decoded;
  const bool roundTrip = BinaryCodec::decodeSample(encoded, decoded) &&
                         decoded.monotonicUs == sample.monotonicUs &&
                         decoded.utcEpochMs == sample.utcEpochMs &&
                         decoded.mode == sample.mode &&
                         decoded.validMask == sample.validMask;
  result(output, "sample binary round trip", roundTrip, allPassed);
  encoded[20] ^= 0x01;
  result(output, "sample CRC corruption detection",
         !BinaryCodec::decodeSample(encoded, decoded), allPassed);

  TimeKeeper testClock;
  testClock.begin();
  constexpr int64_t TEST_UTC_MS = 1755800000000LL;
  constexpr uint64_t TEST_ANCHOR_US = 10000000ULL;
  result(output, "UTC range validation",
         !testClock.setUtcEpochMs(1, TEST_ANCHOR_US) &&
             testClock.setUtcEpochMs(TEST_UTC_MS, TEST_ANCHOR_US),
         allPassed);
  TimeQuality testQuality = TimeQuality::UNKNOWN;
  const int64_t convertedUtc =
      testClock.utcFor(TEST_ANCHOR_US + 2500000ULL, testQuality);
  result(output, "monotonic to UTC conversion",
         convertedUtc == TEST_UTC_MS + 2500LL &&
             testQuality == TimeQuality::SYNCED,
         allPassed);
  SensorSample unsynchronizedSample;
  unsynchronizedSample.monotonicUs = TEST_ANCHOR_US - 1000000ULL;
  unsynchronizedSample.bootId = testClock.bootId();
  result(output, "same-boot UTC backfill",
         testClock.backfill(unsynchronizedSample) &&
             unsynchronizedSample.utcEpochMs == TEST_UTC_MS - 1000LL &&
             unsynchronizedSample.timeQuality == TimeQuality::BACKFILLED,
         allPassed);
  constexpr int64_t RESYNCED_UTC_MS = TEST_UTC_MS + 120500LL;
  constexpr uint64_t RESYNCED_ANCHOR_US =
      TEST_ANCHOR_US + 120000000ULL;
  testClock.setUtcEpochMs(RESYNCED_UTC_MS, RESYNCED_ANCHOR_US);
  testQuality = TimeQuality::UNKNOWN;
  result(output, "UTC anchor resynchronization",
         testClock.utcFor(RESYNCED_ANCHOR_US + 1000000ULL, testQuality) ==
                 RESYNCED_UTC_MS + 1000LL &&
             testQuality == TimeQuality::SYNCED,
         allPassed);

  EventMetadata metadata;
  strlcpy(metadata.eventId, "ESP32_TEST_U12345678_0000000001_ABCDEF01",
          sizeof(metadata.eventId));
  strlcpy(metadata.deviceId, "A842E3910001", sizeof(metadata.deviceId));
  metadata.eventSequence = 1;
  metadata.bootId = 0x12345678;
  metadata.expectedPreCount = 720;
  metadata.expectedActiveCount = 600;
  metadata.actualPreCount = 720;
  uint8_t header[BinaryCodec::EVENT_HEADER_BYTES];
  BinaryCodec::encodeHeader(metadata, header);
  EventMetadata decodedMetadata;
  result(output, "event header round trip",
         BinaryCodec::decodeHeader(header, decodedMetadata) &&
             strcmp(metadata.eventId, decodedMetadata.eventId) == 0 &&
             decodedMetadata.eventSequence == 1,
         allPassed);

  BinaryCodec::FooterData footer;
  footer.status = EventStatus::COMPLETE;
  footer.preCount = 720;
  footer.activeCount = 600;
  footer.sampleCount = 1320;
  footer.payloadCrc32 = 0x12345678;
  footer.anchor.valid = true;
  footer.anchor.bootId = 42;
  uint8_t footerBytes[BinaryCodec::EVENT_FOOTER_BYTES];
  BinaryCodec::encodeFooter(footer, footerBytes);
  BinaryCodec::FooterData decodedFooter;
  result(output, "event footer round trip",
         BinaryCodec::decodeFooter(footerBytes, decodedFooter) &&
             decodedFooter.sampleCount == 1320 &&
             decodedFooter.status == EventStatus::COMPLETE,
         allPassed);

  char idOne[64];
  char idTwo[64];
  snprintf(idOne, sizeof(idOne), "ESP32_TEST_U12345678_%010u_%08X", 1,
           0xAABBCCDD);
  snprintf(idTwo, sizeof(idTwo), "ESP32_TEST_U12345678_%010u_%08X", 2,
           0xAABBCCDD);
  result(output, "sequence makes event IDs distinct",
         strcmp(idOne, idTwo) != 0, allPassed);

  const bool stateTransitions =
      deviceStateTransitionAllowed(DeviceState::NORMAL,
                                   DeviceState::SAVING_EVENT_PRE) &&
      deviceStateTransitionAllowed(DeviceState::SAVING_EVENT_PRE,
                                   DeviceState::EVENT_RECORDING) &&
      deviceStateTransitionAllowed(DeviceState::EVENT_RECORDING,
                                   DeviceState::FINALIZING_EVENT) &&
      deviceStateTransitionAllowed(DeviceState::FINALIZING_EVENT,
                                   DeviceState::NORMAL) &&
      deviceStateTransitionAllowed(DeviceState::EVENT_RECORDING,
                                   DeviceState::STORAGE_ERROR) &&
      !deviceStateTransitionAllowed(DeviceState::NORMAL,
                                    DeviceState::FINALIZING_EVENT);
  result(output, "event state transitions", stateTransitions, allPassed);

  output.println(allPassed ? "SELF_TEST_RESULT=PASS" :
                             "SELF_TEST_RESULT=FAIL");
  output.println("--- FIRMWARE SELF TEST END ---");
  return allPassed;
}
