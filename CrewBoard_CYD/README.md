# CrewBoard CYD

CrewBoard is a small, local-network coordination server for an ESP32-2432S028R-style Cheap Yellow Display (CYD). The CYD screen reports startup and network status. Normal use is through a phone or computer browser.

## Develop without hardware

From the repository root, run `npm run dev` with Node.js 22 or newer, then open
`http://127.0.0.1:8080`. This serves the same files in `sd-card/crewboard/www`
with a local API and isolated persistent development data. No changes to the
Arduino build are required. See the [local development guide](../docs/local-development.md)
for credentials, tests, limitations, and safe deployment back to the CYD.

## Hardware assumptions

- ESP32-2432S028R or compatible 2.8-inch CYD
- ILI9341-compatible 320×240 TFT
- TFT backlight on GPIO 21
- Built-in microSD using CS GPIO 5 and the ESP32 default VSPI SD pins (SCK 18, MISO 19, MOSI 23)
- A reliable 5 V supply and a FAT32 microSD card

CYD board revisions vary. Confirm the display, backlight, and SD pins for the actual board before powering attached hardware.

## Arduino setup

Recommended Arduino IDE settings:

- Board package: Espressif `esp32`
- Board: **ESP32 Dev Module**
- CPU frequency: **240 MHz**
- Flash frequency: **80 MHz**
- Flash mode: **QIO** (use DIO if required by the board)
- Flash size: **4 MB**
- Partition scheme: **Default 4 MB with SPIFFS**
- Upload speed: **460800** or a slower speed if uploads are unreliable

Install these libraries:

- `TFT_eSPI`
- `ArduinoJson` 6.x or 7.x

`WiFi`, `SD`, and the filesystem classes come with the ESP32 board package.

The hostname feature uses the bundled `ESPmDNS` and `NetBIOS` libraries. The verified build target is Espressif `esp32` **3.3.12**, board **ESP32 Dev Module** (`esp32:esp32:esp32`); no separate name-resolution library is required on this core. Other core versions require checking these APIs before building.

On Windows, this core does not expose the `460800` upload option; use the supported slower **115200** option. The firmware can be compiled without uploading:

```powershell
arduino-cli compile --fqbn "esp32:esp32:esp32:CPUFreq=240,FlashFreq=80,FlashMode=qio,FlashSize=4M,PartitionScheme=default,UploadSpeed=115200" .\CrewBoard_CYD
```

Configure `TFT_eSPI` for the physical CYD. A common ESP32-2432S028R display configuration uses ILI9341 with TFT MISO 12, MOSI 13, SCLK 14, CS 15, DC 2, and RST -1. Do not assume those values apply to every revision.

Open [CrewBoard_CYD.ino](CrewBoard_CYD.ino) as the Arduino sketch and compile/upload it.

For missing FQBN, COM-port, upload, or SD-card asset problems, see the repository's [troubleshooting guide](../TROUBLESHOOTING.md).

## Prepare the SD card

Format the card as FAT32. Copy the contents of the repository's `sd-card` directory to the root of the card. The result must be:

```text
/config.json
/crewboard/
├── data/
│   ├── roster.json
│   ├── customers.json
│   ├── locations.json
│   ├── schedule.json
│   └── messages.json
├── shared/
├── css/
│   └── (optional Bootstrap 5.3 theme files, e.g. vapor.min.css)
└── www/
    ├── index.html
    ├── app.css
    ├── app.js
    └── vendor/
        ├── bootstrap.min.css
        ├── bootstrap.bundle.min.js
        └── jquery.min.js
```

Rename `/config.sample.json` to `/config.json`, then replace every placeholder. Use long, unique passwords. Do not reuse the Wi-Fi password as an account password.

CrewBoard reads `/config.json` from the SD-card root, the same location used by the original `CYD-Intranet-Config` sketch. It does not search other folders.

The original configuration format remains valid. When its optional `setupAccessPoint` object is absent, CrewBoard preserves the baseline fallback access point: SSID `CYD-Intranet`, password `cydupload`. Add `setupAccessPoint` to choose stronger deployment-specific values.

The setup access point password is used only when CrewBoard cannot join the configured Wi-Fi network. It must contain at least eight characters. Passwords are never displayed on the CYD or returned by the API.

The included JSON records are sample data. Replace them through the owner interface after the first login.

## First run and local access

1. Insert the prepared SD card and restart the CYD.
2. Wait for the display to show an IP address.
3. On a device connected to the same network, open `http://IP-ADDRESS/`.
4. Enter the administrator or staff credentials from `config.json` when the browser asks.
5. The administrator (owner) can edit all CrewBoard records. Staff accounts can read everything, post to the message board, and update their own contact details.

### Memorable local network name

