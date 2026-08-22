#include "time_sync_manager.h"

#include <esp_sntp.h>
#include <time.h>

#include "config.h"

volatile bool TimeSyncManager::notificationPending_ = false;

void TimeSyncManager::begin() {
  sntp_set_time_sync_notification_cb(onSntpSync);
}

void TimeSyncManager::onSntpSync(struct timeval *value) {
  (void)value;
  notificationPending_ = true;
}

void TimeSyncManager::configureSntp() {
  notificationPending_ = false;
  waitingForNtp_ = true;
  configTzTime("UTC0", Config::NTP_SERVER_1, Config::NTP_SERVER_2,
               Config::NTP_SERVER_3);
  sntp_set_sync_interval(Config::NTP_RESYNC_INTERVAL_MS);
  Serial.println("[INFO] NTP synchronization requested");
}

void TimeSyncManager::applySntpTime() {
  const uint64_t beforeUs = timeKeeper_.monotonicUs();
  struct timeval value = {};
  if (gettimeofday(&value, nullptr) != 0) {
    Serial.println("[WARN] NTP callback did not provide readable system time");
    return;
  }
  const uint64_t afterUs = timeKeeper_.monotonicUs();
  const uint64_t atMonotonicUs = beforeUs + (afterUs - beforeUs) / 2ULL;
  const int64_t epochMs = static_cast<int64_t>(value.tv_sec) * 1000LL +
                          static_cast<int64_t>(value.tv_usec) / 1000LL;
  if (!timeKeeper_.setUtcEpochMs(epochMs, atMonotonicUs)) {
    Serial.println("[WARN] NTP returned an unreasonable UTC value");
    return;
  }

  waitingForNtp_ = false;
  lastSyncUtcMs_ = epochMs;
  ++syncCount_;
  Serial.print("[INFO] UTC synchronized by NTP: epoch_ms=");
  char text[32];
  snprintf(text, sizeof(text), "%lld", static_cast<long long>(epochMs));
  Serial.println(text);
}

void TimeSyncManager::tick(uint64_t nowUs) {
  (void)nowUs;
  if (network_.connected() &&
      configuredGeneration_ != network_.connectionGeneration()) {
    configuredGeneration_ = network_.connectionGeneration();
    configureSntp();
  }
  if (notificationPending_) {
    notificationPending_ = false;
    applySntpTime();
  }
}

void TimeSyncManager::printStatus(Print &output) const {
  output.print("ntp_state=");
  if (ntpSynchronized()) {
    output.println(waitingForNtp_ ? "resynchronizing" : "synchronized");
  } else if (waitingForNtp_) {
    output.println("waiting");
  } else {
    output.println("not_started");
  }
  output.print("ntp_sync_count=");
  output.println(syncCount_);
  if (lastSyncUtcMs_ != 0) {
    output.print("ntp_last_sync_utc_ms=");
    char text[32];
    snprintf(text, sizeof(text), "%lld",
             static_cast<long long>(lastSyncUtcMs_));
    output.println(text);
  }
}

