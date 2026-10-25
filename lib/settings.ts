import { readJson, writeJson } from "./db";
import type { PublicSettings, Settings } from "./types";

export const DEFAULT_TIMEZONE = "America/Chicago";

export function defaultSettings(): Settings {
  const host = process.env.SBC_HOST?.trim() ?? "";
  const smtpPort = numberFromEnv("SMTP_PORT", 587);
  return {
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
  return normalizeSettings({ ...defaultSettings(), ...stored, ...secretsFrom(stored) });
}

function secretsFrom(stored: Partial<Settings>): Partial<Settings> {
  return {
    sbcPassword: typeof stored.sbcPassword === "string" ? stored.sbcPassword : "",
    smtpPassword: typeof stored.smtpPassword === "string" ? stored.smtpPassword : "",
  };
}

export function saveSettings(settings: Settings) {
  writeJson("settings", normalizeSettings(settings));
}

export function toPublicSettings(settings: Settings): PublicSettings {
  return {
    mode: settings.mode,
    monitoringEnabled: settings.monitoringEnabled,
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
  assignString(body, "sbcHost", 255, (value) => {
    next.sbcHost = value.trim();
  });
  assignString(body, "sbcUsername", 256, (value) => {
    next.sbcUsername = value.trim();
  });
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
  assignNumber(body, "sbcPort", (value) => {
    next.sbcPort = value;
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
  if (typeof body.sbcPassword === "string" && body.sbcPassword.length > 0) {
    if (body.sbcPassword.length > 256) throw new Error("SBC password is too long.");
    next.sbcPassword = body.sbcPassword;
  }
  if (typeof body.smtpPassword === "string" && body.smtpPassword.length > 0) {
    if (body.smtpPassword.length > 256) throw new Error("SMTP password is too long.");
    next.smtpPassword = body.smtpPassword;
  }

  return normalizeSettings(next);
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
  if (settings.sbcPort < 1 || settings.sbcPort > 65535) throw new Error("SBC port must be between 1 and 65535.");
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
  return {
    ...settings,
    timezone,
    alertRecipients: recipients.join(", "),
    pollIntervalSeconds: Math.round(settings.pollIntervalSeconds),
    reminderMinutes: Math.round(settings.reminderMinutes),
    unreachableThreshold: Math.round(settings.unreachableThreshold),
    sbcPort: Math.round(settings.sbcPort),
    smtpPort: Math.round(settings.smtpPort),
  };
}
