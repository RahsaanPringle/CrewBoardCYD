# PBI: Require usernames and let users change their passwords

**Type:** Product Backlog Item
**Status:** Proposed
**Area:** CrewBoard CYD / Accounts and authentication

## User story

As a CrewBoard owner, I want every crew member to have a unique username and an initial password, so that each person has an identifiable account without requiring the owner to invent a different onboarding process for every employee.

As a CrewBoard user, I want to change my own password, so that I do not have to continue using the initial password or ask the owner to maintain my password for me.

## Business value

Mandatory usernames ensure that messages, profile updates, and other user actions can be associated with a specific crew member. A temporary default password makes account setup quick, while self-service password changes reduce owner administration and prevent the onboarding password from becoming a permanent shared credential.

## Description

Require every active roster member to have a unique login username. When the owner creates an employee account, CrewBoard may assign a deployment-configured default password if the owner does not enter a different initial password. Every newly created account and every owner-reset password is temporary and must be changed by that user.

Add a **Change password** action for the currently authenticated user. A user changing their own password must provide the current password, a valid new password, and matching confirmation. After the password is changed, CrewBoard must explain that the browser may need to authenticate again because the current application uses HTTP Basic authentication.

The owner retains the ability to reset a staff member's password, but neither the owner nor the account APIs can view an existing password.

## Acceptance criteria

1. **Mandatory usernames**
   - Every new active roster member requires a username before the record can be saved.
   - Usernames are trimmed, are 1–40 characters, cannot contain a colon, and are compared consistently for uniqueness.
   - A staff username cannot duplicate another staff username or the administrator username.
   - The roster editor labels the field **Username** rather than **Username (optional)** and clearly reports missing or duplicate usernames.
   - A roster member's account remains linked by the stable employee ID when their display name or username changes.
   - Inactive historical roster records may retain their username. The owner cannot reuse that username while its account still exists.

2. **Existing CrewBoard data**
   - Existing roster data and configuration files remain readable after the update.
   - An existing active roster member without an account is visibly identified to the owner as requiring login setup.
   - CrewBoard does not invent usernames silently for existing people, because generated names may be ambiguous or inappropriate.
   - The owner can assign the missing username and initial password through the roster editor without manually editing JSON.
   - Missing legacy accounts do not prevent CrewBoard from starting or prevent the owner from signing in to complete the migration.

3. **Initial and default passwords**
   - The sample configuration documents an optional deployment-specific default staff password for onboarding.
   - If the owner creates a staff account without entering an initial password and a valid default is configured, CrewBoard copies that default into the new account as a temporary password.
   - If no valid default is configured, the owner must enter an initial password before the account can be created.
   - The UI tells the owner whether the configured default or an entered initial password will be used, but never displays an existing saved password.
   - Newly created staff accounts are marked as requiring a password change.
   - The documented sample value is a placeholder and is not a usable universal CrewBoard password.

4. **Change own password**
   - Every authenticated staff user and the administrator can open a **Change password** form for their own account.
   - The form requires the current password, the new password, and confirmation of the new password.
   - The server verifies the current password and rejects an incorrect value without changing the account.
   - The new password must meet the documented password rules, must match the confirmation, and must differ from the current password.
   - Staff users cannot change another user's password through the self-service endpoint or by changing request fields.
   - A successful change safely updates `/config.json`, updates the in-memory credential immediately, and clears the account's temporary-password state without restarting the CYD.

5. **Required first change**
   - A user signing in with a temporary password is clearly required to replace it before using normal CrewBoard features.
   - While a password change is required, the account can access the minimum application resources needed to identify the signed-in user, display the password form, and submit the change.
   - Other protected application data and write operations remain unavailable until the password is changed.
   - The administrator can still reach recovery and account-management functionality if the administrator credential is marked temporary.

6. **Owner password reset**
   - The owner can reset a staff account to a new temporary password through the roster/account editor.
   - The owner may enter a temporary password or use the configured default when one is available.
   - Resetting a password marks the account as requiring another password change.
   - The owner cannot retrieve, reveal, or export the previous password.
   - Staff users cannot reset other accounts.

7. **HTTP Basic reauthentication behavior**
   - After a successful password change, the response does not attempt to treat the old HTTP Basic credentials as a continuing authenticated session.
   - The UI tells the user that their password changed and that the browser will ask them to sign in again with the new password.
   - The implementation provides and documents a reliable sign-in-again flow for supported browsers, accounting for browsers that cache HTTP Basic credentials until a new challenge, tab close, or browser close.
   - A request using the old password is rejected immediately after the update, and a request using the new password succeeds.

8. **Security and data exposure**
   - Passwords and the configured default password are never returned by the session, roster, account, or other application APIs.
   - Password fields are never written to `roster.json`, browser storage, application logs, or message content.
   - Password-change and owner-reset requests require the existing `X-CrewBoard-Request: 1` same-origin marker and authenticated authorization.
   - Error responses do not disclose another account's password or sensitive configuration values.
   - Documentation continues to state that CrewBoard uses HTTP without TLS and must be used only on a trusted private or isolated network.

## Implementation notes

- Keep the stable `employeeId` as the link between a roster record and its entry in the `/config.json` `users` array.
- Add a temporary-password flag to staff account configuration, for example `mustChangePassword: true`. Define equivalent handling for the administrator without exposing the flag as writable by staff.
- Add a small authenticated endpoint such as `PUT /api/v1/password` for self-service changes. Do not accept a target username or employee ID from staff clients; derive the account from the authenticated request.
- Require the existing same-origin request header and cap the request-body size consistently with the other small JSON APIs.
- Use the existing safe temporary-file installation pattern when updating `/config.json`. Do not leave an in-memory password changed if the SD-card update fails.
- Validate username uniqueness in the firmware as well as the browser. Client validation is only a usability aid.
- Define one password policy shared by initial-password, reset-password, self-service, and configuration validation paths. At minimum, reject empty or oversized values and document the chosen minimum length.
- Return only non-sensitive account metadata needed by the owner, such as employee ID, username, and whether a password change is required.
- Because HTTP Basic credentials are sent with every request and are commonly cached by the browser, test the post-change authentication experience in each supported browser before choosing the final reauthentication mechanism.
- A common default password creates risk even when it is temporary. Limit temporary-password accounts to the forced-change experience and instruct deployments to replace the sample default before use.

## Out of scope

- Password recovery by email, SMS, security questions, or an internet service.
- Allowing staff users to change their username, role, active status, or roster identity.
- Showing an existing password to the owner or user.
- Synchronizing accounts with Google, Microsoft, Active Directory, or another identity provider.
- Adding remote access, HTTPS, certificates, multi-factor authentication, or internet-facing authentication.
- Replacing HTTP Basic authentication or redesigning the current plaintext credential storage in `/config.json` as part of this PBI.

## Definition of done

- New active roster members cannot be saved without a unique valid username and an initial or configured default password.
- A new or reset account must change its temporary password before accessing normal CrewBoard data.
- Staff and administrator self-service password changes work without a device restart.
- Old credentials fail and new credentials succeed immediately after a password change.
- Owner reset, legacy-account migration, invalid-current-password, duplicate-username, storage-failure, and browser reauthentication paths are tested.
- No API response or log exposes a current, previous, or default password.
- The sample configuration and setup documentation explain usernames, temporary passwords, first-use changes, resets, browser reauthentication, and trusted-network limitations.

