# CrewBoard CYD

CrewBoard is a small, local-network coordination server for an ESP32-2432S028R-style Cheap Yellow Display (CYD). The CYD screen reports startup and network status. Normal use is through a phone or computer browser.

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
│   ├── locations.json
│   ├── schedule.json
│   └── messages.json
├── shared/
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
5. The administrator can edit all CrewBoard records. Staff accounts are read-only in this first version.

The roster requires only a display name. Business role, phone, email, birthday, emergency contact, notes, username, and password can be added later. Staff passwords are never stored in `roster.json` or returned to the browser; the administrator form updates the protected `users` section of `/config.json`. New credentials take effect immediately without restarting the CYD.

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

Bootstrap 5.3.3 and jQuery 3.7.1 are stored under `/crewboard/www/vendor` and served locally. CrewBoard does not require a CDN. The optional **Open street map** links on location cards require internet access on the viewing phone or computer; the built-in concentration plot does not.

## Known limitations

- Traffic uses HTTP Basic authentication without TLS. Use CrewBoard only on a trusted private network or isolated business Wi-Fi.
- This is a single-client, blocking ESP32 server intended for a small team, not many simultaneous users.
- JSON collection sizes are capped: 50 roster members, 100 locations, 250 jobs, and 100 messages. API writes are capped at 16 KB.
- WebDAV uploads are capped at 8 MB and directory responses list at most 100 entries.
- The location plot shows relative concentration, not roads, travel time, routing, or live position.
- Coordinates must be entered manually. CrewBoard performs no geocoding.
- The device has no database transactions or guaranteed power-loss protection. Temporary and backup files reduce, but cannot eliminate, SD corruption risk.
- The server does not provide HTTPS, email, notifications, live GPS, payroll, time tracking, billing, reporting, inventory, equipment tracking, employee home mapping, PTO, or personal schedules.
- Dates and times are business-entered values. This version does not depend on NTP or an external real-time clock.
