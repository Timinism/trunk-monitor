import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { closeDb } from "../lib/db";
import { getSettings, mergeSettings, saveSettings } from "../lib/settings";

beforeEach(() => {
  closeDb();
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "edge-watch-"));
  delete process.env.SBC_HOST;
  delete process.env.SBC_USERNAME;
  delete process.env.SBC_PASSWORD;
});

describe("settings", () => {
  it("keeps the SBC address and password saved in the UI when the environment changes", () => {
    process.env.SBC_HOST = "from-env.example";
    process.env.SBC_USERNAME = "env-user";
    process.env.SBC_PASSWORD = "env-pass";
    const seeded = getSettings();
    assert.equal(seeded.sbcHost, "from-env.example");
    assert.equal(seeded.mode, "live");

    const saved = mergeSettings(seeded, {
      sbcHost: "10.1.1.5",
      sbcUsername: "restuser",
      sbcPassword: "new-secret",
    });
    saveSettings(saved);
    process.env.SBC_HOST = "changed-env.example";
    process.env.SBC_USERNAME = "other-user";
    process.env.SBC_PASSWORD = "env-pass-2";
    closeDb();

    const again = getSettings();
    assert.equal(again.sbcHost, "10.1.1.5");
    assert.equal(again.sbcUsername, "restuser");
    assert.equal(again.sbcPassword, "new-secret");
    assert.equal(again.mode, "live");
  });

  it("replaces a REST password and can clear it", () => {
    const current = getSettings();
    const saved = mergeSettings(current, { sbcPassword: "first" });
    assert.equal(saved.sbcPassword, "first");
    const kept = mergeSettings(saved, { sbcPassword: "" });
    assert.equal(kept.sbcPassword, "first");
    const replaced = mergeSettings(kept, { sbcPassword: "second" });
    assert.equal(replaced.sbcPassword, "second");
    const cleared = mergeSettings(replaced, { sbcPassword: "", clearSbcPassword: true });
    assert.equal(cleared.sbcPassword, "");
  });

  it("requires the address, username, and password before monitoring a live SBC", () => {
    const current = getSettings();
    assert.throws(() => mergeSettings(current, { mode: "live", sbcHost: "sbc.example.com" }), /REST username/);
    assert.throws(
      () => mergeSettings(current, { mode: "live", sbcHost: "sbc.example.com", sbcUsername: "rest" }),
      /REST password/,
    );
    const ready = mergeSettings(current, {
      mode: "live",
      sbcHost: "sbc.example.com",
      sbcUsername: "rest",
      sbcPassword: "secret",
    });
    assert.equal(ready.sbcHost, "sbc.example.com");
    assert.equal(ready.sbcPassword, "secret");
    assert.equal(ready.sbcs[0]?.host, "sbc.example.com");
    assert.equal(ready.sbcs[0]?.password, "secret");
  });

  it("keeps each SBC password and allows more than one", () => {
    const current = getSettings();
    const first = mergeSettings(current, {
      mode: "live",
      sbcs: [
        {
          id: "edge-a",
          name: "Chicago",
          host: "sbc-a.example.com",
          port: 443,
          username: "rest",
          password: "secret-a",
          tlsVerify: false,
          enabled: true,
        },
      ],
    });
    const second = mergeSettings(first, {
      sbcs: [
        {
          id: "edge-a",
          name: "Chicago",
          host: "sbc-a.example.com",
          port: 443,
          username: "rest",
          password: "",
          tlsVerify: false,
          enabled: true,
        },
        {
          id: "edge-b",
          name: "Dallas",
          host: "sbc-b.example.com",
          port: 8443,
          username: "rest",
          password: "secret-b",
          tlsVerify: true,
          enabled: true,
        },
      ],
    });
    assert.equal(second.sbcs.length, 2);
    assert.equal(second.sbcs[0].password, "secret-a");
    assert.equal(second.sbcs[1].password, "secret-b");
    assert.equal(second.sbcs[1].tlsVerify, true);
    assert.equal(second.sbcHost, "sbc-a.example.com");

    const cleared = mergeSettings(second, {
      mode: "demo",
      sbcs: [
        {
          id: "edge-a",
          name: "Chicago",
          host: "sbc-a.example.com",
          port: 443,
          username: "rest",
          password: "",
          clearPassword: true,
          tlsVerify: false,
          enabled: true,
        },
        {
          id: "edge-c",
          name: "",
          host: "",
          port: 443,
          username: "",
          password: "",
          tlsVerify: false,
          enabled: true,
        },
      ],
    });
    assert.equal(cleared.mode, "demo");
    assert.equal(cleared.sbcs.length, 1);
    assert.equal(cleared.sbcs[0].password, "");
    assert.throws(() => mergeSettings(cleared, { mode: "live" }), /REST password/);
  });
});
