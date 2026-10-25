import { readJson, writeJson } from "./db";
import type { PublicSettings, PublicSbc, SbcConfig, Settings } from "./types";

export const DEFAULT_TIMEZONE = "America/Chicago";

function codeDefaults(): Settings {
  return {
    mode: "demo",
    monitoringEnabled: true,
    sbcs: [],
    sbcHost: "",
    sbcPort: 443,
    sbcUsername: "",
    sbcPassword: "",
    tlsVerify: false,
    pollIntervalSeconds: 60,
    watchFilter: "",
    alertRecipients: "",
    alertOnRecovery: true,
    alertOnDegraded: false,
    alertOnStartup: false,
    reminderMinutes: 0,
    unreachableThreshold: 3,
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPassword: "",
    alertFrom: "Edge Watch <edge-watch@localhost>",
    timezone: DEFAULT_TIMEZONE,
  };
}

export function defaultSettings(): Settings {
  const host = process.env.SBC_HOST?.trim() ?? "";
  const smtpPort = numberFromEnv("SMTP_PORT", 587);
  return {
    ...codeDefaults(),
    mode: host ? "live" : "demo",
    monitoringEnabled: process.env.MONITORING_ENABLED !== "false",
    sbcHost: host,
    sbcPort: numberFromEnv("SBC_PORT", 443),
    sbcUsername: process.env.SBC_USERNAME?.trim() ?? "",
    sbcPassword: process.env.SBC_PASSWORD ?? "",
    tlsVerify: process.env.SBC_TLS_VERIFY === "true",
    pollIntervalSeconds: clamp(numberFromEnv("POLL_INTERVAL_SECONDS", 60), 15, 3600),
    watchFilter: process.env.WATCH_FILTER ?? "",
    alertRecipients: process.env.ALERT_TO ?? "",
    alertOnRecovery: process.env.ALERT_ON_RECOVERY !== "false",
    alertOnDegraded: process.env.ALERT_ON_DEGRADED === "true",
    alertOnStartup: process.env.ALERT_ON_STARTUP === "true",
    reminderMinutes: clamp(numberFromEnv("ALERT_REMINDER_MINUTES", 0), 0, 1440),
    unreachableThreshold: clamp(numberFromEnv("UNREACHABLE_THRESHOLD", 3), 1, 20),
    smtpHost: process.env.SMTP_HOST?.trim() ?? "",
    smtpPort,
    smtpSecure: process.env.SMTP_SECURE === "true" || smtpPort === 465,
    smtpUser: process.env.SMTP_USER ?? "",
    smtpPassword: process.env.SMTP_PASSWORD ?? "",
    alertFrom: process.env.SMTP_FROM?.trim() || "Edge Watch <edge-watch@localhost>",
    timezone: process.env.ALERT_TIMEZONE?.trim() || DEFAULT_TIMEZONE,
  };
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getSettings(): Settings {
  const stored = readJson<Partial<Settings>>("settings");
  if (!stored) {
    const seeded = normalizeSettings(defaultSettings());
    writeJson("settings", seeded);
    return seeded;
  }
  // After the first launch, Settings in the web UI is the source of truth.
  // A later change to SBC_HOST or the other environment variables does not replace it.
  return normalizeSettings({ ...codeDefaults(), ...stored });
}

export function saveSettings(settings: Settings) {
  writeJson("settings", normalizeSettings(settings));
}

export function toPublicSettings(settings: Settings): PublicSettings {
  return {
    mode: settings.mode,
    monitoringEnabled: settings.monitoringEnabled,
    sbcs: settings.sbcs.map(toPublicSbc),
    sbcHost: settings.sbcHost,
    sbcPort: settings.sbcPort,
    sbcUsername: settings.sbcUsername,
    tlsVerify: settings.tlsVerify,
    pollIntervalSeconds: settings.pollIntervalSeconds,
    watchFilter: settings.watchFilter,
    alertRecipients: settings.alertRecipients,
    alertOnRecovery: settings.alertOnRecovery,
    alertOnDegraded: settings.alertOnDegraded,
    alertOnStartup: settings.alertOnStartup,
    reminderMinutes: settings.reminderMinutes,
    unreachableThreshold: settings.unreachableThreshold,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpSecure: settings.smtpSecure,
    smtpUser: settings.smtpUser,
    alertFrom: settings.alertFrom,
    timezone: settings.timezone,
    sbcPasswordSet: settings.sbcPassword.length > 0,
    smtpPasswordSet: settings.smtpPassword.length > 0,
  };
}

export function parseRecipients(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(/[,;\n]/)) {
    const email = part.trim();
    if (!email) continue;
    seen.add(email);
  }
  return [...seen];
}

