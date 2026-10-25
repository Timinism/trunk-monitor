import { RibbonClient } from "./ribbon-client";
import { sbcRestBase } from "./sbc-url";
import {
  getDemoDownIds,
  getPollState,
  insertEvent,
  listEvents,
  listTrunks,
  replaceTrunks,
  savePollState,
  setDemoDownIds,
  type PollState,
  type StoredTrunk,
} from "./db";
import { buildDemoTrunks, DEMO_NODE_NAME, DEMO_VERSION, demoTrunkIds } from "./demo";
import { renderReachabilityMail, renderTestMail, renderTrunkMail } from "./email";
import { ConfigError } from "./errors";
import { deliverMail } from "./mailer";
import { getSettings, saveSettings, mergeSettings } from "./settings";
import { evaluateAlarms, matchesWatchFilter } from "./status";
import type { Dashboard, Settings, TrunkObservation, TrunkView } from "./types";

type Snapshot = {
  name: string;
  version: string;
  trunks: TrunkObservation[];
  simulatedIds: Set<string>;
};

const globalState = globalThis as {
  __edgeWatch?: { timer?: ReturnType<typeof setTimeout>; chain: Promise<void> };
};

function slot() {
  if (!globalState.__edgeWatch) globalState.__edgeWatch = { chain: Promise.resolve() };
  return globalState.__edgeWatch;
}

let client: RibbonClient | null = null;
let clientKey = "";

function clientFor(settings: Settings): RibbonClient {
  const key = JSON.stringify([
    settings.sbcHost,
    settings.sbcPort,
    settings.sbcUsername,
    settings.sbcPassword,
    settings.tlsVerify,
  ]);
  if (!client || clientKey !== key) {
    client = new RibbonClient({
      baseUrl: sbcRestBase(settings.sbcHost, settings.sbcPort),
      username: settings.sbcUsername,
      password: settings.sbcPassword,
      tlsVerify: settings.tlsVerify,
    });
    clientKey = key;
  }
  return client;
}

async function collect(settings: Settings): Promise<Snapshot> {
  if (settings.mode === "demo") {
    const simulatedIds = new Set(getDemoDownIds());
    return {
      name: DEMO_NODE_NAME,
      version: DEMO_VERSION,
      trunks: buildDemoTrunks(simulatedIds),
      simulatedIds,
    };
  }
  if (!settings.sbcHost.trim() || !settings.sbcUsername.trim()) {
    throw new ConfigError("Add the SBC address and REST username in Settings.");
  }
  const ribbon = clientFor(settings);
  const system = await ribbon.getSystem().catch(() => ({ name: "", version: "" }));
  const trunks = await ribbon.getSignalingGroups();
  return {
    name: system.name || settings.sbcHost,
    version: system.version,
    trunks,
    simulatedIds: new Set(),
  };
}

function record(
  kind: "down" | "recovery" | "reminder" | "unreachable" | "reachable" | "test",
  input: {
    trunkId?: string | null;
    trunkName?: string | null;
    subject: string;
    body: string;
    status: "sent" | "failed" | "skipped";
    detail: string;
    now: Date;
  },
) {
  insertEvent({
    createdAt: input.now.toISOString(),
    kind,
    trunkId: input.trunkId ?? null,
    trunkName: input.trunkName ?? null,
    subject: input.subject,
    body: input.body,
    emailStatus: input.status,
    emailDetail: input.detail,
  });
}

