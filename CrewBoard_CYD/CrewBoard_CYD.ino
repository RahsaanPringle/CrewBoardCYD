#include <WiFi.h>
#include <WiFiClient.h>
#include <SD.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>

// CrewBoard CYD
// Copy the contents of sd-card/ to a FAT32 microSD card before first boot.
// Requires the ESP32 Arduino core, TFT_eSPI, and ArduinoJson 6.x or 7.x.

constexpr uint16_t serverPort = 80;
constexpr uint8_t sdChipSelectPin = 5;
constexpr uint8_t backlightPin = 21;
constexpr uint8_t maxUserCount = 12;
constexpr uint8_t statusLineCount = 7;
constexpr size_t transferBufferSize = 1024;
constexpr size_t maxApiBodySize = 24576;
constexpr size_t jsonDocumentCapacity = maxApiBodySize * 2;
constexpr size_t maxSmallBodySize = 2048;
constexpr size_t maxDavUploadSize = 8UL * 1024UL * 1024UL;
constexpr size_t maxRequestLineLength = 512;
constexpr size_t maxHeaderLineLength = 768;
constexpr size_t maxHeaderBytes = 4096;

constexpr char primaryConfigPath[] = "/config.json";
constexpr char webRoot[] = "/crewboard/www";
constexpr char dataRoot[] = "/crewboard/data";
constexpr char davStorageRoot[] = "/crewboard/shared";
constexpr char ownerRole[] = "Owner";
const char* const rosterRoles[] = { ownerRole, "Crew Lead", "Crew Member", "Equipment Operator", "Trainee" };

struct UserCredential {
  String employeeId;
  String username;
  String password;
};

struct HttpRequest {
  String method;
  String path;
  String authorization;
  String depth;
  String contentType;
  String transferEncoding;
  String crewBoardHeader;
  String authenticatedUsername;
  size_t contentLength = 0;
  bool hasContentLength = false;
  bool isAdmin = false;
};

WiFiServer server(serverPort);
TFT_eSPI display = TFT_eSPI();
IPAddress serverAddress;
String wifiSsid;
String wifiPassword;
String setupApSsid;
String setupApPassword;
String adminUsername;
String adminPassword;
UserCredential users[maxUserCount];
uint8_t userCount = 0;
String statusLines[statusLineCount];

bool loadConfiguration();

void drawStatus() {
  display.fillScreen(TFT_BLACK);
  display.setTextColor(TFT_CYAN, TFT_BLACK);
  display.setTextSize(2);
  display.setCursor(8, 5);
  display.print("CrewBoard");
  display.drawFastHLine(8, 26, 304, TFT_DARKGREY);
  display.setTextColor(TFT_WHITE, TFT_BLACK);
  display.setTextSize(1);
  display.setCursor(8, 34);
  display.print("IP: ");
  display.print(serverAddress.toString());
  display.setCursor(8, 50);
  display.print("Network: ");
  display.print(wifiSsid);
  display.drawFastHLine(8, 68, 304, TFT_DARKGREY);
  for (uint8_t i = 0; i < statusLineCount; ++i) {
    display.setCursor(8, 77 + i * 20);
    display.print(statusLines[i]);
  }
}

void logEvent(const String& message) {
  Serial.println(message);
  for (uint8_t i = 1; i < statusLineCount; ++i) statusLines[i - 1] = statusLines[i];
  String line = String(millis() / 1000) + "s " + message;
  if (line.length() > 43) line = line.substring(0, 43);
  statusLines[statusLineCount - 1] = line;
  drawStatus();
}

bool readHttpLine(WiFiClient& client, String& line, size_t maximumLength, uint32_t timeoutMs) {
  line = "";
  const uint32_t started = millis();
  while (client.connected() && millis() - started < timeoutMs) {
    while (client.available()) {
      const char c = static_cast<char>(client.read());
      if (c == '\n') return true;
      if (c != '\r') {
        if (line.length() >= maximumLength) return false;
        line += c;
      }
    }
    delay(1);
  }
  return false;
}

int hexValue(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}

