#include <WiFi.h>
#include <WiFiClient.h>
#include <LittleFS.h>
#include <SD.h>
#include <TFT_eSPI.h>
#include <ArduinoJson.h>

// Requires ArduinoJson 6.x or 7.x. Put config.json at the root of the SD card.
// Copy the JSON template in this comment to /config.json on the SD card.
// Admin credentials are required; user logins are optional (up to 12).
// {
//   "wifi": { "ssid": "YOUR_WIFI_NAME", "password": "YOUR_WIFI_PASSWORD" },
//   "admin": { "username": "owner", "password": "CHANGE_THIS_PASSWORD" },
//   "users": []
// }

constexpr char configFilePath[] = "/config.json";
constexpr uint8_t maxUserCount = 12;

String wifiSsid;
String wifiPassword;
String adminUsername;
String adminPassword;

struct UserCredential {
  String username;
  String password;
};

UserCredential userCredentials[maxUserCount];
uint8_t userCount = 0;

constexpr uint16_t serverPort = 80;
constexpr uint8_t backlightPin = 21;
constexpr uint8_t sdChipSelectPin = 5;
constexpr uint8_t logLineCount = 8;
constexpr size_t transferBufferSize = 1024;
constexpr bool requireAuthentication = true;

WiFiServer server(serverPort);
FS* storage = nullptr;
TFT_eSPI display = TFT_eSPI();
String logLines[logLineCount];
IPAddress serverAddress;

struct HttpRequest {
  String method;
  String path;
  String depth;
  String authorization;
  String authenticatedUsername;
  size_t contentLength = 0;
  bool folderView = false;
  bool isAdmin = false;
  bool valid = false;
};

void drawStatusScreen() {
  display.fillScreen(TFT_BLACK);
  display.setTextColor(TFT_CYAN, TFT_BLACK);
  display.setTextSize(2);
  display.setCursor(8, 4);
  display.print("Intranet server");
  display.drawFastHLine(8, 24, 304, TFT_DARKGREY);

  display.setTextColor(TFT_WHITE, TFT_BLACK);
  display.setCursor(8, 30);
  display.print("IP: ");
  display.print(serverAddress.toString());
  display.setTextSize(1);
  display.setCursor(8, 56);
  display.print("WiFi: ");
  display.print(wifiSsid);
  display.drawFastHLine(8, 74, 304, TFT_DARKGREY);

  display.setTextSize(1);
  const uint8_t firstVisibleLine = logLineCount > 6 ? logLineCount - 6 : 0;
  for (uint8_t index = firstVisibleLine; index < logLineCount; ++index) {
    display.setCursor(8, 82 + (index - firstVisibleLine) * 21);
    display.print(logLines[index]);
  }
}

void logEvent(const String& message) {
  Serial.println(message);

  for (uint8_t index = 1; index < logLineCount; ++index) {
    logLines[index - 1] = logLines[index];
  }

  String line = String(millis() / 1000) + "s " + message;
  if (line.length() > 38) line = line.substring(0, 38);
  logLines[logLineCount - 1] = line;

  drawStatusScreen();
}

int hexValue(char character) {
  if (character >= '0' && character <= '9') return character - '0';
  if (character >= 'a' && character <= 'f') return character - 'a' + 10;
  if (character >= 'A' && character <= 'F') return character - 'A' + 10;
  return -1;
}

String urlDecode(const String& value) {
  String decoded;
  decoded.reserve(value.length());

  for (size_t index = 0; index < value.length(); ++index) {
    const char character = value[index];
    if (character == '%' && index + 2 < value.length()) {
      const int high = hexValue(value[index + 1]);
      const int low = hexValue(value[index + 2]);
      if (high >= 0 && low >= 0) {
        decoded += char((high << 4) | low);
        index += 2;
      }
    } else if (character == '+') {
      decoded += ' ';
    } else {
      decoded += character;
    }
  }

  return decoded;
}

