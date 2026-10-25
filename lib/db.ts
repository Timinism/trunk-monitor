import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyCallStats, type AdminState, type AlertEvent, type CallStats, type EmailStatus, type EventKind, type Health, type MonitorMode } from "./types";

export type StoredTrunk = {
  id: string;
  sbcId: string;
  sbcName: string;
  sbcHost: string;
  sgId: string;
  name: string;
  health: Health;
  alarmHealth: Health;
  alarming: boolean;
  rawStatus: string;
  statusLabel: string;
  adminState: AdminState;
  channels: number | null;
  currentCalls: number | null;
  calls: CallStats;
  peers: string[];
  interop: string;
  protocol: string;
  downSince: string | null;
  lastAlertAt: string | null;
  simulated: boolean;
  updatedAt: string;
};

export type SbcRuntime = {
  lastError: string | null;
  consecutiveFailures: number;
  unreachableAlertedAt: string | null;
  nodeName: string;
  softwareVersion: string;
  lastSuccessAt: string | null;
};

export type PollState = {
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  unreachableAlertedAt: string | null;
  sbcName: string;
  softwareVersion: string;
  snapshotMode: MonitorMode | null;
};

const EMPTY_RUNTIME: SbcRuntime = {
  lastError: null,
  consecutiveFailures: 0,
  unreachableAlertedAt: null,
  nodeName: "",
  softwareVersion: "",
  lastSuccessAt: null,
};

const EMPTY_POLL: PollState = {
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null,
  consecutiveFailures: 0,
  unreachableAlertedAt: null,
  sbcName: "",
  softwareVersion: "",
  snapshotMode: null,
};

let database: DatabaseSync | null = null;

export function dataDirectory(): string {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

function openDatabase(): DatabaseSync {
  const directory = dataDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, "edge-watch.sqlite"));
  db.exec(`
    -- DELETE, not WAL. The WAL sidecar changes on read, and Next.js dev
    -- treats that as a source change and reloads the page.
    PRAGMA journal_mode = DELETE;
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trunk_state (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      health TEXT NOT NULL,
      alarm_health TEXT NOT NULL,
      alarming INTEGER NOT NULL,
      raw_status TEXT NOT NULL,
      status_label TEXT NOT NULL,
      admin_state TEXT NOT NULL,
      channels INTEGER,
      current_calls INTEGER,
      peers TEXT NOT NULL,
      interop TEXT NOT NULL,
      protocol TEXT NOT NULL,
      down_since TEXT,
      last_alert_at TEXT,
      simulated INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      call_stats TEXT,
      sbc_id TEXT NOT NULL DEFAULT '',
      sbc_name TEXT NOT NULL DEFAULT '',
      sbc_host TEXT NOT NULL DEFAULT '',
      sg_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      trunk_id TEXT,
      trunk_name TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      email_status TEXT NOT NULL,
      email_detail TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS local_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS local_users_username ON local_users(username COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      attempted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_attempts_user ON login_attempts(username, attempted_at);
  `);
  const columns = db.prepare("PRAGMA table_info(trunk_state)").all() as { name: string }[];
  const additions: [string, string][] = [
    ["call_stats", "ALTER TABLE trunk_state ADD COLUMN call_stats TEXT"],
    ["sbc_id", "ALTER TABLE trunk_state ADD COLUMN sbc_id TEXT NOT NULL DEFAULT ''"],
    ["sbc_name", "ALTER TABLE trunk_state ADD COLUMN sbc_name TEXT NOT NULL DEFAULT ''"],
    ["sbc_host", "ALTER TABLE trunk_state ADD COLUMN sbc_host TEXT NOT NULL DEFAULT ''"],
    ["sg_id", "ALTER TABLE trunk_state ADD COLUMN sg_id TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, sql] of additions) {
    if (!columns.some((column) => column.name === name)) db.exec(sql);
  }
  return db;
}

export function getDb(): DatabaseSync {
  if (!database) database = openDatabase();
  return database;
}

export function closeDb(): void {
  database?.close();
  database = null;
}