bool normalizeRequestPath(String rawPath, String& normalized) {
  const int query = rawPath.indexOf('?');
  if (query >= 0) rawPath = rawPath.substring(0, query);
  if (rawPath.isEmpty() || rawPath[0] != '/') return false;
  String decoded;
  decoded.reserve(rawPath.length());
  for (size_t i = 0; i < rawPath.length(); ++i) {
    const char c = rawPath[i];
    if (c == '%' && i + 2 < rawPath.length()) {
      const int high = hexValue(rawPath[i + 1]);
      const int low = hexValue(rawPath[i + 2]);
      if (high < 0 || low < 0) return false;
      const char decodedCharacter = static_cast<char>((high << 4) | low);
      if (decodedCharacter < 32 || decodedCharacter == '\\') return false;
      decoded += decodedCharacter;
      i += 2;
    } else {
      if (static_cast<uint8_t>(c) < 32 || c == '\\') return false;
      decoded += c;
    }
  }

  normalized = "";
  int start = 1;
  while (start <= decoded.length()) {
    int end = decoded.indexOf('/', start);
    if (end < 0) end = decoded.length();
    const String segment = decoded.substring(start, end);
    if (segment == "." || segment == "..") return false;
    if (!segment.isEmpty()) {
      for (size_t characterIndex = 0; characterIndex < segment.length(); ++characterIndex) {
        const char character = segment[characterIndex];
        const bool allowed = (character >= 'a' && character <= 'z') ||
          (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9') || character == '.' ||
          character == '-' || character == '_' || character == ' ';
        if (!allowed) return false;
      }
      normalized += "/" + segment;
    }
    start = end + 1;
  }
  if (normalized.isEmpty()) normalized = "/";
  return true;
}

bool readRequest(WiFiClient& client, HttpRequest& request) {
  String line;
  if (!readHttpLine(client, line, maxRequestLineLength, 5000) || line.isEmpty()) return false;
  const int firstSpace = line.indexOf(' ');
  const int secondSpace = line.indexOf(' ', firstSpace + 1);
  if (firstSpace <= 0 || secondSpace <= firstSpace + 1) return false;
  request.method = line.substring(0, firstSpace);
  if (!normalizeRequestPath(line.substring(firstSpace + 1, secondSpace), request.path)) return false;

  size_t headerBytes = 0;
  while (true) {
    if (!readHttpLine(client, line, maxHeaderLineLength, 5000)) return false;
    headerBytes += line.length();
    if (headerBytes > maxHeaderBytes) return false;
    if (line.isEmpty()) break;
    const int colon = line.indexOf(':');
    if (colon <= 0) continue;
    String name = line.substring(0, colon);
    String value = line.substring(colon + 1);
    name.toLowerCase();
    value.trim();
    if (name == "authorization") request.authorization = value;
    else if (name == "content-length") {
      request.contentLength = static_cast<size_t>(strtoul(value.c_str(), nullptr, 10));
      request.hasContentLength = true;
    } else if (name == "content-type") request.contentType = value;
    else if (name == "transfer-encoding") request.transferEncoding = value;
    else if (name == "depth") request.depth = value;
    else if (name == "x-crewboard-request") request.crewBoardHeader = value;
  }
  return true;
}

String encodeBase64(const String& value) {
  static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String result;
  uint32_t accumulator = 0;
  int bits = -6;
  for (size_t i = 0; i < value.length(); ++i) {
    accumulator = (accumulator << 8) | static_cast<uint8_t>(value[i]);
    bits += 8;
    while (bits >= 0) {
      result += alphabet[(accumulator >> bits) & 0x3f];
      bits -= 6;
    }
  }
  if (bits > -6) result += alphabet[((accumulator << 8) >> (bits + 8)) & 0x3f];
  while (result.length() % 4) result += '=';
  return result;
}

bool authorize(HttpRequest& request) {
  if (request.authorization == "Basic " + encodeBase64(adminUsername + ":" + adminPassword)) {
    request.authenticatedUsername = adminUsername;
    request.isAdmin = true;
    return true;
  }
  for (uint8_t i = 0; i < userCount; ++i) {
    if (request.authorization == "Basic " + encodeBase64(users[i].username + ":" + users[i].password)) {
      request.authenticatedUsername = users[i].username;
      return true;
    }
  }
  return false;
}

void responseStart(WiFiClient& client, int code, const char* status, const char* contentType, size_t length, const String& extraHeaders = "") {
  client.print("HTTP/1.1 "); client.print(code); client.print(' '); client.print(status);
  client.print("\r\nConnection: close\r\nContent-Type: "); client.print(contentType);
  client.print("\r\nContent-Length: "); client.print(length); client.print("\r\n");
  if (!extraHeaders.isEmpty()) client.print(extraHeaders);
  client.print("\r\n");
}

void responseWithoutLength(WiFiClient& client, int code, const char* status, const char* contentType, const String& extraHeaders = "") {
  client.print("HTTP/1.1 "); client.print(code); client.print(' '); client.print(status);
  client.print("\r\nConnection: close\r\nContent-Type: "); client.print(contentType); client.print("\r\n");
  if (!extraHeaders.isEmpty()) client.print(extraHeaders);
  client.print("\r\n");
}

void sendText(WiFiClient& client, int code, const char* status, const char* contentType, const String& body, const String& extraHeaders = "") {
  responseStart(client, code, status, contentType, body.length(), extraHeaders);
  client.print(body);
}

void sendEmpty(WiFiClient& client, int code, const char* status, const String& extraHeaders = "") {
  responseStart(client, code, status, "text/plain; charset=utf-8", 0, extraHeaders);
}

void sendJsonError(WiFiClient& client, int code, const char* status, const String& message) {
  DynamicJsonDocument document(256);
  document["error"] = message;
  String body;
  serializeJson(document, body);
  sendText(client, code, status, "application/json; charset=utf-8", body, "Cache-Control: no-store\r\n");
}

void sendUnauthorized(WiFiClient& client) {
  sendText(client, 401, "Unauthorized", "text/plain; charset=utf-8", "CrewBoard login required\n", "WWW-Authenticate: Basic realm=\"CrewBoard\"\r\nCache-Control: no-store\r\n");
}

const char* contentTypeFor(const String& path) {
  String lower = path;
  lower.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

bool streamFile(WiFiClient& client, const String& path, bool headOnly, const String& extraHeaders = "") {
  File file = SD.open(path, FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    return false;
  }
  responseStart(client, 200, "OK", contentTypeFor(path), file.size(), extraHeaders);
  if (!headOnly) {
    uint8_t buffer[transferBufferSize];
    while (file.available() && client.connected()) {
      const int count = file.read(buffer, sizeof(buffer));
      if (count > 0) client.write(buffer, count);
    }
  }
  file.close();
  return true;
}

String collectionPath(const String& collection) {
  if (collection == "roster" || collection == "locations" || collection == "schedule" || collection == "messages") {
    return String(dataRoot) + "/" + collection + ".json";
  }
  return "";
}

size_t collectionLimit(const String& collection) {
  if (collection == "roster") return 50;
  if (collection == "locations") return 100;
  if (collection == "schedule") return 250;
  if (collection == "messages") return 200;
  return 0;
}

bool validRole(JsonVariantConst value) {
  if (value.isNull()) return true;
  if (!value.is<const char*>()) return false;
  const char* role = value.as<const char*>();
  if (!role[0]) return true;
  for (const char* allowed : rosterRoles) if (strcmp(role, allowed) == 0) return true;
  return false;
}

bool validText(JsonVariantConst value, size_t maximum, bool required = true) {
  if (!value.is<const char*>()) return !required && value.isNull();
  const char* text = value.as<const char*>();
  const size_t length = strlen(text);
  return length <= maximum && (!required || length > 0);
}

bool validateCollection(const String& collection, JsonDocument& document, String& error) {
  if (!document.is<JsonArray>()) { error = "The collection must be a JSON array."; return false; }
  JsonArray array = document.as<JsonArray>();
  if (array.size() > collectionLimit(collection)) { error = "This collection has too many records."; return false; }

  for (size_t recordIndex = 0; recordIndex < array.size(); ++recordIndex) {
    JsonObject record = array[recordIndex].as<JsonObject>();
    if (!validText(record["id"], 64)) { error = "Every record needs a short ID."; return false; }
    for (size_t otherIndex = recordIndex + 1; otherIndex < array.size(); ++otherIndex) {
      JsonObject other = array[otherIndex].as<JsonObject>();
      if (String(record["id"].as<const char*>()) == String(other["id"].as<const char*>())) {
        error = "Record IDs must be unique."; return false;
      }
    }
    if (collection == "roster") {
      if (!validText(record["name"], 60) || !validText(record["role"], 40, false) || !validText(record["username"], 40, false) ||
          !validText(record["phone"], 30, false) || !validText(record["email"], 100, false) ||
          !validText(record["birthday"], 10, false) || !validText(record["emergencyContactName"], 80, false) ||
          !validText(record["emergencyContactPhone"], 30, false) || !validText(record["notes"], 300, false) ||
          !record["active"].is<bool>()) { error = "A roster record is invalid."; return false; }
      if (!validRole(record["role"])) { error = "Choose a role from the defined role list."; return false; }
    } else if (collection == "locations") {
      if (!validText(record["name"], 80) || !validText(record["address"], 120) || !validText(record["city"], 60) || !validText(record["region"], 30, false) || !validText(record["postalCode"], 16, false)) { error = "A location record is invalid."; return false; }
      if (!record["latitude"].is<float>() || !record["longitude"].is<float>()) {
        error = String("Latitude and longitude are required for ") + (record["name"] | "a location") + ".";
        return false;
      }
      const float latitude = record["latitude"].as<float>();
      const float longitude = record["longitude"].as<float>();
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) { error = "Location coordinates are out of range."; return false; }
    } else if (collection == "schedule") {
      if (!validText(record["title"], 80) || !validText(record["date"], 10) || !validText(record["startTime"], 5) || !validText(record["endTime"], 5, false) || !validText(record["locationId"], 64) || !validText(record["notes"], 500, false) || !record["crewIds"].is<JsonArray>()) { error = "A schedule record is invalid."; return false; }
      if (record["crewIds"].as<JsonArray>().size() > maxUserCount) { error = "A job has too many crew assignments."; return false; }
    } else if (collection == "messages") {
      const bool isReply = record["parentId"].is<const char*>() && record["parentId"].as<const char*>()[0];
      if (!validText(record["title"], 80, !isReply) || !validText(record["body"], 1000) || !validText(record["postedAt"], 25) ||
          !validText(record["expiresAt"], 10, false) || !validText(record["author"], 40, false) || !validText(record["parentId"], 64, false)) {
        error = "A message record is invalid."; return false;
      }
    }
  }
  return true;
}

bool readBodyToFile(WiFiClient& client, File& file, size_t length) {
  uint8_t buffer[transferBufferSize];
  size_t remaining = length;
  uint32_t lastProgress = millis();
  while (remaining > 0) {
    if (client.available()) {
      const size_t nextRead = min(remaining, sizeof(buffer));
      const int count = client.read(buffer, nextRead);
      if (count > 0) {
        if (file.write(buffer, count) != static_cast<size_t>(count)) return false;
        remaining -= count;
        lastProgress = millis();
      }
    } else if (!client.connected() || millis() - lastProgress > 10000) {
      return false;
    } else {
      delay(1);
    }
  }
  file.flush();
  return true;
}

bool installTemporaryFile(const String& temporaryPath, const String& finalPath) {
  const String backupPath = finalPath + ".bak";
  if (SD.exists(backupPath)) SD.remove(backupPath);
  const bool hadOriginal = SD.exists(finalPath);
  if (hadOriginal && !SD.rename(finalPath, backupPath)) return false;
  if (SD.rename(temporaryPath, finalPath)) return true;
  if (hadOriginal) SD.rename(backupPath, finalPath);
  return false;
}

void handleApiPut(WiFiClient& client, const HttpRequest& request, const String& collection) {
  if (!request.isAdmin) { sendJsonError(client, 403, "Forbidden", "Administrator access is required to change records."); return; }
  if (request.crewBoardHeader != "1") { sendJsonError(client, 403, "Forbidden", "Missing same-origin request marker."); return; }
  if (!request.transferEncoding.isEmpty()) { sendJsonError(client, 400, "Bad Request", "Transfer-Encoding is not supported."); return; }
  if (!request.hasContentLength || request.contentLength == 0 || request.contentLength > maxApiBodySize) { sendJsonError(client, 413, "Content Too Large", "The JSON request is empty or too large."); return; }
  String lowerType = request.contentType; lowerType.toLowerCase();
  if (!lowerType.startsWith("application/json")) { sendJsonError(client, 415, "Unsupported Media Type", "Use application/json."); return; }

  const String finalPath = collectionPath(collection);
  const String temporaryPath = finalPath + ".tmp";
  if (SD.exists(temporaryPath)) SD.remove(temporaryPath);
  File temporary = SD.open(temporaryPath, FILE_WRITE);
  if (!temporary) { sendJsonError(client, 500, "Internal Server Error", "Could not create a temporary data file."); return; }
  const bool bodyRead = readBodyToFile(client, temporary, request.contentLength);
  temporary.close();
  if (!bodyRead) { SD.remove(temporaryPath); sendJsonError(client, 408, "Request Timeout", "The request body was interrupted."); return; }

  temporary = SD.open(temporaryPath, FILE_READ);
  DynamicJsonDocument document(jsonDocumentCapacity);
  const DeserializationError jsonError = deserializeJson(document, temporary);
  temporary.close();
  String validationError;
  if (jsonError || !validateCollection(collection, document, validationError)) {
    SD.remove(temporaryPath);
    sendJsonError(client, 422, "Unprocessable Content", jsonError ? "The request is not valid JSON." : validationError);
    return;
  }
  if (!installTemporaryFile(temporaryPath, finalPath)) {
    SD.remove(temporaryPath);
    sendJsonError(client, 500, "Internal Server Error", "Could not safely replace the data file.");
    return;
  }
  logEvent("Updated " + collection + " by " + request.authenticatedUsername);
  sendText(client, 200, "OK", "application/json; charset=utf-8", "{\"ok\":true}", "Cache-Control: no-store\r\n");
}

void sendAccountsJson(WiFiClient& client) {
  DynamicJsonDocument document(2048);
  JsonArray accounts = document.to<JsonArray>();
  for (uint8_t i = 0; i < userCount; ++i) {
    JsonObject account = accounts.add<JsonObject>();
    account["employeeId"] = users[i].employeeId;
    account["username"] = users[i].username;
  }
  String body;
  serializeJson(document, body);
  sendText(client, 200, "OK", "application/json; charset=utf-8", body, "Cache-Control: no-store\r\n");
}

bool readBodyToString(WiFiClient& client, String& body, size_t length) {
  body = "";
  body.reserve(length);
  size_t remaining = length;
  uint32_t lastProgress = millis();
  while (remaining > 0) {
    if (client.available()) {
      const char character = static_cast<char>(client.read());
      body += character;
      --remaining;
      lastProgress = millis();
    } else if (!client.connected() || millis() - lastProgress > 10000) {
      return false;
    } else {
      delay(1);
    }
  }
  return true;
}

void handleAccountPut(WiFiClient& client, const HttpRequest& request) {
  if (!request.isAdmin) { sendJsonError(client, 403, "Forbidden", "Administrator access is required to change logins."); return; }
  if (request.crewBoardHeader != "1") { sendJsonError(client, 403, "Forbidden", "Missing same-origin request marker."); return; }
  if (!request.transferEncoding.isEmpty() || !request.hasContentLength || request.contentLength == 0 || request.contentLength > 1024) {
    sendJsonError(client, 413, "Content Too Large", "The account request is empty or too large."); return;
  }
  String lowerType = request.contentType; lowerType.toLowerCase();
  if (!lowerType.startsWith("application/json")) { sendJsonError(client, 415, "Unsupported Media Type", "Use application/json."); return; }

  String body;
  if (!readBodyToString(client, body, request.contentLength)) { sendJsonError(client, 408, "Request Timeout", "The account request was interrupted."); return; }
  DynamicJsonDocument requestDocument(1536);
  if (deserializeJson(requestDocument, body)) { sendJsonError(client, 422, "Unprocessable Content", "The account request is not valid JSON."); return; }
  const String employeeId = requestDocument["employeeId"] | "";
  const String username = requestDocument["username"] | "";
  const String password = requestDocument["password"] | "";
  const String previousUsername = requestDocument["previousUsername"] | "";
  if (employeeId.isEmpty() || employeeId.length() > 64 || username.length() > 40 || password.length() > 100 || previousUsername.length() > 40 || username.indexOf(':') >= 0) {
    sendJsonError(client, 422, "Unprocessable Content", "The account fields are invalid."); return;
  }
  if (!username.isEmpty() && username == adminUsername) { sendJsonError(client, 409, "Conflict", "That username belongs to the administrator."); return; }

  File configFile = SD.open(primaryConfigPath, FILE_READ);
  if (!configFile || configFile.isDirectory()) { if (configFile) configFile.close(); sendJsonError(client, 500, "Internal Server Error", "Could not open /config.json."); return; }
  DynamicJsonDocument configDocument(6144);
  const DeserializationError configError = deserializeJson(configDocument, configFile);
  configFile.close();
  if (configError) { sendJsonError(client, 500, "Internal Server Error", "The configuration file is invalid."); return; }

  JsonArray configuredUsers;
  if (configDocument["users"].is<JsonArray>()) configuredUsers = configDocument["users"].as<JsonArray>();
  else configuredUsers = configDocument["users"].to<JsonArray>();

  int matchedIndex = -1;
  for (size_t i = 0; i < configuredUsers.size(); ++i) {
    JsonObject configuredUser = configuredUsers[i].as<JsonObject>();
    const String configuredEmployeeId = configuredUser["employeeId"] | "";
    const String configuredUsername = configuredUser["username"] | "";
    if ((!configuredEmployeeId.isEmpty() && configuredEmployeeId == employeeId) ||
        (!previousUsername.isEmpty() && configuredUsername == previousUsername) ||
        (configuredEmployeeId.isEmpty() && !username.isEmpty() && configuredUsername == username)) {
      matchedIndex = static_cast<int>(i);
      break;
    }
  }
  for (size_t i = 0; i < configuredUsers.size(); ++i) {
    if (static_cast<int>(i) == matchedIndex) continue;
    const String configuredUsername = configuredUsers[i]["username"] | "";
    if (!username.isEmpty() && configuredUsername == username) { sendJsonError(client, 409, "Conflict", "That staff username is already in use."); return; }
  }

  if (username.isEmpty()) {
    if (matchedIndex >= 0) configuredUsers.remove(static_cast<size_t>(matchedIndex));
  } else if (matchedIndex >= 0) {
    JsonObject configuredUser = configuredUsers[matchedIndex].as<JsonObject>();
    configuredUser["employeeId"] = employeeId;
    configuredUser["username"] = username;
    if (!password.isEmpty()) configuredUser["password"] = password;
  } else {
    if (password.isEmpty()) { sendJsonError(client, 422, "Unprocessable Content", "A password is required for a new username."); return; }
    if (configuredUsers.size() >= maxUserCount) { sendJsonError(client, 409, "Conflict", "The maximum number of staff logins has been reached."); return; }
    JsonObject configuredUser = configuredUsers.add<JsonObject>();
    configuredUser["employeeId"] = employeeId;
    configuredUser["username"] = username;
    configuredUser["password"] = password;
  }

  const String temporaryPath = String(primaryConfigPath) + ".tmp";
  if (SD.exists(temporaryPath)) SD.remove(temporaryPath);
  File temporaryFile = SD.open(temporaryPath, FILE_WRITE);
  if (!temporaryFile) { sendJsonError(client, 500, "Internal Server Error", "Could not create a temporary configuration file."); return; }
  const size_t bytesWritten = serializeJsonPretty(configDocument, temporaryFile);
  temporaryFile.flush();
  temporaryFile.close();
  if (bytesWritten == 0 || !installTemporaryFile(temporaryPath, primaryConfigPath)) {
    SD.remove(temporaryPath);
    sendJsonError(client, 500, "Internal Server Error", "Could not safely update /config.json."); return;
  }
  if (!loadConfiguration()) { sendJsonError(client, 500, "Internal Server Error", "The updated configuration could not be loaded."); return; }
  logEvent("Staff login updated");
  sendAccountsJson(client);
}

String employeeIdFor(const String& username) {
  for (uint8_t i = 0; i < userCount; ++i) if (users[i].username == username) return users[i].employeeId;
  return "";
}

bool loadCollection(const String& collection, JsonDocument& document) {
  File file = SD.open(collectionPath(collection), FILE_READ);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    document.to<JsonArray>();
    return true;
  }
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  return !error && document.is<JsonArray>();
}