String xmlEscape(const String& value) {
  String escaped;
  escaped.reserve(value.length());

  for (size_t index = 0; index < value.length(); ++index) {
    const char character = value[index];
    if (character == '&') escaped += F("&amp;");
    else if (character == '<') escaped += F("&lt;");
    else if (character == '>') escaped += F("&gt;");
    else if (character == '\"') escaped += F("&quot;");
    else escaped += character;
  }

  return escaped;
}

String safePath(String requestPath) {
  const int queryStart = requestPath.indexOf('?');
  if (queryStart >= 0) requestPath = requestPath.substring(0, queryStart);
  requestPath = urlDecode(requestPath);
  requestPath.replace("\\", "/");

  while (requestPath.startsWith("/")) requestPath = requestPath.substring(1);

  String cleaned;
  int segmentStart = 0;
  while (segmentStart < requestPath.length()) {
    int segmentEnd = requestPath.indexOf('/', segmentStart);
    if (segmentEnd < 0) segmentEnd = requestPath.length();
    const String segment = requestPath.substring(segmentStart, segmentEnd);

    if (!segment.isEmpty() && segment != "." && segment != "..") {
      String cleanSegment;
      for (size_t index = 0; index < segment.length(); ++index) {
        const char character = segment[index];
        if (isalnum(character) || character == '.' || character == '-' || character == '_' || character == ' ') {
          cleanSegment += character;
        }
      }
      if (!cleanSegment.isEmpty()) {
        if (!cleaned.isEmpty()) cleaned += '/';
        cleaned += cleanSegment;
      }
    }

    segmentStart = segmentEnd + 1;
  }

  return cleaned;
}

String storageName(const String& path);
String webDavHref(const String& path, bool isDirectory);

String parentPath(const String& path) {
  const int lastSlash = path.lastIndexOf('/');
  return lastSlash < 0 ? "" : path.substring(0, lastSlash);
}

String directoryHref(const String& path) {
  String href = webDavHref(path, true);
  return href;
}

String indexFilePath(const String& path) {
  const String prefix = path.isEmpty() ? "" : path + "/";
  const String htmlPath = prefix + "index.html";
  File htmlFile = storage->open(storageName(htmlPath), FILE_READ);
  if (htmlFile && !htmlFile.isDirectory()) {
    htmlFile.close();
    return htmlPath;
  }
  if (htmlFile) htmlFile.close();
  const String htmPath = prefix + "index.htm";
  File htmFile = storage->open(storageName(htmPath), FILE_READ);
  if (htmFile && !htmFile.isDirectory()) {
    htmFile.close();
    return htmPath;
  }
  if (htmFile) htmFile.close();
  return "";
}

String storageName(const String& path) {
  return path.isEmpty() ? "/" : "/" + path;
}

String baseName(const String& path) {
  const int lastSlash = path.lastIndexOf('/');
  return lastSlash < 0 ? path : path.substring(lastSlash + 1);
}

bool isPrivateConfigPath(const String& path) {
  String lowerPath = path;
  lowerPath.toLowerCase();
  return lowerPath == "config.json";
}

void createParentDirectories(const String& path) {
  int slash = path.indexOf('/');
  while (slash >= 0) {
    storage->mkdir("/" + path.substring(0, slash));
    slash = path.indexOf('/', slash + 1);
  }
}

bool deleteRecursive(const String& path) {
  File target = storage->open(storageName(path));
  if (!target) return false;

  if (!target.isDirectory()) {
    target.close();
    return storage->remove(storageName(path));
  }

  File entry = target.openNextFile();
  while (entry) {
    String childName = baseName(String(entry.name()));
    String childPath = path.isEmpty() ? childName : path + "/" + childName;
    bool childIsDirectory = entry.isDirectory();
    entry.close();

    if (childIsDirectory) {
      if (!deleteRecursive(childPath)) {
        target.close();
        return false;
      }
    } else if (!storage->remove(storageName(childPath))) {
      target.close();
      return false;
    }

    entry = target.openNextFile();
  }

  target.close();
  return path.isEmpty() || storage->rmdir(storageName(path)) || storage->remove(storageName(path));
}

