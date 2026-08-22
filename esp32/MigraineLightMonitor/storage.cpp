#include "storage.h"

#include <ESP.h>
#include <inttypes.h>
#include <string.h>

#include "config.h"

namespace {

bool endsWith(const char *value, const char *suffix) {
  if (value == nullptr || suffix == nullptr) {
    return false;
  }
  const size_t valueLength = strlen(value);
  const size_t suffixLength = strlen(suffix);
  return valueLength >= suffixLength &&
         strcmp(value + valueLength - suffixLength, suffix) == 0;
}

bool replaceSuffix(const char *source, const char *oldSuffix,
                   const char *newSuffix, char *output,
                   size_t outputCapacity) {
  if (!endsWith(source, oldSuffix)) {
    return false;
  }
  const size_t prefixLength = strlen(source) - strlen(oldSuffix);
  if (prefixLength + strlen(newSuffix) + 1U > outputCapacity) {
    return false;
  }
  memcpy(output, source, prefixLength);
  output[prefixLength] = '\0';
  strcat(output, newSuffix);
  return true;
}

void printInt64(Print &output, int64_t value) {
  char text[32];
  snprintf(text, sizeof(text), "%lld", static_cast<long long>(value));
  output.print(text);
}

void printFloatOrNull(Print &output, float value, bool valid) {
  if (valid) {
    output.print(value, 2);
  } else {
    output.print("null");
  }
}

}  // namespace

bool StorageManager::begin() {
  const uint64_t chipId = ESP.getEfuseMac() & 0x0000FFFFFFFFFFFFULL;
  snprintf(deviceId_, sizeof(deviceId_), "%012llX",
           static_cast<unsigned long long>(chipId));

  if (!preferences_.begin("migraine", false)) {
    Serial.println("[ERROR] Preferences initialization failed");
    return false;
  }

  // Never pass true here. Formatting on mount failure would destroy pending
  // events and legacy logs.
  if (!LittleFS.begin(false)) {
    Serial.println("[ERROR] LittleFS mount failed; automatic format disabled");
    return false;
  }

  if (!LittleFS.exists(Config::EVENT_DIRECTORY) &&
      !LittleFS.mkdir(Config::EVENT_DIRECTORY)) {
    Serial.println("[ERROR] Could not create /events");
    return false;
  }
  if (!LittleFS.exists(Config::BASELINE_DIRECTORY) &&
      !LittleFS.mkdir(Config::BASELINE_DIRECTORY)) {
    Serial.println("[ERROR] Could not create /baseline");
    return false;
  }

  baselineSequence_ = preferences_.getUInt("baseSeq", 1);
  baselineRecordCount_ = preferences_.getUShort("baseCount", 0);
  char baselinePath[64];
  currentBaselinePath(baselinePath, sizeof(baselinePath));
  if (LittleFS.exists(baselinePath)) {
    File baseline = LittleFS.open(baselinePath, FILE_READ);
    if (baseline) {
      const size_t size = baseline.size();
      baseline.close();
      if (size % BinaryCodec::SAMPLE_RECORD_BYTES == 0) {
        baselineRecordCount_ = static_cast<uint16_t>(
            size / BinaryCodec::SAMPLE_RECORD_BYTES);
      } else {
        Serial.println("[ERROR] Baseline segment has a truncated record; rotating");
        rotateBaselineSegment();
      }
    }
  } else {
    baselineRecordCount_ = 0;
  }

  ready_ = true;
  recoverEventsAtBoot();

  Serial.print("[INFO] Storage ready; device_id=");
  Serial.print(deviceId_);
  Serial.print(" total=");
  Serial.print(totalBytes());
  Serial.print(" used=");
  Serial.println(usedBytes());
  if (legacyDataPresent()) {
    Serial.println("[WARN] Legacy migraine CSV data is present and preserved");
  }
  return true;
}

size_t StorageManager::totalBytes() const {
  return ready_ ? LittleFS.totalBytes() : 0;
}

size_t StorageManager::usedBytes() const {
  return ready_ ? LittleFS.usedBytes() : 0;
}

size_t StorageManager::freeBytes() const {
  const size_t total = totalBytes();
  const size_t used = usedBytes();
  return total > used ? total - used : 0;
}