bool saveCollection(const String& collection, JsonDocument& document, String& error) {
  if (!validateCollection(collection, document, error)) return false;
  if (measureJson(document) > maxApiBodySize) { error = "This collection is full. Ask the owner to remove older records."; return false; }
  const String finalPath = collectionPath(collection);
  const String temporaryPath = finalPath + ".tmp";
  if (SD.exists(temporaryPath)) SD.remove(temporaryPath);
  File temporary = SD.open(temporaryPath, FILE_WRITE);
  if (!temporary) { error = "Could not create a temporary data file."; return false; }
  const size_t written = serializeJson(document, temporary);
  temporary.flush();
  temporary.close();
  if (written == 0 || !installTemporaryFile(temporaryPath, finalPath)) {
    SD.remove(temporaryPath);
    error = "Could not safely replace the data file.";
    return false;
  }
  return true;
}

// Shared checks for small JSON write requests that any signed-in user may send.
bool readSmallJsonRequest(WiFiClient& client, const HttpRequest& request, JsonDocument& document) {
  if (request.crewBoardHeader != "1") { sendJsonError(client, 403, "Forbidden", "Missing same-origin request marker."); return false; }
  if (!request.transferEncoding.isEmpty() || !request.hasContentLength || request.contentLength == 0 || request.contentLength > maxSmallBodySize) {
    sendJsonError(client, 413, "Content Too Large", "The request is empty or too large."); return false;
  }
  String lowerType = request.contentType; lowerType.toLowerCase();
  if (!lowerType.startsWith("application/json")) { sendJsonError(client, 415, "Unsupported Media Type", "Use application/json."); return false; }
  String body;
  if (!readBodyToString(client, body, request.contentLength)) { sendJsonError(client, 408, "Request Timeout", "The request was interrupted."); return false; }
  if (deserializeJson(document, body) || !document.is<JsonObject>()) { sendJsonError(client, 422, "Unprocessable Content", "The request is not valid JSON."); return false; }
  return true;
}

