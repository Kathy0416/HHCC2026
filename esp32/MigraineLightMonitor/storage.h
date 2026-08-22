#pragma once

#include <FS.h>
#include <LittleFS.h>
#include <Preferences.h>

#include "binary_codec.h"
#include "data_types.h"
#include "time_keeper.h"

class StorageManager {
 public:
  bool begin();
  bool ready() const { return ready_; }
  const char *deviceId() const { return deviceId_; }

  size_t totalBytes() const;
  size_t usedBytes() const;
  size_t freeBytes() const;
  uint8_t usagePercent() const;
  bool legacyDataPresent() const;

  bool maintainCapacity();
  bool ensureEventReserve();
  bool appendBaseline(const SensorSample &sample);

  uint64_t allocateEventSequence();
  bool beginEvent(const EventMetadata &metadata);
  bool appendEventSample(const SensorSample &sample,
                         bool flushImmediately);
  bool flushEvent();
  bool finalizeEvent(EventStatus status, uint64_t nowUs,
                     const TimeKeeper &timeKeeper);
  void preserveOpenEventAsIncomplete(EventStatus reason);
  bool eventOpen() const { return eventOpen_; }
  const char *activeEventId() const { return activeMetadata_.eventId; }

  size_t listPendingEvents(EventDescriptor *descriptors,
                           size_t descriptorCapacity) const;
  bool readEventRange(const char *eventId, size_t offset, uint8_t *buffer,
                      size_t requested, size_t &bytesRead) const;
  bool deleteAfterServerConfirmation(const char *eventId);

  void printStatus(Print &output) const;
  void printEventList(Print &output) const;
  bool dumpEventCsv(const char *eventId, Print &output) const;
  void dumpLegacy(Print &output) const;

 private:
  bool recoverEventsAtBoot();
  bool validateCompleteEvent(const char *path, EventMetadata *metadata,
                             BinaryCodec::FooterData *footer) const;
  bool readHeader(File &file, EventMetadata &metadata) const;
  bool findEventPath(const char *eventId, char *output,
                     size_t outputCapacity) const;
  bool findOldestBaseline(char *output, size_t outputCapacity) const;
  bool purgeBaselinesUntil(size_t requiredFreeBytes,
                           uint8_t targetUsagePercent);
  bool deleteOldestBaseline();
  void currentBaselinePath(char *output, size_t outputCapacity) const;
  void rotateBaselineSegment();
  EventStatus statusForPath(const char *path) const;
  bool normalizeDirectoryEntry(const char *directory, const char *entryName,
                               char *output, size_t outputCapacity) const;

  bool ready_ = false;
  Preferences preferences_;
  char deviceId_[DEVICE_ID_CAPACITY] = {};

  uint32_t baselineSequence_ = 1;
  uint16_t baselineRecordCount_ = 0;

  bool eventOpen_ = false;
  File eventFile_;
  EventMetadata activeMetadata_;
  char activePartPath_[112] = {};
  uint32_t payloadCrcState_ = 0;
  uint32_t writtenPreCount_ = 0;
  uint32_t writtenActiveCount_ = 0;
};
