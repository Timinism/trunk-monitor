import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { closeDb, getPollState, listEvents } from "../lib/db";
import { setMailSenderForTests, type OutboundMail } from "../lib/mailer";
import { getDashboard, runPoll, simulateDemo } from "../lib/monitor";
import { getSettings, saveSettings } from "../lib/settings";

const sent: OutboundMail[] = [];

beforeEach(() => {
  closeDb();
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "edge-watch-"));
  delete process.env.SBC_HOST;
  delete process.env.SBC_PASSWORD;
  delete process.env.SBC_USERNAME;
  delete process.env.ALERT_TO;
  delete process.env.SMTP_HOST;
  sent.length = 0;
  setMailSenderForTests(async (mail) => {
    sent.push(mail);
  });
});

describe("monitor", () => {
  it("polls the demo SBC and emails only on a down transition and recovery", async () => {
    await runPoll({ manual: true });
    const initial = getDashboard();
    assert.equal(initial.mode, "demo");
    assert.equal(initial.poll.sbcName, "edge-lab-01");
    assert.equal(initial.summary.up, 3);
    assert.equal(initial.summary.disabled, 1);
    assert.equal(sent.length, 0);

    simulateDemo("down", "1");
    await runPoll({ manual: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /DOWN: PSTN — Lumen primary/);
    assert.match(sent[0].text, /State: Down/);
    assert.equal(getDashboard().summary.down, 1);
    const downEvent = listEvents(5)[0];
    assert.equal(downEvent.kind, "down");
    assert.equal(downEvent.emailStatus, "sent");

    await runPoll({ manual: true });
    assert.equal(sent.length, 1);

    simulateDemo("restore", "1");
    await runPoll({ manual: true });
    assert.equal(sent.length, 2);
    assert.match(sent[1].subject, /RECOVERED: PSTN — Lumen primary/);
    assert.equal(getDashboard().summary.down, 0);
  });

  it("records a skipped email when SMTP is not configured", async () => {
    setMailSenderForTests(null);
    await runPoll({ manual: true });
    simulateDemo("down", "3");
    await runPoll({ manual: true });
    const [event] = listEvents(5);
    assert.equal(event.kind, "down");
    assert.equal(event.emailStatus, "skipped");
    assert.match(event.emailDetail, /SMTP host/);
    assert.match(event.body, /Microsoft Teams/);
  });

  it("limits alerts to the watch filter", async () => {
    const settings = getSettings();
    saveSettings({ ...settings, watchFilter: "Teams" });
    simulateDemo("down", "1");
    await runPoll({ manual: true });
    assert.equal(sent.length, 0);
    assert.equal(getDashboard().trunks.length, 1);
    simulateDemo("down", "3");
    await runPoll({ manual: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Teams/);
  });

  it("does not email when the live SBC address is missing", async () => {
    const settings = getSettings();
    saveSettings({ ...settings, mode: "live", sbcHost: "", sbcUsername: "" });
    await runPoll({ manual: true });
    const poll = getPollState();
    assert.match(poll.lastError ?? "", /SBC address/);
    assert.equal(poll.consecutiveFailures, 0);
    assert.equal(sent.length, 0);
  });

  it("emails once when the live SBC cannot be reached", async () => {
    const settings = getSettings();
    saveSettings({
      ...settings,
      mode: "live",
      sbcHost: "127.0.0.1",
      sbcPort: 9,
      sbcUsername: "restuser",
      sbcPassword: "secret",
      tlsVerify: false,
      unreachableThreshold: 2,
      alertRecipients: "noc@example.com",
    });
    await runPoll({ manual: true });
    assert.equal(sent.length, 0);
    await runPoll({ manual: true });
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /SBC UNREACHABLE/);
    assert.equal(getPollState().consecutiveFailures, 2);
    await runPoll({ manual: true });
    assert.equal(sent.length, 1);
  });
});
