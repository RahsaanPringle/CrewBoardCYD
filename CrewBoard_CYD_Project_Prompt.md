# CrewBoard CYD — Project Starting Prompt

Use this prompt when beginning implementation. The name **CrewBoard** is a working project name for a simple team-coordination server that runs on a Cheap Yellow Display (CYD).

---

## Project prompt

I want to build **CrewBoard**, a local-first business coordination server for very small businesses that do not provide employee email accounts or need a full corporate system. The first example customer is a small mowing company, but the design should also suit a small boutique shop.

### Starting point and working rules

- First inspect the existing `CYD-Intranet-Config\CYD-Intranet-Config.ino` file and describe its current behavior, storage choices, Wi-Fi setup, and HTTP request handling before changing code.
- Treat it as the existing baseline. Do not overwrite it. Create a clearly named new `.ino` file for CrewBoard and preserve existing WebDAV behavior if it can be retained safely alongside the new features.
- Work incrementally and keep the implementation appropriate for the ESP32 CYD, its limited memory, and microSD storage. Avoid heavyweight frameworks, cloud services, large dependencies, or features that require a full server.
- Keep the staff interface in small HTML, CSS, and JavaScript files served by the CYD to phones or computers on the local business network. The CYD's small screen is for setup and status; normal app use is on a phone or computer.
- Put Wi-Fi settings and administrator/user credentials in a JSON configuration file on the SD card, following the existing configuration direction. Do not hard-code real credentials, show passwords on the CYD display, or expose them in web pages or logs. Provide a clearly marked sample configuration with placeholder values.
- Keep business data in simple, readable JSON files on the SD card. Design writes to avoid leaving a partially written data file if power is interrupted. Make a clear SD-card folder layout and document manual backup by copying the card.
- Before coding, identify any changes needed to the existing request handler and explain any risks or hardware limitations. Then implement only the agreed first version. Provide every changed/new file and setup instructions.

### First-version features

1. **Roster** — basic employee records and roles. Do not collect or map employees' home addresses or ZIP codes.
2. **Team Schedule** — jobs, dates/times, assigned crew, and practical job notes.
3. **Message Board** — simple team announcements and updates.
4. **Business Locations and Map** — job-site addresses and a useful view of where scheduled jobs are concentrated. Map business locations only. Keep the first map lightweight; do not add live route optimization or employee tracking.

Use shared records so a schedule entry can refer to a roster member and a business location without retyping the same information. Keep employee personal ride arrangements outside the system; coworkers can exchange personal details directly if they choose.

### Scope boundaries

Do not implement equipment tracking, supplies/inventory, checklists, reports, printouts/PDF generation, employee home-location mapping, time tracking, payroll, customer billing, or live GPS tracking in the first version. Personal schedules and PTO may be considered as a separate paid expansion later, but are not part of the initial build.

The product should be simple enough for an owner who currently uses paper schedules and phone calls. Favor clear screens, a short setup process, and reliable basic operation over feature count.

### Initial deliverables

- A brief architecture and file-layout plan before implementation.
- A new, uniquely named Arduino `.ino` file, leaving the existing baseline untouched.
- The HTML, CSS, JavaScript, JSON sample configuration, and any sample data needed for the first version.
- A concise README with wiring assumptions, Arduino libraries/board settings, SD-card layout, first-run setup, local access instructions, and manual backup/restore steps.
- A list of known limitations, especially around map data, local network access, and the CYD's small-team capacity.
