#pragma once

#include <ArduinoJson.h>
#include <cstring>

namespace traxxi {

constexpr size_t maxConfigBytes = 4096;
constexpr char defaultHostname[] = "traxxi-server";

struct Configuration {
  char ssid[33] = {};
  char wifiPassword[65] = {};
  char hostname[16] = {};
  char serverName[65] = {};
  char adminUsername[33] = {};
  char adminPassword[129] = {};
};

inline bool hostnameValid(const char* value) {
  const size_t length = value ? strlen(value) : 0;
  if (!length || length > 15) return false;
  for (size_t i = 0; i < length; ++i) {
    const char c = value[i];
    const bool alphanumeric = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                              (c >= '0' && c <= '9');
    if (!alphanumeric && (c != '-' || i == 0 || i == length - 1)) return false;
  }
  return true;
}

template <size_t Capacity>
bool readText(JsonVariantConst value, char (&target)[Capacity], size_t minimum) {
  if (!value.is<const char*>()) return false;
  const JsonString text = value.as<JsonString>();
  const size_t length = text.size();
  if (length < minimum || length >= Capacity || strlen(text.c_str()) != length) return false;
  for (size_t i = 0; i < length; ++i) {
    const unsigned char c = static_cast<unsigned char>(text.c_str()[i]);
    if (c < 32 || c > 126) return false;
  }
  memcpy(target, text.c_str(), length + 1);
  return true;
}

inline const char* parseConfiguration(JsonVariantConst root, Configuration& output) {
  Configuration next;
  if (!root.is<JsonObjectConst>()) return "Config must be a JSON object";
  if (!readText(root["wifi"]["ssid"], next.ssid, 1)) return "Invalid Wi-Fi SSID";
  if (strcmp(next.ssid, "YOUR_WIFI_NAME") == 0) return "Replace Wi-Fi SSID placeholder";
  if (!readText(root["wifi"]["password"], next.wifiPassword, 8)) return "Invalid Wi-Fi password";
  if (strcmp(next.wifiPassword, "YOUR_WIFI_PASSWORD") == 0) return "Replace Wi-Fi password placeholder";
  if (strlen(next.wifiPassword) == 64) {
    for (const char* p = next.wifiPassword; *p; ++p) {
      if (!((*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'f') || (*p >= 'A' && *p <= 'F'))) {
        return "64-character Wi-Fi key must be hex";
      }
    }
  }
  if (!readText(root["serverName"], next.serverName, 1)) return "Invalid serverName";
  if (root["hostname"].isUnbound()) {
    strcpy(next.hostname, defaultHostname);
  } else if (!readText(root["hostname"], next.hostname, 1) || !hostnameValid(next.hostname)) {
    return "Invalid hostname";
  }
  for (char* p = next.hostname; *p; ++p) {
    if (*p >= 'A' && *p <= 'Z') *p += 'a' - 'A';
  }
  if (!readText(root["admin"]["username"], next.adminUsername, 1)) return "Invalid admin username";
  for (const char* p = next.adminUsername; *p; ++p) {
    if (*p == ':' || *p == ' ') return "Admin username cannot contain colon/space";
  }
  if (!readText(root["admin"]["password"], next.adminPassword, 16)) return "Admin password needs 16-128 characters";
  if (strcmp(next.adminPassword, "REPLACE_WITH_A_UNIQUE_PASSWORD") == 0) return "Replace admin password placeholder";
  if (strcmp(next.adminPassword, next.wifiPassword) == 0) return "Use different admin and Wi-Fi passwords";
  output = next;
  return nullptr;
}

}
