# PBI: Research role-based abilities for CrewBoard

**Type:** Product Backlog Item / Research Spike
**Status:** Proposed
**Area:** CrewBoard CYD / Authorization and employee roles

## User story

As a CrewBoard owner, I want to delegate appropriate abilities to trusted employees such as an office administrator or crew lead, so that routine schedule, location, roster, and communication work does not require the owner's account.

As a CrewBoard user, I want my available actions to match my responsibilities, so that I can do my job without receiving unnecessary access to employee accounts, credentials, or system administration.

## Business value

CrewBoard currently places all business administration on one owner login. Appropriate delegation would reduce that bottleneck, support an office secretary or administrator, and make the existing employee roles more meaningful while preserving the simplicity expected by a small crew.

## Current state

CrewBoard currently defines these business roles:

- Owner
- Crew Lead
- Crew Member
- Equipment Operator
- Trainee

These roster roles are labels and do not determine authorization. Effective access is currently binary:

- The configured administrator can create, edit, and delete roster, location, schedule, and message records; manage staff accounts; moderate messages; and write through WebDAV.
- Other authenticated users can read CrewBoard data, post and reply to messages, delete their own messages, update limited fields in their own profile, and read shared WebDAV files.

The research must verify this inventory against every firmware route and front-end action before proposing changes.

## Research questions

1. Which operational tasks should the owner be able to delegate safely?
2. What should an office secretary or administrator be able to manage?
3. Does a crew lead need authority over every job or only jobs and crew members assigned to that lead?
4. Do Equipment Operator and Trainee need distinct application abilities today, or are those currently business titles only?
5. Should business role and access profile remain separate concepts?
6. Which abilities must always remain owner-only?
7. Can the selected model be implemented clearly within the ESP32's memory, storage, and code-size constraints?

## Model options to compare

### Option A: Business roles directly grant abilities

Map Owner, Office Administrator, Crew Lead, Crew Member, Equipment Operator, and Trainee directly to fixed permission sets.

This is easy to explain but couples a person's job title to security access. Changing a roster role could unintentionally change privileges, and a business may use the same title differently.

### Option B: Separate business role and access profile

Keep the employee's business role for display and scheduling, while the protected account configuration assigns a fixed access profile such as:

- Owner
- Office Administrator
- Crew Lead
- Staff
- Restricted

This permits an employee to remain an Equipment Operator while also serving as a Crew Lead, or to hold a secretary/office business role with Office Administrator access. It also prevents ordinary roster edits from silently granting system privileges.

The research should begin with Option B as the preferred hypothesis and reject it only if the additional concept creates more product complexity than value.

## Candidate ability matrix for evaluation

The following table is a discussion starting point, not approved behavior:

| Ability | Owner | Office Administrator | Crew Lead | Staff / Equipment Operator | Trainee / Restricted |
| --- | --- | --- | --- | --- | --- |
| View schedule, locations, roster, and messages | Yes | Yes | Yes | Yes | Yes |
| Post, reply, and manage own messages | Yes | Yes | Yes | Yes | Decide |
| Edit own contact details and password | Yes | Yes | Yes | Yes | Yes |
| Create and edit schedules | Yes | Likely | Investigate assigned work only | No | No |
| Create and edit locations | Yes | Likely | Investigate | No | No |
| Edit ordinary roster/contact information | Yes | Likely | No | No | No |
| Activate or deactivate employees | Yes | Investigate | No | No | No |
| Moderate any message | Yes | Likely | Investigate | No | No |
| Upload and manage shared WebDAV files | Yes | Investigate | Investigate | No | No |
| Create usernames or reset temporary passwords | Yes | Investigate | No | No | No |
| Assign access profiles | Yes | No | No | No | No |
| Change owner credentials or protected configuration | Yes | No | No | No | No |
| Delete backups or perform system recovery | Yes | No | No | No | No |

## Acceptance criteria

1. **Complete authorization inventory**
   - Document every authenticated HTTP API route, WebDAV method, and privileged front-end action.
   - Record who can use each action today and where the firmware enforces that decision.
   - Identify actions that are hidden in the browser but insufficiently protected by the server, if any.
   - Include the interaction with the mandatory-username and self-service-password PBI.

2. **Role and access terminology**
   - Decide whether to add **Office Administrator**, **Secretary**, or another customer-facing name.
   - Use terminology that distinguishes the protected system owner from delegated office administration.
   - Decide whether the existing five labels remain business roles and whether Office Administrator is a business role, an access profile, or both.
   - Document the difference in plain language suitable for the employee editor and setup guide.

3. **Proposed permission matrix**
   - Produce a final proposed matrix covering data reads, schedule changes, location changes, roster changes, message moderation, account management, WebDAV, backups, configuration, and access-profile assignment.
   - Give every allowed ability a concrete business reason.
   - Keep abilities out of a role when there is no current workflow requiring them.
   - Identify actions that require record-level scope, such as a crew lead changing only assigned jobs rather than the entire schedule.