const char* contentTypeFor(const String& fileName) {
  String lowerName = fileName;
  lowerName.toLowerCase();
  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lowerName.endsWith(".css")) return "text/css; charset=utf-8";
  if (lowerName.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lowerName.endsWith(".json")) return "application/json; charset=utf-8";
  if (lowerName.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) return "image/jpeg";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".svg")) return "image/svg+xml";
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

const char* listingIconFor(const String& fileName, bool isDirectory) {
  if (isDirectory) return "&#128193;";

  String lowerName = fileName;
  lowerName.toLowerCase();
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".png") || lowerName.endsWith(".gif") || lowerName.endsWith(".webp") || lowerName.endsWith(".svg")) return "&#128444;";
  if (lowerName.endsWith(".mp3") || lowerName.endsWith(".wav") || lowerName.endsWith(".ogg") || lowerName.endsWith(".m4a")) return "&#127925;";
  if (lowerName.endsWith(".mp4") || lowerName.endsWith(".mov") || lowerName.endsWith(".avi") || lowerName.endsWith(".mkv") || lowerName.endsWith(".webm")) return "&#127909;";
  if (lowerName.endsWith(".zip") || lowerName.endsWith(".rar") || lowerName.endsWith(".7z") || lowerName.endsWith(".gz") || lowerName.endsWith(".tar")) return "&#128230;";
  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm") || lowerName.endsWith(".css") || lowerName.endsWith(".js") || lowerName.endsWith(".json") || lowerName.endsWith(".ino") || lowerName.endsWith(".cpp") || lowerName.endsWith(".h")) return "&#128187;";
  if (lowerName.endsWith(".txt") || lowerName.endsWith(".md") || lowerName.endsWith(".pdf") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "&#128196;";
  return "&#128196;";
}

void sendResponse(WiFiClient& client, int code, const String& status, const String& contentType, const String& body, const String& extraHeaders = "") {
  client.print("HTTP/1.1 ");
  client.print(code);
  client.print(' ');
  client.print(status);
  client.print("\r\nConnection: close\r\nContent-Length: ");
  client.print(body.length());
  client.print("\r\nContent-Type: ");
  client.print(contentType);
  client.print("\r\n");
  if (!extraHeaders.isEmpty()) client.print(extraHeaders);
  client.print("\r\n");
  client.print(body);
}

void sendEmptyResponse(WiFiClient& client, int code, const String& status, const String& extraHeaders = "") {
  client.print("HTTP/1.1 ");
  client.print(code);
  client.print(' ');
  client.print(status);
  client.print("\r\nConnection: close\r\nContent-Length: 0\r\n");
  if (!extraHeaders.isEmpty()) client.print(extraHeaders);
  client.print("\r\n");
}

bool readRequest(WiFiClient& client, HttpRequest& request) {
  client.setTimeout(5000);
  String requestLine = client.readStringUntil('\n');
  requestLine.trim();
  if (requestLine.isEmpty()) return false;

  const int firstSpace = requestLine.indexOf(' ');
  const int secondSpace = requestLine.indexOf(' ', firstSpace + 1);
  if (firstSpace < 0 || secondSpace < 0) return false;

  request.method = requestLine.substring(0, firstSpace);
  String rawTarget = requestLine.substring(firstSpace + 1, secondSpace);
  request.folderView = rawTarget.indexOf("view=files") >= 0;
  request.path = safePath(rawTarget);
  request.valid = true;

  while (client.connected()) {
    String headerLine = client.readStringUntil('\n');
    headerLine.trim();
    if (headerLine.isEmpty()) break;

    const int colon = headerLine.indexOf(':');
    if (colon < 0) continue;

    String name = headerLine.substring(0, colon);
    String value = headerLine.substring(colon + 1);
    name.toLowerCase();
    value.trim();

    if (name == "content-length") request.contentLength = value.toInt();
    else if (name == "depth") request.depth = value;
    else if (name == "authorization") request.authorization = value;
  }

  return request.valid;
}