uint8_t StorageManager::usagePercent() const {
  const size_t total = totalBytes();
  return total == 0
             ? 100
             : static_cast<uint8_t>((usedBytes() * 100ULL) / total);
}

bool StorageManager::legacyDataPresent() const {
  if (!ready_) {
    return false;
  }
  return LittleFS.exists(Config::LEGACY_LOG_PATHS[0]) ||
         LittleFS.exists(Config::LEGACY_LOG_PATHS[1]);
}

void StorageManager::currentBaselinePath(char *output,
                                         size_t outputCapacity) const {
  snprintf(output, outputCapacity, "%s/b%08lu.bin",
           Config::BASELINE_DIRECTORY,
           static_cast<unsigned long>(baselineSequence_));
}

void StorageManager::rotateBaselineSegment() {
  ++baselineSequence_;
  if (baselineSequence_ == 0) {
    baselineSequence_ = 1;
  }
  baselineRecordCount_ = 0;
  preferences_.putUInt("baseSeq", baselineSequence_);
  preferences_.putUShort("baseCount", baselineRecordCount_);
}

bool StorageManager::normalizeDirectoryEntry(
    const char *directory, const char *entryName, char *output,
    size_t outputCapacity) const {
  if (entryName == nullptr || entryName[0] == '\0') {
    return false;
  }
  if (entryName[0] == '/') {
    return strlcpy(output, entryName, outputCapacity) < outputCapacity;
  }
  const int written =
      snprintf(output, outputCapacity, "%s/%s", directory, entryName);
  return written > 0 && static_cast<size_t>(written) < outputCapacity;
}

bool StorageManager::findOldestBaseline(char *output,
                                        size_t outputCapacity) const {
  output[0] = '\0';
  File directory = LittleFS.open(Config::BASELINE_DIRECTORY);
  if (!directory || !directory.isDirectory()) {
    return false;
  }

  File entry = directory.openNextFile();
  while (entry) {
    if (!entry.isDirectory()) {
      char path[96];
      if (normalizeDirectoryEntry(Config::BASELINE_DIRECTORY, entry.name(),
                                  path, sizeof(path)) &&
          endsWith(path, ".bin") &&
          (output[0] == '\0' || strcmp(path, output) < 0)) {
        strlcpy(output, path, outputCapacity);
      }
    }
    entry.close();
    entry = directory.openNextFile();
  }
  directory.close();
  return output[0] != '\0';
}

bool StorageManager::deleteOldestBaseline() {
  char oldest[96];
  if (!findOldestBaseline(oldest, sizeof(oldest))) {
    return false;
  }

  char current[64];
  currentBaselinePath(current, sizeof(current));
  if (!LittleFS.remove(oldest)) {
    Serial.print("[ERROR] Could not remove baseline segment ");
    Serial.println(oldest);
    return false;
  }
  Serial.print("[WARN] Removed oldest baseline segment ");
  Serial.println(oldest);
  if (strcmp(oldest, current) == 0) {
    rotateBaselineSegment();
  }
  return true;
}

bool StorageManager::purgeBaselinesUntil(size_t requiredFreeBytes,
                                         uint8_t targetUsagePercent) {
  while (freeBytes() < requiredFreeBytes ||
         (targetUsagePercent > 0 &&
          usagePercent() >= targetUsagePercent)) {
    if (!deleteOldestBaseline()) {
      break;
    }
  }
  return freeBytes() >= requiredFreeBytes &&
         (targetUsagePercent == 0 ||
          usagePercent() < targetUsagePercent);
}

bool StorageManager::maintainCapacity() {
  if (!ready_) {
    return false;
  }
  if (usagePercent() >= Config::FLASH_CRITICAL_PERCENT) {
    purgeBaselinesUntil(Config::EVENT_RESERVE_BYTES,
                        Config::FLASH_URGENT_PERCENT);
  } else if (freeBytes() < Config::EVENT_RESERVE_BYTES) {
    purgeBaselinesUntil(Config::EVENT_RESERVE_BYTES, 0);
  }
  return freeBytes() >= Config::EVENT_RESERVE_BYTES;
}

bool StorageManager::ensureEventReserve() {
  if (!ready_) {
    return false;
  }
  if (freeBytes() < Config::EVENT_RESERVE_BYTES) {
    purgeBaselinesUntil(Config::EVENT_RESERVE_BYTES, 0);
  }
  return freeBytes() >= Config::EVENT_RESERVE_BYTES;
}

