# PBI: Open Schedule in Calendar and drill into a date list

**Type:** Product Backlog Item
**Status:** Proposed
**Area:** CrewBoard web interface / Schedule

## User story

As a CrewBoard user, I want the Schedule tab to open with the calendar, so that I can understand the month at a glance.

As a CrewBoard user, I want selecting a calendar date to open a list of jobs for that date, so that I can move naturally from the monthly overview into the day's work.

## Business value

A calendar-first schedule better matches how owners and crews think about upcoming work. A date-specific list removes unrelated jobs from the detail view and makes the selected day's assignments easier to scan on a phone.

## Current behavior

- Schedule initially opens in List view.
- The current List contains all jobs sorted by date and time.
- Calendar is an optional secondary view.
- Selecting a calendar date leaves Calendar visible and renders that date's jobs below the month grid.

## Desired behavior

- Schedule initially opens in Calendar view.
- Selecting any calendar date changes Schedule to List view.
- The List shows only jobs whose date matches the selected date.
- The selected date is displayed clearly above the list.
- Returning to Calendar preserves the selected date and shows the month containing that date.

## Acceptance criteria

1. **Calendar is the initial schedule view**
   - On a fresh CrewBoard page load, Schedule initializes with `scheduleView` set to Calendar.
   - The Calendar button is visually active and has the correct `aria-pressed` state before and after schedule data loads.
   - The List button is inactive until the user chooses it directly or selects a calendar date.
   - The initial calendar month is the user's current local month.
   - Today's date is visually distinguished without implying that the user deliberately selected it.

2. **Select a date and switch views**
   - Every date cell in the current calendar month is an accessible button.
   - Selecting a date stores its canonical local `YYYY-MM-DD` value as the selected schedule date.
   - The Schedule view immediately changes from Calendar to List.
   - The selected date receives a clear list heading using the user's localized date format.
   - The view buttons update their active styling and `aria-pressed` values consistently.

3. **Date-filtered list**
   - List view shows only jobs whose stored `date` exactly matches the selected date.
   - Jobs for the selected day are sorted by start time and then by a stable secondary value such as title or ID.
   - Jobs on earlier, later, or invalid dates are not displayed in the selected-date list.
   - Each job card continues to show time, location, assigned crew, notes, and authorized actions.
   - Editing, deleting, or adding a job refreshes the filtered list without exposing jobs from another date.

4. **Empty dates**
   - Selecting a date with no jobs still switches to List view.
   - The empty state names the selected date and clearly states that no jobs are scheduled for it.
   - Authorized users can start adding a job from the empty date view.
   - A new job opened from a selected-date list has that date prefilled even though the current view is List rather than Calendar.

5. **Return to Calendar**
   - Selecting the Calendar view button returns to the calendar without clearing the selected date.
   - The calendar opens to the month containing the selected date, even if it is not the current month.
   - The selected date is visually distinct from Today when they are different.
   - Selecting another date replaces the previous selection and opens the new date's filtered List.

6. **Direct List selection**
   - Define and document the result of selecting List before the user has deliberately chosen a date.
   - The preferred behavior is to use today's local date and show a clearly labeled list for Today.
   - Direct List selection must never fall back silently to the previous all-jobs behavior.
   - If an all-jobs or upcoming-jobs view remains desirable, it must be labeled separately and must not be conflated with the selected-date List.

7. **Month navigation**
   - Previous and Next change the displayed calendar month without switching to List.
   - Changing the displayed month does not silently change the selected date.
   - Today returns the calendar to the current local month and identifies Today consistently.
   - Decide whether the Today control merely navigates to the current month or also selects today; its label and behavior must agree.
   - Selecting a date after month navigation opens that date's List and preserves the containing month for the return path.

8. **Calendar content**
   - Calendar cells continue to indicate the number of jobs on each date.
   - Desktop-sized calendars may continue showing short job chips where space permits.
   - The selected day's full job-card list is removed from below the calendar because date selection now navigates to List.
   - Calendar rendering remains usable on narrow screens without horizontal overflow or unreadably small targets.

9. **Accessibility and focus**
   - Each date button announces the full localized date and number of scheduled jobs.
   - The selected date uses an accessible selected/current-state treatment in addition to color.
   - After selecting a date, keyboard and assistive-technology users receive clear context that List view is now active and which date is displayed.
   - Focus moves to a sensible List heading or remains managed in a way that does not strand the user on a removed calendar element.
   - Returning to Calendar restores focus to the selected date when practical.

10. **Date correctness**
   - Date selection, Today, month boundaries, and filtering use the viewer's local calendar date without UTC conversion shifting the day.
   - Leap days, months with different lengths, year transitions, and daylight-saving boundaries are tested.
   - Stored schedule dates remain canonical `YYYY-MM-DD` values and the API/data-file shape does not change.
   - Display formatting may be localized, but comparisons use canonical date keys.

11. **Interaction with other navigation persistence**
   - The separate last-active-primary-tab PBI may restore Schedule as the active primary tab; when it does, Schedule still follows the calendar-first initialization behavior on a fresh page load.
   - This PBI does not persist Calendar versus List across page closes unless a later product decision explicitly requests it.
   - Moving temporarily to Messages, Roster, or Locations within the same loaded page does not unexpectedly reset the selected schedule date or view.

## Implementation notes

- Change the initial `state.scheduleView` from `list` to `calendar` and align the initial Bootstrap button classes and `aria-pressed` values in `index.html` so the static markup does not flash the wrong state.
- Separate rendering of the monthly grid from rendering of the selected-date list. Do not continue rendering full selected-day job cards below the calendar.
- Filter `sortedJobs()` or a derived list by exact `job.date === state.selectedDay` before generating List cards.
- Preserve `calendarMonth` when drilling into List and restore the month containing `selectedDay` when returning to Calendar.
- Update the Add Job default-date logic to use the selected date in date-filtered List view as well as Calendar view.
- Use a dedicated List heading element that can receive focus programmatically after calendar drill-down.
- Avoid parsing a `YYYY-MM-DD` string as a UTC instant when only a local calendar date is needed.

## Out of scope

- Persisting the schedule subview across browser restarts.
- Showing multiple days or a week in List view.
- Dragging jobs between calendar dates.
- Inline job editing inside calendar cells.
- Recurring jobs, routing, travel time, or crew availability.
- Redesigning schedule permissions or adding job-status workflows.
- Removing the option to return to Calendar.

## Definition of done

- A fresh page load shows Calendar as the active Schedule view without a List-view flash.
- Selecting a populated date opens a correctly sorted List containing only that date's jobs.
- Selecting an empty date opens a clearly labeled empty List and prefills that date when adding a job.
- Returning to Calendar preserves and highlights the selected date in the correct month.
- Direct List selection, month navigation, Today, leap day, year transition, and local-date behavior are tested.
- Keyboard, screen-reader, phone, and desktop interactions are verified.
- Add, edit, and delete operations keep the selected-date List correctly filtered.

