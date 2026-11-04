# PBI: Record errors in an exportable JSON error console

**Type:** Product Backlog Item
**Status:** Proposed
**Area:** CrewBoard web interface / Diagnostics

## User story

As a CrewBoard user, I want errors to be collected in an in-app error console that I can download as a JSON file, so that I can send the file to the CrewBoard maintainers without opening browser developer tools.

As a CrewBoard maintainer, I want error reports in a consistent JSON format, so that I can diagnose problems that happened on a user's phone or computer.

## Business value

Most crew members will never open the browser's developer console, and errors written there are lost when the page closes. Collecting errors in CrewBoard and letting users export them as a file gives maintainers actionable diagnostic information with minimal effort from the user.

## Description

Add a client-side error log to the CrewBoard web interface. CrewBoard records application errors as structured JSON entries in browser storage instead of writing them to the browser console. Users can open an **Error console** from the interface, review the recorded errors, download them as a `.json` file, and clear the log.

The existing user-facing alert behavior remains: when an API request fails, the user still sees the friendly alert message. The error console is an additional diagnostic record, not a replacement for user feedback.

Local logging and JSON download always remain available. As an optional, explicitly enabled feature, an installation may also forward error reports to an operator-configured HTTPS API. This lets maintainers learn about recurring problems without waiting for a user to send a file. Remote reporting is disabled by default; when enabled, queued reports are sent when a network connection is available. The receiving service may notify maintainers, for example by email, but CrewBoard does not send email directly.

Reports are sent from the user's browser to the configured service, not stored on or relayed through the CYD. Users must be told that reports leave their local network when remote reporting is enabled. No reports are sent to a third party automatically.

## Acceptance criteria

1. **Errors captured**
   - Failed CrewBoard API requests handled by `apiError` are recorded, including the failure from initial data loading.
   - Uncaught JavaScript errors (`window` `error` events) and unhandled promise rejections (`unhandledrejection` events) are recorded.
   - CrewBoard application code does not write these errors to the browser console. Third-party/vendor library console output is not in scope.
   - Recording an error never prevents the existing alert, connection-state badge, or other existing error handling from running.

2. **Entry format**
   - Each entry is a JSON object containing at least:
     - `timestamp` — ISO 8601 UTC time the error occurred.
     - `type` — for example `api`, `script`, or `promise`.
     - `message` — the user-facing or error message.
     - `details` — type-specific data, such as HTTP method, API path, HTTP status, and server-provided `error` text for API failures, or source file, line, column, and stack for script errors.
     - `page` — the active tab and CrewBoard path (without query strings or fragments that could contain sensitive data).
     - `userAgent` — the browser user-agent string.
   - Entries are stored in chronological order.

3. **No sensitive data**
   - Entries never contain passwords, `Authorization` headers, credentials, or request bodies.
   - API response bodies are not stored except for the server's `error` message field.
   - Message text, roster details, schedule details, and location data entered by users are not stored as part of an entry.

4. **Bounded storage**
   - The log is kept in `localStorage` under a CrewBoard-specific key such as `crewboard.errorLog`.
   - The log retains a documented maximum number of entries (for example, the most recent 200); older entries are discarded first.
   - If browser storage is unavailable, full, blocked, or contains invalid data, CrewBoard keeps an in-memory log for the current page session and continues working without showing an additional error.

5. **Error console**
   - The interface provides a clearly labeled way to open the error console (for example, a link or button in the footer or navigation bar).
   - The console lists recorded errors newest first, showing time, type, and message, with details available for each entry.
   - The console shows an empty state when no errors are recorded.
   - The console is keyboard accessible and follows the existing modal/dialog accessibility conventions.
   - Optionally, the open control shows a count of recorded errors.

6. **Download as JSON**
   - A **Download** action saves a file named like `crewboard-errors-YYYYMMDD-HHMMSS.json`.
   - The file is valid, pretty-printed JSON containing an export header (export time, CrewBoard origin, user agent, and entry count) and the array of entries.
   - Downloading works on supported mobile and desktop browsers without requiring a network request to the CYD.

