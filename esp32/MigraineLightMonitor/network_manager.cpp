#include "network_manager.h"

#include <ESP.h>
#include <esp_timer.h>
#include <string.h>

#include "config.h"

namespace {
constexpr uint64_t MS_TO_US = 1000ULL;
constexpr uint16_t DNS_PORT = 53;
constexpr const char *PREFERENCES_NAMESPACE = "migraine-wifi";
constexpr const char *PORTAL_IP = "192.168.4.1";
}

WifiProvisioningManager::WifiProvisioningManager() : webServer_(80) {}

void WifiProvisioningManager::begin(uint64_t nowUs) {
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  preferencesReady_ = preferences_.begin(PREFERENCES_NAMESPACE, false);
  if (!preferencesReady_) {
    Serial.println("[ERROR] Wi-Fi Preferences initialization failed");
  } else {
    storedSsid_ = preferences_.getString("ssid", "");
    storedPassword_ = preferences_.getString("pass", "");
  }

  const uint32_t suffix =
      static_cast<uint32_t>(ESP.getEfuseMac() & 0xFFFFFFULL);
  snprintf(portalSsid_, sizeof(portalSsid_), "MigraineMonitor-%06lX",
           static_cast<unsigned long>(suffix));
  configurePortalHandlers();

  if (storedSsid_.length() > 0) {
    startConnection(storedSsid_, storedPassword_, CredentialSource::STORED,
                    nowUs);
  } else {
    startPortal(nowUs);
  }
}

void WifiProvisioningManager::configurePortalHandlers() {
  if (handlersConfigured_) {
    return;
  }
  handlersConfigured_ = true;
  webServer_.on("/", HTTP_GET, [this]() { sendSetupPage(); });
  webServer_.on("/save", HTTP_POST, [this]() {
    handlePortalSave(static_cast<uint64_t>(esp_timer_get_time()));
  });
  webServer_.onNotFound([this]() { redirectToPortal(); });
}

bool WifiProvisioningManager::credentialsValid(
    const String &ssid, const String &password) const {
  if (ssid.length() == 0 || ssid.length() > 32) {
    return false;
  }
  return password.length() == 0 ||
         (password.length() >= 8 && password.length() <= 63);
}

void WifiProvisioningManager::sendSetupPage(const char *message) {
  String page;
  page.reserve(1800);
  page += F("<!doctype html><html><head><meta name=viewport content=\"width=device-width,initial-scale=1\">");
  page += F("<title>Migraine Monitor Wi-Fi</title><style>body{font-family:sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem;color:#172033}input,button{box-sizing:border-box;width:100%;padding:.8rem;margin:.35rem 0 1rem;font-size:1rem}button{background:#3758d6;color:white;border:0;border-radius:.4rem}.note{background:#eef2ff;padding:.8rem;border-radius:.4rem}</style></head><body>");
  page += F("<h1>Wi-Fi setup</h1><p>Connect this migraine monitor to a 2.4 GHz Wi-Fi network.</p>");
  if (message != nullptr) {
    page += F("<p class=note>");
    page += message;
    page += F("</p>");
  }
  page += F("<form method=post action=/save><label>Network name (SSID)</label><input name=ssid maxlength=32 required autocomplete=off><label>Wi-Fi password</label><input name=password type=password maxlength=63 autocomplete=off><button type=submit>Connect</button></form>");
  page += F("<p>The setup network closes automatically after a successful connection. Monitoring continues during setup.</p></body></html>");
  webServer_.sendHeader("Cache-Control", "no-store");
  webServer_.send(200, "text/html; charset=utf-8", page);
}

void WifiProvisioningManager::redirectToPortal() {
  webServer_.sendHeader("Location", String("http://") + PORTAL_IP + "/",
                        true);
  webServer_.send(302, "text/plain", "Open the Wi-Fi setup page");
}

void WifiProvisioningManager::handlePortalSave(uint64_t nowUs) {
  const String ssid = webServer_.arg("ssid");
  const String password = webServer_.arg("password");
  if (!credentialsValid(ssid, password)) {
    sendSetupPage(
        "Enter an SSID of 1-32 characters and either an empty password or a password of 8-63 characters.");
    return;
  }

  candidateSsid_ = ssid;
  candidatePassword_ = password;
  sendSetupPage(
      "Connection attempt started. If it fails, reconnect to this setup network and try again.");
  startConnection(candidateSsid_, candidatePassword_,
                  CredentialSource::CANDIDATE, nowUs);
}