bool StorageManager::appendBaseline(const SensorSample &sample) {
  if (!ready_ || eventOpen_) {
    return false;
  }
  const size_t required = Config::EVENT_RESERVE_BYTES +
                          BinaryCodec::SAMPLE_RECORD_BYTES + 4096U;
  if (freeBytes() < required && !purgeBaselinesUntil(required, 0)) {
    Serial.println("[WARN] Baseline skipped to protect event reserve");
    return false;
  }
  if (baselineRecordCount_ >= Config::BASELINE_SEGMENT_RECORDS) {
    rotateBaselineSegment();
  }

  char path[64];
  currentBaselinePath(path, sizeof(path));
  File file = LittleFS.open(path, FILE_APPEND);
  if (!file) {
    Serial.println("[ERROR] Could not open baseline segment");
    return false;
  }
  uint8_t encoded[BinaryCodec::SAMPLE_RECORD_BYTES];
  BinaryCodec::encodeSample(sample, encoded);
  const bool success = file.write(encoded, sizeof(encoded)) == sizeof(encoded);
  file.flush();
  file.close();
  if (!success) {
    Serial.println("[ERROR] Baseline flash write failed");
    return false;
  }
  ++baselineRecordCount_;
  preferences_.putUShort("baseCount", baselineRecordCount_);
  return true;
}

uint64_t StorageManager::allocateEventSequence() {
  const uint64_t sequence = preferences_.getULong64("eventSeq", 1);
  const uint64_t next = sequence == UINT64_MAX ? 1 : sequence + 1;
  return preferences_.putULong64("eventSeq", next) == sizeof(next) ? sequence
                                                                   : 0;
}

bool StorageManager::beginEvent(const EventMetadata &metadata) {
  if (!ready_ || eventOpen_ || metadata.eventId[0] == '\0') {
    return false;
  }
  activeMetadata_ = metadata;
  snprintf(activePartPath_, sizeof(activePartPath_), "%s/%s.part",
           Config::EVENT_DIRECTORY, activeMetadata_.eventId);
  if (LittleFS.exists(activePartPath_)) {
    Serial.println("[ERROR] Event path collision");
    return false;
  }

  eventFile_ = LittleFS.open(activePartPath_, FILE_WRITE);
  if (!eventFile_) {
    Serial.println("[ERROR] Could not create event file");
    return false;
  }
  uint8_t header[BinaryCodec::EVENT_HEADER_BYTES];
  BinaryCodec::encodeHeader(activeMetadata_, header);
  if (eventFile_.write(header, sizeof(header)) != sizeof(header)) {
    eventFile_.flush();
    eventFile_.close();
    Serial.println("[ERROR] Event header write failed");
    return false;
  }
  eventFile_.flush();
  payloadCrcState_ = BinaryCodec::crc32Begin();
  writtenPreCount_ = 0;
  writtenActiveCount_ = 0;
  eventOpen_ = true;
  return true;
}

bool StorageManager::appendEventSample(const SensorSample &sample,
                                       bool flushImmediately) {
  if (!eventOpen_ || !eventFile_) {
    return false;
  }
  uint8_t encoded[BinaryCodec::SAMPLE_RECORD_BYTES];
  BinaryCodec::encodeSample(sample, encoded);
  if (eventFile_.write(encoded, sizeof(encoded)) != sizeof(encoded)) {
    Serial.println("[ERROR] Event sample write failed");
    return false;
  }
  payloadCrcState_ =
      BinaryCodec::crc32Update(payloadCrcState_, encoded, sizeof(encoded));
  if (sample.mode == SamplingMode::EVENT_PRE) {
    ++writtenPreCount_;
  } else if (sample.mode == SamplingMode::EVENT_ACTIVE) {
    ++writtenActiveCount_;
  }
  if (flushImmediately) {
    eventFile_.flush();
  }
  return true;
}

bool StorageManager::flushEvent() {
  if (!eventOpen_ || !eventFile_) {
    return false;
  }
  eventFile_.flush();
  return true;
}

