# Edge Watch

Edge Watch polls one or more [Ribbon SBC Edge](https://ribboncommunications.com/) appliances (SBC 1000, SBC 2000, or SBC SWe Edge) and shows the status of every SIP signaling group. On that platform the signaling group is the SIP trunk. When a trunk goes down, Edge Watch sends an email and keeps a copy of the message in the alert log. The trunk list shows up or down until you select a row, which opens the peers, channels, and call counters.

The poller logs in to the SBC REST API, then reads `GET /rest/sipsg`. It does not change the SBC. Operational state comes from `rt_Status`. The same response supplies the call counters on each trunk: active calls, channels, ingress and egress calls in progress, connected calls, and the cumulative attempt, accepted, completed, rejected, refused, blocked, and errored totals.

| Value | Meaning | Alarm |
| --- | --- | --- |
| `sgsUP` | Up | No |
| `sgsDOWN` | Down | Yes |
| `sgsUpPeersDown` | Up, peers down | Yes |
| `sgsNONE_EXISTS` | Not present | Yes |
| `sgsUpDraining` / `sgsUpDrained` | Draining or drained | Only if enabled |
| Admin disabled | Taken out of service on purpose | No |

A failed poll does not mark every trunk down. After several failures Edge Watch emails that the SBC itself is unreachable, and it emails again when polling succeeds. Each SBC is checked on its own, so one appliance being unreachable leaves the others on the trunk page.

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

`npm start` includes the background poller. `npm test` covers the Ribbon XML parser, alarm transitions, a fake SBC, the mail decision, and sign-in.

### Connect a live SBC

Open Settings in the web UI. Choose **Live SBC**, then add each appliance with its address, HTTPS port, REST username, and REST password. Save and poll stores them in this app and checks every enabled SBC on the next poll. SMTP recipients, host, username, and password are on that same page.

A `.env` file can seed those values only while `./data` is still empty. After that, the Settings page is what the monitor uses, including when the environment variables still hold the old address or password. To seed the first launch instead of typing into the page, copy the example file and edit it before starting the app.

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

The REST account has to be created in the SBC Web UI with the **REST** access level before login will succeed. Most appliances ship a self-signed certificate, so TLS verification stays off unless `SBC_TLS_VERIFY=true`.

## Sign in

The UI and API stay closed until someone signs in. Health checks at `/api/health` stay open so a container probe can run without a session. Edge Watch is meant to stay on the internal network. Do not publish it to the internet.

Two methods can be turned on together:

- Local account. Set `MONITOR_PASSWORD`. The username defaults to `admin`, or `MONITOR_USERNAME`. Restarting with a new password updates that account. After eight wrong passwords for the same name, that name is locked for 15 minutes.
- Microsoft Entra ID. Register a single-tenant app in Entra, then set the variables below. People in that directory can sign in. Set `OIDC_ALLOWED_GROUPS` to a comma-separated list of group object IDs or app role values when only some of them should get in.

Entra app registration:

1. Entra admin center, App registrations, New registration. Supported account types: this directory only.
2. Redirect URI, platform Web: the exact browser URL plus `/api/session/oidc/callback`. On a private HTTP network that is `http://edge-watch.internal:3847/api/session/oidc/callback`.
3. Certificates & secrets: create a client secret and put it in `OIDC_CLIENT_SECRET`.
4. If you set `OIDC_ALLOWED_GROUPS`, add a groups claim or an app role in Token configuration. Entra omits groups when someone is in too many of them. An app role avoids that gap.

```bash
MONITOR_USERNAME=admin
MONITOR_PASSWORD=replace-with-a-long-password
OIDC_TENANT_ID=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=http://edge-watch.internal:3847/api/session/oidc/callback
OIDC_ALLOWED_GROUPS=
```

`APP_URL` can stand in for the redirect URI. Edge Watch appends `/api/session/oidc/callback`. Leave `MONITOR_COOKIE_SECURE=false` when browsers reach the app over plain HTTP. Set it to `true` when a reverse proxy terminates HTTPS. A session lasts 12 hours.

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

## LibreNMS plugin

The same monitor is available as a local LibreNMS plugin under `librenms-plugin/RibbonTrunks`. Copy that folder to `app/Plugins/RibbonTrunks`, add the SBCs on the plugin settings page, and run `bin/poll.php` from cron. Mail goes out through LibreNMS. Install steps, the Docker mount, and the cron line are in [librenms-plugin/README.md](librenms-plugin/README.md).

## What gets stored

SQLite lives in `DATA_DIR` (`./data` for a Node install, `/data` in the container). It holds the SBC password, the SMTP password, the local account password hash, session hashes, trunk state, and alert history. The monitor only sends `GET` requests after login. It does not change the SBC.
