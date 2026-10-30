# PBI: Use semantic, data-specific form controls

**Type:** Product Backlog Item
**Status:** Proposed
**Area:** CrewBoard web interface / Forms and data quality

## User story

As a CrewBoard user, I want each form field to use the control appropriate to its data, so that my phone or computer can show the right keyboard, picker, autocomplete suggestions, and validation while I enter information.

## Business value

Semantic form controls reduce typing effort and invalid data, especially on phones used in the field. They also improve accessibility, browser autofill, and consistency without adding a JavaScript form framework or increasing load on the CYD.

## Description

Audit every CrewBoard form and assign the most appropriate native HTML element, input type, autocomplete token, input mode, validation attributes, and accessible label for the data being collected.

Apply the locally bundled Bootstrap 5.3.3 form styles consistently to those native controls. Bootstrap should improve layout, visual hierarchy, focus states, help text, and validation feedback without replacing the semantic HTML behavior supplied by the browser.

Examples include:

- Dates use `input type="date"` when the stored value represents a complete calendar date.
- Times use `input type="time"`.
- Phone numbers use `input type="tel"`.
- Email addresses use `input type="email"`.
- Numeric coordinates use `input type="number"` with appropriate ranges and decimal steps.
- Passwords use `input type="password"` and the correct current/new-password autocomplete intent.
- Boolean values use checkboxes.
- Fixed single choices use selects or appropriate radio controls.
- Long free-form content uses textareas.

CrewBoard already uses several of these types. This work must preserve correct existing controls, fix inconsistent fields, and add useful metadata rather than changing inputs solely for the sake of touching every form.

## Current-state observations

- Primary and emergency phone fields already use `tel`.
- Email already uses `email`.
- Schedule date, message expiry date, and schedule times already use `date` and `time`.
- Latitude and longitude already use bounded numeric controls.
- Password fields already use `password`.
- Birthday currently uses a text field and accepts either `MM-DD` or `YYYY-MM-DD`; this requires an explicit product and compatibility decision before conversion to a native date input.

## Acceptance criteria

1. **Complete field inventory**
   - Inventory every input, textarea, select, checkbox, and dynamically generated form control in the CrewBoard web interface.
   - For each field, document its meaning, current stored representation, required/optional status, maximum length, chosen HTML control, input type, autocomplete token, input mode, and validation constraints.
   - Include roster, account, self-profile, location, schedule, message, reply, password-change, geocoding, and support forms that exist when this PBI is implemented.

2. **Contact and identity fields**
   - Phone and emergency-contact phone use `type="tel"` with `autocomplete="tel"` where autofill is appropriate.
   - Email uses `type="email"` with `autocomplete="email"` and retains the existing length limit.
   - Person-name fields use meaningful autocomplete tokens such as `name` only where browser autofill would help rather than overwrite another person's roster data unexpectedly.
   - Usernames use text inputs with `autocomplete="username"` for the signed-in user's own credential flow and an intentional non-autofill treatment in owner-managed employee forms.
   - Browsers are not asked to autocomplete one employee's personal values into another employee's record.

3. **Dates and times**
   - Full calendar dates use `type="date"` and are stored as canonical `YYYY-MM-DD` strings.
   - Times use `type="time"` and retain the documented 24-hour `HH:MM` storage representation regardless of the browser's localized display.
   - Date and time controls remain usable with keyboard input and native mobile pickers.
   - Empty optional dates and times remain empty rather than being converted to invalid dates, zeroes, or the current date.
   - Reasonable ordering validation remains in place where applicable, such as an end time not preceding a start time unless an overnight-job rule is explicitly supported.

4. **Birthday decision and compatibility**
   - Decide whether CrewBoard requires a full birth date or continues allowing month and day without a year.
   - If a full birth date is required, use `type="date"`, document the privacy and migration implications, and safely migrate or explicitly flag existing `MM-DD` values rather than allowing the browser to display them as blank.
   - If the year remains optional, retain a control capable of representing `MM-DD` and define a clear input pattern, input mode, example, parsing rule, and validation message; document why a native date input is not suitable.
   - Existing valid birthday values survive editing and saving without silent loss or reinterpretation.

