# PBI: Make the Add Employee modal accessible and scrollable

**Type:** Product Backlog Item
**Status:** Proposed
**Area:** CrewBoard web interface / Roster and accessibility

## User story

As a CrewBoard owner using a phone, tablet, or smaller computer screen, I want to reach every field and action in the Add Employee modal, so that I can complete or cancel employee entry without controls being clipped below the viewport.

As a keyboard or assistive-technology user, I want the modal to announce its purpose, keep focus in the dialog, and provide a logical path through every control, so that I can manage employees without relying on a mouse or touch gestures.

## Business value

The employee editor is one of CrewBoard's longest forms and is required for roster and account setup. Making it reliably scrollable prevents abandoned or incomplete employee records and establishes a reusable accessible modal pattern for the rest of CrewBoard.

## Problem statement

The current Add/Edit Employee modal can extend below the visible page without providing a usable scrollbar. Fields and the Save/Cancel actions can appear too low to reach on shorter screens.

The dialog already uses Bootstrap's `modal-dialog-scrollable` class, but the form currently wraps the modal header, body, and footer inside `.modal-content`. Research and correct the structure or flex layout needed for Bootstrap's scrollable modal behavior to constrain the form and allow `.modal-body` to scroll.

## Description

Update the shared record modal so that:

- Its height never exceeds the usable viewport.
- The modal body scrolls independently when the form is tall.
- The title, Close control, Cancel button, and Save button remain reachable.
- All dynamically generated employee fields can be reached by touch, mouse, keyboard, and assistive technology.
- Opening and closing the modal follows accessible focus behavior.
- The solution continues to support the other record editors that reuse the same modal.

Prefer Bootstrap 5.3.3's supported modal, form, spacing, and responsive utilities. Add small project-specific CSS only where the existing Bootstrap behavior does not cover the CrewBoard layout.

## Acceptance criteria

1. **Constrained and scrollable layout**
   - The modal fits within the usable browser viewport at supported desktop, tablet, and phone sizes.
   - When the employee form is taller than the available space, the modal body has a visible and usable vertical scroll path.
   - The page behind the open modal does not scroll instead of the modal body.
   - Scrolling can reach the first and last form controls without content being clipped by the header, footer, browser chrome, or virtual keyboard.
   - The modal does not introduce unnecessary horizontal scrolling at supported widths or browser zoom levels.

2. **Persistent dialog actions**
   - The modal header remains visible or immediately reachable and contains the title and labeled Close button.
   - Cancel and Save remain visible while the body scrolls, or remain reliably reachable without leaving the dialog.
   - The action footer does not cover the final field or validation message.
   - Save remains the primary action and Cancel remains visually distinct.
   - Closing through Close, Cancel, or Escape behaves consistently and does not accidentally submit the form.

3. **Bootstrap modal structure**
   - The implementation follows a Bootstrap-supported structure in which `.modal-content`, `.modal-header`, `.modal-body`, and `.modal-footer` participate correctly in the scrollable flex layout.
   - If the `<form>` remains inside `.modal-content`, it receives the required flex sizing and `min-height: 0` behavior; alternatively, the form itself may serve as `.modal-content` if that produces cleaner valid markup.
   - `modal-dialog-scrollable` behavior is verified rather than assumed from the presence of the class.
   - Evaluate `modal-fullscreen-sm-down` or an equivalent Bootstrap responsive treatment for small phones and adopt it only if it improves reachability and clarity.
   - No new modal, scrolling, or accessibility library is introduced.

4. **Accessible dialog semantics**
   - The modal has an accessible dialog name through `aria-labelledby="record-modal-title"` or an equivalent valid association.
   - The visible title changes correctly between **Add employee**, **Edit employee**, and the other record-editor contexts.
   - Instructions essential to completing the form are associated with the relevant controls or dialog description.
   - The Close button retains an accessible name.
   - Decorative elements are not announced as controls.

5. **Focus management**
   - Opening the modal moves focus to a sensible location, such as the dialog title or first editable field, without unexpectedly opening a mobile keyboard when that would obscure the context.
   - Tab and Shift+Tab move through visible dialog controls in a logical order and do not place focus behind the modal.
   - Keyboard users can reach every employee field, validation message, Cancel, Save, and Close.
   - After the modal closes, focus returns to the Add Employee button or Edit control that opened it.
   - When submission fails validation, focus moves to or clearly identifies the first invalid field without resetting the user's scroll position or entered values.

6. **Employee-form reachability**
   - Test the longest expected employee form, including identity, role, contact details, birthday, emergency contact, notes, username, password/reset controls, active state, and any approved access-profile fields.
   - Every field label, help message, and validation message remains readable and associated with its control.
   - Expanding validation feedback does not make Save, Cancel, or the final fields unreachable.
   - Native date, phone, email, password, select, and checkbox controls introduced by the semantic-form PBI work within the scrolling dialog.
   - Scrolling does not clear, duplicate, or alter any entered field value.

7. **Responsive and zoom behavior**
   - Verify representative narrow and short viewports, including phone portrait, phone landscape, tablet, and a desktop window with reduced height.
   - Verify at 200% browser zoom and evaluate the form at 400% reflow where practical.
   - Content reflows into a single readable column when Bootstrap grid breakpoints require it.
   - The virtual keyboard does not permanently hide the focused field or action buttons; the user can scroll the focused control into view.
   - Device safe areas and mobile browser controls do not make Close, Cancel, or Save unreachable.

8. **Shared-modal regression coverage**
   - Add/Edit Location, Add/Edit Job, New/Edit Message, Reply, and Edit My Details continue opening and closing correctly in the shared modal.
   - Short forms do not receive an unnecessary large empty scrolling region.
   - Existing form submission, API error display, and modal-close timing remain unchanged unless explicitly required for accessibility.
   - Reopening the modal does not retain the previous record's scroll position, validation state, title, or fields.

## Implementation notes

- Inspect the computed height and overflow of `.modal-dialog`, `.modal-content`, `#record-form`, and `.modal-body` rather than adding an arbitrary fixed pixel height.
- Bootstrap scrollable dialogs constrain `.modal-content` and apply overflow to `.modal-body`; ensure the intervening form participates in that height and flex chain.
- Prefer viewport-relative constraints already supplied by Bootstrap. If custom viewport sizing is necessary, account for modern dynamic viewport behavior and test fallbacks rather than relying blindly on `100vh`.
- Keep header and footer outside the scrolling body so the dialog's context and actions remain available.
- Reset `.modal-body` scroll position when opening a different record.
- Reuse this corrected shared-modal structure for all record types instead of creating an employee-only duplicate.
- Coordinate validation presentation with the semantic form-controls PBI so invalid feedback can expand without being clipped.

## Out of scope

- Redesigning the employee data model or changing which employee fields are collected.
- Implementing role-based abilities, password policy, or geocoding behavior defined by other PBIs.
- Replacing the modal with a separate page unless testing proves a modal cannot provide an accessible experience on supported devices.
- Adding a new CSS framework, modal library, or form framework.
- A general visual redesign of all CrewBoard pages.

## Definition of done

- The complete Add Employee form can be reached, reviewed, validated, saved, and canceled on the agreed desktop and mobile viewport matrix.
- The modal body scrolls while its header and actions remain usable, with no clipped final fields or validation messages.
- Dialog naming, focus entry, focus containment, Escape behavior, and focus restoration are verified with keyboard-only navigation.
- The employee modal is checked with a representative screen reader on at least one supported desktop or mobile platform.
- Browser zoom, phone landscape, virtual-keyboard, and long-validation-message scenarios are verified.
- Every other editor using the shared record modal passes regression testing.