String encodeBase64(const String& value) {
  static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String encoded;
  uint32_t accumulator = 0;
  int bits = -6;
  for (size_t index = 0; index < value.length(); ++index) {
    accumulator = (accumulator << 8) | static_cast<uint8_t>(value[index]);
    bits += 8;
    while (bits >= 0) {
      encoded += alphabet[(accumulator >> bits) & 0x3F];
      bits -= 6;
    }
  }
  if (bits > -6) encoded += alphabet[((accumulator << 8) >> (bits + 8)) & 0x3F];
  while (encoded.length() % 4) encoded += '=';
  return encoded;
}

bool isAuthorized(HttpRequest& request) {
  if (!requireAuthentication) return true;

  const String adminAuthorization = "Basic " + encodeBase64(adminUsername + ":" + adminPassword);
  if (request.authorization == adminAuthorization) {
    request.authenticatedUsername = adminUsername;
    request.isAdmin = true;
    return true;
  }

  for (uint8_t index = 0; index < userCount; ++index) {
    const String userAuthorization = "Basic " + encodeBase64(
      userCredentials[index].username + ":" + userCredentials[index].password);
    if (request.authorization == userAuthorization) {
      request.authenticatedUsername = userCredentials[index].username;
      request.isAdmin = false;
      return true;
    }
  }
  return false;
}

void sendUnauthorized(WiFiClient& client) {
  sendResponse(client, 401, "Unauthorized", "text/plain", "Intranet login required\n", "WWW-Authenticate: Basic realm=\"CYD Intranet\"\r\n");
}

String webDavHref(const String& path, bool isDirectory) {
  String href = "/" + path;
  href.replace(" ", "%20");
  if (isDirectory && !href.endsWith("/")) href += "/";
  return href;
}

void appendPropResponse(String& xml, const String& path, bool isDirectory, size_t size) {
  xml += F("<d:response><d:href>");
  xml += xmlEscape(webDavHref(path, isDirectory));
  xml += F("</d:href><d:propstat><d:prop><d:resourcetype>");
  if (isDirectory) xml += F("<d:collection/>");
  xml += F("</d:resourcetype>");

  if (!isDirectory) {
    xml += F("<d:getcontentlength>");
    xml += String(size);
    xml += F("</d:getcontentlength><d:getcontenttype>");
    xml += contentTypeFor(path);
    xml += F("</d:getcontenttype>");
  }

  xml += F("</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");
}

void handleOptions(WiFiClient& client) {
  sendEmptyResponse(client, 200, "OK", "DAV: 1\r\nAllow: OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, LOCK, UNLOCK\r\n");
}

