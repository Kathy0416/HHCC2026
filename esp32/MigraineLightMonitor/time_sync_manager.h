#pragma once

#include <Arduino.h>
#include <sys/time.h>

#include "network_manager.h"
#include "time_keeper.h"

class TimeSyncManager {
 public:
  TimeSyncManager(TimeKeeper &timeKeeper, WifiProvisioningManager &network)
      : timeKeeper_(timeKeeper), network_(network) {}

  void begin();
  void tick(uint64_t nowUs);
  bool ntpSynchronized() const { return syncCount_ > 0; }
  bool waitingForNtp() const { return waitingForNtp_; }
  int64_t lastSyncUtcMs() const { return lastSyncUtcMs_; }
  uint32_t syncCount() const { return syncCount_; }
  void printStatus(Print &output) const;

 private:
  static void onSntpSync(struct timeval *value);
  void configureSntp();
  void applySntpTime();

  static volatile bool notificationPending_;
  TimeKeeper &timeKeeper_;
  WifiProvisioningManager &network_;
  uint32_t configuredGeneration_ = 0;
  uint32_t syncCount_ = 0;
  int64_t lastSyncUtcMs_ = 0;
  bool waitingForNtp_ = false;
};
