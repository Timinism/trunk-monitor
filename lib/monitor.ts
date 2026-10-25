import { RibbonClient } from "./ribbon-client";
import { sbcRestBase } from "./sbc-url";
import {
  getDemoDownIds,
  getPollState,
  getSbcRuntimes,
  insertEvent,
  listEvents,
  listTrunks,
  replaceTrunks,
  savePollState,
  saveSbcRuntimes,
  setDemoDownIds,
  type PollState,
  type SbcRuntime,
  type StoredTrunk,
} from "./db";
import { buildDemoTrunks, DEMO_NODE_NAME, DEMO_VERSION, demoTrunkIds } from "./demo";
import { renderReachabilityMail, renderTestMail, renderTrunkMail } from "./email";
import { ConfigError } from "./errors";
import { deliverMail } from "./mailer";
import { getSettings, mergeSettings, saveSettings, sbcLabel } from "./settings";
import { evaluateAlarms, matchesWatchFilter, type AlarmUpdate } from "./status";
import type { Dashboard, DashboardSbc, SbcConfig, Settings, TrunkObservation, TrunkView } from "./types";

type Snapshot = {
  sbcId: string;
  name: string;
  host: string;
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

const clients = new Map<string, { key: string; client: RibbonClient }>();

function clientFor(sbc: SbcConfig): RibbonClient {
  const key = JSON.stringify([sbc.host, sbc.port, sbc.username, sbc.password, sbc.tlsVerify]);
  const cached = clients.get(sbc.id);
  if (cached && cached.key === key) return cached.client;
  const client = new RibbonClient({
    baseUrl: sbcRestBase(sbc.host, sbc.port),
    username: sbc.username,
    password: sbc.password,
    tlsVerify: sbc.tlsVerify,
  });
  clients.set(sbc.id, { key, client });
  return client;
}

function emptyRuntime(): SbcRuntime {
  return {
    lastError: null,
    consecutiveFailures: 0,
    unreachableAlertedAt: null,
    nodeName: "",
    softwareVersion: "",
    lastSuccessAt: null,
  };
}

function pollable(sbc: SbcConfig): boolean {
  return Boolean(sbc.enabled && sbc.host.trim() && sbc.username.trim() && sbc.password);
}

function collectDemo(): Snapshot {
  const simulatedIds = new Set(getDemoDownIds());
  return {
    sbcId: "demo",
    name: DEMO_NODE_NAME,
    host: "demo",
    version: DEMO_VERSION,
    trunks: buildDemoTrunks(simulatedIds),
    simulatedIds,
  };
}

async function collectSbc(sbc: SbcConfig): Promise<Snapshot> {
  const ribbon = clientFor(sbc);
  const system = await ribbon.getSystem().catch(() => ({ name: "", version: "" }));
  const name = system.name || sbc.name.trim() || sbc.host;
  const trunks = (await ribbon.getSignalingGroups()).map((trunk) => {
    const sgId = trunk.sgId || trunk.id;
    return {
      ...trunk,
      sgId,
      id: `${sbc.id}:${sgId}`,
      sbcId: sbc.id,
      sbcName: name,
      sbcHost: sbc.host,
    };
  });
  return {
    sbcId: sbc.id,
    name,
    host: sbc.host,
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

function toStored(
  trunk: TrunkObservation,
  update: AlarmUpdate | undefined,
  snapshot: Snapshot,
  now: Date,
): StoredTrunk {
  return {
    id: trunk.id,
    sbcId: trunk.sbcId,
    sbcName: trunk.sbcName,
    sbcHost: trunk.sbcHost,
    sgId: trunk.sgId,
    name: trunk.name,
    health: trunk.health,
    alarmHealth: update?.alarmHealth ?? trunk.health,
    alarming: update?.alarming ?? false,
    rawStatus: trunk.rawStatus,
    statusLabel: trunk.statusLabel,
    adminState: trunk.adminState,
    channels: trunk.channels,
    currentCalls: trunk.currentCalls,
    calls: trunk.calls,
    peers: trunk.peers,
    interop: trunk.interop,
    protocol: trunk.protocol,
    downSince: update?.downSince ?? null,
    lastAlertAt: update?.lastAlertAt ?? null,
    simulated: snapshot.simulatedIds.has(trunk.id) || snapshot.simulatedIds.has(trunk.sgId),
    updatedAt: now.toISOString(),
  };
}

async function alarmAndStore(
  settings: Settings,
  snapshot: Snapshot,
  watched: TrunkObservation[],
  previousTrunks: StoredTrunk[],
  now: Date,
): Promise<StoredTrunk[]> {
  const previous = previousTrunks.map((trunk) => ({
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
  const stored = watched.map((trunk) => toStored(trunk, updateById.get(trunk.id), snapshot, now));
  for (const update of updates) {
    if (!update.transition) continue;
    const trunk = update.transition.trunk;
    const mail = renderTrunkMail({
      kind: update.transition.kind,
      trunk,
      previousHealth: update.transition.previousHealth,
      sbcName: trunk.sbcName || snapshot.name,
      sbcHost: snapshot.host,
      downSince: update.transition.downSince,
      now,
      timezone: settings.timezone,
    });
    const delivery = await deliverMail(settings, mail);
    record(update.transition.kind, {
      trunkId: update.id,
      trunkName: trunk.name,
      subject: mail.subject,
      body: mail.text,
      status: delivery.status,
      detail: delivery.detail,
      now,
    });
  }
  return stored;
}

async function sendReachable(
  settings: Settings,
  input: { name: string; host: string; detail: string; failures: number },
  now: Date,
) {
  const mail = renderReachabilityMail({
    kind: "reachable",
    sbcName: input.name,
    sbcHost: input.host,
    detail: input.detail,
    failures: input.failures,
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

async function commitSnapshot(settings: Settings, snapshot: Snapshot, poll: PollState, now: Date) {
  const watched = snapshot.trunks.filter((trunk) => matchesWatchFilter(trunk, settings.watchFilter));
  const stored = await alarmAndStore(settings, snapshot, watched, listTrunks(), now);
  replaceTrunks(stored);
  if (poll.unreachableAlertedAt) {
    await sendReachable(
      settings,
      {
        name: snapshot.name,
        host: snapshot.host,
        detail: poll.lastError ?? "",
        failures: poll.consecutiveFailures,
      },
      now,
    );
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
}

function runtimeFor(
  sbc: SbcConfig,
  settings: Settings,
  poll: PollState,
  runtimes: Record<string, SbcRuntime>,
): SbcRuntime {
  if (runtimes[sbc.id]) return { ...runtimes[sbc.id] };
  const enabled = settings.sbcs.filter((item) => item.enabled);
  if (enabled.length <= 1 && (poll.consecutiveFailures > 0 || poll.unreachableAlertedAt || poll.lastError)) {
    return {
      lastError: poll.lastError,
      consecutiveFailures: poll.consecutiveFailures,
      unreachableAlertedAt: poll.unreachableAlertedAt,
      nodeName: poll.sbcName,
      softwareVersion: poll.softwareVersion,
      lastSuccessAt: poll.lastSuccessAt,
    };
  }
  return emptyRuntime();
}

async function pollLive(settings: Settings, poll: PollState, now: Date) {
  const targets = settings.sbcs.filter(pollable);
  if (targets.length === 0) {
    throw new ConfigError("Add the SBC address and REST username in Settings.");
  }

  const runtimes = getSbcRuntimes();
  const previous = listTrunks();
  const notes: string[] = [];
  for (const sbc of settings.sbcs) {
    if (!sbc.enabled || pollable(sbc)) continue;
    if (!sbc.host.trim() && !sbc.username.trim() && !sbc.password) continue;
    notes.push(`${sbcLabel(sbc)} needs an address, REST username, and REST password before it can be polled.`);
  }

  const failed = new Map<string, string>();
  const fresh: StoredTrunk[] = [];
  let anySuccess = false;
  const names: string[] = [];
  const versions: string[] = [];

  for (const sbc of targets) {
    const runtime = runtimeFor(sbc, settings, poll, runtimes);
    try {
      const snapshot = await collectSbc(sbc);
      const watched = snapshot.trunks.filter((trunk) => matchesWatchFilter(trunk, settings.watchFilter));
      fresh.push(...(await alarmAndStore(settings, snapshot, watched, previous, now)));
      if (runtime.unreachableAlertedAt) {
        await sendReachable(
          settings,
          {
            name: snapshot.name,
            host: snapshot.host,
            detail: runtime.lastError ?? "",
            failures: runtime.consecutiveFailures,
          },
          now,
        );
      }
      runtimes[sbc.id] = {
        lastError: null,
        consecutiveFailures: 0,
        unreachableAlertedAt: null,
        nodeName: snapshot.name,
        softwareVersion: snapshot.version,
        lastSuccessAt: now.toISOString(),
      };
      anySuccess = true;
      names.push(snapshot.name);
      if (snapshot.version) versions.push(snapshot.version);
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      const message = error instanceof Error ? error.message : "Poll failed.";
      const failures = runtime.consecutiveFailures + 1;
      const detail = targets.length === 1 ? message : `${sbcLabel(sbc)}: ${message}`;
      const nextRuntime: SbcRuntime = {
        ...runtime,
        lastError: detail,
        consecutiveFailures: failures,
      };
      const shouldAlert = failures >= settings.unreachableThreshold;
      const alreadyAlerted = nextRuntime.unreachableAlertedAt != null;
      const reminderDue =
        shouldAlert &&
        settings.reminderMinutes > 0 &&
        alreadyAlerted &&
        now.getTime() - Date.parse(nextRuntime.unreachableAlertedAt ?? "") >= settings.reminderMinutes * 60_000;
      if (shouldAlert && (!alreadyAlerted || reminderDue)) {
        const kind = alreadyAlerted ? "reminder" : "unreachable";
        const mail = renderReachabilityMail({
          kind,
          sbcName: runtime.nodeName || sbc.name,
          sbcHost: sbc.host,
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
        nextRuntime.unreachableAlertedAt = now.toISOString();
      }
      runtimes[sbc.id] = nextRuntime;
      failed.set(sbc.id, detail);
    }
  }

  if (anySuccess) {
    const kept = previous.filter((trunk) => failed.has(trunk.sbcId));
    replaceTrunks([...fresh, ...kept]);
  }

  const failureCounts = targets.map((sbc) => runtimes[sbc.id]?.consecutiveFailures ?? 0);
  const alertedAt =
    targets.map((sbc) => runtimes[sbc.id]?.unreachableAlertedAt).find((value) => value) ?? null;
  const keptRuntimes: Record<string, SbcRuntime> = {};
  for (const sbc of settings.sbcs) {
    if (runtimes[sbc.id]) keptRuntimes[sbc.id] = runtimes[sbc.id];
  }
  saveSbcRuntimes(keptRuntimes);

  const failureText = [...failed.values(), ...notes].filter(Boolean).join(" · ");
  const allClear = anySuccess && failed.size === 0 && notes.length === 0;
  savePollState({
    lastPollAt: now.toISOString(),
    lastSuccessAt: anySuccess ? now.toISOString() : poll.lastSuccessAt,
    lastError: failureText || null,
    consecutiveFailures: allClear ? 0 : Math.max(0, ...failureCounts),
    unreachableAlertedAt: allClear ? null : alertedAt,
    sbcName: names.length > 0 ? names.join(" · ") : poll.sbcName,
    softwareVersion: versions.length > 0 ? versions.join(" · ") : poll.softwareVersion,
    snapshotMode: settings.mode,
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
    if (settings.mode === "demo") {
      await commitSnapshot(settings, collectDemo(), poll, now);
    } else {
      await pollLive(settings, poll, now);
    }
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

function dashboardSbcs(settings: Settings, poll: PollState): DashboardSbc[] {
  if (settings.mode === "demo") {
    return [
      {
        id: "demo",
        name: poll.sbcName || DEMO_NODE_NAME,
        host: "",
        enabled: true,
        nodeName: poll.sbcName || DEMO_NODE_NAME,
        softwareVersion: poll.softwareVersion,
        lastError: null,
        consecutiveFailures: 0,
      },
    ];
  }
  const runtimes = getSbcRuntimes();
  return settings.sbcs.map((sbc) => {
    const runtime = runtimes[sbc.id];
    return {
      id: sbc.id,
      name: sbc.name,
      host: sbc.host,
      enabled: sbc.enabled,
      nodeName: runtime?.nodeName ?? "",
      softwareVersion: runtime?.softwareVersion ?? "",
      lastError: runtime?.lastError ?? null,
      consecutiveFailures: runtime?.consecutiveFailures ?? 0,
    };
  });
}

export function getDashboard(): Dashboard {
  const settings = getSettings();
  const poll = getPollState();
  const trunks = listTrunks();
  const views: TrunkView[] = trunks.map((trunk) => ({
    id: trunk.id,
    sbcId: trunk.sbcId,
    sbcName: trunk.sbcName,
    sbcHost: trunk.sbcHost,
    sgId: trunk.sgId,
    name: trunk.name,
    health: trunk.health,
    statusLabel: trunk.statusLabel,
    rawStatus: trunk.rawStatus,
    adminState: trunk.adminState,
    channels: trunk.channels,
    currentCalls: trunk.currentCalls,
    calls: trunk.calls,
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
  const liveHosts = settings.sbcs
    .filter((sbc) => sbc.enabled && sbc.host.trim())
    .map((sbc) => sbc.host.trim());
  return {
    mode: settings.mode,
    sbcHost: settings.mode === "demo" ? "demo" : liveHosts.join(", ") || settings.sbcHost,
    sbcs: dashboardSbcs(settings, poll),
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

export async function testOneSbc(sbc: SbcConfig): Promise<{
  ok: boolean;
  message: string;
  nodeName?: string;
  version?: string;
  trunkCount?: number;
}> {
  if (!sbc.host.trim() || !sbc.username.trim()) {
    return { ok: false, message: "Add the SBC address and REST username first." };
  }
  try {
    const ribbon = new RibbonClient({
      baseUrl: sbcRestBase(sbc.host, sbc.port),
      username: sbc.username,
      password: sbc.password,
      tlsVerify: sbc.tlsVerify,
    });
    const system = await ribbon.getSystem().catch(() => ({ name: "", version: "" }));
    const trunks = await ribbon.getSignalingGroups();
    const name = system.name || sbc.name.trim() || sbc.host;
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

export async function testSbcConnection(settings: Settings): Promise<{
  ok: boolean;
  message: string;
  nodeName?: string;
  version?: string;
  trunkCount?: number;
}> {
  const sbc = settings.sbcs.find((item) => item.enabled && item.host.trim()) ?? settings.sbcs[0];
  if (!sbc) return { ok: false, message: "Add the SBC address and REST username first." };
  return testOneSbc(sbc);
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
  clients.clear();
  return next;
}
