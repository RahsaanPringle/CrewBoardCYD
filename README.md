# CrewBoard CYD

CrewBoard is a local-first schedule, roster, message board, and business-location server for a small team. It runs on an ESP32 Cheap Yellow Display and serves its phone/desktop interface from a microSD card.

- The original `CYD-Intranet-Config` sketch remains available as the untouched baseline.
- The new implementation and setup guide are in [`CrewBoard_CYD`](CrewBoard_CYD/README.md).
- Recurring compile, upload, COM-port, and missing-file fixes are in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- Never commit a populated SD-card `config.json`; use the included placeholder sample.