export function mergeSettings(current: Settings, input: unknown): Settings {
  if (!input || typeof input !== "object") throw new Error("Settings must be an object.");
  const body = input as Record<string, unknown>;
  const next: Settings = { ...current };

  if ("mode" in body) {
    if (body.mode !== "demo" && body.mode !== "live") throw new Error("Mode must be demo or live.");
    next.mode = body.mode;
  }
  assignBoolean(body, "monitoringEnabled", (value) => {
    next.monitoringEnabled = value;
  });
  assignBoolean(body, "tlsVerify", (value) => {
    next.tlsVerify = value;
  });
  assignBoolean(body, "alertOnRecovery", (value) => {
    next.alertOnRecovery = value;
  });
  assignBoolean(body, "alertOnDegraded", (value) => {
    next.alertOnDegraded = value;
  });
  assignBoolean(body, "alertOnStartup", (value) => {
    next.alertOnStartup = value;
  });
  assignBoolean(body, "smtpSecure", (value) => {
    next.smtpSecure = value;
  });
  if ("sbcs" in body) {
    next.sbcs = mergeSbcList(current.sbcs, body.sbcs);
    syncLegacyFromSbcs(next);
  } else {
    assignString(body, "sbcHost", 255, (value) => {
      next.sbcHost = value.trim();
    });
    assignString(body, "sbcUsername", 256, (value) => {
      next.sbcUsername = value.trim();
    });
    assignNumber(body, "sbcPort", (value) => {
      next.sbcPort = value;
    });
    if (typeof body.sbcPassword === "string" && body.sbcPassword.length > 0) {
      if (body.sbcPassword.length > 256) throw new Error("SBC password is too long.");
      next.sbcPassword = body.sbcPassword;
    } else if (body.clearSbcPassword === true) {
      next.sbcPassword = "";
    }
    const touchesLegacy =
      "sbcHost" in body ||
      "sbcUsername" in body ||
      "sbcPort" in body ||
      "sbcPassword" in body ||
      "tlsVerify" in body ||
      body.clearSbcPassword === true;
    if (touchesLegacy) applyLegacyToFirstSbc(next);
  }
  assignString(body, "watchFilter", 500, (value) => {
    next.watchFilter = value.trim();
  });
  assignString(body, "alertRecipients", 2000, (value) => {
    next.alertRecipients = value.trim();
  });
  assignString(body, "smtpHost", 255, (value) => {
    next.smtpHost = value.trim();
  });
  assignString(body, "smtpUser", 256, (value) => {
    next.smtpUser = value;
  });
  assignString(body, "alertFrom", 320, (value) => {
    next.alertFrom = value.trim();
  });
  assignString(body, "timezone", 100, (value) => {
    next.timezone = value.trim();
  });
  assignNumber(body, "pollIntervalSeconds", (value) => {
    next.pollIntervalSeconds = value;
  });
  assignNumber(body, "reminderMinutes", (value) => {
    next.reminderMinutes = value;
  });
  assignNumber(body, "unreachableThreshold", (value) => {
    next.unreachableThreshold = value;
  });
  assignNumber(body, "smtpPort", (value) => {
    next.smtpPort = value;
  });
  if (typeof body.smtpPassword === "string" && body.smtpPassword.length > 0) {
    if (body.smtpPassword.length > 256) throw new Error("SMTP password is too long.");
    next.smtpPassword = body.smtpPassword;
  } else if (body.clearSmtpPassword === true) {
    next.smtpPassword = "";
  }

  if (next.mode === "live") assertLiveSbcs(next.sbcs);

  return normalizeSettings(next);
}

const SBC_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_SBCS = 20;

export function sbcLabel(sbc: { name: string; host: string }): string {
  return sbc.name.trim() || sbc.host.trim() || "SBC";
}

function toPublicSbc(sbc: SbcConfig): PublicSbc {
  return {
    id: sbc.id,
    name: sbc.name,
    host: sbc.host,
    port: sbc.port,
    username: sbc.username,
    tlsVerify: sbc.tlsVerify,
    enabled: sbc.enabled,
    passwordSet: sbc.password.length > 0,
  };
}

function syncLegacyFromSbcs(settings: Settings) {
  const first = settings.sbcs[0];
  settings.sbcHost = first?.host ?? "";
  settings.sbcPort = first?.port ?? settings.sbcPort;
  settings.sbcUsername = first?.username ?? "";
  settings.sbcPassword = first?.password ?? "";
  settings.tlsVerify = first?.tlsVerify ?? false;
}

