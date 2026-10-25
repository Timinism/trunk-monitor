# Edge Watch

Edge Watch polls a [Ribbon SBC Edge](https://ribboncommunications.com/) (SBC 1000, SBC 2000, or SBC SWe Edge) and shows the status of every SIP signaling group. On that platform the signaling group is the SIP trunk. When a trunk goes down, Edge Watch sends an email and keeps a copy of the message in the alert log.

The poller logs in to the SBC REST API, then reads `GET /rest/sipsg`. It does not change the SBC. Operational state comes from `rt_Status`. The same response supplies the call counters on each trunk: active calls, channels, ingress and egress calls in progress, connected calls, and the cumulative attempt, accepted, completed, rejected, refused, blocked, and errored totals.

| Value | Meaning | Alarm |
| --- | --- | --- |
| `sgsUP` | Up | No |
| `sgsDOWN` | Down | Yes |
| `sgsUpPeersDown` | Up, peers down | Yes |
| `sgsNONE_EXISTS` | Not present | Yes |
| `sgsUpDraining` / `sgsUpDrained` | Draining or drained | Only if enabled |
| Admin disabled | Taken out of service on purpose | No |

A failed poll does not mark every trunk down. After several failures Edge Watch emails that the SBC itself is unreachable, and it emails again when polling succeeds.

## Install with Node.js

Install [Node.js 22](https://nodejs.org/) or newer. Clone the repo if you have not already, then run the install from that directory. `npm install` in your home folder fails because `package.json` is not there.

```bash
origin repo clone ttec/trunk-monitor
cd trunk-monitor
npm install
npm run dev
```

Open http://127.0.0.1:3847. With no SBC configured, the app starts in demo mode so you can simulate an outage and read the alert. If `trunk-monitor` already exists, skip the clone and start with `cd trunk-monitor`.

For a long-running process:

```bash
npm run build
npm start
```

`npm start` includes the background poller. `npm test` covers the Ribbon XML parser, alarm transitions, a fake SBC, and the mail decision.

### Connect a live SBC

You can enter the SBC and SMTP settings in the web UI. To seed them on the first launch instead, copy the example file and edit it before starting the app.

PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS, Linux, or WSL:

```bash
cp .env.example .env
```

```bash
SBC_HOST=sbc.example.com
SBC_USERNAME=restuser
SBC_PASSWORD=replace-me
ALERT_TO=noc@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=Edge Watch <noc@example.com>
```

Those variables are read only while `./data` is still empty. After that, Settings in the UI is what the monitor keeps.

The REST account has to be created in the SBC Web UI with the **REST** access level before login will succeed. Most appliances ship a self-signed certificate, so TLS verification stays off unless `SBC_TLS_VERIFY=true`.

Set `MONITOR_PASSWORD` to require a password for the UI and API. The session cookie is not marked Secure unless `MONITOR_COOKIE_SECURE=true`, so the lock works over plain HTTP on a trusted network.

## Install with Docker

Docker is optional. With Docker Desktop or Docker Engine installed:

```bash
docker compose up --build
```

The app listens on http://127.0.0.1:3847. Settings are stored in the `edge-watch-data` volume. A `.env` file next to `docker-compose.yml` seeds that volume the first time it is created. Use the same variables as `.env.example`.

To catch mail locally, start the optional inbox and point SMTP at the Compose network:

```bash
docker compose --profile mail up --build
```

Set `SMTP_HOST=mailpit` and `SMTP_PORT=1025`. The inbox is at http://127.0.0.1:8025.

## What gets stored

SQLite lives in `DATA_DIR` (`./data` for a Node install, `/data` in the container). It holds the SBC password, the SMTP password, trunk state, and alert history. The monitor only sends `GET` requests after login. It does not change the SBC.