bool WifiProvisioningManager::startPortal(uint64_t nowUs) {
  if (portalActive_) {
    return true;
  }
  const size_t setupPasswordLength = strlen(Config::WIFI_SETUP_PASSWORD);
  if (setupPasswordLength < 8 || setupPasswordLength > 63) {
    Serial.println(
        "[ERROR] WIFI_SETUP_PASSWORD must contain 8-63 characters");
    return false;
  }
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP(portalSsid_, Config::WIFI_SETUP_PASSWORD)) {
    Serial.println("[ERROR] Could not start Wi-Fi setup access point");
    nextRetryUs_ =
        nowUs + static_cast<uint64_t>(Config::WIFI_RETRY_INTERVAL_MS) *
                    MS_TO_US;
    return false;
  }
  if (!dnsServer_.start(DNS_PORT, "*", WiFi.softAPIP())) {
    Serial.println("[WARN] Captive-portal DNS could not start");
  }
  webServer_.begin();
  portalActive_ = true;
  Serial.print("[INFO] Wi-Fi setup portal: SSID=");
  Serial.print(portalSsid_);
  Serial.print(" URL=http://");
  Serial.println(WiFi.softAPIP());
  return true;
}

void WifiProvisioningManager::stopPortal() {
  if (!portalActive_) {
    return;
  }
  dnsServer_.stop();
  webServer_.stop();
  WiFi.softAPdisconnect(true);
  portalActive_ = false;
  WiFi.mode(WIFI_STA);
  Serial.println("[INFO] Wi-Fi setup portal stopped");
}

void WifiProvisioningManager::startConnection(
    const String &ssid, const String &password, CredentialSource source,
    uint64_t nowUs) {
  if (ssid.length() == 0) {
    return;
  }
  WiFi.mode(portalActive_ ? WIFI_AP_STA : WIFI_STA);
  connected_ = false;
  connecting_ = true;
  ignoreStationUntilDisconnected_ = false;
  credentialSource_ = source;
  connectionSsid_ = ssid;
  connectionPassword_ = password;
  connectionStartedUs_ = nowUs;
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.disconnectAsync(false, false);
    connectionBeginPending_ = true;
  } else {
    WiFi.begin(connectionSsid_.c_str(), connectionPassword_.c_str());
    connectionBeginPending_ = false;
  }
  Serial.print("[INFO] Connecting to Wi-Fi SSID: ");
  Serial.println(ssid);
}

bool WifiProvisioningManager::saveCredentials(const String &ssid,
                                              const String &password) {
  if (!preferencesReady_) {
    return false;
  }
  const size_t passwordBytes = preferences_.putString("pass", password);
  if (password.length() > 0 && passwordBytes != password.length()) {
    return false;
  }
  const size_t ssidBytes = preferences_.putString("ssid", ssid);
  return ssidBytes == ssid.length() &&
         preferences_.getString("ssid", "") == ssid &&
         preferences_.getString("pass", "") == password;
}

void WifiProvisioningManager::handleConnectionSuccess() {
  connected_ = true;
  connecting_ = false;
  connectionBeginPending_ = false;
  ignoreStationUntilDisconnected_ = false;
  ++connectionGeneration_;
  if (connectionGeneration_ == 0) {
    connectionGeneration_ = 1;
  }

  if (credentialSource_ == CredentialSource::CANDIDATE) {
    storedSsid_ = candidateSsid_;
    storedPassword_ = candidatePassword_;
    if (!saveCredentials(storedSsid_, storedPassword_)) {
      Serial.println(
          "[ERROR] Wi-Fi connected, but credentials could not be persisted");
    } else {
      Serial.println("[INFO] Wi-Fi credentials saved");
    }
    candidateSsid_ = "";
    candidatePassword_ = "";
  }
  credentialSource_ = CredentialSource::NONE;
  connectionSsid_ = "";
  connectionPassword_ = "";
  stopPortal();
  Serial.print("[INFO] Wi-Fi connected: SSID=");
  Serial.print(WiFi.SSID());
  Serial.print(" IP=");
  Serial.println(WiFi.localIP());
}

void WifiProvisioningManager::handleConnectionTimeout(uint64_t nowUs) {
  Serial.println("[WARN] Wi-Fi connection timed out; setup portal available");
  connecting_ = false;
  connectionBeginPending_ = false;
  if (credentialSource_ == CredentialSource::CANDIDATE) {
    candidateSsid_ = "";
    candidatePassword_ = "";
  }
  credentialSource_ = CredentialSource::NONE;
  connectionSsid_ = "";
  connectionPassword_ = "";
  WiFi.disconnectAsync(false, false);
  ignoreStationUntilDisconnected_ = true;
  startPortal(nowUs);
  nextRetryUs_ =
      nowUs + static_cast<uint64_t>(Config::WIFI_RETRY_INTERVAL_MS) *
                  MS_TO_US;
}