void handleProfilePut(WiFiClient& client, const HttpRequest& request) {
  DynamicJsonDocument requestDocument(maxSmallBodySize + 1024);
  if (!readSmallJsonRequest(client, request, requestDocument)) return;
  const String employeeId = employeeIdFor(request.authenticatedUsername);
  if (employeeId.isEmpty()) { sendJsonError(client, 403, "Forbidden", "This login is not linked to a roster record."); return; }

  DynamicJsonDocument roster(jsonDocumentCapacity);
  if (!loadCollection("roster", roster)) { sendJsonError(client, 500, "Internal Server Error", "The roster file is invalid."); return; }
  JsonObject employee;
  for (JsonObject record : roster.as<JsonArray>()) {
    if (employeeId == (record["id"] | "")) { employee = record; break; }
  }
  if (employee.isNull()) { sendJsonError(client, 404, "Not Found", "Your roster record was not found."); return; }
  if (strcmp(employee["role"] | "", ownerRole) == 0) { sendJsonError(client, 403, "Forbidden", "Crew members cannot modify the owner record."); return; }

  static const char* const editableFields[] = { "phone", "email", "birthday", "emergencyContactName", "emergencyContactPhone" };
  for (const char* fieldName : editableFields) {
    JsonVariantConst value = requestDocument[fieldName];
    if (value.isNull()) continue;
    if (!value.is<const char*>()) { sendJsonError(client, 422, "Unprocessable Content", "Profile fields must be text."); return; }
    employee[fieldName] = String(value.as<const char*>());
  }
  String error;
  if (!saveCollection("roster", roster, error)) { sendJsonError(client, 422, "Unprocessable Content", error); return; }
  logEvent("Profile updated by " + request.authenticatedUsername);
  sendText(client, 200, "OK", "application/json; charset=utf-8", "{\"ok\":true}", "Cache-Control: no-store\r\n");
}

