#include <ArduinoJson.h>
#include "../CrewBoard_CYD/form_validation.h"
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <string>
#include <vector>

class String : public std::string {
public:
  using std::string::string;
  using std::string::operator=;
  String(const std::string& value) : std::string(value) {}
  bool isEmpty() const { return empty(); }
  void toLowerCase() {
    for (char& c : *this) if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
  }
};

struct IPAddress {
  uint32_t value;
  IPAddress(uint8_t a = 0, uint8_t b = 0, uint8_t c = 0, uint8_t d = 0)
    : value(uint32_t(a) << 24 | uint32_t(b) << 16 | uint32_t(c) << 8 | d) {}
  bool operator==(IPAddress other) const { return value == other.value; }
  bool operator!=(IPAddress other) const { return !(*this == other); }
};

constexpr int WIFI_STA = 1, WIFI_AP = 2, WL_CONNECTED = 3;
constexpr uint16_t serverPort = 80;
constexpr char defaultHostname[] = "crewboard-cyd";
String deviceHostname, wifiSsid = "business", wifiPassword = "placeholder";
String setupApSsid = "setup", setupApPassword = "placeholder";
IPAddress serverAddress;
std::vector<std::string> events;
uint32_t clockMs = 0;
uint32_t millis() { return clockMs; }
void delay(uint32_t amount) { clockMs += amount; }
void logEvent(const String& message) { events.push_back(message); }
struct {
  void println() {}
  void print(char) {}
} Serial;

struct FakeWiFi {
  bool hostnameOk = true, stationOk = true, apModeOk = true, apOk = true;
  bool connected = true, hasIP = true;
  int currentMode = 0;
  bool setHostname(const char* name) {
    events.push_back("hostname:" + std::string(name));
    return hostnameOk;
  }
  bool mode(int requested) {
    events.push_back(requested == WIFI_STA ? "mode:STA" : "mode:AP");
    const bool ok = requested == WIFI_STA ? stationOk : apModeOk;
    if (ok) currentMode = requested;
    return ok;
  }
  void begin(const char*, const char*) { events.push_back("wifi:begin"); }
  int status() const { return connected ? WL_CONNECTED : 0; }
  int getMode() const { return currentMode; }
  IPAddress localIP() const { return hasIP ? IPAddress(10, 0, 0, 42) : IPAddress(); }
  bool softAP(const char*, const char*) { events.push_back("ap:begin"); return apOk; }
  IPAddress softAPIP() const { return IPAddress(192, 168, 4, 1); }
} WiFi;

struct FakeMDNS {
  bool beginOk = true, serviceOk = true;
  bool begin(const char* name) { events.push_back("mdns:" + std::string(name)); return beginOk; }
  bool addService(const char* service, const char* protocol, uint16_t port) {
    assert(std::string(service) == "http" && std::string(protocol) == "tcp" && port == 80);
    events.push_back("mdns:http");
    return serviceOk;
  }
  void end() { events.push_back("mdns:end"); }
} MDNS;

struct FakeNBNS {
  bool beginOk = true;
  bool begin(const char* name) { events.push_back("nbns:" + std::string(name)); return beginOk; }
} NBNS;

// Generated from the production sketch by hostname.test.mjs, not a copied implementation.
#include "network-under-test.inc"

bool saw(const char* value) {
  return std::find(events.begin(), events.end(), value) != events.end();
}

void reset() {
  deviceHostname.clear();
  wifiSsid = "business";
  serverAddress = IPAddress();
  events.clear();
  clockMs = 0;
  WiFi = FakeWiFi();
  MDNS = FakeMDNS();
  NBNS = FakeNBNS();
}

void config(const char* json) {
  JsonDocument document;
  assert(!deserializeJson(document, json));
  loadHostnameUnderTest(document);
}

