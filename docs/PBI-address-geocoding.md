# PBI: Find location coordinates from a street address

**Type:** Product Backlog Item
**Status:** Proposed
**Area:** CrewBoard web interface / Locations and maps

## User story

As a CrewBoard owner, I want CrewBoard to find a job site's latitude and longitude from its street address, so that I can add locations without looking up and copying coordinates manually.

## Business value

Street addresses are familiar business information; raw coordinates are not. Address lookup makes location entry faster, reduces data-entry errors, and makes the location map practical for everyday use.

## Description

Add an address-to-coordinate lookup, also known as forward geocoding, to the location editor. The user enters the street address, city, state/region, and postal code, then selects **Find on map**. CrewBoard sends that address to a configured geocoding provider, displays the best matching result or a short result list, and lets the user confirm the correct location before saving its latitude and longitude.

Coordinate fields should no longer be the primary data-entry method. They remain available under an advanced or manual option for offline use, unusual properties, provider failures, and final corrections.

The lookup should be performed by the user's browser where practical. This avoids adding a large HTTPS client workflow to the ESP32 and matches the existing pattern in which the viewing device retrieves online OpenStreetMap tiles. CrewBoard must continue to store the confirmed coordinates locally on the SD card and must not depend on the geocoding provider when displaying a previously saved location.

## Provider investigation

Before implementation, compare at least the following options and record the selected provider and fallback strategy:

