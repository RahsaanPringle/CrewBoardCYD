#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <NetBIOS.h>
#include <SD.h>
#include <TFT_eSPI.h>
#include "configuration.h"

constexpr uint8_t sdChipSelectPin = 5;
constexpr uint8_t backlightPin = 21;
constexpr uint16_t serverPort = 80;
constexpr uint32_t wifiTimeoutMs = 20000;
constexpr char configPath[] = "/config.json";
constexpr char webRoot[] = "/traxxi/www";

WebServer server(serverPort);
TFT_eSPI display;
traxxi::Configuration config;
String statusLines[6];
IPAddress activeAddress;
bool serverStarted = false;
bool mdnsReady = false;
bool netbiosReady = false;

void drawStatus() {
  display.fillScreen(TFT_BLACK);
  display.setTextColor(TFT_CYAN, TFT_BLACK);
  display.setTextSize(2);
  display.setCursor(8, 5);
  display.print("TraxxiServer");
  display.setTextSize(1);
  display.setTextColor(TFT_WHITE, TFT_BLACK);
  display.setCursor(8, 36);
  display.print("IP: " + activeAddress.toString());
  display.setCursor(8, 52);
  display.print("Host: ");
  display.print(config.hostname);
  display.setCursor(8, 68);
  display.print("Network: ");
  display.print(config.ssid);
  for (uint8_t i = 0; i < 6; ++i) {
    display.setCursor(8, 98 + i * 20);
    display.print(statusLines[i]);
  }
}

void logEvent(const String& message) {
  Serial.println(message);
  for (uint8_t i = 1; i < 6; ++i) statusLines[i - 1] = statusLines[i];
  statusLines[5] = message.substring(0, 48);
  drawStatus();
}

void haltStartup(const String& message) {
  logEvent(message);
  logEvent("Fix setup and restart device");
  while (true) delay(1000);
}

bool loadConfiguration() {
  File file = SD.open(configPath, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    logEvent("Missing /config.json");
    return false;
  }
  if (file.size() == 0 || file.size() > traxxi::maxConfigBytes) {
    file.close();
    logEvent("Config must be 1-4096 bytes");
    return false;
  }
  DynamicJsonDocument document(traxxi::maxConfigBytes * 2);
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error) {
    logEvent("Invalid config JSON: " + String(error.c_str()));
    return false;
  }
  const char* validationError = traxxi::parseConfiguration(document.as<JsonVariantConst>(), config);
  if (validationError) {
    logEvent(validationError);
    return false;
  }
  logEvent("Configuration loaded");
  return true;
}