void handleMessagePost(WiFiClient& client, const HttpRequest& request) {
  DynamicJsonDocument requestDocument(maxSmallBodySize + 1024);
  if (!readSmallJsonRequest(client, request, requestDocument)) return;
  const String parentId = requestDocument["parentId"] | "";
  const String title = requestDocument["title"] | "";
  const String body = requestDocument["body"] | "";
  const String postedAt = requestDocument["postedAt"] | "";
  const String expiresAt = request.isAdmin ? String(requestDocument["expiresAt"] | "") : String("");
  if (body.isEmpty() || postedAt.length() < 10 || (parentId.isEmpty() && title.isEmpty())) {
    sendJsonError(client, 422, "Unprocessable Content", "A message needs text, and new posts need a title."); return;
  }

  DynamicJsonDocument messages(jsonDocumentCapacity);
  if (!loadCollection("messages", messages)) { sendJsonError(client, 500, "Internal Server Error", "The message file is invalid."); return; }
  JsonArray array = messages.as<JsonArray>();
  if (array.size() >= collectionLimit("messages")) { sendJsonError(client, 409, "Conflict", "The message board is full. Ask the owner to remove older posts."); return; }

  bool parentFound = parentId.isEmpty();
  String id;
  for (uint8_t attempt = 0; attempt < 5 && id.isEmpty(); ++attempt) {
    id = "msg-" + String(millis(), HEX) + "-" + String(esp_random() & 0xffffff, HEX);
    for (JsonObject record : array) if (id == (record["id"] | "")) { id = ""; break; }
  }
  for (JsonObject record : array) if (!parentFound && parentId == (record["id"] | "")) parentFound = true;
  if (!parentFound) { sendJsonError(client, 404, "Not Found", "The message being replied to no longer exists."); return; }
  if (id.isEmpty()) { sendJsonError(client, 500, "Internal Server Error", "Could not create a message ID."); return; }

  JsonObject record = array.add<JsonObject>();
  record["id"] = id;
  if (!parentId.isEmpty()) record["parentId"] = parentId;
  record["author"] = request.authenticatedUsername;
  record["title"] = title;
  record["body"] = body;
  record["postedAt"] = postedAt;
  record["expiresAt"] = expiresAt;

  String error;
  if (!saveCollection("messages", messages, error)) { sendJsonError(client, 422, "Unprocessable Content", error); return; }
  logEvent("Message posted by " + request.authenticatedUsername);
  String response;
  serializeJson(record, response);
  sendText(client, 201, "Created", "application/json; charset=utf-8", response, "Cache-Control: no-store\r\n");
}