bool StorageManager::finalizeEvent(EventStatus status, uint64_t nowUs,
                                   const TimeKeeper &timeKeeper) {
  if (!eventOpen_ || !eventFile_) {
    return false;
  }

  BinaryCodec::FooterData footer;
  footer.status = status;
  footer.preCount = writtenPreCount_;
  footer.activeCount = writtenActiveCount_;
  footer.sampleCount = writtenPreCount_ + writtenActiveCount_;
  footer.payloadCrc32 = BinaryCodec::crc32Finish(payloadCrcState_);
  footer.finalizedMonotonicUs = nowUs;
  TimeQuality finalQuality = TimeQuality::UNKNOWN;
  footer.finalizedUtcMs = timeKeeper.utcFor(nowUs, finalQuality);
  footer.anchor = timeKeeper.anchor();

  uint8_t encoded[BinaryCodec::EVENT_FOOTER_BYTES];
  BinaryCodec::encodeFooter(footer, encoded);
  const bool written = eventFile_.write(encoded, sizeof(encoded)) ==
                       sizeof(encoded);
  eventFile_.flush();
  eventFile_.close();
  eventOpen_ = false;
  if (!written) {
    Serial.println("[ERROR] Event footer write failed; .part preserved");
    return false;
  }

  char finalPath[112];
  const char *extension =
      status == EventStatus::COMPLETE ? ".evt" : ".incomplete";
  if (!replaceSuffix(activePartPath_, ".part", extension, finalPath,
                     sizeof(finalPath)) ||
      !LittleFS.rename(activePartPath_, finalPath)) {
    Serial.println("[ERROR] Event finalized but rename failed; .part preserved");
    return false;
  }
  Serial.print("[INFO] Event finalized: ");
  Serial.println(finalPath);
  activePartPath_[0] = '\0';
  return true;
}

void StorageManager::preserveOpenEventAsIncomplete(EventStatus reason) {
  if (!eventOpen_) {
    return;
  }
  if (eventFile_) {
    eventFile_.flush();
    eventFile_.close();
  }
  eventOpen_ = false;
  char incompletePath[112];
  if (replaceSuffix(activePartPath_, ".part", ".incomplete", incompletePath,
                    sizeof(incompletePath)) &&
      !LittleFS.exists(incompletePath)) {
    LittleFS.rename(activePartPath_, incompletePath);
  }
  Serial.print("[ERROR] Event preserved as ");
  Serial.println(eventStatusName(reason));
}

bool StorageManager::readHeader(File &file, EventMetadata &metadata) const {
  if (!file || file.size() < BinaryCodec::EVENT_HEADER_BYTES ||
      !file.seek(0)) {
    return false;
  }
  uint8_t header[BinaryCodec::EVENT_HEADER_BYTES];
  return file.read(header, sizeof(header)) == sizeof(header) &&
         BinaryCodec::decodeHeader(header, metadata);
}

bool StorageManager::validateCompleteEvent(
    const char *path, EventMetadata *metadata,
    BinaryCodec::FooterData *footerOutput) const {
  File file = LittleFS.open(path, FILE_READ);
  EventMetadata localMetadata;
  if (!readHeader(file, localMetadata) ||
      file.size() < BinaryCodec::EVENT_HEADER_BYTES +
                        BinaryCodec::EVENT_FOOTER_BYTES) {
    file.close();
    return false;
  }
  const size_t size = file.size();
  if (!file.seek(size - BinaryCodec::EVENT_FOOTER_BYTES)) {
    file.close();
    return false;
  }
  uint8_t footerBytes[BinaryCodec::EVENT_FOOTER_BYTES];
  BinaryCodec::FooterData footer;
  if (file.read(footerBytes, sizeof(footerBytes)) != sizeof(footerBytes) ||
      !BinaryCodec::decodeFooter(footerBytes, footer)) {
    file.close();
    return false;
  }
  const size_t expectedSize =
      BinaryCodec::EVENT_HEADER_BYTES +
      static_cast<size_t>(footer.sampleCount) *
          BinaryCodec::SAMPLE_RECORD_BYTES +
      BinaryCodec::EVENT_FOOTER_BYTES;
  if (expectedSize != size || !file.seek(BinaryCodec::EVENT_HEADER_BYTES)) {
    file.close();
    return false;
  }

  uint32_t payloadState = BinaryCodec::crc32Begin();
  uint32_t decodedPreCount = 0;
  uint32_t decodedActiveCount = 0;
  uint8_t record[BinaryCodec::SAMPLE_RECORD_BYTES];
  SensorSample decoded;
  for (uint32_t index = 0; index < footer.sampleCount; ++index) {
    if (file.read(record, sizeof(record)) != sizeof(record) ||
        !BinaryCodec::decodeSample(record, decoded)) {
      file.close();
      return false;
    }
    payloadState = BinaryCodec::crc32Update(payloadState, record,
                                            sizeof(record));
    if (decoded.mode == SamplingMode::EVENT_PRE) {
      ++decodedPreCount;
    } else if (decoded.mode == SamplingMode::EVENT_ACTIVE) {
      ++decodedActiveCount;
    } else {
      file.close();
      return false;
    }
  }
  file.close();
  if (BinaryCodec::crc32Finish(payloadState) != footer.payloadCrc32 ||
      footer.sampleCount != footer.preCount + footer.activeCount ||
      decodedPreCount != footer.preCount ||
      decodedActiveCount != footer.activeCount ||
      localMetadata.actualPreCount != footer.preCount) {
    return false;
  }
  if (metadata != nullptr) {
    *metadata = localMetadata;
  }
  if (footerOutput != nullptr) {
    *footerOutput = footer;
  }
  return true;
}

