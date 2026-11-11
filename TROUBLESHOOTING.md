# CrewBoard CYD Troubleshooting

## Missing FQBN (Fully Qualified Board Name)

### Error

```text
Missing FQBN (Fully Qualified Board Name)

Compilation error: Missing FQBN (Fully Qualified Board Name)
```

This means Arduino does not know which board definition to use. It occurs before the CrewBoard source is compiled.

### Arduino IDE 2 fix

1. Open `CrewBoard_CYD/CrewBoard_CYD.ino`.
2. Click the board selector beside the **Verify** and **Upload** buttons.
3. Choose **Select other board and port**.
4. Select **ESP32 Dev Module**.
5. Select the COM port belonging to the CYD.
6. Compile or upload again.

If **ESP32 Dev Module** is unavailable:

1. Open **Tools → Board → Boards Manager**.
2. Search for `esp32`.
3. Install **esp32 by Espressif Systems**.
4. Select **Tools → Board → ESP32 Arduino → ESP32 Dev Module**.

### Recommended CYD settings

```text
Board: ESP32 Dev Module
CPU Frequency: 240MHz
Flash Frequency: 80MHz
Flash Mode: QIO
Flash Size: 4MB
Partition Scheme: Default 4MB with spiffs
Upload Speed: 460800
```

If uploading is unreliable, reduce **Upload Speed** to `115200`.

### Arduino CLI fix

Supply the ESP32 Dev Module FQBN explicitly:

```powershell
arduino-cli compile --fqbn esp32:esp32:esp32 CrewBoard_CYD
arduino-cli upload --fqbn esp32:esp32:esp32 -p COM5 CrewBoard_CYD
```

Replace `COM5` with the CYD's port. To list detected ports:

```powershell
arduino-cli board list
```

If the ESP32 platform is missing:

```powershell
arduino-cli core update-index
arduino-cli core install esp32:esp32
```

## No COM port appears

- Try a different USB cable; many inexpensive cables provide power but no data connection.
- Try another USB port without a hub.
- Check Windows Device Manager under **Ports (COM & LPT)**.
- Install the USB serial driver used by the board, commonly CH340 or CP210x.
- Disconnect and reconnect the CYD while watching which COM port appears.

## Upload cannot connect to the ESP32

If compilation succeeds but uploading times out:

1. Confirm the correct COM port is selected.
2. Reduce the upload speed to `115200`.
3. Hold the CYD's **BOOT** button.
4. Start the upload.
5. Release **BOOT** when the IDE displays `Connecting...` or begins writing.
6. Press **RESET/EN** after the upload if the sketch does not start automatically.

Not every CYD revision requires the BOOT-button procedure.

## CrewBoard page loads without styling or scripts

Confirm these files exist on the microSD card:

```text
/crewboard/www/index.html
/crewboard/www/app.css
/crewboard/www/app.js
/crewboard/www/vendor/bootstrap.min.css
/crewboard/www/vendor/bootstrap.bundle.min.js
/crewboard/www/vendor/jquery.min.js
```

Use either of these addresses:

```text
http://CYD-IP/
http://CYD-IP/crewboard/www/
```

After replacing SD-card files or reflashing, restart the CYD and perform a hard refresh in the browser.

If `/api/v1/` returns `404`, verify that `CrewBoard_CYD.ino`, rather than the original `CYD-Intranet-Config.ino`, is installed on the device.

If a custom theme does not appear in the theme menu or falls back to the classic look, confirm that the file is directly inside `/crewboard/css/` (not in a subfolder), ends in `.css`, and uses only letters, numbers, `.`, `-`, and `_` in its name. If `/config.json` names a site theme, the name must match the file exactly. A firmware build from before theme support only serves the classic look.

## Configured Wi-Fi is unavailable

CrewBoard reads `/config.json` from the SD-card root. It waits up to 20 seconds for the configured Wi-Fi network and then automatically starts its setup access point.

With the current sample configuration, use the `setupAccessPoint` SSID and password from `/config.json`. With an unchanged legacy `CYD-Intranet-Config` file that has no `setupAccessPoint` object, the compatibility defaults are:

```text
SSID: CYD-Intranet
Password: cydupload
Address: http://192.168.4.1/
```

The CYD screen shows the actual access-point IP address. It never displays the password.

## CrewBoard works by IP but not by name

First open `http://CYD-IP/` using the address on the display. This checks HTTP independently of name resolution.

- In setup access-point mode, use the displayed AP IP (normally `http://192.168.4.1/`). Name services are not started there.
- On the configured Wi-Fi network, try `http://HOSTNAME.local/` from a client with mDNS support on the same LAN. Enter the full `http://` URL so the browser does not treat the name as a search.
- Check **Host** on the CYD and the Serial log at **115200 baud**. Invalid configured names fall back to `crewboard-cyd`. Hostname changes require a restart.
- Check for `mDNS startup failed`, `mDNS HTTP service failed`, or `NetBIOS startup failed`. HTTP by IP remains available if one of these services fails.
- A plain `http://HOSTNAME/` address requires compatible router DNS or enabled client name resolution. NetBIOS may be disabled by Windows/network policy; it is not guaranteed.
- Check guest-network isolation, multicast/broadcast filtering, VPNs, VLANs, or duplicate device names. Do not assume names resolve across separate networks.

Keep a DHCP reservation for a stable numeric fallback. CrewBoard does not run a DNS server or configure router DNS.

## A new crew member cannot sign in

Open **Roster**, edit the crew member, and confirm that both a username and password have been provided. A username is optional during onboarding, but a new username cannot be activated without a password. Leaving the password blank when editing an existing login keeps its current password.

Roster login changes update the protected `users` array in `/config.json` and take effect immediately. If the update fails, check that the SD card is writable and that no more than 12 staff logins are configured.