void handlePropfind(WiFiClient& client, const HttpRequest& request) {
  const String targetPath = request.path;
  File target = storage->open(storageName(targetPath));
  if (!target) {
    sendResponse(client, 404, "Not Found", "text/plain", "Not found\n");
    return;
  }

  const bool targetIsDirectory = target.isDirectory();
  String xml = F("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">");
  appendPropResponse(xml, targetPath, targetIsDirectory, target.size());

  if (targetIsDirectory && request.depth != "0") {
    File entry = target.openNextFile();
    while (entry) {
      const String childName = baseName(String(entry.name()));
      const String childPath = targetPath.isEmpty() ? childName : targetPath + "/" + childName;
      if (!isPrivateConfigPath(childPath)) {
        appendPropResponse(xml, childPath, entry.isDirectory(), entry.size());
      }
      entry.close();
      entry = target.openNextFile();
    }
  }

  target.close();
  xml += F("</d:multistatus>");
  sendResponse(client, 207, "Multi-Status", "application/xml; charset=utf-8", xml);
}

void sendDirectoryIndex(WiFiClient& client, const String& directory, const String& indexPath, bool headersOnly) {
  File indexFile = storage->open(storageName(indexPath), FILE_READ);
  if (!indexFile || indexFile.isDirectory()) {
    if (indexFile) indexFile.close();
    sendResponse(client, 404, "Not Found", "text/plain", "Index file not found\n");
    return;
  }

  const String folderHref = directoryHref(directory) + "?view=files";
  String navigation = F("<style>.cyd-nav{font:14px system-ui,sans-serif;display:flex;gap:1rem;flex-wrap:wrap;padding:10px 14px;margin:0 0 12px;background:#e8f2f5;border:1px solid #b8cbd2;border-radius:8px}.cyd-nav a{color:#145d76;font-weight:600}</style><nav class=\"cyd-nav\" aria-label=\"Directory navigation\"><a href=\"");
  navigation += folderHref;
  navigation += F("\">Folder contents</a>");
  if (!directory.isEmpty()) {
    navigation += F("<a href=\"");
    navigation += directoryHref(parentPath(directory));
    navigation += F("\">Up one level</a>");
  }
  navigation += F("</nav>");

  client.print("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: ");
  client.print(indexFile.size() + navigation.length() + 15);
  client.print("\r\nContent-Type: text/html; charset=utf-8\r\n\r\n");
  if (!headersOnly) {
    client.print("<!doctype html>");
    client.print(navigation);
    uint8_t buffer[transferBufferSize];
    while (indexFile.available()) {
      const int bytesRead = indexFile.read(buffer, sizeof(buffer));
      if (bytesRead > 0) client.write(buffer, bytesRead);
    }
  }
  indexFile.close();
}

void handleGet(WiFiClient& client, const HttpRequest& request, bool headersOnly) {
  const String path = request.path;
  File target = storage->open(storageName(path), FILE_READ);
  if (!target) {
    sendResponse(client, 404, "Not Found", "text/plain", "Not found\n");
    return;
  }

  if (target.isDirectory()) {
    target.close();
    const String indexPath = indexFilePath(path);
    if (!path.isEmpty() && !request.folderView && !indexPath.isEmpty()) {
      sendDirectoryIndex(client, path, indexPath, headersOnly);
      return;
    }
    target = storage->open(storageName(path), FILE_READ);
    String page = F("<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>CYD Intranet</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#eef3f5;color:#17202a}main{background:white;border:1px solid #d7e0e4;border-radius:8px;padding:24px}a{color:#176b87;overflow-wrap:anywhere}li{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:10px 0}.icon{display:inline-block;width:1.5em;text-align:center}.meta{color:#63727a}.delete{background:#a43d3d;color:#fff;border:0;border-radius:4px;padding:6px 10px;cursor:pointer}.tools{display:grid;gap:12px;margin:20px 0;padding:16px 0;border-top:1px solid #d7e0e4;border-bottom:1px solid #d7e0e4}.tools form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.tools input[type=text]{padding:8px;min-width:180px}.tools button{padding:8px 12px;cursor:pointer}.drop-zone{padding:20px;border:2px dashed #8ba2aa;border-radius:8px;background:#f7fafb;text-align:center;color:#34464d;cursor:pointer;transition:background .15s,border-color .15s}.drop-zone.dragover{border-color:#176b87;background:#e7f4f7}#message{margin:0;color:#176b87}</style></head><body><main><h1>CYD Intranet</h1><nav aria-label=\"Directory navigation\" style=\"display:flex;gap:1rem;flex-wrap:wrap;margin:12px 0 18px\"><a href=\"");
    page += directoryHref(parentPath(path));
    page += F("\">Up one level</a>");
    const String listingIndex = path.isEmpty() ? "" : indexFilePath(path);
    if (!listingIndex.isEmpty()) {
      page += F("<a href=\"");
      page += directoryHref(path);
      page += F("\">Open index page</a>");
    }
    page += F("</nav><p>Local files: <strong>/</strong></p><section class=\"tools\"><form id=\"folder-form\"><label for=\"folder-name\">New folder</label><input id=\"folder-name\" type=\"text\" required><button type=\"submit\">Create folder</button></form><form id=\"upload-form\"><label for=\"upload-files\">Choose files to upload</label><input id=\"upload-files\" type=\"file\" multiple required><div id=\"drop-zone\" class=\"drop-zone\" role=\"button\" tabindex=\"0\" aria-label=\"Choose files or drop files here\">Drop files here, or click to choose</div><button type=\"submit\">Upload selected files</button></form><p id=\"message\" role=\"status\" aria-live=\"polite\"></p></section><ul>");
    File entry = target.openNextFile();
    while (entry) {
      const String childName = baseName(String(entry.name()));
      const String childPath = path.isEmpty() ? childName : path + "/" + childName;
      if (isPrivateConfigPath(childPath)) {
        entry.close();
        entry = target.openNextFile();
        continue;
      }
      const String childHref = webDavHref(childPath, entry.isDirectory());
      page += F("<li><div><a href=\"");
      page += childHref;
      page += F("\"><span class=\"icon\" aria-hidden=\"true\">");
      page += listingIconFor(childName, entry.isDirectory());
      page += F("</span>");
      page += xmlEscape(childName);
      if (entry.isDirectory()) page += F("/");
      page += F("</a>");
      if (!entry.isDirectory()) {
        page += F(" <span class=\"meta\">");
        page += String(entry.size());
        page += F(" bytes</span>");
      }
      page += F("</div><button class=\"delete\" type=\"button\" data-path=\"");
      page += xmlEscape(childHref);
      page += F("\">Delete</button></li>");
      entry.close();
      entry = target.openNextFile();
    }
    target.close();
    page += F("<script>const message = document.getElementById('message'); const directory = new URL('.', location.href).pathname; document.getElementById('folder-form').addEventListener('submit', async (event) => { event.preventDefault(); const input = document.getElementById('folder-name'); const name = input.value.trim(); if (!name || name.includes('/') || name.includes('\\\\')) { message.textContent = 'Enter a folder name without slashes.'; return; } try { const response = await fetch(directory + encodeURIComponent(name) + '/', { method: 'MKCOL', credentials: 'same-origin' }); if (!response.ok) throw new Error('Request failed: ' + response.status); location.reload(); } catch (error) { message.textContent = 'Folder creation failed: ' + error.message; } }); const dropZone = document.getElementById('drop-zone'); const fileInput = document.getElementById('upload-files'); dropZone.addEventListener('click', () => fileInput.click()); dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } }); ['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add('dragover'); })); ['dragleave', 'dragend'].forEach((type) => dropZone.addEventListener(type, () => dropZone.classList.remove('dragover'))); dropZone.addEventListener('drop', (event) => { event.preventDefault(); dropZone.classList.remove('dragover'); const files = event.dataTransfer && event.dataTransfer.files; if (!files || !files.length) return; fileInput.files = files; message.textContent = files.length + (files.length === 1 ? ' file ready to upload.' : ' files ready to upload.'); }); fileInput.addEventListener('change', () => { const count = fileInput.files.length; if (count) message.textContent = count + (count === 1 ? ' file selected.' : ' files selected.'); }); document.getElementById('upload-form').addEventListener('submit', async (event) => { event.preventDefault(); const files = document.getElementById('upload-files').files; if (!files.length) return; try { for (const file of files) { message.textContent = 'Uploading ' + file.name + '...'; const response = await fetch(directory + encodeURIComponent(file.name), { method: 'PUT', body: file, credentials: 'same-origin' }); if (!response.ok) throw new Error(file.name + ': ' + response.status); } location.reload(); } catch (error) { message.textContent = 'Upload failed: ' + error.message; } }); document.querySelectorAll('.delete').forEach((button) => { button.addEventListener('click', async () => { const path = button.dataset.path; if (!confirm('Delete ' + decodeURIComponent(path) + '?')) return; const response = await fetch(path, { method: 'DELETE' }); if (response.ok || response.status === 204) { location.reload(); } else { alert('Delete failed: ' + response.status); } }); });</script>");
    page += F("</ul></main></body></html>");
    if (headersOnly) sendEmptyResponse(client, 200, "OK", "Content-Type: text/html; charset=utf-8\r\n");
    else sendResponse(client, 200, "OK", "text/html; charset=utf-8", page);
    return;
  }

  client.print("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: ");
  client.print(target.size());
  client.print("\r\nContent-Type: ");
  client.print(contentTypeFor(path));
  client.print("\r\n\r\n");

  if (!headersOnly) {
    uint8_t buffer[transferBufferSize];
    while (target.available()) {
      const int bytesRead = target.read(buffer, sizeof(buffer));
      if (bytesRead > 0) client.write(buffer, bytesRead);
    }
  }
  target.close();
}

bool readBodyToFile(WiFiClient& client, File& file, size_t contentLength) {
  uint8_t buffer[transferBufferSize];
  size_t remaining = contentLength;
  const unsigned long started = millis();

  while (remaining > 0) {
    const size_t nextRead = min(remaining, sizeof(buffer));
    int bytesRead = client.read(buffer, nextRead);
    if (bytesRead > 0) {
      file.write(buffer, bytesRead);
      remaining -= bytesRead;
    } else if (!client.connected() || millis() - started > 30000) {
      return false;
    } else {
      delay(1);
    }
  }

  file.flush();
  return true;
}

void handlePut(WiFiClient& client, const HttpRequest& request) {
  if (request.path.isEmpty()) {
    sendResponse(client, 400, "Bad Request", "text/plain", "PUT requires a file path\n");
    return;
  }

  createParentDirectories(request.path);
  const bool existed = storage->exists(storageName(request.path));
  File file = storage->open(storageName(request.path), FILE_WRITE);
  if (!file || file.isDirectory()) {
    if (file) file.close();
    sendResponse(client, 500, "Internal Server Error", "text/plain", "Could not open destination file\n");
    return;
  }

  if (!readBodyToFile(client, file, request.contentLength)) {
    file.close();
    sendResponse(client, 408, "Request Timeout", "text/plain", "Upload timed out\n");
    return;
  }
  file.close();

  logEvent("PUT " + request.path + " " + String(request.contentLength) + "B");
  sendEmptyResponse(client, existed ? 204 : 201, existed ? "No Content" : "Created");
}

void handleMkcol(WiFiClient& client, const HttpRequest& request) {
  if (request.path.isEmpty()) {
    sendResponse(client, 405, "Method Not Allowed", "text/plain", "Root already exists\n");
    return;
  }

  if (storage->exists(storageName(request.path))) {
    sendResponse(client, 405, "Method Not Allowed", "text/plain", "Path already exists\n");
    return;
  }

  createParentDirectories(request.path);
  if (!storage->mkdir(storageName(request.path))) {
    sendResponse(client, 409, "Conflict", "text/plain", "Could not create folder\n");
    return;
  }

  logEvent("MKCOL " + request.path);
  sendEmptyResponse(client, 201, "Created");
}

void handleDelete(WiFiClient& client, const HttpRequest& request) {
  if (!request.isAdmin) {
    sendResponse(client, 403, "Forbidden", "text/plain", "Admin login required to delete files or folders\n");
    return;
  }

  if (request.path.isEmpty()) {
    sendResponse(client, 405, "Method Not Allowed", "text/plain", "Deleting root is disabled\n");
    return;
  }

  if (!storage->exists(storageName(request.path))) {
    sendResponse(client, 404, "Not Found", "text/plain", "Not found\n");
    return;
  }

  if (!deleteRecursive(request.path)) {
    sendResponse(client, 500, "Internal Server Error", "text/plain", "Delete failed\n");
    return;
  }

  logEvent("DELETE " + request.path);
  sendEmptyResponse(client, 204, "No Content");
}

void handleClient(WiFiClient& client) {
  HttpRequest request;
  if (!readRequest(client, request)) return;

  if (isPrivateConfigPath(request.path)) {
    sendResponse(client, 404, "Not Found", "text/plain", "Not found\n");
    return;
  }

  if (!isAuthorized(request)) {
    sendUnauthorized(client);
    return;
  }

  if (request.method == "OPTIONS") handleOptions(client);
  else if (request.method == "PROPFIND") handlePropfind(client, request);
  else if (request.method == "GET") handleGet(client, request, false);
  else if (request.method == "HEAD") handleGet(client, request, true);
  else if (request.method == "PUT") handlePut(client, request);
  else if (request.method == "MKCOL") handleMkcol(client, request);
  else if (request.method == "DELETE") handleDelete(client, request);
  else if (request.method == "LOCK") sendResponse(client, 200, "OK", "application/xml; charset=utf-8", "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:prop xmlns:d=\"DAV:\"><d:lockdiscovery/></d:prop>");
  else if (request.method == "UNLOCK") sendEmptyResponse(client, 204, "No Content");
  else sendResponse(client, 405, "Method Not Allowed", "text/plain", "Method not supported\n", "Allow: OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, LOCK, UNLOCK\r\n");
}

bool loadConfiguration(FS& filesystem) {
  File configFile = filesystem.open(configFilePath, FILE_READ);
  if (!configFile || configFile.isDirectory()) {
    if (configFile) configFile.close();
    logEvent("Missing /config.json on SD");
    return false;
  }

  DynamicJsonDocument document(4096);
  const DeserializationError error = deserializeJson(document, configFile);
  configFile.close();
  if (error) {
    logEvent("Invalid config.json");
    return false;
  }

  const char* configuredSsid = document["wifi"]["ssid"] | "";
  const char* configuredWifiPassword = document["wifi"]["password"] | "";
  const char* configuredAdminUsername = document["admin"]["username"] | "";
  const char* configuredAdminPassword = document["admin"]["password"] | "";
  JsonVariant usersValue = document["users"];
  if (!usersValue.isNull() && !usersValue.is<JsonArray>()) {
    logEvent("Users must be a JSON array");
    return false;
  }
  JsonArray users = usersValue.as<JsonArray>();

  if (!configuredSsid[0] || !configuredWifiPassword[0] ||
      !configuredAdminUsername[0] || !configuredAdminPassword[0] ||
      users.size() > maxUserCount) {
    logEvent("Config fields missing or invalid");
    return false;
  }

  wifiSsid = configuredSsid;
  wifiPassword = configuredWifiPassword;
  adminUsername = configuredAdminUsername;
  adminPassword = configuredAdminPassword;
  userCount = 0;

  for (JsonObject user : users) {
    const char* username = user["username"] | "";
    const char* password = user["password"] | "";
    if (!username[0] || !password[0] || adminUsername == username) {
      logEvent("Invalid user in config.json");
      return false;
    }
    for (uint8_t index = 0; index < userCount; ++index) {
      if (userCredentials[index].username == username) {
        logEvent("Duplicate user in config");
        return false;
      }
    }
    userCredentials[userCount].username = username;
    userCredentials[userCount].password = password;
    ++userCount;
  }

  logEvent("Config loaded; users " + String(userCount));
  return true;
}

bool connectToWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  Serial.print("Connecting to configured Wi-Fi");
  const unsigned long connectionStarted = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - connectionStarted < 20000) {
    delay(500);
    Serial.print('.');
  }

  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    logEvent("Wi-Fi failed: " + String(WiFi.status()));
    return false;
  }

  logEvent("Wi-Fi " + WiFi.localIP().toString());
  serverAddress = WiFi.localIP();
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(backlightPin, OUTPUT);
  digitalWrite(backlightPin, HIGH);
  display.init();
  display.setRotation(1);
  display.fillScreen(TFT_BLACK);
  logEvent("Starting...");

  if (!LittleFS.begin(true)) {
    logEvent("LittleFS mount failed");
    while (true) delay(1000);
  }

  storage = &LittleFS;
  logEvent("Storage: LittleFS fallback");
  if (!SD.begin(sdChipSelectPin)) {
    logEvent("SD card required for config");
    while (true) delay(1000);
  }

  storage = &SD;
  logEvent("Storage: SD card");
  if (!loadConfiguration(SD)) {
    logEvent("Fix config.json and restart");
    while (true) delay(1000);
  }

  if (!connectToWiFi()) {
    WiFi.mode(WIFI_AP);
    WiFi.softAP("CYD-Intranet", "cydupload");
    serverAddress = WiFi.softAPIP();
    logEvent("Setup AP: CYD-Intranet");
    logEvent("AP IP " + WiFi.softAPIP().toString());
  }

  server.begin();
  logEvent("Intranet http://" + serverAddress.toString());
}

void loop() {
  WiFiClient client = server.available();
  if (client) {
    handleClient(client);
    client.stop();
  }
}