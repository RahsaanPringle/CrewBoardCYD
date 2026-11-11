# TraxxiServer HTTPS Firmware

This is a separate HTTPS variant. The original `firmware/TraxxiServer` HTTP sketch is unchanged.

## SD Card

Use the existing `TraxxiServer/sd-card` contents, including `/config.json` and `/traxxi/www`. Add these PEM files:

```text
/traxxi/tls/server.crt
/traxxi/tls/server.key
```

Create a self-signed certificate for the default hostname with OpenSSL:

```powershell
openssl req -x509 -newkey rsa:2048 -nodes -days 365 `
  -keyout server.key -out server.crt `
  -subj "/CN=traxxi-server.local" `
  -addext "subjectAltName=DNS:traxxi-server.local" `
  -addext "extendedKeyUsage=serverAuth"
```

If `config.json` uses a different hostname, change the certificate's DNS subject alternative name to `<hostname>.local`. Copy the certificate and key to the SD-card paths above. Do not commit or share the private key.

Browsers will warn until the certificate is trusted by the client. Access by the matching hostname, for example `https://traxxi-server.local/`; accessing by IP also requires that IP in the certificate's subject alternative names. The HTTPS server does not start a plain-HTTP listener or redirect HTTP requests.

## Firmware

Open `TraxxiServerHttps.ino` in Arduino IDE and select the same ESP32 Dev Module settings as the original firmware. The HTTPS server listens on port 443, advertises `_https._tcp` over mDNS, and keeps the existing Basic Authentication credentials and routes.