function applyLegacyToFirstSbc(settings: Settings) {
  const existing = settings.sbcs[0];
  const next: SbcConfig = {
    id: existing?.id && SBC_ID.test(existing.id) ? existing.id : "primary",
    name: existing?.name ?? "",
    host: settings.sbcHost.trim(),
    port: settings.sbcPort,
    username: settings.sbcUsername.trim(),
    password: settings.sbcPassword,
    tlsVerify: settings.tlsVerify,
    enabled: existing?.enabled ?? true,
  };
  if (!next.host && !next.username && !next.password && settings.sbcs.length === 0) return;
  settings.sbcs = [next, ...settings.sbcs.slice(1)];
}

function assertLiveSbcs(sbcs: SbcConfig[]) {
  const enabled = sbcs.filter((sbc) => sbc.enabled);
  const complete = enabled.filter((sbc) => sbc.host.trim() && sbc.username.trim() && sbc.password);
  if (complete.length > 0) return;
  const target = enabled[0] ?? sbcs[0];
  if (!target || !target.host.trim()) throw new Error("Enter the SBC address.");
  if (!target.username.trim()) throw new Error("Enter the REST username.");
  throw new Error("Enter the REST password.");
}

function mergeSbcList(current: SbcConfig[], input: unknown): SbcConfig[] {
  if (!Array.isArray(input)) throw new Error("SBCs must be a list.");
  if (input.length > MAX_SBCS) throw new Error("Add at most 20 SBCs.");
  const savedById = new Map(current.map((sbc) => [sbc.id, sbc]));
  const used = new Set<string>();
  const merged: SbcConfig[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") throw new Error("Each SBC must be an object.");
    const raw = item as Record<string, unknown>;
    const requested = typeof raw.id === "string" ? raw.id.trim() : "";
    let id = SBC_ID.test(requested) ? requested : "";
    if (!id) id = crypto.randomUUID();
    if (used.has(id)) throw new Error("Each SBC needs its own id.");
    used.add(id);
    const saved = savedById.get(id);
    const name = readBoundedString(raw.name, 120, "SBC name");
    const host = readBoundedString(raw.host, 255, "SBC address").trim();
    const username = readBoundedString(raw.username, 256, "REST username").trim();
    if (!("port" in raw)) throw new Error("SBC port is required.");
    const port = typeof raw.port === "number" ? raw.port : Number(raw.port);
    if (!Number.isFinite(port)) throw new Error("SBC port must be a number.");
    if (typeof raw.tlsVerify !== "boolean") throw new Error("tlsVerify must be true or false.");
    if (typeof raw.enabled !== "boolean") throw new Error("enabled must be true or false.");
    let password = saved?.password ?? "";
    if (typeof raw.password === "string" && raw.password.length > 0) {
      if (raw.password.length > 256) throw new Error("SBC password is too long.");
      password = raw.password;
    } else if (raw.clearPassword === true) {
      password = "";
    }
    if (!name && !host && !username && !password) continue;
    merged.push({
      id,
      name,
      host,
      port,
      username,
      password,
      tlsVerify: raw.tlsVerify,
      enabled: raw.enabled,
    });
  }
  return merged;
}

function readBoundedString(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  if (value.length > max) throw new Error(`${label} is too long.`);
  return value;
}

export function resolveSbcDraft(current: Settings, input: unknown): SbcConfig {
  if (!input || typeof input !== "object") throw new Error("SBC details are missing.");
  const raw = input as Record<string, unknown>;
  const requested = typeof raw.id === "string" ? raw.id.trim() : "";
  const saved = current.sbcs.find((sbc) => sbc.id === requested);
  const [draft] = mergeSbcList(saved ? [saved] : [], [
    {
      ...raw,
      id: saved?.id ?? (SBC_ID.test(requested) ? requested : crypto.randomUUID()),
      port: "port" in raw ? raw.port : 443,
      tlsVerify: typeof raw.tlsVerify === "boolean" ? raw.tlsVerify : false,
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
      name: typeof raw.name === "string" ? raw.name : "",
      host: typeof raw.host === "string" ? raw.host : "",
      username: typeof raw.username === "string" ? raw.username : "",
      password: typeof raw.password === "string" ? raw.password : "",
    },
  ]);
  if (!draft) throw new Error("Add the SBC address and REST username first.");
  return draft;
}

function assignBoolean(
  body: Record<string, unknown>,
  key: string,
  apply: (value: boolean) => void,
) {
  if (!(key in body)) return;
  if (typeof body[key] !== "boolean") throw new Error(`${key} must be true or false.`);
  apply(body[key]);
}

