#pragma once

#include <Arduino.h>

#include "network_manager.h"
#include "storage.h"

// 负责把已完成的发作事件（本地二进制文件）通过 Wi-Fi 上传到后端，
// 收到服务端确认后再删除本地文件。非阻塞：tick() 内一次只处理一个事件。
class UploadManager {
 public:
  UploadManager(StorageManager &storage, WifiProvisioningManager &network)
      : storage_(storage), network_(network) {}

  void begin();
  void tick(uint64_t nowUs);
  void printStatus(Print &output) const;

  size_t uploadedCount() const { return uploadedCount_; }
  size_t failedCount() const { return failedCount_; }

 private:
  bool uploadEvent(const char *eventId);

  StorageManager &storage_;
  WifiProvisioningManager &network_;

  uint64_t nextCheckUs_ = 0;
  size_t uploadedCount_ = 0;
  size_t failedCount_ = 0;
  const char *lastError_ = nullptr;
};
