#include "upload_manager.h"

#include <HTTPClient.h>
#include <WiFi.h>

#include "config.h"

namespace {
constexpr uint64_t MS_TO_US = 1000ULL;
constexpr size_t MAX_PENDING_SCAN = 8;
}

void UploadManager::begin() {
  nextCheckUs_ = 0;
}

void UploadManager::tick(uint64_t nowUs) {
  if (!network_.connected() || !network_.hasServerConfig()) {
    return;
  }
  if (nowUs < nextCheckUs_) {
    return;
  }

  EventDescriptor descriptors[MAX_PENDING_SCAN];
  const size_t count = storage_.listPendingEvents(descriptors, MAX_PENDING_SCAN);
  bool uploadedAny = false;
  for (size_t index = 0; index < count; ++index) {
    const EventDescriptor &descriptor = descriptors[index];
    // 只上传完整事件；.part/.incomplete/.corrupt 不传。
    if (descriptor.status != EventStatus::COMPLETE || descriptor.eventId[0] == '\0') {
      continue;
    }
    if (uploadEvent(descriptor.eventId)) {
      storage_.deleteAfterServerConfirmation(descriptor.eventId);
      ++uploadedCount_;
      uploadedAny = true;
    } else {
      ++failedCount_;
      break;  // 网络异常，本轮停止，下一轮再试。
    }
  }

  // 失败时退避，避免在无网/服务器不可用时频繁重试。
  nextCheckUs_ = nowUs + (uploadedAny ? 0 : Config::UPLOAD_CHECK_INTERVAL_MS) * MS_TO_US;
}

bool UploadManager::uploadEvent(const char *eventId) {
  File file;
  if (!storage_.openEventForRead(eventId, file)) {
    lastError_ = "open failed";
    return false;
  }
  const size_t size = file.size();
  if (size == 0 || size > Config::MAX_UPLOAD_BYTES) {
    file.close();
    lastError_ = "bad size";
    return false;
  }

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(Config::UPLOAD_TIMEOUT_MS);
  if (!http.begin(client, network_.uploadUrl())) {
    file.close();
    lastError_ = "begin failed";
    return false;
  }
  http.addHeader("Content-Type", "application/octet-stream");
  http.addHeader("Authorization", String("Bearer ") + network_.deviceToken());

  const int code = http.sendRequest("POST", &file, size);
  file.close();

  bool ok = false;
  if (code > 0) {
    // 2xx 视为成功（含重复上传返回的 200）。
    ok = (code >= 200 && code < 300);
    if (!ok) {
      Serial.print("[WARN] Upload rejected HTTP ");
      Serial.print(code);
      Serial.print(": ");
      Serial.println(http.getString());
      lastError_ = "server rejected";
    }
  } else {
    Serial.print("[WARN] Upload failed: ");
    Serial.println(HTTPClient::errorToString(code));
    lastError_ = HTTPClient::errorToString(code);
  }
  http.end();
  return ok;
}

void UploadManager::printStatus(Print &output) const {
  output.print("upload_uploaded=");
  output.println(uploadedCount_);
  output.print("upload_failed=");
  output.println(failedCount_);
  output.print("upload_last_error=");
  output.println(lastError_ == nullptr ? "none" : lastError_);
}
