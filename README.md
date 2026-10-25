# Edge Watch

Edge Watch polls a [Ribbon SBC Edge](https://ribboncommunications.com/) (SBC 1000, SBC 2000, or SBC SWe Edge) and shows the status of every SIP signaling group. On that platform the signaling group is the SIP trunk. When a trunk goes down, Edge Watch sends an email and keeps a copy of the message in the alert log.

The poller logs in to the SBC REST API, then reads `GET /rest/sipsg`. Operational state comes from `rt_Status`:

| Value | Meaning | Alarm |
| --- | --- | --- |
| `sgsUP` | Up | No |
| `sgsDOWN` | Down | Yes |
| `sgsUpPeersDown` | Up, peers down | Yes |
| `sgsNONE_EXISTS` | Not present | Yes |
| `sgsUpDraining` / `sgsUpDrained` | Draining or drained | Only if enabled |
| Admin disabled | Taken out of service on purpose | No |

A failed poll does not mark every trunk down. After several failures Edge Watch emails that the SBC itself is unreachable, and it emails again when polling succeeds.

## Run it in Docker

```bash
docker compose up --build
```

Open http://127.0.0.1:3847. With no SBC configured, the app starts in demo mode so you can simulate an outage and inspect the alert. Settings are stored in the `edge-watch-data` volume and survive restarts. Environment variables in `.env` seed that database the first time it is created.

Copy `.env.example` to `.env` and set the live values:

```bash
SBC_HOST=sbc.example.com
SBC_USERNAME=restuser
SBC_PASSWORD=replace-me
ALERT_TO=noc@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=Edge Watch <noc@example.com>
```

The REST account has to be created in the SBC Web UI with the **REST** access level before login will succeed. Most appliances ship a self-signed certificate, so TLS verification is off unless `SBC_TLS_VERIFY=true`.

To catch mail locally, start the optional inbox and point SMTP at it:

```bash
docker compose --profile mail up --build
```

Set `SMTP_HOST=mailpit` and `SMTP_PORT=1025` on the `edge-watch` service. The inbox is at http://127.0.0.1:8025.

Set `MONITOR_PASSWORD` to require a password for the UI and API. The session cookie is not marked Secure unless `MONITOR_COOKIE_SECURE=true`, so the lock works over plain HTTP on a trusted network. Put the container behind HTTPS before exposing it further.

## Run it locally

Node.js 22 or newer:

```bash
npm install
npm run dev
```

The dev server listens on http://127.0.0.1:3847. `npm test` covers the Ribbon XML parser, alarm transitions, a fake SBC, and the mail decision. `npm run build && npm start` runs the production server, including the background poller.

## What gets stored

SQLite lives in `DATA_DIR` (`./data` locally, `/data` in the container). It holds the SBC password, the SMTP password, trunk state, and alert history. The monitor only sends `GET` requests after login. It does not change the SBC.