function kvGet(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function kvSet(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function readJson<T>(key: string): T | null {
  const raw = kvGet(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export function writeJson(key: string, value: unknown) {
  kvSet(key, JSON.stringify(value));
}

export function getPollState(): PollState {
  return { ...EMPTY_POLL, ...(readJson<Partial<PollState>>("poll_state") ?? {}) };
}

export function savePollState(state: PollState) {
  writeJson("poll_state", state);
}

export function getSbcRuntimes(): Record<string, SbcRuntime> {
  const stored = readJson<Record<string, Partial<SbcRuntime>>>("sbc_runtime") ?? {};
  const runtimes: Record<string, SbcRuntime> = {};
  for (const [id, value] of Object.entries(stored)) {
    runtimes[id] = { ...EMPTY_RUNTIME, ...value };
  }
  return runtimes;
}

export function saveSbcRuntimes(runtimes: Record<string, SbcRuntime>) {
  writeJson("sbc_runtime", runtimes);
}

export function getDemoDownIds(): string[] {
  return readJson<string[]>("demo_down_ids") ?? [];
}

export function setDemoDownIds(ids: string[]) {
  writeJson("demo_down_ids", [...new Set(ids)]);
}

type TrunkRow = {
  id: string;
  sbc_id?: string | null;
  sbc_name?: string | null;
  sbc_host?: string | null;
  sg_id?: string | null;
  name: string;
  health: Health;
  alarm_health: Health;
  alarming: number;
  raw_status: string;
  status_label: string;
  admin_state: AdminState;
  channels: number | null;
  current_calls: number | null;
  call_stats: string | null;
  peers: string;
  interop: string;
  protocol: string;
  down_since: string | null;
  last_alert_at: string | null;
  simulated: number;
  updated_at: string;
};

function parseCallStats(raw: string | null): CallStats {
  if (!raw) return emptyCallStats();
  try {
    return { ...emptyCallStats(), ...(JSON.parse(raw) as Partial<CallStats>) };
  } catch {
    return emptyCallStats();
  }
}

function trunkFromRow(row: TrunkRow): StoredTrunk {
  return {
    id: row.id,
    sbcId: row.sbc_id ?? "",
    sbcName: row.sbc_name ?? "",
    sbcHost: row.sbc_host ?? "",
    sgId: row.sg_id || row.id,
    name: row.name,
    health: row.health,
    alarmHealth: row.alarm_health,
    alarming: row.alarming === 1,
    rawStatus: row.raw_status,
    statusLabel: row.status_label,
    adminState: row.admin_state,
    channels: row.channels,
    currentCalls: row.current_calls,
    calls: parseCallStats(row.call_stats),
    peers: JSON.parse(row.peers) as string[],
    interop: row.interop,
    protocol: row.protocol,
    downSince: row.down_since,
    lastAlertAt: row.last_alert_at,
    simulated: row.simulated === 1,
    updatedAt: row.updated_at,
  };
}

export function listTrunks(): StoredTrunk[] {
  const rows = getDb()
    .prepare("SELECT * FROM trunk_state ORDER BY sbc_name, sbc_id, CAST(sg_id AS INTEGER), sg_id, id")
    .all() as unknown as TrunkRow[];
  return rows.map(trunkFromRow);
}

export function replaceTrunks(trunks: StoredTrunk[]) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO trunk_state (
      id, name, health, alarm_health, alarming, raw_status, status_label, admin_state,
      channels, current_calls, peers, interop, protocol, down_since, last_alert_at,
      simulated, updated_at, call_stats, sbc_id, sbc_name, sbc_host, sg_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM trunk_state");
    for (const trunk of trunks) {
      insert.run(
        trunk.id,
        trunk.name,
        trunk.health,
        trunk.alarmHealth,
        trunk.alarming ? 1 : 0,
        trunk.rawStatus,
        trunk.statusLabel,
        trunk.adminState,
        trunk.channels,
        trunk.currentCalls,
        JSON.stringify(trunk.peers),
        trunk.interop,
        trunk.protocol,
        trunk.downSince,
        trunk.lastAlertAt,
        trunk.simulated ? 1 : 0,
        trunk.updatedAt,
        JSON.stringify(trunk.calls),
        trunk.sbcId,
        trunk.sbcName,
        trunk.sbcHost,
        trunk.sgId,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function insertEvent(event: Omit<AlertEvent, "id">): AlertEvent {
  const result = getDb()
    .prepare(
      `INSERT INTO events (
        created_at, kind, trunk_id, trunk_name, subject, body, email_status, email_detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.createdAt,
      event.kind,
      event.trunkId,
      event.trunkName,
      event.subject,
      event.body,
      event.emailStatus,
      event.emailDetail,
    );
  getDb()
    .prepare(
      `DELETE FROM events WHERE id NOT IN (
        SELECT id FROM events ORDER BY id DESC LIMIT 1000
      )`,
    )
    .run();
  return { ...event, id: Number(result.lastInsertRowid) };
}

type EventRow = {
  id: number;
  created_at: string;
  kind: EventKind;
  trunk_id: string | null;
  trunk_name: string | null;
  subject: string;
  body: string;
  email_status: EmailStatus;
  email_detail: string;
};

function eventFromRow(row: EventRow): AlertEvent {
  return {
    id: row.id,
    createdAt: row.created_at,
    kind: row.kind,
    trunkId: row.trunk_id,
    trunkName: row.trunk_name,
    subject: row.subject,
    body: row.body,
    emailStatus: row.email_status,
    emailDetail: row.email_detail,
  };
}

export function listEvents(limit = 100): AlertEvent[] {
  const rows = getDb()
    .prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?")
    .all(limit) as unknown as EventRow[];
  return rows.map(eventFromRow);
}
