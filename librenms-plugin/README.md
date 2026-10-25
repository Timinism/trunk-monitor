# Ribbon trunks for LibreNMS

Ribbon trunks is a local [LibreNMS](https://docs.librenms.org/Extensions/Plugin-System/) plugin. It polls one or more Ribbon SBC Edge appliances (SBC 1000, SBC 2000, or SBC SWe Edge) and lists every SIP signaling group. On that platform the signaling group is the SIP trunk. The row shows up or down until it is opened. Opening it shows peers, channels, and the call counters from `GET /rest/sipsg`.

The poller logs in, then only sends GET requests. It does not change the SBC. When a trunk goes down, the plugin emails the recipients you set, using the mail transport LibreNMS already has, and writes a matching line to the LibreNMS event log. If the SBC hostname matches a LibreNMS device, the event is attached to that device.

A failed poll does not mark every trunk down. After the configured number of failures the plugin emails that the SBC itself is unreachable, and it emails again when polling succeeds. Each SBC is checked on its own.

This copy is installed by placing the folder in LibreNMS. It is not published on Packagist.

## Install on a LibreNMS server

The folder name has to stay `RibbonTrunks`. LibreNMS loads hooks from `app/Plugins/RibbonTrunks` and the PHP namespace matches that directory.

```bash
cp -a librenms-plugin/RibbonTrunks /opt/librenms/app/Plugins/RibbonTrunks
chown -R librenms:librenms /opt/librenms/app/Plugins/RibbonTrunks
```

Restart PHP-FPM so it sees the new files. Sign in as a user who can read devices. **Plugins → Ribbon trunks** appears after LibreNMS registers the plugin, which happens on the next page load. Open **Plugin Admin → RibbonTrunks** and add each appliance:

- address, HTTPS port, REST username, and REST password
- leave **Verify TLS** off unless this server trusts the SBC certificate (the appliances usually present a self-signed certificate)
- alert recipients, as a comma-separated list

The REST account has to exist in the SBC web UI with the REST access level. Saving the form sends the password back because LibreNMS replaces the whole settings record. Clearing the password field forgets it. Anyone who can open plugin settings can read that password.

Cron runs the poller every minute. The poller itself waits until the interval from the settings page has elapsed, so a one-minute cron is right even when the interval is longer. `php bin/poll.php --now` polls immediately.

```cron
* * * * * librenms php /opt/librenms/app/Plugins/RibbonTrunks/bin/poll.php >> /dev/null 2>&1
```

**Poll now** on the trunk page does the same thing for an admin. Trunk rows stay collapsed until opened. That state is the browser's disclosure widget, so a refresh closes them again.

The latest snapshot is `storage/app/ribbon-trunks.json` inside the LibreNMS install. SBC passwords stay in the LibreNMS `plugins` table, not in that file.

## Docker

The official `librenms/librenms` image links `/data/plugins` into the old `html/plugins` location. This plugin will not load from there. Mount the folder onto the v2 plugin path and restart the container:

```yaml
services:
  librenms:
    image: librenms/librenms:latest
    volumes:
      - ./RibbonTrunks:/opt/librenms/app/Plugins/RibbonTrunks:ro
```

If `LIBRENMS_PATH` is not `/opt/librenms`, mount the folder under that path plus `/app/Plugins/RibbonTrunks`.

Poll from the host so the schedule survives a new container:

```cron
* * * * * docker exec librenms php /opt/librenms/app/Plugins/RibbonTrunks/bin/poll.php >> /dev/null 2>&1
```

Use the container name from `docker ps`. A recreated container keeps settings in the database. The snapshot under `storage/app` is inside the container filesystem, so a new container starts from a fresh first poll. Trunks that are already down are not emailed unless **Email trunks that are already down on the first poll** is checked.

## Checks

From this repository, with PHP CLI, XML, and curl:

```bash
php librenms-plugin/tests/plugin-test.php
```

The script covers the Ribbon XML parser, alarm transitions, the REST URL, and a poll of several SBCs with a fake appliance. It does not contact a live SBC.
