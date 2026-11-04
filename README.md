# CrewBoard CYD

CrewBoard is a local-first schedule, roster, message board, and business-location server for a small team. It runs on an ESP32 Cheap Yellow Display and serves its phone/desktop interface from a microSD card.

- The original `CYD-Intranet-Config` sketch remains available as the untouched baseline.
- The new implementation and setup guide are in [`CrewBoard_CYD`](CrewBoard_CYD/README.md).
- Recurring compile, upload, COM-port, and missing-file fixes are in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- Never commit a populated SD-card `config.json`; use the included placeholder sample.

## Local development

With Node.js 22 or newer, run `npm run dev` from this folder and open
`http://127.0.0.1:8080`. No package installation is needed. The first run prints
development login credentials. The local server uses the same deployable SD-card
web assets and keeps its data and credentials separately in ignored `.local-dev`.
The Arduino/CYD build is unchanged.

See [local development and safe CYD deployment](docs/local-development.md) for
editing, tests, persistent data, and transferring changes without overwriting
device configuration or business records.

## Working-copy demo data

The root `crewboard/data` folder includes additional fictional landscaping records: six employees, seven Virginia locations, twelve jobs dated November 2-11, 2026, and five messages including nested replies. Existing records and `.bak` files are preserved. These additions are in the working-copy folder, not `CrewBoard_CYD/sd-card/crewboard/data`; copy the four JSON files to `/crewboard/data` on the SD card while the device is powered off to use them.

New locations use real ZIP-area coordinates for Moneta (24121), Roanoke (24018), Salem (24153), Christiansburg (24073), Blacksburg (24060), Rocky Mount (24151), and Bedford (24523), verified against [Zippopotam.us](https://api.zippopotam.us/us/24121). They are approximate map points, not street addresses or real customer sites. The pre-existing sample locations are unchanged.

Added employees use fictional `555-01xx` phone numbers and `example.com` emails. Their usernames are blank; demo records do not create login accounts or change protected configuration.
