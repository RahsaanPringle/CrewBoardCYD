# PBI: Reach CrewBoard by a memorable local network name

**Type:** Product Backlog Item
**Status:** Proposed
**Area:** CrewBoard CYD / Network access

## User story

As a crew member on the business's local Wi-Fi, I want to open CrewBoard using a memorable device name instead of looking up its IP address, so that I can reach the schedule and message board more easily.

## Business value

Crew members can find CrewBoard without remembering or bookmarking a changing numeric IP address. This is especially useful when the router assigns the CYD a different address after a restart.

## Description

Add configurable local name support to the CYD firmware. The CYD should announce a hostname on the local network and provide:

- mDNS resolution at `http://<hostname>.local/` on clients that support mDNS.
- A Wi-Fi DHCP hostname so compatible routers can resolve a plain name, such as `http://cydnet/`.
- NetBIOS name resolution for compatible Windows clients.
- The hostname alongside the device IP address on the CYD status display.

For example, with the hostname `cydnet`, supported devices can use `http://cydnet.local/`. A plain `http://cydnet/` depends on the router's DNS behavior or the client's name-resolution support; it must not be presented as guaranteed on every device.

## Acceptance criteria

1. **Configurable hostname**
   - The sample configuration documents an optional hostname setting.
   - The hostname is validated before use and is limited to 15 ASCII letters, digits, or hyphens; it cannot start or end with a hyphen.
   - If the setting is absent, invalid, or empty, CrewBoard uses a documented default hostname and continues starting normally.
   - Existing configuration files without the new setting remain compatible.

2. **mDNS**
   - After joining the configured Wi-Fi network, the CYD advertises its HTTP service over mDNS.
   - A client on the same local network with mDNS support can open `http://<hostname>.local/` and reach CrewBoard.
   - If mDNS startup fails, the device continues serving HTTP at its IP address and reports the failure through the existing status/logging mechanism.

3. **DHCP hostname and Windows name resolution**
   - The CYD supplies the configured hostname when joining Wi-Fi, before starting the connection.
   - The CYD advertises the same name using NetBIOS name service where supported.
   - Documentation explains that plain-name resolution depends on the router/client and is not guaranteed by setting a hostname alone.

4. **Status display**
   - When the device has an IP address, the status display shows both the hostname and address without obscuring existing startup or network status information.

5. **Compatibility and network modes**
   - CrewBoard remains accessible by its IP address.
   - Existing HTTP authentication, API, and WebDAV behavior are unchanged.
   - If the device starts its setup access point, its existing setup instructions and displayed access-point address continue to work; documentation states which hostname forms are available in that mode.

6. **Documentation**
   - Setup documentation explains the `.local` address, plain-name/router dependency, IP reservation recommendation, and common client/network limitations.
   - The documentation does not imply that this feature runs a DNS server or guarantees plain-name resolution on every network.

## Implementation notes

- Use the ESP32 Arduino core's `WiFi.setHostname`, `ESPmDNS`, and NetBIOS support if available in the configured core version.
- Set the Wi-Fi hostname before connecting to the access point.
- Start mDNS and NetBIOS only after the network interface has an address; handle failure without taking down the HTTP server.
- Keep the configured name consistent across DHCP hostname, mDNS, NetBIOS, and the status display.
- Validate the feature with an IP address as the fallback, `.local` resolution on a supported client, and plain-name resolution on a router/client combination that supports it.

## Out of scope

- Running a DNS server on the CYD.
- Changing router settings automatically or configuring DHCP reservations.
- Guaranteeing `http://<hostname>/` resolution on every phone, computer, or router.
- Remote access, HTTPS, or name resolution across guest networks, VLANs, or isolated Wi-Fi clients.
- Changing the existing setup access point credentials or adding an in-browser network configuration page.

## Definition of done

- Firmware builds for the documented ESP32 board configuration.
- Existing configuration without a hostname still starts and serves CrewBoard by IP.
- Acceptance criteria are verified on hardware or documented compatible network/client combinations.
- Configuration and user documentation are updated.