void handleMessageDelete(WiFiClient& client, const HttpRequest& request, const String& messageId) {
  if (request.crewBoardHeader != "1") { sendJsonError(client, 403, "Forbidden", "Missing same-origin request marker."); return; }
  DynamicJsonDocument messages(jsonDocumentCapacity);
  if (!loadCollection("messages", messages)) { sendJsonError(client, 500, "Internal Server Error", "The message file is invalid."); return; }
  JsonArray array = messages.as<JsonArray>();
  const size_t count = array.size();
  bool* remove = new bool[count]();
  bool found = false;
  for (size_t i = 0; i < count; ++i) {
    if (messageId != (array[i]["id"] | "")) continue;
    if (!request.isAdmin && request.authenticatedUsername != (array[i]["author"] | "")) {
      delete[] remove;
      sendJsonError(client, 403, "Forbidden", "Only the author or the owner can delete this message."); return;
    }
    remove[i] = found = true;
  }
  if (!found) { delete[] remove; sendJsonError(client, 404, "Not Found", "Message not found."); return; }
  // Replies are removed with the message they answer, at any depth.
  for (bool changed = true; changed;) {
    changed = false;
    for (size_t i = 0; i < count; ++i) {
      if (remove[i]) continue;
      const char* parent = array[i]["parentId"] | "";
      for (size_t j = 0; parent[0] && j < count; ++j) {
        if (remove[j] && strcmp(parent, array[j]["id"] | "") == 0) { remove[i] = changed = true; break; }
      }
    }
  }
  for (size_t i = count; i-- > 0;) if (remove[i]) array.remove(i);
  delete[] remove;

  String error;
  if (!saveCollection("messages", messages, error)) { sendJsonError(client, 500, "Internal Server Error", error); return; }
  logEvent("Message deleted by " + request.authenticatedUsername);
  sendText(client, 200, "OK", "application/json; charset=utf-8", "{\"ok\":true}", "Cache-Control: no-store\r\n");
}

void handleApi(WiFiClient& client, const HttpRequest& request) {
  const String prefix = "/api/v1/";
  const String resource = request.path.substring(prefix.length());
  if (resource == "session" && request.method == "GET") {
    DynamicJsonDocument document(512);
    document["username"] = request.authenticatedUsername;
    document["isAdmin"] = request.isAdmin;
    document["employeeId"] = employeeIdFor(request.authenticatedUsername);
    JsonArray roles = document["roles"].to<JsonArray>();
    for (const char* role : rosterRoles) roles.add(role);
    String body; serializeJson(document, body);
    sendText(client, 200, "OK", "application/json; charset=utf-8", body, "Cache-Control: no-store\r\n");
    return;
  }
  if (resource == "profile") {
    if (request.method == "PUT") handleProfilePut(client, request);
    else sendJsonError(client, 405, "Method Not Allowed", "Method not supported by the profile API.");
    return;
  }
  if (resource == "messages" && request.method == "POST") { handleMessagePost(client, request); return; }
  if (resource.startsWith("messages/")) {
    const String messageId = resource.substring(9);
    if (request.method == "DELETE" && !messageId.isEmpty() && messageId.length() <= 64) handleMessageDelete(client, request, messageId);
    else sendJsonError(client, 405, "Method Not Allowed", "Method not supported by this message API.");
    return;
  }
  if (resource == "accounts") {
    if (!request.isAdmin) { sendJsonError(client, 403, "Forbidden", "Administrator access is required to view logins."); return; }
    if (request.method == "GET") sendAccountsJson(client);
    else if (request.method == "PUT") handleAccountPut(client, request);
    else sendJsonError(client, 405, "Method Not Allowed", "Method not supported by the accounts API.");
    return;
  }
  const String path = collectionPath(resource);
  if (path.isEmpty()) { sendJsonError(client, 404, "Not Found", "API resource not found."); return; }
  if (request.method == "GET") {
    if (!streamFile(client, path, false, "Cache-Control: no-store\r\n")) sendText(client, 200, "OK", "application/json; charset=utf-8", "[]", "Cache-Control: no-store\r\n");
  } else if (request.method == "PUT") {
    handleApiPut(client, request, resource);
  } else {
    sendJsonError(client, 405, "Method Not Allowed", "Method not supported by this API resource.");
  }
}

String staticPathFor(const String& requestPath) {
  if (requestPath == "/" || requestPath == "/crewboard/www/") return String(webRoot) + "/index.html";

  String assetPath = requestPath;
  const String webPrefix = "/crewboard/www";
  if (assetPath.startsWith(webPrefix + "/")) assetPath = assetPath.substring(webPrefix.length());

  if (assetPath == "/app.css" || assetPath == "/app.js") return String(webRoot) + assetPath;
  if (assetPath.startsWith("/vendor/") && assetPath.indexOf('/', 8) < 0) return String(webRoot) + assetPath;
  return "";
}

String davRelativePath(const String& requestPath) {
  if (requestPath == "/dav" || requestPath == "/dav/") return "";
  if (requestPath.startsWith("/dav/")) return requestPath.substring(5);
  return "";
}

String davStoragePath(const String& relative) {
  return relative.isEmpty() ? String(davStorageRoot) : String(davStorageRoot) + "/" + relative;
}

String fileBaseName(const String& path) {
  const int slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.substring(slash + 1);
}

String xmlEscape(const String& value) {
  String escaped;
  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value[i];
    if (c == '&') escaped += F("&amp;");
    else if (c == '<') escaped += F("&lt;");
    else if (c == '>') escaped += F("&gt;");
    else if (c == '\"') escaped += F("&quot;");
    else escaped += c;
  }
  return escaped;
}

String davHref(const String& relative, bool directory) {
  String result = "/dav";
  if (!relative.isEmpty()) result += "/" + relative;
  result.replace(" ", "%20");
  if (directory && !result.endsWith("/")) result += '/';
  return result;
}

