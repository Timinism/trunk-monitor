import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAlarms, isAlarming, matchesWatchFilter } from "../lib/status";
import type { TrunkObservation } from "../lib/types";

function trunk(partial: Partial<TrunkObservation> & Pick<TrunkObservation, "id" | "health">): TrunkObservation {
  return {
    name: partial.name ?? `Trunk ${partial.id}`,
    rawStatus: partial.rawStatus ?? (partial.health === "down" ? "sgsDOWN" : "sgsUP"),
    statusLabel: partial.statusLabel ?? partial.health,
    adminState: partial.adminState ?? "enabled",
    channels: partial.channels ?? 24,
    currentCalls: partial.currentCalls ?? 0,
    peers: partial.peers ?? [],
    interop: partial.interop ?? "Standard",
    protocol: partial.protocol ?? "UDP 5060",
    serverClusterId: partial.serverClusterId ?? "",
    ...partial,
  };
}

const baseOptions = {
  alertOnDegraded: false,
  alertOnStartup: false,
  alertOnRecovery: true,
  reminderMinutes: 0,
  now: new Date("2026-10-25T15:00:00.000Z"),
};

describe("evaluateAlarms", () => {
  it("does not alarm on the first look when startup alerts are off", () => {
    const [update] = evaluateAlarms([], [trunk({ id: "1", health: "down" })], baseOptions);
    assert.equal(update.transition, null);
    assert.equal(update.alarming, true);
    assert.ok(update.downSince);
  });

  it("alerts when a trunk changes from up to down, then stays quiet", () => {
    const first = evaluateAlarms([], [trunk({ id: "1", health: "up" })], baseOptions);
    const second = evaluateAlarms(first, [trunk({ id: "1", health: "down", name: "Lumen" })], {
      ...baseOptions,
      now: new Date("2026-10-25T15:01:00.000Z"),
    });
    assert.equal(second[0].transition?.kind, "down");
    assert.equal(second[0].transition?.trunk.name, "Lumen");
    const third = evaluateAlarms(second, [trunk({ id: "1", health: "down" })], {
      ...baseOptions,
      now: new Date("2026-10-25T15:02:00.000Z"),
    });
    assert.equal(third[0].transition, null);
  });

  it("sends recovery when the trunk leaves the alarm", () => {
    const down = evaluateAlarms([], [trunk({ id: "1", health: "down" })], {
      ...baseOptions,
      alertOnStartup: true,
    });
    const up = evaluateAlarms(down, [trunk({ id: "1", health: "up" })], {
      ...baseOptions,
      now: new Date("2026-10-25T16:00:00.000Z"),
    });
    assert.equal(up[0].transition?.kind, "recovery");
    assert.equal(up[0].alarming, false);
    assert.equal(up[0].downSince, null);
  });

  it("treats peers down as an alarm and draining as optional", () => {
    assert.equal(isAlarming("down", false), true);
    assert.equal(isAlarming("degraded", false), false);
    assert.equal(isAlarming("degraded", true), true);
    assert.equal(isAlarming("disabled", false), false);
    const [draining] = evaluateAlarms(
      [{ id: "1", alarmHealth: "up", alarming: false, downSince: null, lastAlertAt: null }],
      [trunk({ id: "1", health: "degraded", rawStatus: "sgsUpDraining" })],
      { ...baseOptions, alertOnDegraded: true },
    );
    assert.equal(draining.transition?.kind, "down");
  });

  it("does not clear an alarm when the status cannot be read", () => {
    const previous = evaluateAlarms([], [trunk({ id: "1", health: "down" })], {
      ...baseOptions,
      alertOnStartup: true,
    });
    const [update] = evaluateAlarms(previous, [trunk({ id: "1", health: "unknown", rawStatus: "unknown" })], {
      ...baseOptions,
      now: new Date("2026-10-25T15:05:00.000Z"),
    });
    assert.equal(update.transition, null);
    assert.equal(update.alarming, true);
    assert.equal(update.alarmHealth, "down");
  });

  it("repeats while the trunk stays down", () => {
    const down = evaluateAlarms([], [trunk({ id: "1", health: "down" })], {
      ...baseOptions,
      alertOnStartup: true,
    });
    const reminder = evaluateAlarms(down, [trunk({ id: "1", health: "down" })], {
      ...baseOptions,
      reminderMinutes: 15,
      now: new Date("2026-10-25T15:16:00.000Z"),
    });
    assert.equal(reminder[0].transition?.kind, "reminder");
  });

  it("matches watch filters by id or name", () => {
    assert.equal(matchesWatchFilter({ id: "3", name: "Microsoft Teams Direct Routing" }, ""), true);
    assert.equal(matchesWatchFilter({ id: "3", name: "Microsoft Teams Direct Routing" }, "teams, fax"), true);
    assert.equal(matchesWatchFilter({ id: "3", name: "Microsoft Teams Direct Routing" }, "1, Lumen"), false);
    assert.equal(matchesWatchFilter({ id: "3", name: "Microsoft Teams Direct Routing" }, "3"), true);
  });
});