The optional top-level `"hostname": "crewboard-cyd"` setting in `/config.json` selects the device name. Use **1–15 ASCII letters, digits, or hyphens**, with a letter or digit at both ends. Do not include `.local`, a URL, spaces, or underscores. Valid names are normalized to lowercase. Missing, empty, null, wrong-type, or invalid values use **`crewboard-cyd`**; supplied invalid values are reported through the Serial/status log without preventing startup. Existing configurations without this setting remain compatible.

Hostname changes take effect **after a restart**. Saving staff logins reloads account configuration but does not change the active hostname or restart name services.

On the configured Wi-Fi network:

- Open **`http://crewboard-cyd.local/`** (substitute your hostname) on a same-network client with mDNS support. The CYD also advertises its HTTP/TCP service on port 80.
- The CYD supplies its hostname to DHCP before joining Wi-Fi and answers NetBIOS name queries from compatible Windows clients. A plain address such as **`http://crewboard-cyd/`** depends on the router's DNS integration or the client's enabled name-resolution mechanisms; setting a hostname alone does **not** guarantee it.
- The status display shows **Host**, **IP**, and **Network**. Successful name-service startup and any failures appear in the existing Serial/status log. A failed mDNS or NetBIOS startup does not stop HTTP: use **`http://IP-ADDRESS/`** instead.
- Keep a **DHCP reservation** for the CYD in the router as a stable numeric fallback. Choose a different hostname for each CYD on the same network to avoid collisions.

Client support and network policy vary. Multicast/broadcast filtering, guest networks, Wi-Fi client isolation, VLAN boundaries, VPN routing, or disabled NetBIOS can prevent name resolution. IP access still depends on routing/firewall policy. This feature does not run a DNS server, change router settings, provide remote access, or add HTTPS. Authentication, APIs, and WebDAV permissions remain unchanged. Browser credentials and preferences may be separate for IP, `.local`, and plain-name origins.

In **setup access-point mode**, mDNS and NetBIOS are not started. The Host line identifies the configured device name, not an available name-based address in that mode. Connect to the existing setup SSID and use the displayed AP IP, normally **`http://192.168.4.1/`**, then update the SD-card configuration and restart as before.

The roster requires only a display name. Business role, phone, email, birthday, emergency contact, notes, username, and password can be added later. Staff passwords are never stored in `roster.json` or returned to the browser; the administrator form updates the protected `users` section of `/config.json`. New credentials take effect immediately without restarting the CYD.

Up to 50 staff accounts are supported. A job can still have at most 12 assigned crew members.

Birthdays may be entered as `MM-DD` or `YYYY-MM-DD`; the year remains optional. Schedule dates use `YYYY-MM-DD`, times use 24-hour `HH:MM`, and an end time cannot precede its start time. Existing noncanonical dates and times are shown for correction rather than silently cleared. See the [form-field inventory](../docs/form-fields.md) for all controls, validation, autofill, and compatibility details.

### Permissions and features

- **Roster roles** come from a fixed list for a mowing/landscaping business: Owner, Crew Lead, Crew Member, Equipment Operator, and Trainee. The list is defined in `rosterRoles` in `CrewBoard_CYD.ino` and is returned to the browser by `/api/v1/session`. Records with an older role outside the list must be given a listed role (or none) the next time the owner saves the roster.
- **Roster editing:** the owner can add, edit, and delete any employee. A staff login that is linked to a roster record gets an **Edit my details** button for its own phone, email, birthday, and emergency contact only. Staff cannot change names, roles, status, or logins, and can never modify a record whose role is Owner.
- **Customers:** the owner can manage names and link each customer to multiple existing locations. Signed-in staff can see customer records and their locations; customers do not get login accounts. Linked customer names appear on location cards and map labels. Existing SD cards without `customers.json` start with an empty customer list; the first save creates the file.
- **Message board:** every signed-in user can post and reply, including replies to replies. The server stamps each post with the signed-in username, which is displayed on the message. Authors can delete their own posts; the owner can edit or delete any post. Deleting a post also deletes its replies. Post times come from the browser's clock.
- **Locations:** latitude and longitude are required. Only locations with coordinates are pinned. The map draws OpenStreetMap tiles when the viewing device has internet access and falls back to the offline grid otherwise.
- **Schedule:** opens on the current local month in **Calendar**. Select a date to open its filtered **List**; choosing List before selecting a date uses today. New jobs default to the selected date, or today if none is selected. **Current month** navigates without changing the selection, and returning to Calendar shows the selected date's month. The date and subview reset when the page is reloaded or reopened.
- **Last active tab:** Schedule, Messages, Roster, Customers, or Locations reopens after a refresh or a later visit in the same browser profile. Only the tab target is saved in `localStorage` under `crewboard.activeTab`; no tab content, form data, or credentials are saved by this feature or sent to the CYD. Missing, invalid, or unavailable storage leaves Schedule as the default. Storage is scoped to the page origin: a different IP address, hostname, protocol, or port may have a separate preference. The preference is not synchronized across devices or associated with a login.

API endpoints added for staff writes (all require the `X-CrewBoard-Request: 1` header):