- **U.S. Census Geocoder:** No-key public API for individual structured or one-line addresses in the United States, Puerto Rico, and U.S. Island Areas. It returns matched addresses and coordinates but does not provide worldwide coverage. See the [Census Geocoding Services API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html).
- **OpenStreetMap Nominatim:** Worldwide address search with latitude, longitude, display name, and address details. Use of the public server is limited: lookups must be user-triggered, attribution is required, autocomplete is forbidden, usage must stay below one request per second, and the application must be able to switch providers. Its policy also warns against submitting personal or confidential information. See the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) and [search API](https://nominatim.org/release-docs/latest/api/Search/).
- **Hosted or self-hosted geocoding provider:** Evaluate if CrewBoard will be sold broadly, needs non-U.S. coverage, handles residential customer addresses, exceeds public-service limits, or cannot meet a public provider's privacy and identification rules.

The provider decision must consider geographic coverage, accuracy for the intended service area, browser CORS support, request limits, attribution, privacy, API keys, operating cost, commercial terms, service availability, and whether the provider can be changed without reflashing firmware.

API keys or paid-provider secrets must not be embedded in downloadable front-end JavaScript. If a provider requires a secret that cannot safely be exposed in a browser, the implementation must define an appropriate proxy or choose a different provider; the key must not be sent to every CrewBoard client.

## Acceptance criteria

1. **Address-first location form**
   - The location editor continues to collect location name, street address, city, state/region, and postal code.
   - A clearly labeled **Find on map** action is available after the address fields.
   - Latitude and longitude are moved into an advanced/manual section and are not presented as information an ordinary user is expected to know.
   - The lookup action is available only to users already authorized to add or edit locations.

2. **Explicit address lookup**
   - Selecting **Find on map** submits one normalized query built from the entered address fields.
   - CrewBoard does not query on every keystroke and does not implement provider-backed address autocomplete.
   - While the request is running, the form shows progress and prevents accidental duplicate submissions.
   - Requests and responses are bounded to small, reasonable sizes for the browser and application.

3. **Review before saving**
   - A successful lookup shows the provider's matched address and a map or pin preview before coordinates are accepted.
   - If several plausible matches are returned, the user can select from a short, clearly distinguished list rather than CrewBoard silently choosing an uncertain result.
   - The selected result populates the latitude and longitude fields.
   - Provider-normalized address text does not silently overwrite the address the user entered; any address replacement requires explicit confirmation.
   - The location is not saved until the user confirms and submits the location form.

4. **Changed and stale addresses**
   - If an address field changes after coordinates were found, the form marks the coordinates as needing confirmation or another lookup.
   - CrewBoard does not silently retain coordinates known to belong to the previous address.
   - Editing non-address fields such as the location name does not unnecessarily invalidate confirmed coordinates.

5. **No-match, ambiguous, and offline behavior**
   - No-match, network, provider, rate-limit, and malformed-response failures produce a clear, non-technical message without losing the form contents.
   - The user can correct the address and try again through an explicit action.
   - If the browser has no internet access or the provider is unavailable, the user can still enter coordinates manually and save the location.
   - Existing saved locations remain viewable and editable without contacting the geocoding provider.

6. **Coordinate validation and persistence**
   - Confirmed or manually entered latitude must be between -90 and 90, and longitude must be between -180 and 180.
   - The existing firmware validation remains authoritative when the location collection is saved.
   - Saved location records remain compatible with the current `locations.json` structure unless the implementation documents and safely handles an additive metadata field.
   - Sufficient coordinate precision is retained for a practical job-site map pin.

7. **Provider configuration and compliance**
   - The provider and endpoint can be changed through deployment configuration or replaceable SD-card web assets without compiling and reflashing the firmware.
   - Provider-specific request limits, identification requirements, attribution, and result licensing are implemented and documented.
   - Required attribution appears near the lookup results or map in a form appropriate to the selected provider.
   - If public Nominatim is selected, lookups are explicitly user-triggered, globally throttled to at most one request per second for the application path, cached where appropriate, and never used for autocomplete or bulk lookup.

8. **Privacy and security**
   - Documentation states that an online lookup sends the entered address to the configured third-party provider.
   - The provider investigation explicitly decides whether residential customer addresses are permitted and appropriate under the provider's privacy policy and terms.
   - CrewBoard does not send roster, schedule, crew, notes, credentials, or unrelated business data with a lookup request.
   - Search queries and provider responses containing addresses are not written to firmware logs, browser storage, or application logs as part of this feature.
   - A geocoding failure never weakens existing CrewBoard authentication or exposes the location collection to an unauthenticated user.

## Implementation notes

- Add a small provider-neutral JavaScript function that accepts the structured address and returns normalized candidates containing display text, latitude, and longitude. Keep provider response parsing outside the location form logic.
- Prefer a structured query when supported so street, city, state/region, and postal code retain their meaning.
- Limit the candidate list to a small number, such as three to five, and request no polygons or unnecessary provider data.
- Use the existing map implementation for result preview if it can display a temporary candidate marker without saving the location.
- Do not make the ESP32 proxy arbitrary URLs. If a proxy is required, restrict it to the configured provider and tightly bound its request and response behavior.
- Keep the manual coordinate fields available for rural entrances, new construction, large properties, and locations where the geocoded street point is not the desired crew entrance.
- Consider a later map-pin adjustment feature, but do not make it a prerequisite for the initial address lookup.

## Out of scope

- Live search suggestions or address autocomplete.
- Bulk geocoding the existing location collection.
- Repeatedly geocoding addresses on page load or map display.
- Reverse geocoding a coordinate into an address.
- Route planning, travel time, turn-by-turn navigation, live vehicle location, or crew tracking.
- Guaranteeing that a provider's result identifies the correct driveway, building entrance, service gate, or parcel boundary.
- Hosting a full geocoding database on the CYD.

## Definition of done

- A provider comparison is documented and the selected provider's terms, privacy rules, attribution, limits, coverage, and CORS behavior are verified.
- A user can enter a representative address, request a lookup, review the match, and save a valid mapped location without manually finding coordinates.
- Ambiguous, no-match, offline, rate-limit, and changed-address flows are tested without losing user input.
- Manual coordinate entry remains available and validated.
- Previously saved locations display without an online geocoding request.
- Setup and user documentation explain provider dependency, address disclosure, attribution, manual fallback, and expected accuracy limitations.