function assignString(
  body: Record<string, unknown>,
  key: string,
  max: number,
  apply: (value: string) => void,
) {
  if (!(key in body)) return;
  if (typeof body[key] !== "string") throw new Error(`${key} must be a string.`);
  if (body[key].length > max) throw new Error(`${key} is too long.`);
  apply(body[key]);
}

function assignNumber(
  body: Record<string, unknown>,
  key: string,
  apply: (value: number) => void,
) {
  if (!(key in body)) return;
  const value = typeof body[key] === "number" ? body[key] : Number(body[key]);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number.`);
  apply(value);
}

export function normalizeSettings(settings: Settings): Settings {
  const timezone = settings.timezone.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("Timezone is not a valid IANA name, for example America/Chicago.");
  }
  const recipients = parseRecipients(settings.alertRecipients);
  for (const recipient of recipients) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new Error(`"${recipient}" is not an email address.`);
    }
  }
  if (settings.smtpPort < 1 || settings.smtpPort > 65535) {
    throw new Error("SMTP port must be between 1 and 65535.");
  }
  if (settings.pollIntervalSeconds < 15 || settings.pollIntervalSeconds > 3600) {
    throw new Error("Poll interval must be between 15 and 3600 seconds.");
  }
  if (settings.reminderMinutes < 0 || settings.reminderMinutes > 1440) {
    throw new Error("Reminder interval must be between 0 and 1440 minutes.");
  }
  if (settings.unreachableThreshold < 1 || settings.unreachableThreshold > 20) {
    throw new Error("Unreachable threshold must be between 1 and 20 polls.");
  }
  if (!settings.alertFrom.trim()) throw new Error("From address is required.");
  const sbcs = reconcileSbcs(settings);
  if (sbcs.length === 0 && (settings.sbcPort < 1 || settings.sbcPort > 65535)) {
    throw new Error("SBC port must be between 1 and 65535.");
  }
  for (const sbc of sbcs) {
    if (sbc.port < 1 || sbc.port > 65535) {
      throw new Error(`Port for ${sbcLabel(sbc)} must be between 1 and 65535.`);
    }
  }
  const first = sbcs[0];
  return {
    ...settings,
    sbcs,
    sbcHost: first?.host ?? "",
    sbcPort: Math.round(first?.port ?? settings.sbcPort),
    sbcUsername: first?.username ?? "",
    sbcPassword: first?.password ?? "",
    tlsVerify: first?.tlsVerify ?? false,
    timezone,
    alertRecipients: recipients.join(", "),
    pollIntervalSeconds: Math.round(settings.pollIntervalSeconds),
    reminderMinutes: Math.round(settings.reminderMinutes),
    unreachableThreshold: Math.round(settings.unreachableThreshold),
    smtpPort: Math.round(settings.smtpPort),
  };
}

function reconcileSbcs(settings: Settings): SbcConfig[] {
  const listed = (Array.isArray(settings.sbcs) ? settings.sbcs : [])
    .slice(0, MAX_SBCS)
    .map((sbc, index) => coerceStoredSbc(sbc, index));
  const unique: SbcConfig[] = [];
  const seen = new Set<string>();
  for (const sbc of listed) {
    if (seen.has(sbc.id)) continue;
    seen.add(sbc.id);
    unique.push({ ...sbc, port: Math.round(sbc.port) });
  }
  if (unique.length > 0) return unique;
  if (!settings.sbcHost.trim() && !settings.sbcUsername.trim() && !settings.sbcPassword) return [];
  return [
    {
      id: "primary",
      name: "",
      host: settings.sbcHost.trim(),
      port: Math.round(settings.sbcPort),
      username: settings.sbcUsername.trim(),
      password: settings.sbcPassword,
      tlsVerify: settings.tlsVerify,
      enabled: true,
    },
  ];
}

function coerceStoredSbc(value: Partial<SbcConfig> | null | undefined, index: number): SbcConfig {
  const id = typeof value?.id === "string" && SBC_ID.test(value.id.trim()) ? value.id.trim() : `sbc-${index + 1}`;
  const port = Number(value?.port);
  return {
    id,
    name: typeof value?.name === "string" ? value.name.trim().slice(0, 120) : "",
    host: typeof value?.host === "string" ? value.host.trim().slice(0, 255) : "",
    port: Number.isFinite(port) ? port : 443,
    username: typeof value?.username === "string" ? value.username.trim().slice(0, 256) : "",
    password: typeof value?.password === "string" ? value.password.slice(0, 256) : "",
    tlsVerify: value?.tlsVerify === true,
    enabled: value?.enabled !== false,
  };
}
