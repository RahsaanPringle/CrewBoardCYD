# CrewBoard form-field inventory

This inventory covers the deployable SD-card interface and the working-copy
interface. Both use the same generated record editor. The theme selector is
the only other input control. Authentication uses the browser's HTTP Basic
prompt; there is no in-page self-login, password-change, geocoding, or support
form in this version.

The default form autocomplete setting is `off`. The tokens below are explicit
exceptions or deliberate per-field settings. Where no input mode is listed,
the browser's default for the control type is used. HTML `maxlength` counts
UTF-16 code units; the CYD enforces the corresponding maximum in UTF-8 bytes.
Empty optional values are allowed. Client validation helps users but does not
replace the firmware's checks.

## Roster, owner-managed account, and self-profile

Self-profile contains only the five contact fields marked below. The owner
editor can change all fields. Contact autofill is enabled only for the signed-in
employee's own phone and email; it is deliberately disabled for owner-managed
employee records and for another person's emergency contact.

| Field and meaning | Stored representation | Required | Max | Control; autocomplete / input mode | Constraints |
| --- | --- | --- | --- | --- | --- |
| Display name (`name`) | Roster string | Yes | 60 | `text`; `off` / default | Nonblank; single line |
| Business role (`role`) | Roster string | No | 40 | Single `select`; form default / default | No role or one of the defined business roles |
| Phone (`phone`), self-profile | Roster string | No | 30 | `tel`; `tel` for self, otherwise `off` / default | International prefixes and formatting allowed |
| Email (`email`), self-profile | Roster string | No | 100 | `email`; `email` for self, otherwise `off` / default | Browser email syntax; no case normalization |
| Birthday (`birthday`), self-profile | Roster string `MM-DD` or `YYYY-MM-DD` | No | 10 | `text`; `off` / `text` | Pattern and calendar-valid month/day; see birthday decision |
| Emergency contact name (`emergencyContactName`), self-profile | Roster string | No | 80 | `text`; `off` / default | Single line; another person's name is not autofilled |
| Emergency contact phone (`emergencyContactPhone`), self-profile | Roster string | No | 30 | `tel`; `off` / default | International prefixes and formatting allowed |
| Roster notes (`notes`) | Roster string | No | 300 | `textarea`; form default / default | Multiline |
| Employee username (`username`) | Roster and protected account configuration strings | No | 40 | `text`; `off` / default | No colon; owner-managed, not the current user's autofill identity |
| New or replacement password | Protected account configuration string, never a roster field or API response | New username only | 100 | `password`; `new-password` / default | Nonempty for a new account; blank keeps an existing password; no password `value` attribute |
| Active employee (`active`) | Roster boolean | Yes | N/A | Checkbox; form default / default | Checked means active; new employees default to active |

### Birthday decision

The year remains optional. A native `date` input cannot represent `MM-DD`, so
the text control accepts exactly two-digit month and day, optionally preceded
by a four-digit year: for example, `02-29` or `2000-02-29`. Month and day must
form a real calendar date; without a year, February 29 is allowed. With a
year, the usual leap-year rules apply, and year `0000` is rejected. The help
text and validation message describe the format. `inputmode="text"` keeps the
hyphen available on keyboards that do not include it on a numeric keypad.

Both supported existing representations are shown and saved unchanged. No
birth year is inferred or added, and there is no migration or new disclosure of
birth years.

## Business locations

The address autocomplete section is `section-jobsite`; it is intended for
business job sites, not employee home addresses. Postal codes are text so
leading zeroes, spaces, and letters survive.

| Field and meaning | Stored representation | Required | Max | Control; autocomplete / input mode | Constraints |
| --- | --- | --- | --- | --- | --- |
| Location name (`name`) | Location string | Yes | 80 | `text`; form default / default | Nonblank |
| Street (`address`) | Location string | Yes | 120 | `text`; `section-jobsite street-address` / default | Nonblank |
| City (`city`) | Location string | Yes | 60 | `text`; `section-jobsite address-level2` / default | Nonblank |
| State or region (`region`) | Location string | No | 30 | `text`; `section-jobsite address-level1` / default | Single line |
| Postal code (`postalCode`) | Location string | No | 16 | `text`; `section-jobsite postal-code` / default | No numeric-only restriction |
| Latitude (`latitude`) | JSON number, decimal degrees | Yes | N/A | `number`; form default / `decimal` | -90 to 90; `step="any"` |
| Longitude (`longitude`) | JSON number, decimal degrees | Yes | N/A | `number`; form default / `decimal` | -180 to 180; `step="any"` |

Each coordinate has a labeled `+/-` button. Some mobile decimal keyboards do
not include a minus key, so the button changes the sign after a number has
been entered, without changing numeric validation or converting an empty
field to zero. A future geocoding feature must populate these same controls
and use the normal server validation.

## Schedule

Dates and times are stored as strings, not timezone-converted JavaScript dates.
The browser may localize their display, but saved values use `YYYY-MM-DD` and
24-hour `HH:MM`. An optional end time can be empty; overnight jobs are not
supported, so a present end time cannot precede the start time.

