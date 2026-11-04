# Local development and CYD deployment

## Documentation pages

Standalone HTML documents live in `docs\SitePages` and can be opened directly in
a browser without the development server. All pages load shared styles from
`docs\SiteAssets\css\site.css` and shared behavior from
`docs\SiteAssets\js\site.js`. Page-specific styles also live in the assets CSS
folder to preserve each page's layout. The shared script makes overflowing
tables keyboard-focusable; pages remain readable without JavaScript.

Use `../SiteAssets/` for page asset URLs, `../` for Markdown documents in `docs`,
and `../../` for repository-root resources. Data exports belong in
`docs\SiteAssets\data`; they are not automatically loaded by the pages.

## Start locally

Install Node.js 22 or newer, then run from the repository root:

```powershell
npm run dev
```

No npm packages or Arduino hardware are required. Open **http://127.0.0.1:8080**.
On the first run the terminal prints randomly generated owner and staff credentials.
These are development-only accounts, not the credentials from your SD card.
Later runs preserve the same accounts; find them in `.local-dev\config.json`.
Stop the server with Ctrl+C. To use another port:

```powershell
$env:PORT = "8081"
npm run dev
```

The server binds only to `127.0.0.1`. It is a development tool, not a production
server or a replacement for the CYD firmware. Do not expose it through a proxy
or port forward.

## One web interface, two hosts

Edit the deployable files directly:

- [HTML](../CrewBoard_CYD/sd-card/crewboard/www/index.html)
- [JavaScript](../CrewBoard_CYD/sd-card/crewboard/www/app.js)
- [Styles](../CrewBoard_CYD/sd-card/crewboard/www/app.css)
- Local themes in `crewboard\css`, plus deployable themes in
  `CrewBoard_CYD\sd-card\crewboard\css`

Refresh the browser after editing; there is no bundling or build step. Both `/`
and `/crewboard/www/` work. Other files in the root-level `crewboard` working
copy and `CrewBoardSales` are not served or synchronized.

### Switch styles

Use the **Theme** menu in the top bar to select any CSS theme from either theme
folder, including Brite, Cyborg, and Vapor when present in `crewboard\css`.
The selection is saved in this browser and survives refreshes. Refresh the page
after adding a theme file. If both folders contain the same filename, the local
`crewboard\css` version takes precedence. Up to 40 themes are listed.

**Site default (Classic)** and **CrewBoard classic** intentionally look the same
when no site theme is configured. To give Site default a different style, set
`"theme": "vapor.min.css"` (or another available filename) in
`.local-dev\config.json`, then refresh. Classic always keeps the original look.
To deploy a theme tested from `crewboard\css`, copy that CSS file to
`/crewboard/css` on the SD card; the CYD cannot access the repository's local folder.

The Node server mirrors the existing HTTP Basic authentication, owner/staff
permissions, collection APIs, login management, profiles, nested messages,
themes, and `/dav/` shared-file routes. It enforces the CYD's 24,576-byte JSON
write limit, collection counts, 12 staff accounts/crew assignments, and 8 MiB
upload limit. New installations include one staff login linked to the sample
crew member so **Edit my details** can be tested immediately.

The Arduino sketch remains the authoritative device implementation. Changes to
API behavior must be applied to both hosts and covered by local tests.
The local server does not emulate ESP32 networking, display, memory, SD timing,
Wi-Fi fallback, or power-loss behavior. Windows-specific unsafe filenames and
filesystem symlinks are rejected locally. Test firmware and hardware on the
actual CYD before release.

## Isolated, persistent development data

On first start, sample collections and shared files are copied from
`CrewBoard_CYD\sd-card\crewboard` into `.local-dev`. Existing local data is never
reseeded. Invalid data causes an explicit error instead of being silently reset.

- Browser writes affect only `.local-dev\data`, `.local-dev\shared`, and
  `.local-dev\config.json`.
- Replaced files retain a `.bak` copy; temporary files are installed by rename.
- No existing root or SD-card `config.json` is read or changed.
- `.local-dev` is ignored by Git. It contains plaintext development passwords
  and may contain private data; do not commit or publish it.

To try the root working-copy demo records, stop the server, back up
`.local-dev\data`, then copy only the four JSON collection files from
`crewboard\data` into `.local-dev\data`. Restart to validate the records.
For a fresh sample environment, stop the server and **rename** `.local-dev` to
a backup folder outside the repository. The next start creates fresh data and
credentials. Keep any backup protected.

## Validate

```powershell
npm run check
npm test
```

Tests use isolated OS temporary folders and remove only the test data they
create. They cover permissions, response shapes, persistence/restarts, byte
limits, validation, traversal rejection, messages, profiles, accounts, static
assets, and WebDAV. No SD card or existing business records are used.

## Deploy to the CYD

1. Stop local development and power off the CYD before removing its SD card.
2. Back up the entire card, especially `/config.json` and `/crewboard/data`.
3. Copy the contents of `CrewBoard_CYD\sd-card\crewboard\www` to
   `/crewboard/www` on the card. Copy any changed theme files to `/crewboard/css`.
   HTML, CSS, and JavaScript changes do not require a firmware upload.
4. Preserve the card's `/config.json`, `/crewboard/data`, and `/crewboard/shared`.
   Do not copy the whole sample SD-card tree over a working deployment.
5. Only if intentionally transferring development records, copy the four JSON
   files from `.local-dev\data` to `/crewboard/data` after backing up the card.
   Never deploy the generated local configuration; configure device staff
   accounts separately to match the roster.
6. If the Arduino sketch changed, compile/upload it using the
   [existing Arduino instructions](../CrewBoard_CYD/README.md#arduino-setup).
7. Reinsert the card, boot the CYD, and verify login, reads/writes, themes and
   shared files at its displayed IP address.