5. **Address and location fields**
   - Street, city, state/region, and postal-code fields use appropriate address autocomplete tokens such as `street-address`, `address-level2`, `address-level1`, and `postal-code` when autofill is beneficial.
   - Postal codes remain text rather than numeric so leading zeroes, spaces, and letters are preserved.
   - Latitude uses `type="number"`, `min="-90"`, `max="90"`, and a decimal step; longitude uses equivalent bounds of -180 to 180.
   - Numeric fields use a decimal-friendly input mode where it improves mobile behavior without changing browser validation.
   - The address-geocoding PBI can populate the same validated latitude and longitude controls without bypassing server validation.

6. **Credentials and account fields**
   - Existing-password confirmation uses `autocomplete="current-password"`.
   - New and temporary passwords use `autocomplete="new-password"`.
   - Password values are never placed in an HTML `value` attribute when editing an existing account.
   - Password controls retain the selected minimum and maximum length rules from the account-management PBI.
   - Semantic input changes do not cause credentials to be stored in browser storage or returned by an API.

7. **Selection and free-text controls**
   - Fixed single-choice fields, including business role and access profile, use selects or radio controls with a clearly labeled unselected state when optional.
   - Boolean fields, including active status and opt-in diagnostic inclusion, use checkboxes with labels that describe the checked state.
   - Notes, messages, replies, support descriptions, and other multiline content use textareas with suitable maximum lengths.
   - Single-line titles, names, and subjects remain text inputs and do not accept line breaks.
   - Multi-select controls remain keyboard and touch accessible; if the current assigned-crew multi-select is not usable on target phones, record a separate usability issue rather than expanding this PBI without review.

8. **Native validation and error presentation**
   - Required fields use the `required` attribute in addition to firmware validation.
   - Length, numeric range, step, and format constraints are expressed through native attributes where supported.
   - Invalid fields prevent ordinary form submission and receive a clear, field-specific message or native browser validation prompt.
   - Optional fields do not fail validation when empty.
   - The first invalid field can be focused and identified by assistive technology.
   - Client validation is treated as usability assistance; the ESP32 firmware remains authoritative for all saved data.

9. **Accessibility and mobile behavior**
   - Every control has a visible label programmatically associated through matching `for` and `id` values.
   - Help and error text is associated with its control when it provides necessary instructions.
   - Input types and modes produce appropriate keyboards on representative Android and iPhone browsers.
   - Date and time pickers, selects, and checkboxes remain operable by keyboard on desktop.
   - Controls do not rely on placeholder text as their only label or instruction.

10. **Bootstrap styling and feedback**
   - Text-like inputs, including `text`, `tel`, `email`, `date`, `time`, `number`, and `password`, use Bootstrap's `form-control` styling unless a documented control requires another treatment.
   - Single and multiple selects use `form-select` with a size and responsive layout appropriate to their content.
   - Checkboxes and radio controls use `form-check`, `form-check-input`, and `form-check-label` with the entire label remaining easy to select on touch devices.
   - Visible labels use `form-label`; optional guidance uses `form-text`; validation messages use `invalid-feedback` or another accessible Bootstrap pattern.
   - Required and invalid controls receive consistent Bootstrap validation presentation using `:invalid`, `.was-validated`, `is-invalid`, or the smallest appropriate combination.
   - Valid styling is not shown merely because an untouched optional field is empty, and forms do not become visually noisy with unnecessary success indicators.
   - Input groups are used only when a visible prefix, suffix, or unit materially helps, and their accessible labels remain intact.
   - Responsive Bootstrap rows and columns keep related fields together on wider screens and stack them in a sensible order on phones.
   - Modal forms remain scrollable, focused, and usable when native date/time pickers or mobile keyboards are open.
   - Bootstrap styling does not hide native picker affordances, reduce browser autofill usability, or override accessible focus indicators without an equivalent replacement.
   - New styling uses the existing local Bootstrap asset and adds no CDN or new front-end dependency.