bool StorageManager::recoverEventsAtBoot() {
  File directory = LittleFS.open(Config::EVENT_DIRECTORY);
  if (!directory || !directory.isDirectory()) {
    return false;
  }
  File entry = directory.openNextFile();
  while (entry) {
    char path[112];
    const bool normalized = normalizeDirectoryEntry(
        Config::EVENT_DIRECTORY, entry.name(), path, sizeof(path));
    entry.close();
    if (normalized && endsWith(path, ".part")) {
      char recovered[112];
      BinaryCodec::FooterData recoveredFooter;
      if (validateCompleteEvent(path, nullptr, &recoveredFooter)) {
        replaceSuffix(path, ".part",
                      recoveredFooter.status == EventStatus::COMPLETE
                          ? ".evt"
                          : ".incomplete",
                      recovered, sizeof(recovered));
      } else {
        // A torn header is still interrupted capture evidence. Only invalid
        // files that had already been named complete are quarantined.
        replaceSuffix(path, ".part", ".incomplete", recovered,
                      sizeof(recovered));
      }
      if (!LittleFS.exists(recovered) && LittleFS.rename(path, recovered)) {
        Serial.print("[WARN] Recovered interrupted event as ");
        Serial.println(recovered);
      }
    } else if (normalized && endsWith(path, ".evt")) {
      BinaryCodec::FooterData footer;
      if (!validateCompleteEvent(path, nullptr, &footer) ||
          footer.status != EventStatus::COMPLETE) {
        char corrupt[112];
        if (replaceSuffix(path, ".evt", ".corrupt", corrupt,
                          sizeof(corrupt)) &&
            !LittleFS.exists(corrupt) && LittleFS.rename(path, corrupt)) {
          Serial.print("[ERROR] Quarantined corrupt event as ");
          Serial.println(corrupt);
        }
      }
    }
    entry = directory.openNextFile();
  }
  directory.close();
  return true;
}

EventStatus StorageManager::statusForPath(const char *path) const {
  if (endsWith(path, ".evt")) {
    return EventStatus::COMPLETE;
  }
  if (endsWith(path, ".part")) {
    return EventStatus::RECORDING;
  }
  if (endsWith(path, ".incomplete")) {
    return EventStatus::INCOMPLETE_POWER_LOSS;
  }
  return EventStatus::CORRUPT;
}