7. **Clear log**
   - A **Clear** action removes all recorded entries after the user confirms.
   - Clearing does not affect other CrewBoard browser preferences, such as the remembered active tab.

8. **Optional remote reporting**
   - Remote reporting is off by default and can only be enabled by an installation administrator through documented configuration.
   - The configured destination is an operator-controlled HTTPS endpoint. When remote reporting is enabled, the interface clearly discloses that diagnostic reports will be sent to that destination.
   - Reports are sent from the browser, not through the CYD. The client queues entries while offline and retries later, with bounded queue size, backoff, and protection against repeatedly sending the same acknowledged entry.
   - Reports use a documented, versioned JSON payload based on the export entry format. The client sends only the allowlisted diagnostic fields; it does not send request bodies, credentials, or user-entered content.
   - No shared secret or privileged API credential is embedded in the client. The receiving service applies rate limits, payload-size limits, and duplicate/error aggregation to limit abuse and notification floods.
   - Remote reporting failure does not interrupt CrewBoard, discard the local log, or change existing error handling. Users can still download the JSON file and share it manually.
   - Users can disable remote reporting. Disabling it stops future sends and retries; reports already received by the service cannot be recalled from CrewBoard.
   - Any maintainer email notifications are generated by the receiving service and should be configurable or grouped to avoid one email per error.

## Implementation notes

- Add a small logging module (for example `errorLog.record(type, message, details)`) in `app.js` and route `apiError` through it before calling `showAlert`.
- For API failures, capture `xhr.status`, `xhr.statusText`, the request method, the API path, and `xhr.responseJSON.error` when present. Do not capture request `data` or headers.
- Register `window.addEventListener('error', ...)` and `window.addEventListener('unhandledrejection', ...)` early in initialization so start-up failures are captured.
- Wrap all storage reads/writes in `try`/`catch`; logging failures must be silent and non-fatal, and must not recurse into the logger.
- Generate the download with `Blob` + `URL.createObjectURL` and a temporary `<a download>` element; revoke the object URL afterward.
- Include a `schemaVersion` field in the export header so the format can evolve.
- Browser storage is scoped to the page origin; opening CrewBoard by a different IP address, hostname, protocol, or port uses a separate log. Document this.
- Keep remote-reporting configuration out of user-controlled error data. Document the endpoint payload, acknowledgment behavior, and configuration mechanism for the receiving service.
- Because installations may use different local IP addresses or hostnames, the configured HTTPS service must explicitly support the required browser cross-origin requests. Validate that behavior on representative phones and desktop browsers.

## Out of scope

- Sending reports through the CYD or sending email directly from the browser.
- Automatically enabling remote reporting, or sending reports to an operator or third-party service without the installation administrator enabling it.
- Storing logs on the CYD or SD card, or aggregating logs from multiple users or devices.
- Capturing firmware/CYD serial-console errors.
- Capturing console output from vendor libraries (jQuery, Bootstrap, map libraries).
- Changing the wording or behavior of existing user-facing alerts.
- Performance monitoring, analytics, or usage tracking.
- Building a general-purpose hosted error-monitoring product; the receiving endpoint is operator-controlled.

## Definition of done

- API failures, uncaught script errors, and unhandled promise rejections appear in the error console and in the downloaded JSON.
- CrewBoard application code no longer writes these errors to the browser console.
- A downloaded file is verified to be valid JSON and to contain no passwords, authorization data, or request bodies.
- Entry limit, clear action, and unavailable/full storage fallback are tested.
- Remote reporting is verified disabled by default; when enabled, HTTPS delivery, offline queuing/retry, acknowledgment, disabling, and endpoint failure behavior are tested.
- The receiving service's rate limiting, payload limits, deduplication/grouping, and maintainer notification behavior are documented and verified.
- Existing alerts, data loading, and editing workflows continue to work.
- User documentation explains how to open the error console, download the file, and send it to the maintainers, and how remote reporting is configured and disclosed when enabled.