| Field and meaning | Stored representation | Required | Max | Control; autocomplete / input mode | Constraints |
| --- | --- | --- | --- | --- | --- |
| Job title (`title`) | Schedule string | Yes | 80 | `text`; form default / default | Nonblank; single line |
| Job date (`date`) | Schedule `YYYY-MM-DD` string | Yes | 10 | `date`; form default / default | Calendar date, years 0001-9999 |
| Start time (`startTime`) | Schedule `HH:MM` string | Yes | 5 | `time`; form default / default | Minute precision, 00:00-23:59 |
| End time (`endTime`) | Schedule `HH:MM` string | No | 5 | `time`; form default / default | Minute precision; at or after start |
| Business location (`locationId`) | Location ID string | Yes | 64 | Single `select`; form default / default | Empty prompt or an available location |
| Assigned crew (`crewIds`) | Array of employee ID strings | No | 12 selections | Multiple `select`, size 5; form default / default | Available active employees and previously assigned employees; keyboard guidance is associated with the control |
| Practical job notes (`notes`) | Schedule string | No | 500 | `textarea`; form default / default | Multiline |

## Messages and replies

| Field and meaning | Stored representation | Required | Max | Control; autocomplete / input mode | Constraints |
| --- | --- | --- | --- | --- | --- |
| Post title (`title`) | Message string | Yes for a post; absent from reply editor | 80 | `text`; form default / default | Nonblank; single line |
| Post or reply body (`body`) | Message string | Yes | 1000 | `textarea`; form default / default | Nonblank; multiline |
| Expiry (`expiresAt`) | Message `YYYY-MM-DD` string | No; owner post editor only | 10 | `date`; form default / default | Calendar date, years 0001-9999 |

The author, parent ID, and posting timestamp are assigned by the existing
application/server flow; they are not user-editable controls.

## Other control

| Field and meaning | Stored representation | Required | Max | Control; autocomplete / input mode | Constraints |
| --- | --- | --- | --- | --- | --- |
| Theme | Browser-local `crewboard.theme` choice, or site default | No | Theme filenames up to 64 characters | Single `select` with visible label; default / default | Options come from the available local themes; not a record field |

## Bootstrap and accessibility pattern

Persistent visible labels are clearer than floating labels for these short
forms, especially once fields contain values or errors. Standard fields use
`form-label` and `form-control`; selects use `form-select`; checkboxes use
`form-check`, `form-check-input`, and `form-check-label`. The schedule's
list/calendar controls remain a button group with `aria-pressed`. The only new
input groups are the coordinate controls, where the sign button serves a
real mobile-keyboard need.

Representative reusable markup:

```html
<div class="mb-3">
  <label class="form-label" for="example">Example (optional)</label>
  <input id="example" name="example" class="form-control is-invalid"
         aria-invalid="true" aria-describedby="example-help example-error">
  <div id="example-error" class="invalid-feedback">Enter a valid value.</div>
  <div id="example-help" class="form-text">Optional guidance.</div>
</div>
<div class="mb-3">
  <label class="form-label" for="choice">Choice</label>
  <select id="choice" name="choice" class="form-select"><option value="">No choice</option></select>
</div>
<div class="form-check">
  <input id="enabled" name="enabled" type="checkbox" class="form-check-input">
  <label class="form-check-label" for="enabled">Enabled</label>
</div>
<div class="mb-3">
  <label class="form-label" for="notes">Notes (optional)</label>
  <textarea id="notes" name="notes" class="form-control" maxlength="300"></textarea>
</div>
```

In the editor, invalid feedback and `aria-invalid` are added only after a
control fails native validation and are removed once corrected. Existing help
IDs remain in `aria-describedby`; untouched optional fields are not marked
valid or invalid. Responsive Bootstrap rows stack on small screens, and the
modal uses scrollable, fullscreen-on-small-screen layout.

## Compatibility and verification

Unchanged missing, null, formatted, and numeric values are retained when a
record is saved. The firmware and local development server reject newly
introduced invalid email, birthday, date, time, ordering, and coordinate
values. Previously saved noncanonical values are allowed to remain unchanged
when another record is saved. A noncanonical date or time being edited is
shown as text with correction guidance instead of silently appearing blank.
The firmware loads the previous collection only when needed for a legacy
comparison, and at most once per validation.

Automated tests cover both web copies, native-control metadata, leap dates,
legacy values, direct local-API rejection, and the portable firmware format
checks. Desktop Chromium and a narrow mobile-sized viewport were exercised.
Actual Android and iPhone keyboards, native pickers, autofill behavior, and
the assigned-crew picker still require checks on representative devices; a
viewport simulation cannot verify those OS features. Firmware was compiled
for ESP32, but direct API behavior and resource use should also be checked on
physical CYD hardware before deployment.

### Remaining device checks

Use test records and a non-production SD card:

1. On Android Chrome and iPhone Safari, check the phone, email, date, time,
   birthday, postal-code, and coordinate controls. Confirm keyboard and picker
   behavior, autofill intent, validation messages, sign buttons, and modal
   scrolling while the keyboard is open.
2. Check assigned-crew multi-select with touch and keyboard. If it is unusable
   on a target phone, record a separate usability issue.
3. On the CYD, save and reopen representative roster, location, schedule,
   message, and reply records. Check unchanged values, both birthday formats,
   optional end times, international phone numbers, and postal codes.
4. Send invalid date, time, email, birthday, ordering, and coordinate values
   directly to the applicable APIs. Confirm rejection without file changes,
   and confirm existing noncanonical values can remain unchanged when another
   record is saved. Check responsiveness with multiple such legacy records.
