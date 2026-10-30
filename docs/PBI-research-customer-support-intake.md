# PBI: Research customer support intake from CrewBoard

**Type:** Product Backlog Item / Research Spike
**Status:** Proposed
**Area:** CrewBoard web interface / Customer support

## User story

As a CrewBoard customer, I want a simple support form inside CrewBoard that prepares an email to the support team, so that I can start a conversation without visiting a developer-oriented issue tracker or manually collecting device information.

As the CrewBoard product owner, I want to determine whether a `mailto:`-based form is sufficient before building or operating a support API.

## Business value

A built-in support path makes the physical product feel supported and gives customers an obvious place to ask for help. Starting with the customer's existing email application may provide an adequate experience without creating hosting costs, API credentials, spam controls, ticket storage, or another service to maintain.

## Research question

Can CrewBoard reliably use a small web form to open the customer's email application with a correctly addressed, pre-filled support message on the devices and browsers customers are expected to use?

The preferred starting hypothesis is **yes**. An external support API should be recommended only if testing identifies a meaningful customer or operational problem that `mailto:` and a copy-to-clipboard fallback cannot solve.

## Background

The `mailto:` URI scheme supports a recipient, subject, and short plain-text body. It launches the user's configured mail handler and presents a draft for the user to review and send; it does not transmit email directly from CrewBoard. Subject and body values must be encoded correctly, including UTF-8 text, reserved characters, spaces, and line breaks. See [RFC 6068](https://www.rfc-editor.org/info/rfc6068/).

Research must distinguish between:

1. A native HTML form using a `mailto:` action and `text/plain` encoding.
2. JavaScript that validates the form and constructs an RFC 6068-compatible `mailto:` URI with an explicitly formatted subject and body.

These approaches may behave differently across browsers and mail handlers. Prefer the smallest approach that produces readable drafts consistently on the supported customer devices.

## Prototype scope

Create a disposable prototype support form containing:

- Customer name.
- Reply email address.
- Request type: Help, Bug, or Feature idea.
- Subject.
- Description.
- Optional **Include device diagnostics** checkbox.
- **Open email** action.
- **Copy support message** fallback.

The generated draft should be addressed to a configurable CrewBoard support email address and use a recognizable subject such as `CrewBoard support request: <subject>`.

If diagnostics are included, use only an allowlist of non-sensitive fields such as CrewBoard software version, CYD hardware profile when known, uptime, restart reason, free memory, SD-card status, and network mode. Do not include credentials, Wi-Fi names or passwords, login names, roster data, messages, schedules, customer locations, local IP addresses, or configuration-file contents.

## Acceptance criteria

1. **Correct email draft**
   - Submitting the prototype opens the configured mail application or webmail handler with the support recipient populated.
   - The subject and body contain the labeled form values in a readable plain-text layout.
   - Spaces, line breaks, ampersands, question marks, percent signs, apostrophes, plus signs, and representative non-ASCII characters are tested for correct encoding.
   - The customer can review and edit the complete message before choosing to send it.
   - CrewBoard does not claim that the request was sent merely because the mail application opened.

2. **Implementation comparison**
   - Test both direct HTML `mailto:` form submission and an explicitly constructed `mailto:` URI.
   - Record which approach produces the most consistent recipient, subject, and body formatting.
   - Confirm whether JavaScript `encodeURIComponent` plus deliberate CRLF formatting is sufficient or whether additional handling is required for the tested clients.
   - Choose and document one implementation approach for a future delivery PBI.

3. **Customer-device test matrix**
   - Test the browsers and mail handlers most likely to be used with CrewBoard, including at least current Windows Edge or Chrome with a desktop or webmail handler, Android Chrome with a common mail app, and iPhone Safari with Mail or a configured alternative.
   - Record the operating system, browser, selected mail handler, expected result, actual result, and any setup required.
   - Identify what happens when no default mail handler is configured.
   - Confirm whether the experience still starts correctly when CrewBoard itself has no internet access but the viewing device has a configured mail application.

4. **Fallback behavior**
   - If opening the mail handler fails or the customer does not use a configured mail application, **Copy support message** copies the same labeled content for pasting into webmail or another contact channel.
   - The support email address remains visible and selectable so the customer can contact support manually.
   - Form contents remain visible after attempting to open email so a failed handoff does not destroy the customer's message.
   - The proposed production experience includes clear instructions for the fallback without showing a technical error.

5. **Practical limits**
   - Determine a safe maximum subject and body length for the supported device and mail-handler matrix.
   - Verify that a typical support request plus the allowlisted diagnostics fits within that limit.
   - Document that `mailto:` does not provide reliable automatic attachments, delivery confirmation, ticket numbers, centralized status, or guaranteed receipt.
   - Determine whether those limitations are acceptable for starting a support conversation at the expected initial sales volume.

6. **Privacy and safety**
   - The form tells customers not to include passwords, Wi-Fi credentials, employee information, customer addresses, or other sensitive business data.
   - Diagnostics are opt-in and previewed in the draft before sending.
   - Form contents are not saved to the SD card, browser storage, firmware logs, or GitHub.
   - No SMTP credential, email-service token, GitHub PAT, or privileged API key is added to CrewBoard.

7. **Operational evaluation**
   - Confirm the support mailbox, reply workflow, expected response process, and how messages will be categorized manually.
   - Assess whether ordinary mailbox rules or aliases are sufficient for Help, Bug, and Feature idea requests.
   - Estimate the request volume at which manual email triage would become burdensome.
   - Define concrete triggers for reconsidering an API or ticketing system, such as missed messages, excessive spam, a need for attachments, multiple support agents, service-level tracking, automated device registration, or a volume that cannot be managed in a mailbox.

## Research alternatives

Compare the preferred `mailto:` approach against, but do not build, these alternatives:

- A hosted HTTPS form endpoint that emails or stores the request.
- A serverless support API that returns a reference number.
- A third-party help-desk or form service.
- A hosted support page opened from CrewBoard.
- Direct creation of a private GitHub issue through a protected backend.

The comparison should cover customer friction, reliability, privacy, spam exposure, ongoing cost, maintenance, offline behavior, credential management, and whether customers need an account.

## Out of scope

- Sending email directly from the ESP32 through SMTP.
- Storing mailbox credentials or provider API keys on the CYD or SD card.
- Automatically creating GitHub issues from the browser.
- Embedding a GitHub PAT in CrewBoard.
- Building a production support API, ticket database, customer account system, or administrative support console during this research spike.
- Promising delivery confirmation or a support response time through `mailto:` alone.

## Research deliverables

- A minimal prototype that runs from CrewBoard's static web environment.
- A completed browser and mail-handler test matrix.
- Examples of the generated subject and body, including encoded edge cases.
- A short decision record stating whether `mailto:` is sufficient for the first production release.
- If `mailto:` is accepted, a scoped implementation PBI for the built-in Support page.
- If it is rejected, evidence of the failed requirement and a scoped recommendation for the smallest suitable alternative.

## Definition of done

- The prototype reliably produces readable email drafts on the agreed supported device matrix, or the failures are documented with reproducible evidence.
- The no-mail-handler and copy-to-clipboard paths are tested.
- Message length, encoding, privacy, diagnostics, and operational limitations are documented.
- A product decision is recorded before any support API or hosted ticketing service is commissioned.