size_t StorageManager::listPendingEvents(EventDescriptor *descriptors,
                                         size_t capacity) const {
  if (!ready_) {
    return 0;
  }
  size_t total = 0;
  File directory = LittleFS.open(Config::EVENT_DIRECTORY);
  if (!directory || !directory.isDirectory()) {
    return 0;
  }
  File entry = directory.openNextFile();
  while (entry) {
    if (!entry.isDirectory()) {
      char path[112];
      if (normalizeDirectoryEntry(Config::EVENT_DIRECTORY, entry.name(), path,
                                  sizeof(path)) &&
          (endsWith(path, ".evt") || endsWith(path, ".incomplete") ||
           endsWith(path, ".part") || endsWith(path, ".corrupt"))) {
        if (descriptors != nullptr && total < capacity) {
          EventDescriptor &descriptor = descriptors[total];
          strlcpy(descriptor.path, path, sizeof(descriptor.path));
          descriptor.status = statusForPath(path);
          descriptor.fileSize = entry.size();
          EventMetadata metadata;
          if (readHeader(entry, metadata)) {
            strlcpy(descriptor.eventId, metadata.eventId,
                    sizeof(descriptor.eventId));
          } else {
            descriptor.eventId[0] = '\0';
          }
          BinaryCodec::FooterData footer;
          if (validateCompleteEvent(path, nullptr, &footer)) {
            descriptor.sampleCount = footer.sampleCount;
            if (descriptor.status == EventStatus::COMPLETE &&
                footer.status != EventStatus::COMPLETE) {
              descriptor.status = EventStatus::CORRUPT;
            }
          } else if (entry.size() >= BinaryCodec::EVENT_HEADER_BYTES) {
            descriptor.sampleCount = static_cast<uint32_t>(
                (entry.size() - BinaryCodec::EVENT_HEADER_BYTES) /
                BinaryCodec::SAMPLE_RECORD_BYTES);
          }
        }
        ++total;
      }
    }
    entry.close();
    entry = directory.openNextFile();
  }
  directory.close();
  return total;
}

bool StorageManager::findEventPath(const char *eventId, char *output,
                                   size_t outputCapacity) const {
  constexpr const char *extensions[] = {".evt", ".incomplete", ".part",
                                         ".corrupt"};
  for (const char *extension : extensions) {
    snprintf(output, outputCapacity, "%s/%s%s", Config::EVENT_DIRECTORY,
             eventId, extension);
    if (LittleFS.exists(output)) {
      return true;
    }
  }
  output[0] = '\0';
  return false;
}

bool StorageManager::readEventRange(const char *eventId, size_t offset,
                                    uint8_t *buffer, size_t requested,
                                    size_t &bytesRead) const {
  bytesRead = 0;
  char path[112];
  if (!ready_ || !findEventPath(eventId, path, sizeof(path))) {
    return false;
  }
  File file = LittleFS.open(path, FILE_READ);
  if (!file || offset > file.size() || !file.seek(offset)) {
    file.close();
    return false;
  }
  bytesRead = file.read(buffer, requested);
  file.close();
  return true;
}

bool StorageManager::deleteAfterServerConfirmation(const char *eventId) {
  if (!ready_ || eventOpen_) {
    return false;
  }
  char path[112];
  if (!findEventPath(eventId, path, sizeof(path)) ||
      endsWith(path, ".part") || endsWith(path, ".corrupt")) {
    return false;
  }
  const bool removed = LittleFS.remove(path);
  if (removed) {
    Serial.print("[INFO] Server-confirmed event deleted: ");
    Serial.println(eventId);
  }
  return removed;
}

void StorageManager::printStatus(Print &output) const {
  output.print("storage_ready=");
  output.println(ready_ ? "true" : "false");
  output.print("device_id=");
  output.println(deviceId_);
  output.print("flash_total=");
  output.println(totalBytes());
  output.print("flash_used=");
  output.println(usedBytes());
  output.print("flash_free=");
  output.println(freeBytes());
  output.print("flash_percent=");
  output.println(usagePercent());
  output.print("event_reserve_ok=");
  output.println(freeBytes() >= Config::EVENT_RESERVE_BYTES ? "true" : "false");
  output.print("legacy_data=");
  output.println(legacyDataPresent() ? "present" : "none");
}

void StorageManager::printEventList(Print &output) const {
  const size_t total = listPendingEvents(nullptr, 0);
  output.print("pending_event_count=");
  output.println(total);
  File directory = LittleFS.open(Config::EVENT_DIRECTORY);
  if (!directory || !directory.isDirectory()) {
    return;
  }
  File entry = directory.openNextFile();
  while (entry) {
    if (!entry.isDirectory()) {
      char path[112];
      if (normalizeDirectoryEntry(Config::EVENT_DIRECTORY, entry.name(), path,
                                  sizeof(path)) &&
          (endsWith(path, ".evt") || endsWith(path, ".incomplete") ||
           endsWith(path, ".part") || endsWith(path, ".corrupt"))) {
        EventMetadata metadata;
        if (readHeader(entry, metadata)) {
          output.print(metadata.eventId);
        } else {
          output.print("UNKNOWN_ID");
        }
        output.print(',');
        output.print(eventStatusName(statusForPath(path)));
        output.print(',');
        output.print(entry.size());
        output.print(',');
        output.println(path);
      }
    }
    entry.close();
    entry = directory.openNextFile();
  }
  directory.close();
}

