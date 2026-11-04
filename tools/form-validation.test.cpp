#include "../CrewBoard_CYD/form_validation.h"
#include <cassert>

int main() {
  using namespace form_validation;
  assert(date("02-29", true));
  assert(date("2000-02-29", true));
  assert(date("2024-02-29"));
  assert(!date("02-29"));
  assert(!date("02-30", true));
  assert(!date("1900-02-29", true));
  assert(!date("2023-02-29"));
  assert(!date("0000-01-01"));
  assert(!date("2024-13-01"));
  assert(!date(nullptr));
  assert(time("00:00"));
  assert(time("23:59"));
  assert(!time("24:00"));
  assert(!time("12:60"));
  assert(!time("9:00"));
  assert(email("A+shift@crew.example"));
  assert(email("a@b"));
  assert(!email("not-an-address"));
  assert(!email("a@-example.com"));
  assert(!email("a@x..com"));
  assert(!email("a b@x"));
  assert(!email("a@b@c"));
  return 0;
}
