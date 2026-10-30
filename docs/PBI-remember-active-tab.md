# PBI: Reopen CrewBoard on the last active tab

**Type:** Product Backlog Item
**Status:** Proposed
**Area:** CrewBoard web interface / Navigation

## User story

As a CrewBoard user, I want the application to remember the tab I was using when I closed or left the page, so that I return to the same part of CrewBoard the next time I open it.

## Business value

Crew members often return to the same area repeatedly, especially the message board or schedule. Restoring the last active tab removes an unnecessary navigation step and makes CrewBoard feel more consistent with an installed application.

## Description

Remember the most recently displayed primary navigation tab in the browser. When the user opens CrewBoard again from the same browser and address, activate that tab after the page loads.

For example, if the user leaves CrewBoard while the **Messages** tab is active, the **Messages** tab should be active the next time that browser opens CrewBoard.

The preference is local to the browser and must not be written to the CYD, the SD card, a roster record, or another user's account. No sensitive or tab-content data should be stored.

## Acceptance criteria

1. **Remember the active tab**
   - When a primary tab finishes becoming active, CrewBoard stores that tab's stable identifier in browser storage.
   - Schedule, Messages, Roster, and Locations can each be remembered.
   - Only the tab identifier is stored; message, roster, schedule, location, authentication, and form data are not stored as part of this feature.

2. **Restore the tab on a later visit**
   - Closing and reopening the page in the same browser and at the same CrewBoard origin restores the last active tab.
   - Refreshing the page also restores the last active tab.
   - If Messages was the last active tab, Messages is displayed instead of the default Schedule tab.
   - The restored tab has the same active button, visible pane, and accessibility state that it would have after the user selected it normally.

3. **Safe fallback behavior**
   - If there is no saved preference, CrewBoard opens on Schedule as it does today.
   - If the saved identifier is missing, invalid, or no longer matches an available tab, CrewBoard ignores it and opens on Schedule.
   - If browser storage is unavailable, blocked, or throws an error, CrewBoard continues loading normally on Schedule without displaying an application error.

4. **Existing tab behavior**
   - Manually selecting any tab still works normally.
   - Restoring Locations triggers the same location-map rendering behavior as manually selecting Locations.
   - Tab persistence does not delay or prevent the existing API requests, authentication prompt, record rendering, or editor actions.

5. **Browser scope**
   - The preference remains local to the browser profile and is not synchronized between phones or computers.
   - Documentation or implementation comments note that browser storage is scoped to the page origin. Opening CrewBoard by a different IP address, hostname, protocol, or port may use a separate saved preference.

## Implementation notes

- Use `localStorage`, because the preference must survive closing the page or browser. `sessionStorage` is not sufficient.
- Use a CrewBoard-specific key such as `crewboard.activeTab`.
- Store the existing Bootstrap tab target (for example, `#messages-pane`) or another stable tab identifier rather than a visible label.
- Listen to Bootstrap's `shown.bs.tab` event on the primary tab controls so the stored value reflects the tab that actually became active.
- During page initialization, find a matching `#section-tabs button[data-bs-target]` element and activate it through Bootstrap's Tab API. Do not reproduce Bootstrap's active-class and accessibility logic manually.
- Wrap browser-storage reads and writes in safe error handling. Storage failures are non-fatal.
- Keep Schedule marked as the HTML default so the interface remains usable before JavaScript initialization and whenever restoration cannot be performed.
- When restoring Locations, ensure the existing `shown.bs.tab` handler still invokes `renderLocationMap`.

## Out of scope

- Remembering the active tab across different browsers, devices, hostnames, or IP addresses.
- Saving the preference on the CYD or associating it with a CrewBoard login.
- Restoring modal dialogs, partially completed forms, selected calendar dates, list/calendar view, scroll position, expanded replies, or map position.
- Changing authentication, authorization, API responses, or data-file formats.
- Adding browser history entries or URL routing for tab changes.

## Definition of done

- The last active primary tab is restored after both a refresh and a close/reopen test in a supported browser.
- Messages and Locations are specifically tested, including successful map rendering when Locations is restored.
- Missing, invalid, and unavailable browser storage fall back to Schedule without breaking page initialization.
- Existing tab navigation and CrewBoard data-loading behavior continue to work.