| Method and path | Who | Purpose |
| --- | --- | --- |
| `POST /api/v1/messages` | Any user | Add a post (`title`, `body`, `postedAt`) or reply (`parentId`, `body`, `postedAt`). |
| `DELETE /api/v1/messages/{id}` | Author or owner | Delete a post and its replies. |
| `PUT /api/v1/profile` | Linked staff | Update the signed-in user's own contact fields. |
| `GET /api/v1/themes` | Any user | List theme files in `/crewboard/css` and the site default theme. |

CrewBoard waits up to 20 seconds for the configured Wi-Fi network. If the network is unavailable or cannot be joined, it automatically starts the configured setup access point. Connect a phone or computer to that access point and browse to the IP shown on the display, normally `http://192.168.4.1/`. The fallback does not provide an in-browser Wi-Fi configuration editor; update the SD-card configuration and restart.

For a stable address, create a DHCP reservation for the CYD in the local router.

## WebDAV shared files

WebDAV is available at:

```text
http://IP-ADDRESS/dav/
```

All authenticated accounts can read this folder. Only the administrator can upload, create folders, or delete. WebDAV is intentionally restricted to `/crewboard/shared`; configuration, application, and business-data files are never exposed through it. Existing clients from the baseline sketch must be reconfigured to use `/dav/`.

`LOCK` and `UNLOCK` are compatibility responses rather than complete WebDAV locking. Keep concurrent file editing modest.

## Safe writes and recovery

CrewBoard collection updates are first written to a `.tmp` file and validated as JSON. The current file is then renamed to `.bak` before the new file is installed. WebDAV uploads use the same temporary-file pattern.

If a write is interrupted, inspect the card on a computer while CrewBoard is powered off:

- A valid `.json` file is the active copy.
- A `.json.bak` file is the previous copy.
- A `.json.tmp` or `.upload` file is incomplete and should not replace a valid active file.

## Manual backup and restore

To back up:

1. Power off the CYD cleanly.
2. Remove the SD card.
3. Copy the entire `/crewboard` folder and `/config.json` to a dated folder on another device.

To restore, power off the CYD and copy a known-good `/crewboard` folder and `/config.json` back to a FAT32 card. Preserve the paths exactly. Keep backups protected because `config.json` contains plaintext Wi-Fi and login credentials.

## Front-end dependencies

Bootstrap 5.3.3 and jQuery 3.7.1 are stored under `/crewboard/www/vendor` and served locally. CrewBoard does not require a CDN. The street-map background and the **Open street map** links on location cards load from openstreetmap.org and need internet access on the viewing phone or computer; pins and the grid work offline.

## Themes

CrewBoard can swap the bundled Bootstrap stylesheet for any Bootstrap 5.3 theme, such as a [Bootswatch](https://bootswatch.com) `bootstrap.min.css`.

1. Copy the theme file to `/crewboard/css/` on the SD card. Give it a descriptive name, such as `vapor.min.css`. Names may contain only letters, numbers, `.`, `-`, and `_`, must end in `.css`, and must be 64 characters or fewer.
2. Optional: set the site-wide default by adding `"theme": "vapor.min.css"` to `/config.json`. The setting is read at startup and whenever a roster login is saved. Leave it empty or remove it to use the classic CrewBoard look.
3. Each browser can override the site default with the theme menu in the top bar. The choice is saved in that browser only. **CrewBoard classic** always uses the bundled Bootstrap stylesheet and green palette.

The theme replaces `vendor/bootstrap.min.css` rather than loading on top of it, so only one large stylesheet is downloaded. When a custom theme is active, `app.css` takes its colors from the theme's Bootstrap variables, including high-contrast semantic colors for status badges. If a theme file is missing, the browser falls back to the classic look. Up to 40 theme files are listed.

On page load, a loading message prevents the unstyled interface from jumping while the theme loads. If loading takes more than three seconds, the page is shown while the theme continues loading; data requests continue during the wait.

## Known limitations

- Traffic uses HTTP Basic authentication without TLS. Use CrewBoard only on a trusted private network or isolated business Wi-Fi.
- This is a single-client, blocking ESP32 server intended for a small team, not many simultaneous users.
- JSON collection sizes are capped: 50 roster members, 100 locations, 250 jobs, and 200 messages (posts plus replies). Each collection file and API write is capped at 24 KB.
- WebDAV uploads are capped at 8 MB and directory responses list at most 100 entries.
- The location map shows job concentration, not travel time, routing, or live position.
- Coordinates must be entered manually. CrewBoard performs no geocoding.
- The device has no database transactions or guaranteed power-loss protection. Temporary and backup files reduce, but cannot eliminate, SD corruption risk.
- The server does not provide HTTPS, email, notifications, live GPS, payroll, time tracking, billing, reporting, inventory, equipment tracking, employee home mapping, PTO, or personal schedules.
- Dates and times are business-entered values. This version does not depend on NTP or an external real-time clock.