4. **Office administrator evaluation**
   - Evaluate an office administrator's expected workflow for scheduling jobs, maintaining customer locations, updating employee contact information, moderating messages, and managing shared files.
   - Decide whether an office administrator may activate employees, create accounts, or reset temporary passwords.
   - Keep owner credentials, access-profile assignment, protected configuration, and system recovery owner-only unless the research documents a compelling recovery requirement.
   - Define what happens if the office administrator is inactive or leaves the business.

5. **Existing business-role evaluation**
   - Decide whether Crew Lead receives additional operational abilities and whether those abilities require assignment relationships not currently stored by CrewBoard.
   - Decide whether Equipment Operator needs any distinct ability before equipment records or equipment workflows exist.
   - Decide whether Trainee should be read-only, have normal message/profile abilities, or use the same standard access as other crew members.
   - Do not create artificial permission differences solely to make every role appear technically different.

6. **Server-authoritative enforcement**
   - All proposed authorization decisions are enforceable in the firmware for direct API and WebDAV requests.
   - Hiding or disabling a button in JavaScript is never the only access control.
   - Unauthorized requests return a consistent `403 Forbidden` response without changing data.
   - The session API returns only the access metadata or permission flags needed to render the interface; the browser does not calculate privileges from an editable roster label.

7. **Privilege-management safety**
   - Only the owner can grant, change, or remove delegated access profiles.
   - An office administrator cannot promote themselves, create another owner, edit the owner account, or bypass an owner-only route by changing a roster record.
   - CrewBoard prevents removal or lockout of the final usable owner account.
   - Deactivating an employee immediately prevents their account from using delegated abilities.
   - Username changes, password resets, and role changes do not leave stale in-memory privileges.

8. **Compatibility and migration**
   - Existing configurations without access-profile metadata continue to load.
   - The existing administrator retains owner access.
   - Existing staff accounts receive a documented least-privilege default rather than gaining new abilities automatically from their roster titles.
   - Existing roster business roles and data remain valid unless a separately approved role-name change is required.
   - The migration does not require manually editing every existing account in `/config.json`.

9. **Audit and usability**
   - Identify which delegated actions should be logged with username and action type using the existing event-log approach.
   - The interface shows a user's access profile separately from their business role where that distinction helps the owner.
   - Controls unavailable to the signed-in user are hidden or disabled consistently, while server enforcement remains authoritative.
   - Permission errors explain that the action requires owner, office-administrator, or other specific access without revealing protected data.

10. **Resource impact**
   - Estimate additional flash, RAM, JSON configuration, and request-processing costs.
   - Prefer a small fixed set of access profiles or compact permission flags over a general-purpose policy engine.
   - Confirm that the proposed checks do not require loading large collections merely to authorize routine requests unless record-level scoping makes that unavoidable.

## Implementation considerations to investigate

- Store access metadata with protected account configuration rather than in publicly readable `roster.json` if business roles and access profiles are separated.
- Replace scattered `isAdmin` conditions with small centralized authorization helpers so each route declares the required ability consistently.
- Consider returning named abilities from `/api/v1/session`, such as `schedule.write` or `messages.moderate`, so the browser does not duplicate the firmware's role mapping.
- Keep the permission vocabulary small and tied to current product actions.
- If crew-lead abilities are limited to assigned work, determine whether the schedule needs a stable `leadEmployeeId` or another explicit relationship before authorizing changes.
- Include direct-request tests that attempt every privileged route with every proposed access profile.

## Out of scope

- Implementing the new access model during this research spike.
- Arbitrary customer-created roles or a full permission-policy editor.
- Department, branch, territory, or multi-business tenancy.
- Approval workflows, time-limited access, or temporary impersonation.
- Cloud identity providers, single sign-on, multi-factor authentication, or remote access.
- Adding equipment-management features solely to justify Equipment Operator permissions.
- Adding job-status or time-tracking features solely to justify Crew Lead permissions.

## Research deliverables

- Verified current-state authorization inventory.
- Recommended business-role and access-profile model.
- Final proposed ability matrix with rationale and unresolved decisions.
- Proposed protected configuration and session-response shape.
- Migration and owner-lockout prevention strategy.
- Firmware and browser enforcement test plan.
- One or more scoped implementation PBIs separating foundational authorization work from optional role-specific workflows.

## Definition of done

- The owner, office administrator/secretary, crew lead, standard staff, equipment operator, and trainee scenarios have been evaluated with representative workflows.
- Business role versus access profile is explicitly decided.
- Every current and proposed privileged action appears in the ability matrix.
- Owner-only boundaries, migration behavior, server enforcement, and resource impact are documented.
- No authorization implementation begins until the product owner approves the proposed matrix.

