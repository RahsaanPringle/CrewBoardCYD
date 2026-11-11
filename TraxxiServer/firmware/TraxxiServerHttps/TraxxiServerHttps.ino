#include <WiFi.h>
#include <ESPmDNS.h>
#include <NetBIOS.h>
#include <SD.h>
#include <TFT_eSPI.h>
#include <esp_https_server.h>
#include <mbedtls/base64.h>
#include "configuration.h"

constexpr uint8_t sdChipSelectPin = 5;
constexpr uint8_t backlightPin = 21;
constexpr uint16_t serverPort = 443;
constexpr uint32_t wifiTimeoutMs = 20000;
constexpr size_t maxPemBytes = 8192;
constexpr char configPath[] = "/config.json";
constexpr char webRoot[] = "/traxxi/www";
constexpr char certificatePath[] = "/traxxi/tls/server.crt";
constexpr char privateKeyPath[] = "/traxxi/tls/server.key";

httpd_handle_t httpsServer = nullptr;
TFT_eSPI display;
traxxi::Configuration config;
String statusLines[6];
IPAddress activeAddress;
char* certificatePem = nullptr;
char* privateKeyPem = nullptr;
bool serverStarted = false;
bool mdnsReady = false;
bool netbiosReady = false;

void drawStatus() {
  display.fillScreen(TFT_BLACK);
  display.setTextColor(TFT_CYAN, TFT_BLACK);
  display.setTextSize(2);
  display.setCursor(8, 5);
  display.print("TraxxiServer HTTPS");
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

bool loadPemFile(const char* path, char*& output) {
  File file = SD.open(path, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    logEvent("Missing TLS certificate or key");
    return false;
  }
  const size_t size = file.size();
  if (size == 0 || size > maxPemBytes) {
    file.close();
    logEvent("TLS PEM must be 1-8192 bytes");
    return false;
  }
  char* pem = static_cast<char*>(malloc(size + 1));
  if (!pem) {
    file.close();
    logEvent("Not enough memory for TLS PEM");
    return false;
  }
  const size_t received = file.readBytes(pem, size);
  file.close();
  if (received != size) {
    free(pem);
    logEvent("TLS PEM read failed");
    return false;
  }
  pem[size] = '\0';
  output = pem;
  return true;
}

void responseHeaders(httpd_req_t* request) {
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
  httpd_resp_set_hdr(request, "Referrer-Policy", "no-referrer");
  httpd_resp_set_hdr(request, "Content-Security-Policy",
                     "default-src 'none'; script-src 'self'; style-src 'self'; "
                     "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}

bool authorize(httpd_req_t* request) {
  responseHeaders(request);
  char credentials[sizeof(config.adminUsername) + sizeof(config.adminPassword) + 1];
  const int credentialsLength = snprintf(credentials, sizeof(credentials), "%s:%s",
                                         config.adminUsername, config.adminPassword);
  if (credentialsLength < 0 || static_cast<size_t>(credentialsLength) >= sizeof(credentials)) return false;
  unsigned char encoded[256];
  size_t encodedLength = 0;
  const int encodeResult = mbedtls_base64_encode(encoded, sizeof(encoded) - 1, &encodedLength,
                                                  reinterpret_cast<const unsigned char*>(credentials),
                                                  credentialsLength);
  if (encodeResult != 0) return false;
  encoded[encodedLength] = '\0';
  char expected[sizeof(encoded) + 7];
  snprintf(expected, sizeof(expected), "Basic %s", reinterpret_cast<char*>(encoded));
  const size_t headerLength = httpd_req_get_hdr_value_len(request, "Authorization");
  if (headerLength == strlen(expected)) {
    char provided[sizeof(expected)];
    if (httpd_req_get_hdr_value_str(request, "Authorization", provided, sizeof(provided)) == ESP_OK &&
        strcmp(provided, expected) == 0) return true;
  }
  httpd_resp_set_status(request, "401 Unauthorized");
  httpd_resp_set_hdr(request, "WWW-Authenticate", "Basic realm=\"TraxxiServer\"");
  httpd_resp_send(request, "Owner login required.", HTTPD_RESP_USE_STRLEN);
  logEvent("HTTPS authentication required");
  return false;
}

esp_err_t sendAsset(httpd_req_t* request, const char* filename, const char* contentType) {
  File file = SD.open(String(webRoot) + filename, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    httpd_resp_set_status(request, "503 Service Unavailable");
    httpd_resp_set_type(request, "text/plain");
    httpd_resp_send(request, "Web asset unavailable. Check the SD card.", HTTPD_RESP_USE_STRLEN);
    logEvent("SD web asset unavailable");
    return ESP_OK;
  }
  httpd_resp_set_type(request, contentType);
  char buffer[1024];
  size_t sent = 0;
  const size_t expected = file.size();
  while (file.available()) {
    const size_t count = file.readBytes(buffer, sizeof(buffer));
    if (!count) break;
    if (httpd_resp_send_chunk(request, buffer, count) != ESP_OK) {
      file.close();
      logEvent("Incomplete HTTPS asset transfer");
      return ESP_FAIL;
    }
    sent += count;
  }
  file.close();
  if (sent != expected) {
    logEvent("Incomplete HTTPS asset read");
    return ESP_FAIL;
  }
  return httpd_resp_send_chunk(request, nullptr, 0);
}

esp_err_t sendStatus(httpd_req_t* request) {
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
  httpd_resp_set_type(request, "application/json");
  return httpd_resp_send(request, body.c_str(), body.length());
}

esp_err_t requestHandler(httpd_req_t* request) {
  if (!authorize(request)) return ESP_OK;
  if (request->method != HTTP_GET) {
    httpd_resp_set_hdr(request, "Allow", "GET");
    httpd_resp_set_status(request, "405 Method Not Allowed");
    httpd_resp_set_type(request, "text/plain");
    return httpd_resp_send(request, "Only GET is supported.", HTTPD_RESP_USE_STRLEN);
  }
  if (strcmp(request->uri, "/") == 0) return sendAsset(request, "/index.html", "text/html");
  if (strcmp(request->uri, "/app.css") == 0) return sendAsset(request, "/app.css", "text/css");
  if (strcmp(request->uri, "/app.js") == 0) return sendAsset(request, "/app.js", "text/javascript");
  if (strcmp(request->uri, "/api/v1/status") == 0) return sendStatus(request);
  httpd_resp_set_status(request, "404 Not Found");
  httpd_resp_set_type(request, "text/plain");
  logEvent("HTTPS route not found");
  return httpd_resp_send(request, "Not found.", HTTPD_RESP_USE_STRLEN);
}

bool startHttpsServer() {
  httpd_ssl_config_t tlsConfig = HTTPD_SSL_CONFIG_DEFAULT();
  tlsConfig.httpd.server_port = serverPort;
  tlsConfig.httpd.uri_match_fn = httpd_uri_match_wildcard;
  tlsConfig.servercert = reinterpret_cast<const uint8_t*>(certificatePem);
  tlsConfig.servercert_len = strlen(certificatePem) + 1;
  tlsConfig.prvtkey_pem = reinterpret_cast<const uint8_t*>(privateKeyPem);
  tlsConfig.prvtkey_len = strlen(privateKeyPem) + 1;
  esp_err_t result = httpd_ssl_start(&httpsServer, &tlsConfig);
  if (result != ESP_OK) {
    logEvent("HTTPS start failed: " + String(esp_err_to_name(result)));
    return false;
  }
  httpd_uri_t allRequests = {};
  allRequests.uri = "/*";
  allRequests.handler = requestHandler;
  const httpd_method_t methods[] = {HTTP_GET, HTTP_POST, HTTP_PUT, HTTP_DELETE,
                                    HTTP_HEAD, HTTP_OPTIONS, HTTP_PATCH};
  for (const httpd_method_t method : methods) {
    allRequests.method = method;
    result = httpd_register_uri_handler(httpsServer, &allRequests);
    if (result != ESP_OK) {
      httpd_ssl_stop(httpsServer);
      httpsServer = nullptr;
      logEvent("HTTPS route setup failed");
      return false;
    }
  }
  serverStarted = true;
  return true;
}

void stopHttpsServer() {
  if (httpsServer) httpd_ssl_stop(httpsServer);
  httpsServer = nullptr;
  serverStarted = false;
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
  } else if (!MDNS.addService("https", "tcp", serverPort)) {
    MDNS.end();
    logEvent("mDNS service failed; use IP");
  } else {
    mdnsReady = true;
    logEvent("Open https://" + String(config.hostname) + ".local/");
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
  logEvent("Starting HTTPS firmware");
  if (!SD.begin(sdChipSelectPin)) haltStartup("SD card mount failed");
  if (!loadConfiguration()) haltStartup("Configuration rejected");
  for (const char* filename : {"/index.html", "/app.css", "/app.js"}) {
    File asset = SD.open(String(webRoot) + filename, FILE_READ);
    const bool valid = asset && !asset.isDirectory() && asset.size() > 0;
    if (asset) asset.close();
    if (!valid) haltStartup("Missing SD web assets");
  }
  if (!loadPemFile(certificatePath, certificatePem) || !loadPemFile(privateKeyPath, privateKeyPem)) {
    haltStartup("TLS certificate/key setup failed");
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
  if (!startHttpsServer()) haltStartup("HTTPS server startup failed");
  logEvent("Open https://" + activeAddress.toString());
  startNetworkNames();
}

void loop() {
  const IPAddress address = WiFi.status() == WL_CONNECTED ? WiFi.localIP() : IPAddress(0, 0, 0, 0);
  if (address != activeAddress) {
    stopNetworkNames();
    stopHttpsServer();
    activeAddress = address;
    if (address == IPAddress(0, 0, 0, 0)) {
      logEvent("Wi-Fi lost; waiting for reconnect");
    } else {
      if (!startHttpsServer()) logEvent("HTTPS restart failed");
      else logEvent("Reconnected: " + address.toString());
      startNetworkNames();
    }
  }
  delay(2);
}