void sendDavProperty(WiFiClient& client, const String& relative, bool directory, size_t size) {
  client.print("<d:response><d:href>"); client.print(xmlEscape(davHref(relative, directory)));
  client.print("</d:href><d:propstat><d:prop><d:resourcetype>");
  if (directory) client.print("<d:collection/>");
  client.print("</d:resourcetype>");
  if (!directory) {
    client.print("<d:getcontentlength>"); client.print(size);
    client.print("</d:getcontentlength><d:getcontenttype>"); client.print(contentTypeFor(relative));
    client.print("</d:getcontenttype>");
  }
  client.print("</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");
}

void handleDavPropfind(WiFiClient& client, const HttpRequest& request, const String& relative) {
  File target = SD.open(davStoragePath(relative));
  if (!target) { sendText(client, 404, "Not Found", "text/plain; charset=utf-8", "Not found\n"); return; }
  const bool directory = target.isDirectory();
  responseWithoutLength(client, 207, "Multi-Status", "application/xml; charset=utf-8");
  client.print("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">");
  sendDavProperty(client, relative, directory, target.size());
  if (directory && request.depth != "0") {
    File entry = target.openNextFile();
    uint16_t count = 0;
    while (entry && count < 100) {
      const String childName = fileBaseName(String(entry.name()));
      const String child = relative.isEmpty() ? childName : relative + "/" + childName;
      sendDavProperty(client, child, entry.isDirectory(), entry.size());
      entry.close(); entry = target.openNextFile(); ++count;
    }
  }
  target.close();
  client.print("</d:multistatus>");
}

void handleDavGet(WiFiClient& client, const String& relative, bool headOnly) {
  const String path = davStoragePath(relative);
  File target = SD.open(path, FILE_READ);
  if (!target) { sendText(client, 404, "Not Found", "text/plain; charset=utf-8", "Not found\n"); return; }
  if (!target.isDirectory()) {
    target.close();
    streamFile(client, path, headOnly);
    return;
  }
  if (headOnly) { target.close(); sendEmpty(client, 200, "OK"); return; }
  responseWithoutLength(client, 200, "OK", "text/html; charset=utf-8");
  client.print("<!doctype html><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>CrewBoard shared files</title><style>body{font:16px system-ui;max-width:48rem;margin:auto;padding:2rem}li{margin:.7rem 0}</style><h1>Shared files</h1><p><a href=\"/\">CrewBoard home</a></p><ul>");
  File entry = target.openNextFile();
  uint16_t count = 0;
  while (entry && count < 100) {
    const String name = fileBaseName(String(entry.name()));
    const String child = relative.isEmpty() ? name : relative + "/" + name;
    client.print("<li><a href=\""); client.print(davHref(child, entry.isDirectory())); client.print("\">");
    client.print(xmlEscape(name)); if (entry.isDirectory()) client.print('/'); client.print("</a></li>");
    entry.close(); entry = target.openNextFile(); ++count;
  }
  target.close(); client.print("</ul>");
}

void createDavParents(const String& relative) {
  int slash = relative.indexOf('/');
  while (slash >= 0) {
    SD.mkdir(String(davStorageRoot) + "/" + relative.substring(0, slash));
    slash = relative.indexOf('/', slash + 1);
  }
}

bool deleteDavRecursive(const String& relative) {
  const String path = davStoragePath(relative);
  File target = SD.open(path);
  if (!target) return false;
  if (!target.isDirectory()) { target.close(); return SD.remove(path); }
  File entry = target.openNextFile();
  while (entry) {
    const String child = relative.isEmpty() ? fileBaseName(String(entry.name())) : relative + "/" + fileBaseName(String(entry.name()));
    entry.close();
    if (!deleteDavRecursive(child)) { target.close(); return false; }
    entry = target.openNextFile();
  }
  target.close();
  return SD.rmdir(path);
}

void handleDavPut(WiFiClient& client, const HttpRequest& request, const String& relative) {
  if (!request.isAdmin) { sendText(client, 403, "Forbidden", "text/plain; charset=utf-8", "Administrator access is required.\n"); return; }
  if (relative.isEmpty() || !request.hasContentLength || !request.transferEncoding.isEmpty() || request.contentLength > maxDavUploadSize) { sendText(client, 400, "Bad Request", "text/plain; charset=utf-8", "Invalid or oversized upload.\n"); return; }
  createDavParents(relative);
  const String finalPath = davStoragePath(relative);
  const String temporaryPath = finalPath + ".upload";
  if (SD.exists(temporaryPath)) SD.remove(temporaryPath);
  File file = SD.open(temporaryPath, FILE_WRITE);
  if (!file) { sendText(client, 500, "Internal Server Error", "text/plain; charset=utf-8", "Could not create upload.\n"); return; }
  const bool ok = readBodyToFile(client, file, request.contentLength);
  file.close();
  if (!ok || !installTemporaryFile(temporaryPath, finalPath)) {
    SD.remove(temporaryPath);
    sendText(client, 500, "Internal Server Error", "text/plain; charset=utf-8", "Upload was not installed.\n"); return;
  }
  logEvent("WebDAV PUT by " + request.authenticatedUsername);
  sendEmpty(client, 201, "Created");
}

void handleDav(WiFiClient& client, const HttpRequest& request) {
  const String relative = davRelativePath(request.path);
  if (request.method == "OPTIONS") {
    sendEmpty(client, 200, "OK", "DAV: 1\r\nAllow: OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, LOCK, UNLOCK\r\n");
  } else if (request.method == "PROPFIND") {
    handleDavPropfind(client, request, relative);
  } else if (request.method == "GET" || request.method == "HEAD") {
    handleDavGet(client, relative, request.method == "HEAD");
  } else if (request.method == "PUT") {
    handleDavPut(client, request, relative);
  } else if (request.method == "MKCOL") {
    if (!request.isAdmin) { sendText(client, 403, "Forbidden", "text/plain; charset=utf-8", "Administrator access is required.\n"); return; }
    if (relative.isEmpty() || SD.exists(davStoragePath(relative))) { sendText(client, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Folder already exists or path is invalid.\n"); return; }
    createDavParents(relative);
    if (SD.mkdir(davStoragePath(relative))) sendEmpty(client, 201, "Created");
    else sendText(client, 409, "Conflict", "text/plain; charset=utf-8", "Could not create folder.\n");
  } else if (request.method == "DELETE") {
    if (!request.isAdmin) { sendText(client, 403, "Forbidden", "text/plain; charset=utf-8", "Administrator access is required.\n"); return; }
    if (relative.isEmpty()) { sendText(client, 405, "Method Not Allowed", "text/plain; charset=utf-8", "The shared root cannot be deleted.\n"); return; }
    if (deleteDavRecursive(relative)) sendEmpty(client, 204, "No Content");
    else sendText(client, 404, "Not Found", "text/plain; charset=utf-8", "Not found or delete failed.\n");
  } else if (request.method == "LOCK") {
    sendText(client, 200, "OK", "application/xml; charset=utf-8", "<?xml version=\"1.0\"?><d:prop xmlns:d=\"DAV:\"><d:lockdiscovery/></d:prop>");
  } else if (request.method == "UNLOCK") {
    sendEmpty(client, 204, "No Content");
  } else {
    sendText(client, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Method not supported.\n");
  }
}

void handleClient(WiFiClient& client) {
  HttpRequest request;
  if (!readRequest(client, request)) {
    sendText(client, 400, "Bad Request", "text/plain; charset=utf-8", "Malformed or oversized HTTP request.\n");
    return;
  }
  if (!authorize(request)) { sendUnauthorized(client); return; }

  if (request.path.startsWith("/api/v1/")) {
    handleApi(client, request);
  } else if (request.path == "/dav" || request.path.startsWith("/dav/")) {
    handleDav(client, request);
  } else if (request.path == "/crewboard/www") {
    sendEmpty(client, 302, "Found", "Location: /crewboard/www/\r\n");
  } else {
    const String staticPath = staticPathFor(request.path);
    if (!staticPath.isEmpty() && (request.method == "GET" || request.method == "HEAD")) {
      if (!streamFile(client, staticPath, request.method == "HEAD", "Cache-Control: no-cache\r\n")) sendText(client, 404, "Not Found", "text/plain; charset=utf-8", "Application file missing from SD card.\n");
    } else {
      sendText(client, 404, "Not Found", "text/plain; charset=utf-8", "Not found\n");
    }
  }
}

bool loadConfiguration() {
  File file = SD.open(primaryConfigPath, FILE_READ);
  if (!file || file.isDirectory()) { if (file) file.close(); logEvent("Missing /config.json"); return false; }
  DynamicJsonDocument document(4096);
  const DeserializationError error = deserializeJson(document, file);
  file.close();
  if (error) { logEvent("Invalid config JSON"); return false; }

  const char* ssid = document["wifi"]["ssid"] | "";
  const char* password = document["wifi"]["password"] | "";
  const char* apSsid = document["setupAccessPoint"]["ssid"] | "";
  const char* apPassword = document["setupAccessPoint"]["password"] | "";
  const char* owner = document["admin"]["username"] | "";
  const char* ownerPassword = document["admin"]["password"] | "";
  JsonVariant userValue = document["users"];
  if (!ssid[0] || !password[0] || !owner[0] || !ownerPassword[0] || (!userValue.isNull() && !userValue.is<JsonArray>())) {
    logEvent("Config fields missing"); return false;
  }
  const bool hasSetupSsid = apSsid[0];
  const bool hasSetupPassword = apPassword[0];
  if (hasSetupSsid != hasSetupPassword || (hasSetupPassword && strlen(apPassword) < 8)) {
    logEvent("Invalid setup AP config"); return false;
  }
  JsonArray configuredUsers = userValue.as<JsonArray>();
  if (configuredUsers.size() > maxUserCount) { logEvent("Too many config users"); return false; }

  wifiSsid = ssid;
  wifiPassword = password;
  if (hasSetupSsid) {
    setupApSsid = apSsid;
    setupApPassword = apPassword;
  } else {
    // Compatibility with the original CYD-Intranet-Config /config.json format.
    setupApSsid = "CYD-Intranet";
    setupApPassword = "cydupload";
    logEvent("Using legacy setup AP defaults");
  }
  adminUsername = owner;
  adminPassword = ownerPassword;
  userCount = 0;
  for (JsonObject configuredUser : configuredUsers) {
    const char* username = configuredUser["username"] | "";
    const char* userPassword = configuredUser["password"] | "";
    const char* employeeId = configuredUser["employeeId"] | "";
    if (!username[0] || !userPassword[0] || adminUsername == username) { logEvent("Invalid config user"); return false; }
    for (uint8_t i = 0; i < userCount; ++i) if (users[i].username == username) { logEvent("Duplicate config user"); return false; }
    users[userCount].employeeId = employeeId;
    users[userCount].username = username;
    users[userCount].password = userPassword;
    ++userCount;
  }
  logEvent("Config: /config.json");
  return true;
}

bool connectToNetwork() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) { delay(500); Serial.print('.'); }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    serverAddress = WiFi.localIP();
    logEvent("Wi-Fi connected");
    return true;
  }
  WiFi.mode(WIFI_AP);
  if (!WiFi.softAP(setupApSsid.c_str(), setupApPassword.c_str())) return false;
  wifiSsid = setupApSsid;
  serverAddress = WiFi.softAPIP();
  logEvent("Setup access point active");
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(backlightPin, OUTPUT);
  digitalWrite(backlightPin, HIGH);
  display.init();
  display.setRotation(1);
  display.fillScreen(TFT_BLACK);
  logEvent("Starting");

  if (!SD.begin(sdChipSelectPin)) {
    logEvent("SD card mount failed");
    while (true) delay(1000);
  }
  if (!loadConfiguration()) {
    logEvent("Fix config and restart");
    while (true) delay(1000);
  }
  if (!connectToNetwork()) {
    logEvent("Network startup failed");
    while (true) delay(1000);
  }
  if (!SD.exists(davStorageRoot)) SD.mkdir(davStorageRoot);
  server.begin();
  logEvent("Open http://" + serverAddress.toString());
}

void loop() {
  WiFiClient client = server.available();
  if (client) {
    handleClient(client);
    client.stop();
  }
}