void responseHeaders() {
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("X-Content-Type-Options", "nosniff");
  server.sendHeader("Referrer-Policy", "no-referrer");
  server.sendHeader("Content-Security-Policy",
                    "default-src 'none'; script-src 'self'; style-src 'self'; "
                    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}

bool authorize() {
  responseHeaders();
  if (server.authenticate(config.adminUsername, config.adminPassword)) return true;
  logEvent("HTTP authentication required");
  server.requestAuthentication(BASIC_AUTH, "TraxxiServer", "Owner login required.");
  return false;
}

void sendAsset(const char* filename, const char* contentType) {
  if (!authorize()) return;
  if (server.method() != HTTP_GET) {
    server.sendHeader("Allow", "GET");
    server.send(405, "text/plain", "Only GET is supported.");
    logEvent("Rejected non-GET asset request");
    return;
  }
  File file = SD.open(String(webRoot) + filename, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    server.send(503, "text/plain", "Web asset unavailable. Check the SD card.");
    logEvent("SD web asset unavailable");
    return;
  }
  const size_t expected = file.size();
  const size_t sent = server.streamFile(file, contentType);
  file.close();
  if (sent != expected) logEvent("Incomplete HTTP asset transfer");
}

void sendStatus() {
  if (!authorize()) return;
  if (server.method() != HTTP_GET) {
    server.sendHeader("Allow", "GET");
    server.send(405, "application/json", "{\"error\":\"Only GET is supported\"}");
    logEvent("Rejected non-GET status request");
    return;
  }
  DynamicJsonDocument document(1024);
  document["apiVersion"] = "0.1.0";
  document["firmwareVersion"] = "0.1.0";
  document["serverName"] = config.serverName;
  document["hostname"] = config.hostname;
  document["ipAddress"] = activeAddress.toString();
  document["mdnsReady"] = mdnsReady;
  document["netbiosReady"] = netbiosReady;
  document["uptimeSeconds"] = millis() / 1000;
  document["storage"]["totalBytes"] = SD.totalBytes();
  document["storage"]["usedBytes"] = SD.usedBytes();
  document["stage"] = "firmware-foundation";
  String body;
  serializeJson(document, body);
  server.send(200, "application/json", body);
}

void registerRoutes() {
  // Exact routes intentionally expose only bundled web assets, never the SD root.
  server.on("/", HTTP_ANY, [] { sendAsset("/index.html", "text/html"); });
  server.on("/app.css", HTTP_ANY, [] { sendAsset("/app.css", "text/css"); });
  server.on("/app.js", HTTP_ANY, [] { sendAsset("/app.js", "text/javascript"); });
  server.on("/api/v1/status", HTTP_ANY, sendStatus);
  server.onNotFound([] {
    if (!authorize()) return;
    server.send(404, "text/plain", "Not found.");
    logEvent("HTTP route not found");
  });
}

void stopNetworkNames() {
  MDNS.end();
  if (netbiosReady) NBNS.end();
  mdnsReady = false;
  netbiosReady = false;
}

void startNetworkNames() {
  if (!MDNS.begin(config.hostname)) {
    MDNS.end();
    logEvent("mDNS failed; use IP address");
  } else if (!MDNS.addService("http", "tcp", serverPort)) {
    MDNS.end();
    logEvent("mDNS service failed; use IP");
  } else {
    mdnsReady = true;
    logEvent("Open http://" + String(config.hostname) + ".local/");
  }
  netbiosReady = NBNS.begin(config.hostname);
  if (!netbiosReady) logEvent("NetBIOS failed; use IP address");
}

void setup() {
  Serial.begin(115200);
  pinMode(backlightPin, OUTPUT);
  digitalWrite(backlightPin, HIGH);
  display.init();
  display.setRotation(1);
  logEvent("Starting firmware foundation");
  if (!SD.begin(sdChipSelectPin)) haltStartup("SD card mount failed");
  if (!loadConfiguration()) haltStartup("Configuration rejected");
  for (const char* filename : {"/index.html", "/app.css", "/app.js"}) {
    File asset = SD.open(String(webRoot) + filename, FILE_READ);
    const bool valid = asset && !asset.isDirectory() && asset.size() > 0;
    if (asset) asset.close();
    if (!valid) haltStartup("Missing SD web assets");
  }
  if (!WiFi.setHostname(config.hostname)) haltStartup("Wi-Fi hostname setup failed");
  if (!WiFi.mode(WIFI_STA)) haltStartup("Wi-Fi station startup failed");
  if (!WiFi.setAutoReconnect(true)) haltStartup("Wi-Fi auto-reconnect failed");
  WiFi.begin(config.ssid, config.wifiPassword);
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < wifiTimeoutMs) delay(100);
  if (WiFi.status() != WL_CONNECTED || WiFi.localIP() == IPAddress(0, 0, 0, 0)) {
    haltStartup("Wi-Fi failed; check router/config");
  }
  activeAddress = WiFi.localIP();
  registerRoutes();
  server.begin();
  serverStarted = true;
  logEvent("Open http://" + activeAddress.toString());
  startNetworkNames();
}

void loop() {
  const IPAddress address = WiFi.status() == WL_CONNECTED ? WiFi.localIP() : IPAddress(0, 0, 0, 0);
  if (address != activeAddress) {
    stopNetworkNames();
    server.stop();
    serverStarted = false;
    activeAddress = address;
    if (address == IPAddress(0, 0, 0, 0)) {
      logEvent("Wi-Fi lost; waiting for reconnect");
    } else {
      server.begin();
      serverStarted = true;
      logEvent("Reconnected: " + address.toString());
      startNetworkNames();
    }
  }
  if (serverStarted) server.handleClient();
  delay(2);
}
