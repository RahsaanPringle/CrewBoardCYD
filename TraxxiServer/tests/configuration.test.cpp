#include <cassert>
#include <iostream>
#include "../firmware/TraxxiServer/configuration.h"

const char* validJson = R"({
  "serverName": "Sample Business",
  "hostname": "SHOP-SERVER",
  "wifi": {"ssid": "TestNetwork", "password": "test-network-key"},
  "admin": {"username": "owner", "password": "unique-test-owner-key"}
})";

void reset(JsonDocument& document) {
  document.clear();
  assert(!deserializeJson(document, validJson));
}

void expectRejected(JsonDocument& document) {
  traxxi::Configuration output;
  strcpy(output.serverName, "previous configuration");
  const traxxi::Configuration before = output;
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), output) != nullptr);
  assert(memcmp(&before, &output, sizeof(output)) == 0);
}

int main() {
  JsonDocument document;
  traxxi::Configuration config;
  reset(document);
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), config) == nullptr);
  assert(strcmp(config.hostname, "shop-server") == 0);
  assert(strcmp(config.ssid, "TestNetwork") == 0);
  assert(strcmp(config.serverName, "Sample Business") == 0);
  document.remove("hostname");
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), config) == nullptr);
  assert(strcmp(config.hostname, traxxi::defaultHostname) == 0);

  for (const char* value : {"", "-shop", "shop-", "shop.local", "shop_name", "shop name", "abcdefghijklmnop"}) {
    reset(document);
    document["hostname"] = value;
    expectRejected(document);
  }
  reset(document);
  document["hostname"] = nullptr;
  expectRejected(document);
  reset(document);
  document["hostname"] = 123;
  expectRejected(document);
  assert(traxxi::hostnameValid("a"));
  assert(traxxi::hostnameValid("123456789012345"));
  assert(!traxxi::hostnameValid(nullptr));

  for (const char* value : {"", "YOUR_WIFI_NAME", "12345678901234567890123456789012345"}) {
    reset(document);
    document["wifi"]["ssid"] = value;
    expectRejected(document);
  }
  for (const char* value : {"", "short", "YOUR_WIFI_PASSWORD"}) {
    reset(document);
    document["wifi"]["password"] = value;
    expectRejected(document);
  }
  reset(document);
  document["wifi"]["password"] = std::string(64, 'g');
  expectRejected(document);
  document["wifi"]["password"] = std::string(64, 'a');
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), config) == nullptr);
  document["wifi"]["password"] = std::string(65, 'a');
  expectRejected(document);
  document["wifi"]["password"] = std::string(8, 'a');
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), config) == nullptr);
  document["wifi"]["password"] = std::string(63, 'a');
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), config) == nullptr);

  for (const char* value : {"", "REPLACE_WITH_A_UNIQUE_PASSWORD", "short-password", "test-network-key"}) {
    reset(document);
    document["admin"]["password"] = value;
    expectRejected(document);
  }
  reset(document);
  document["admin"]["password"] = std::string(16, 'a');
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), config) == nullptr);
  document["admin"]["password"] = std::string(128, 'a');
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), config) == nullptr);
  document["admin"]["password"] = std::string(129, 'a');
  expectRejected(document);
  for (const char* value : {"", "owner:name", "two words"}) {
    reset(document);
    document["admin"]["username"] = value;
    expectRejected(document);
  }
  reset(document);
  document["serverName"] = true;
  expectRejected(document);
  document["serverName"] = std::string(64, 'a');
  assert(traxxi::parseConfiguration(document.as<JsonVariantConst>(), config) == nullptr);
  document["serverName"] = std::string(65, 'a');
  expectRejected(document);
  reset(document);
  document["wifi"]["ssid"] = "line\nbreak";
  expectRejected(document);
  document["wifi"]["ssid"] = "\xc3\xa9";
  expectRejected(document);
  reset(document);
  assert(!deserializeJson(document, R"({"serverName":"a\u0000hidden","wifi":{"ssid":"TestNetwork","password":"test-network-key"},"admin":{"username":"owner","password":"unique-test-owner-key"}})"));
  expectRejected(document);
  document.clear();
  document.to<JsonArray>();
  expectRejected(document);
  document.clear();
  expectRejected(document);
  std::cout << "Configuration validation and atomic failure tests passed.\n";
}
