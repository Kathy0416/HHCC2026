#pragma once

#include <Arduino.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <functional>

class WifiProvisioningManager {
 public:
  WifiProvisioningManager();

  void begin(uint64_t nowUs);
  void tick(uint64_t nowUs);
  bool requestPortal(uint64_t nowUs);
  void forgetCredentials(uint64_t nowUs);

  bool connected() const { return connected_; }
  bool portalActive() const { return portalActive_; }
  bool hasSavedCredentials() const { return storedSsid_.length() > 0; }
  uint32_t connectionGeneration() const { return connectionGeneration_; }
  const char *portalSsid() const { return portalSsid_; }
  String ssid() const;
  IPAddress localIp() const;
  int32_t rssi() const;
  const char *stateName() const;
  // 注册一个回调，供 HTTP 数据端点 GET /data 返回环境样本（[SAMPLE] 文本）。
  void setDataProvider(std::function<String(void)> provider);
  void printStatus(Print &output) const;

 private:
  enum class CredentialSource : uint8_t {
    NONE,
    STORED,
    CANDIDATE,
  };

  void configurePortalHandlers();
  bool startPortal(uint64_t nowUs);
  void stopPortal();
  void startConnection(const String &ssid, const String &password,
                       CredentialSource source, uint64_t nowUs);
  void handleConnectionSuccess();
  void handleConnectionTimeout(uint64_t nowUs);
  void handlePortalSave(uint64_t nowUs);
  void sendSetupPage(const char *message = nullptr);
  void redirectToPortal();
  bool credentialsValid(const String &ssid, const String &password) const;
  bool saveCredentials(const String &ssid, const String &password);

  DNSServer dnsServer_;
  WebServer webServer_;
  std::function<String(void)> dataProvider_;
  Preferences preferences_;
  bool preferencesReady_ = false;
  bool handlersConfigured_ = false;
  bool portalActive_ = false;
  bool connecting_ = false;
  bool connectionBeginPending_ = false;
  bool ignoreStationUntilDisconnected_ = false;
  bool connected_ = false;
  CredentialSource credentialSource_ = CredentialSource::NONE;
  String storedSsid_;
  String storedPassword_;
  String candidateSsid_;
  String candidatePassword_;
  String connectionSsid_;
  String connectionPassword_;
  char portalSsid_[33] = {};
  uint64_t connectionStartedUs_ = 0;
  uint64_t nextRetryUs_ = 0;
  uint32_t connectionGeneration_ = 0;
};