bool StorageManager::dumpEventCsv(const char *eventId, Print &output) const {
  char path[112];
  if (!ready_ || !findEventPath(eventId, path, sizeof(path))) {
    return false;
  }
  File file = LittleFS.open(path, FILE_READ);
  EventMetadata metadata;
  if (!readHeader(file, metadata)) {
    file.close();
    return false;
  }

  output.print("# event_id=");
  output.println(metadata.eventId);
  output.print("# device_id=");
  output.println(metadata.deviceId);
  output.print("# status=");
  output.println(eventStatusName(statusForPath(path)));
  output.print("# event_utc_ms=");
  if (metadata.eventUtcMs == 0) {
    output.println("null");
  } else {
    printInt64(output, metadata.eventUtcMs);
    output.println();
  }
  output.println(
      "monotonic_us,utc_epoch_ms,boot_id,sampling_mode,time_quality,"
      "light_lux,temperature_c,humidity_percent,noise_db_spl,valid_mask");

  const size_t size = file.size();
  size_t dataEnd = size;
  BinaryCodec::FooterData footer;
  if (size >= BinaryCodec::EVENT_HEADER_BYTES +
                  BinaryCodec::EVENT_FOOTER_BYTES &&
      file.seek(size - BinaryCodec::EVENT_FOOTER_BYTES)) {
    uint8_t footerBytes[BinaryCodec::EVENT_FOOTER_BYTES];
    if (file.read(footerBytes, sizeof(footerBytes)) == sizeof(footerBytes) &&
        BinaryCodec::decodeFooter(footerBytes, footer)) {
      dataEnd -= BinaryCodec::EVENT_FOOTER_BYTES;
    }
  }

  file.seek(BinaryCodec::EVENT_HEADER_BYTES);
  uint8_t record[BinaryCodec::SAMPLE_RECORD_BYTES];
  while (file.position() + sizeof(record) <= dataEnd) {
    if (file.read(record, sizeof(record)) != sizeof(record)) {
      break;
    }
    SensorSample sample;
    if (!BinaryCodec::decodeSample(record, sample)) {
      output.println("# CRC_ERROR: remaining records not emitted");
      break;
    }
    char number[32];
    snprintf(number, sizeof(number), "%llu",
             static_cast<unsigned long long>(sample.monotonicUs));
    output.print(number);
    output.print(',');
    if (sample.utcEpochMs == 0) {
      output.print("null");
    } else {
      printInt64(output, sample.utcEpochMs);
    }
    output.print(',');
    output.print(sample.bootId, HEX);
    output.print(',');
    output.print(samplingModeName(sample.mode));
    output.print(',');
    output.print(timeQualityName(sample.timeQuality));
    output.print(',');
    printFloatOrNull(output, sample.lightLux,
                     sampleFieldValid(sample, VALID_LIGHT));
    output.print(',');
    printFloatOrNull(output, sample.temperatureC,
                     sampleFieldValid(sample, VALID_TEMPERATURE));
    output.print(',');
    printFloatOrNull(output, sample.humidityPercent,
                     sampleFieldValid(sample, VALID_HUMIDITY));
    output.print(',');
    printFloatOrNull(output, sample.noiseDbSpl,
                     sampleFieldValid(sample, VALID_NOISE));
    output.print(',');
    output.println(sample.validMask);
  }
  file.close();
  return true;
}

void StorageManager::dumpLegacy(Print &output) const {
  for (const char *path : Config::LEGACY_LOG_PATHS) {
    if (!LittleFS.exists(path)) {
      continue;
    }
    output.print("--- LEGACY CSV START ");
    output.print(path);
    output.println(" ---");
    File file = LittleFS.open(path, FILE_READ);
    while (file && file.available()) {
      output.write(static_cast<uint8_t>(file.read()));
    }
    file.close();
    output.print("--- LEGACY CSV END ");
    output.print(path);
    output.println(" ---");
  }
}
