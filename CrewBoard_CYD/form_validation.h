#pragma once

#include <stddef.h>
#include <string.h>

namespace form_validation {

inline bool digit(char value) { return value >= '0' && value <= '9'; }
inline bool alphaNumeric(char value) {
  return digit(value) || (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z');
}

inline bool hostname(const char* value) {
  if (!value) return false;
  const size_t length = strlen(value);
  if (!length || length > 15 || !alphaNumeric(value[0]) || !alphaNumeric(value[length - 1])) return false;
  for (size_t i = 1; i + 1 < length; ++i) {
    if (!alphaNumeric(value[i]) && value[i] != '-') return false;
  }
  return true;
}

inline bool date(const char* value, bool yearOptional = false) {
  if (!value) return false;
  const size_t length = strlen(value);
  if (length != 10 && !(yearOptional && length == 5)) return false;
  const size_t offset = length == 10 ? 5 : 0;
  if (offset && (!digit(value[0]) || !digit(value[1]) || !digit(value[2]) || !digit(value[3]) || value[4] != '-')) return false;
  if (!digit(value[offset]) || !digit(value[offset + 1]) || value[offset + 2] != '-' ||
      !digit(value[offset + 3]) || !digit(value[offset + 4])) return false;
  const unsigned year = offset ? (value[0] - '0') * 1000 + (value[1] - '0') * 100 +
    (value[2] - '0') * 10 + value[3] - '0' : 2000;
  const unsigned month = (value[offset] - '0') * 10 + value[offset + 1] - '0';
  const unsigned day = (value[offset + 3] - '0') * 10 + value[offset + 4] - '0';
  if (!year || month < 1 || month > 12 || !day) return false;
  const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
  const unsigned days[] = {31, leap ? 29U : 28U, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  return day <= days[month - 1];
}

inline bool time(const char* value) {
  if (!value || strlen(value) != 5 || !digit(value[0]) || !digit(value[1]) || value[2] != ':' ||
      !digit(value[3]) || !digit(value[4])) return false;
  return (value[0] - '0') * 10 + value[1] - '0' <= 23 &&
    (value[3] - '0') * 10 + value[4] - '0' <= 59;
}

inline bool email(const char* value) {
  if (!value || !value[0]) return false;
  const char* at = strchr(value, '@');
  if (!at || at == value || !at[1] || strchr(at + 1, '@')) return false;
  for (const char* character = value; character < at; ++character) {
    if (!alphaNumeric(*character) && !strchr(".!#$%&'*+/=?^_`{|}~-", *character)) return false;
  }
  const char* label = at + 1;
  for (const char* character = label; ; ++character) {
    if (*character == '.' || *character == '\0') {
      const size_t length = static_cast<size_t>(character - label);
      if (!length || length > 63 || !alphaNumeric(*label) || !alphaNumeric(*(character - 1))) return false;
      if (!*character) return true;
      label = character + 1;
    } else if (!alphaNumeric(*character) && *character != '-') return false;
  }
}

}  // namespace form_validation