void WifiProvisioningManager::tick(uint64_t nowUs) {
  if (portalActive_) {
    dnsServer_.processNextRequest();
    webServer_.handleClient();
  }

  if (ignoreStationUntilDisconnected_) {
    if (WiFi.status() == WL_CONNECTED) {
      return;
    }
    ignoreStationUntilDisconnected_ = false;
  }

  if (connectionBeginPending_) {
    if (WiFi.status() == WL_CONNECTED) {
      const uint64_t timeoutUs =
          static_cast<uint64_t>(Config::WIFI_CONNECT_TIMEOUT_MS) * MS_TO_US;
      if (nowUs - connectionStartedUs_ >= timeoutUs) {
        handleConnectionTimeout(nowUs);
      }
      return;
    }
    WiFi.begin(connectionSsid_.c_str(), connectionPassword_.c_str());
    connectionBeginPending_ = false;
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (!connected_) {
      handleConnectionSuccess();
    }
    return;
  }

  if (connected_) {
    connected_ = false;
    Serial.println("[WARN] Wi-Fi connection lost; reconnecting");
    if (storedSsid_.length() > 0) {
      startConnection(storedSsid_, storedPassword_, CredentialSource::STORED,
                      nowUs);
    }
    return;
  }

  if (connecting_) {
    const uint64_t timeoutUs =
        static_cast<uint64_t>(Config::WIFI_CONNECT_TIMEOUT_MS) * MS_TO_US;
    if (nowUs - connectionStartedUs_ >= timeoutUs) {
      handleConnectionTimeout(nowUs);
    }
    return;
  }

  if (storedSsid_.length() > 0 && nowUs >= nextRetryUs_) {
    startConnection(storedSsid_, storedPassword_, CredentialSource::STORED,
                    nowUs);
  } else if (storedSsid_.length() == 0 && !portalActive_) {
    startPortal(nowUs);
  }
}

bool WifiProvisioningManager::requestPortal(uint64_t nowUs) {
  return startPortal(nowUs);
}

void WifiProvisioningManager::forgetCredentials(uint64_t nowUs) {
  if (preferencesReady_) {
    preferences_.remove("ssid");
    preferences_.remove("pass");
  }
  storedSsid_ = "";
  storedPassword_ = "";
  candidateSsid_ = "";
  candidatePassword_ = "";
  connecting_ = false;
  connectionBeginPending_ = false;
  connected_ = false;
  credentialSource_ = CredentialSource::NONE;
  connectionSsid_ = "";
  connectionPassword_ = "";
  WiFi.disconnectAsync(false, true);
  ignoreStationUntilDisconnected_ = true;
  Serial.println("[INFO] Saved Wi-Fi credentials forgotten");
  startPortal(nowUs);
}

String WifiProvisioningManager::ssid() const {
  if (connected_) {
    return WiFi.SSID();
  }
  if (credentialSource_ == CredentialSource::CANDIDATE) {
    return candidateSsid_;
  }
  return storedSsid_;
}

IPAddress WifiProvisioningManager::localIp() const {
  return connected_ ? WiFi.localIP() : IPAddress();
}

int32_t WifiProvisioningManager::rssi() const {
  return connected_ ? WiFi.RSSI() : 0;
}

const char *WifiProvisioningManager::stateName() const {
  if (connected_) {
    return "connected";
  }
  if (connecting_) {
    return "connecting";
  }
  if (portalActive_) {
    return "setup_portal";
  }
  return "disconnected";
}

void WifiProvisioningManager::printStatus(Print &output) const {
  output.print("wifi_state=");
  output.println(stateName());
  output.print("wifi_saved=");
  output.println(hasSavedCredentials() ? "true" : "false");
  output.print("wifi_portal_active=");
  output.println(portalActive_ ? "true" : "false");
  if (portalActive_) {
    output.print("wifi_setup_ssid=");
    output.println(portalSsid_);
    output.print("wifi_setup_url=http://");
    output.println(WiFi.softAPIP());
  }
  const String currentSsid = ssid();
  if (currentSsid.length() > 0) {
    output.print("wifi_ssid=");
    output.println(currentSsid);
  }
  if (connected_) {
    output.print("wifi_ip=");
    output.println(WiFi.localIP());
    output.print("wifi_rssi_dbm=");
    output.println(WiFi.RSSI());
  }
}