export async function runPoll(options?: { manual?: boolean }): Promise<number> {
  const settings = getSettings();
  if (!settings.monitoringEnabled && !options?.manual) {
    const poll = getPollState();
    savePollState({ ...poll, lastError: poll.lastError });
    return settings.pollIntervalSeconds;
  }

  const now = new Date();
  const poll = getPollState();
  try {
    const snapshot = await collect(settings);
    const watched = snapshot.trunks.filter((trunk) => matchesWatchFilter(trunk, settings.watchFilter));
    const previous = listTrunks().map((trunk) => ({
      id: trunk.id,
      alarmHealth: trunk.alarmHealth,
      alarming: trunk.alarming,
      downSince: trunk.downSince,
      lastAlertAt: trunk.lastAlertAt,
    }));
    const updates = evaluateAlarms(previous, watched, {
      alertOnDegraded: settings.alertOnDegraded,
      alertOnStartup: settings.alertOnStartup,
      alertOnRecovery: settings.alertOnRecovery,
      reminderMinutes: settings.reminderMinutes,
      now,
    });
    const updateById = new Map(updates.map((update) => [update.id, update]));
    const stored: StoredTrunk[] = watched.map((trunk) => {
      const update = updateById.get(trunk.id);
      return {
        id: trunk.id,
        name: trunk.name,
        health: trunk.health,
        alarmHealth: update?.alarmHealth ?? trunk.health,
        alarming: update?.alarming ?? false,
        rawStatus: trunk.rawStatus,
        statusLabel: trunk.statusLabel,
        adminState: trunk.adminState,
        channels: trunk.channels,
        currentCalls: trunk.currentCalls,
        peers: trunk.peers,
        interop: trunk.interop,
        protocol: trunk.protocol,
        downSince: update?.downSince ?? null,
        lastAlertAt: update?.lastAlertAt ?? null,
        simulated: snapshot.simulatedIds.has(trunk.id),
        updatedAt: now.toISOString(),
      };
    });
    replaceTrunks(stored);

    for (const update of updates) {
      if (!update.transition) continue;
      const mail = renderTrunkMail({
        kind: update.transition.kind,
        trunk: update.transition.trunk,
        previousHealth: update.transition.previousHealth,
        sbcName: snapshot.name,
        sbcHost: settings.mode === "demo" ? "demo" : settings.sbcHost,
        downSince: update.transition.downSince,
        now,
        timezone: settings.timezone,
      });
      const delivery = await deliverMail(settings, mail);
      record(update.transition.kind, {
        trunkId: update.id,
        trunkName: update.transition.trunk.name,
        subject: mail.subject,
        body: mail.text,
        status: delivery.status,
        detail: delivery.detail,
        now,
      });
    }

    if (poll.unreachableAlertedAt) {
      const mail = renderReachabilityMail({
        kind: "reachable",
        sbcName: snapshot.name,
        sbcHost: settings.mode === "demo" ? "demo" : settings.sbcHost,
        detail: poll.lastError ?? "",
        failures: poll.consecutiveFailures,
        now,
        timezone: settings.timezone,
      });
      const delivery = await deliverMail(settings, mail);
      record("reachable", {
        subject: mail.subject,
        body: mail.text,
        status: delivery.status,
        detail: delivery.detail,
        now,
      });
    }

    savePollState({
      lastPollAt: now.toISOString(),
      lastSuccessAt: now.toISOString(),
      lastError: null,
      consecutiveFailures: 0,
      unreachableAlertedAt: null,
      sbcName: snapshot.name,
      softwareVersion: snapshot.version,
      snapshotMode: settings.mode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed.";
    if (error instanceof ConfigError) {
      savePollState({
        ...poll,
        lastPollAt: now.toISOString(),
        lastError: message,
      });
      return settings.pollIntervalSeconds;
    }
    const failures = poll.consecutiveFailures + 1;
    const next: PollState = {
      ...poll,
      lastPollAt: now.toISOString(),
      lastError: message,
      consecutiveFailures: failures,
    };
    const shouldAlert = failures >= settings.unreachableThreshold;
    const alreadyAlerted = next.unreachableAlertedAt != null;
    const reminderDue =
      shouldAlert &&
      settings.reminderMinutes > 0 &&
      alreadyAlerted &&
      now.getTime() - Date.parse(next.unreachableAlertedAt ?? "") >= settings.reminderMinutes * 60_000;
    if (shouldAlert && (!alreadyAlerted || reminderDue)) {
      const kind = alreadyAlerted ? "reminder" : "unreachable";
      const mail = renderReachabilityMail({
        kind,
        sbcName: poll.sbcName,
        sbcHost: settings.sbcHost,
        detail: message,
        failures,
        now,
        timezone: settings.timezone,
      });
      const delivery = await deliverMail(settings, mail);
      record(kind, {
        subject: mail.subject,
        body: mail.text,
        status: delivery.status,
        detail: delivery.detail,
        now,
      });
      next.unreachableAlertedAt = now.toISOString();
    }
    savePollState(next);
  }
  return settings.pollIntervalSeconds;
}

export function enqueuePoll(options?: { manual?: boolean }): Promise<number> {
  const state = slot();
  const run = state.chain.then(
    () => runPoll(options),
    () => runPoll(options),
  );
  state.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function startPoller() {
  const state = slot();
  if (state.timer) return;
  const loop = async () => {
    let wait = 60_000;
    try {
      wait = (await enqueuePoll({ manual: false })) * 1000;
    } catch {
      wait = 60_000;
    }
    state.timer = setTimeout(loop, wait);
  };
  state.timer = setTimeout(loop, 500);
}

export function getDashboard(): Dashboard {
  const settings = getSettings();
  const poll = getPollState();
  const trunks = listTrunks();
  const views: TrunkView[] = trunks.map((trunk) => ({
    id: trunk.id,
    name: trunk.name,
    health: trunk.health,
    statusLabel: trunk.statusLabel,
    rawStatus: trunk.rawStatus,
    adminState: trunk.adminState,
    channels: trunk.channels,
    currentCalls: trunk.currentCalls,
    peers: trunk.peers,
    interop: trunk.interop,
    protocol: trunk.protocol,
    downSince: trunk.downSince,
    simulated: trunk.simulated,
    updatedAt: trunk.updatedAt,
  }));
  const summary = {
    total: views.length,
    up: views.filter((trunk) => trunk.health === "up").length,
    down: views.filter((trunk) => trunk.health === "down").length,
    degraded: views.filter((trunk) => trunk.health === "degraded").length,
    disabled: views.filter((trunk) => trunk.health === "disabled").length,
    unknown: views.filter((trunk) => trunk.health === "unknown").length,
  };
  return {
    mode: settings.mode,
    sbcHost: settings.mode === "demo" ? "demo" : settings.sbcHost,
    poll: {
      lastPollAt: poll.lastPollAt,
      lastSuccessAt: poll.lastSuccessAt,
      lastError: poll.lastError,
      consecutiveFailures: poll.consecutiveFailures,
      unreachableAlerted: Boolean(poll.unreachableAlertedAt),
      sbcName: poll.sbcName,
      softwareVersion: poll.softwareVersion,
      snapshotMode: poll.snapshotMode,
      intervalSeconds: settings.pollIntervalSeconds,
      monitoringEnabled: settings.monitoringEnabled,
    },
    summary,
    trunks: views,
    recentEvents: listEvents(8),
  };
}

export async function testSbcConnection(settings: Settings): Promise<{
  ok: boolean;
  message: string;
  nodeName?: string;
  version?: string;
  trunkCount?: number;
}> {
  if (!settings.sbcHost.trim() || !settings.sbcUsername.trim()) {
    return { ok: false, message: "Add the SBC address and REST username first." };
  }
  try {
    const ribbon = new RibbonClient({
      baseUrl: sbcRestBase(settings.sbcHost, settings.sbcPort),
      username: settings.sbcUsername,
      password: settings.sbcPassword,
      tlsVerify: settings.tlsVerify,
    });
    const system = await ribbon.getSystem().catch(() => ({ name: "", version: "" }));
    const trunks = await ribbon.getSignalingGroups();
    const name = system.name || settings.sbcHost;
    return {
      ok: true,
      message: `Connected to ${name}. ${trunks.length} SIP signaling group${trunks.length === 1 ? "" : "s"} found.`,
      nodeName: name,
      version: system.version,
      trunkCount: trunks.length,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Connection failed." };
  }
}

export async function sendTestEmail(settings: Settings) {
  const now = new Date();
  const mail = renderTestMail(settings, now);
  const delivery = await deliverMail(settings, mail);
  record("test", {
    subject: mail.subject,
    body: mail.text,
    status: delivery.status,
    detail: delivery.detail,
    now,
  });
  return delivery;
}

export function simulateDemo(action: "down" | "restore", trunkId?: string) {
  const settings = getSettings();
  if (settings.mode !== "demo") {
    throw new ConfigError("Outage simulation is available in demo mode.");
  }
  const ids = new Set(getDemoDownIds());
  if (action === "restore") {
    if (trunkId) ids.delete(trunkId);
    else ids.clear();
  } else {
    const target = trunkId || demoTrunkIds()[0];
    if (!demoTrunkIds().includes(target)) throw new ConfigError("Unknown demo trunk.");
    ids.add(target);
  }
  setDemoDownIds([...ids]);
}

export function updateSettings(input: unknown): Settings {
  const next = mergeSettings(getSettings(), input);
  saveSettings(next);
  client = null;
  clientKey = "";
  return next;
}