int main() {
  reset();
  config("{}");
  assert(deviceHostname == defaultHostname && events.empty());
  config("{\"hostname\":\"Changed\"}");
  assert(deviceHostname == defaultHostname);
  for (const char* json : {
    "{\"hostname\":\"\"}", "{\"hostname\":null}", "{\"hostname\":42}",
    "{\"hostname\":false}", "{\"hostname\":[]}", "{\"hostname\":{}}",
    "{\"hostname\":\"-bad\"}", "{\"hostname\":\"bad-\"}", "{\"hostname\":\"bad_name\"}",
    "{\"hostname\":\"abc-def-12345678\"}", "{\"hostname\":\"caf\\u00e9\"}",
    "{\"hostname\":\"good\\u0000bad\"}"
  }) {
    reset();
    config(json);
    assert(deviceHostname == defaultHostname && saw("Invalid hostname; using default"));
  }
  for (const char* json : {"{\"hostname\":\"X\"}", "{\"hostname\":\"ABC-DEF-1234567\"}"}) {
    reset();
    config(json);
    assert(form_validation::hostname(deviceHostname.c_str()) && events.empty());
    const String active = deviceHostname;
    config("{\"hostname\":\"new-name\"}");
    assert(deviceHostname == active);
  }
  reset();
  config("{\"hostname\":\"CrewBoard-CYD\"}");
  assert(deviceHostname == "crewboard-cyd");
  assert(connectToNetwork());
  assert(events[0] == "hostname:crewboard-cyd" && events[1] == "mode:STA" && events[2] == "wifi:begin");
  assert(serverAddress == IPAddress(10, 0, 0, 42));
  startNetworkNames();
  assert(saw("mdns:crewboard-cyd") && saw("mdns:http") && saw("nbns:crewboard-cyd"));

  for (int failure = 0; failure < 3; ++failure) {
    reset();
    config("{}");
    assert(connectToNetwork());
    if (failure == 0) MDNS.beginOk = false;
    if (failure == 1) MDNS.serviceOk = false;
    if (failure == 2) NBNS.beginOk = false;
    startNetworkNames();
    assert(serverAddress == IPAddress(10, 0, 0, 42));
    assert(saw("nbns:crewboard-cyd"));
    if (failure == 0) assert(saw("mDNS startup failed; use IP") && !saw("mdns:http"));
    if (failure == 1) assert(saw("mDNS HTTP service failed; use IP"));
    if (failure < 2) {
      assert(saw("mdns:end"));
      assert(!saw("Open http://crewboard-cyd.local/"));
    }
    if (failure == 2) assert(saw("NetBIOS startup failed; use IP"));
  }

  for (int failure = 0; failure < 3; ++failure) {
    reset();
    config("{}");
    if (failure == 0) WiFi.connected = false;
    if (failure == 1) WiFi.stationOk = false;
    if (failure == 2) WiFi.hasIP = false;
    assert(connectToNetwork());
    assert(WiFi.currentMode == WIFI_AP && wifiSsid == setupApSsid);
    assert(serverAddress == IPAddress(192, 168, 4, 1));
    const size_t before = events.size();
    startNetworkNames();
    assert(events.size() == before);
    if (failure == 0) assert(clockMs == 20000);
    if (failure == 1) assert(!saw("wifi:begin") && saw("Station mode startup failed"));
  }
  for (int failure = 0; failure < 2; ++failure) {
    reset();
    config("{}");
    WiFi.connected = false;
    if (failure == 0) WiFi.apModeOk = false;
    if (failure == 1) WiFi.apOk = false;
    assert(!connectToNetwork());
    assert(saw(failure == 0 ? "Setup AP mode failed" : "Setup AP startup failed"));
  }
  reset();
  config("{}");
  WiFi.hostnameOk = false;
  assert(connectToNetwork() && saw("Wi-Fi hostname setup failed"));
  reset();
  config("{}");
  WiFi.currentMode = WIFI_STA;
  WiFi.connected = false;
  startNetworkNames();
  assert(events.empty());
  WiFi.connected = true;
  WiFi.hasIP = false;
  startNetworkNames();
  assert(events.empty());
}