11. **Bootstrap component evaluation**
   - Evaluate whether floating labels improve or reduce clarity for CrewBoard's short forms; do not adopt them merely for visual novelty.
   - Evaluate Bootstrap input groups for coordinate units, support diagnostics, or other fields only where the grouping communicates meaning.
   - Evaluate button groups, switches, and checks for boolean or view-selection controls while preserving correct native semantics.
   - Record a small reusable markup pattern for standard fields, optional fields, invalid feedback, selects, checkboxes, and textareas.
   - Keep dynamically generated controls visually consistent with controls written directly in `index.html`.

12. **Data compatibility**
   - Existing JSON field names and API shapes remain unchanged unless a separate migration is explicitly approved.
   - Native controls display all currently valid stored values correctly.
   - Opening and saving an unchanged record does not alter dates, times, phone numbers, postal codes, coordinates, or optional values.
   - Phone inputs do not impose a North America-only numeric pattern; formatting and international prefixes remain possible within the documented length.
   - Email normalization does not silently change the address supplied by the user beyond intentional trimming.

## Suggested field mapping

| Data | Preferred control | Important attributes or notes |
| --- | --- | --- |
| Display or contact name | `text` | `form-control`; appropriate length; use autocomplete selectively |
| Phone number | `tel` | `form-control`; `autocomplete="tel"`; allow international formatting |
| Email address | `email` | `form-control`; `autocomplete="email"` |
| Complete date | `date` | `form-control`; store `YYYY-MM-DD` |
| Time | `time` | `form-control`; store `HH:MM` |
| Birthday without required year | Decision required | Bootstrap-styled chosen control; do not force into `date` without migration |
| Latitude/longitude | `number` | `form-control`; decimal step and geographic bounds |
| Postal code | `text` | `form-control`; `autocomplete="postal-code"`; preserve leading zeroes |
| Username | `text` | `form-control`; autocomplete depends on self-login versus owner editing |
| Current password | `password` | `form-control`; `autocomplete="current-password"` |
| New password | `password` | `form-control`; `autocomplete="new-password"` |
| Active/opt-in state | `checkbox` | `form-check-input`; label describes checked state |
| Role/access profile | `select` or radios | `form-select` or `form-check`; fixed valid choices |
| Notes/message body | `textarea` | `form-control`; required state and maximum length as applicable |

## Implementation notes

- Extend the existing field helper so autocomplete, input mode, described-by IDs, patterns, and other attributes can be supplied consistently without unsafe string construction.
- Continue escaping all values inserted into generated HTML attributes or text content.
- Prefer native controls and constraint validation over adding another client library.
- Reuse Bootstrap 5.3.3 utilities and components already stored under `/crewboard/www/vendor`; avoid duplicating Bootstrap behavior in custom CSS.
- Keep project-specific CSS limited to layout or usability needs that Bootstrap does not address, and verify those rules in both narrow and wide layouts.
- Treat browser display localization separately from stored JSON formats.
- Test legacy values before changing a field type; browsers may render an incompatible value as an empty control even when the original string still exists in memory.
- Coordinate this work with the mandatory-username/password, address-geocoding, support-intake, and role-based-abilities PBIs so newly introduced fields follow the same conventions.

## Out of scope

- Replacing Bootstrap or jQuery.
- Building a general-purpose schema-driven form framework.
- Reformatting or validating phone numbers through an external service.
- Email verification, confirmation messages, or deliverability checks.
- Address verification beyond the separate geocoding PBI.
- Changing data solely to match the browser's localized presentation.
- Redesigning the assigned-crew selection interaction unless separately approved.

## Definition of done

- The form-field inventory and selected mapping are documented.
- Every CrewBoard form uses the approved semantic control, type, autocomplete intent, input mode, and constraints.
- Every form uses the approved Bootstrap field, selection, help-text, and validation patterns consistently with no new external dependency.
- Birthday compatibility is explicitly resolved and tested with both supported stored formats or an approved migration.
- Representative forms are tested on desktop and mobile for keyboard choice, pickers, autofill behavior, native and Bootstrap validation presentation, responsive layout, and accessibility.
- Existing valid records can be opened and saved without unintended data changes.
- Firmware validation continues to reject invalid direct API requests regardless of browser controls.

