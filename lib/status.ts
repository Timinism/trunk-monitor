import type { AdminState, Health, SipSgStatus, TrunkObservation } from "./types";

const STATUS_BY_KEY: Record<string, SipSgStatus> = {
  "0": "sgsUP",
  "1": "sgsDOWN",
  "2": "sgsUpDraining",
  "3": "sgsUpDrained",
  "4": "sgsUpPeersDown",
  "5": "sgsNONE_EXISTS",
  sgsup: "sgsUP",
  sgsdown: "sgsDOWN",
  sgsupdraining: "sgsUpDraining",
  sgsupdrained: "sgsUpDrained",
  sgsuppeersdown: "sgsUpPeersDown",
  sgsnone_exists: "sgsNONE_EXISTS",
  sgsnoneexists: "sgsNONE_EXISTS",
};

const ADMIN_BY_KEY: Record<string, AdminState> = {
  "0": "disabled",
  "1": "enabled",
  "2": "drain",
  cmcustomdisabled: "disabled",
  cmcustomenabled: "enabled",
  cmcustomdrain: "drain",
  disabled: "disabled",
  enabled: "enabled",
  drain: "drain",
};

export function normalizeStatus(raw: string): SipSgStatus | "unknown" {
  const key = raw.trim().toLowerCase();
  if (!key) return "unknown";
  return STATUS_BY_KEY[key] ?? "unknown";
}

export function normalizeAdmin(raw: string): AdminState {
  const key = raw.trim().toLowerCase();
  if (!key) return "unknown";
  return ADMIN_BY_KEY[key] ?? "unknown";
}

export function classifyHealth(status: SipSgStatus | "unknown", admin: AdminState): Health {
  if (admin === "disabled") return "disabled";
  switch (status) {
    case "sgsUP":
      return "up";
    case "sgsUpDraining":
    case "sgsUpDrained":
      return "degraded";
    case "sgsDOWN":
    case "sgsUpPeersDown":
    case "sgsNONE_EXISTS":
      return "down";
    default:
      return "unknown";
  }
}

export function statusLabel(health: Health, status: SipSgStatus | "unknown"): string {
  if (health === "disabled") return "Disabled";
  switch (status) {
    case "sgsUP":
      return "Up";
    case "sgsDOWN":
      return "Down";
    case "sgsUpDraining":
      return "Draining";
    case "sgsUpDrained":
      return "Drained";
    case "sgsUpPeersDown":
      return "Peers down";
    case "sgsNONE_EXISTS":
      return "Not present";
    default:
      return "Unknown";
  }
}

export function isAlarming(health: Health, alertOnDegraded: boolean): boolean {
  if (health === "down") return true;
  if (health === "degraded" && alertOnDegraded) return true;
  return false;
}

export type AlarmSnapshot = {
  id: string;
  alarmHealth: Health;
  alarming: boolean;
  downSince: string | null;
  lastAlertAt: string | null;
};

export type AlarmTransition = {
  kind: "down" | "recovery" | "reminder";
  trunk: TrunkObservation;
  previousHealth: Health | null;
  downSince: string;
};

export type AlarmUpdate = AlarmSnapshot & {
  transition: AlarmTransition | null;
};

export function evaluateAlarms(
  previous: AlarmSnapshot[],
  current: TrunkObservation[],
  options: {
    alertOnDegraded: boolean;
    alertOnStartup: boolean;
    alertOnRecovery: boolean;
    reminderMinutes: number;
    now: Date;
  },
): AlarmUpdate[] {
  const prevById = new Map(previous.map((item) => [item.id, item]));
  const nowIso = options.now.toISOString();
  const updates: AlarmUpdate[] = [];

  for (const trunk of current) {
    const prev = prevById.get(trunk.id);
    if (trunk.health === "unknown") {
      updates.push({
        id: trunk.id,
        alarmHealth: prev?.alarmHealth ?? "unknown",
        alarming: prev?.alarming ?? false,
        downSince: prev?.downSince ?? null,
        lastAlertAt: prev?.lastAlertAt ?? null,
        transition: null,
      });
      continue;
    }

    const alarming = isAlarming(trunk.health, options.alertOnDegraded);
    const wasAlarming = prev?.alarming ?? false;
    let downSince = prev?.downSince ?? null;
    let lastAlertAt = prev?.lastAlertAt ?? null;
    let transition: AlarmTransition | null = null;

    if (!prev) {
      if (alarming) {
        downSince = nowIso;
        if (options.alertOnStartup) {
          lastAlertAt = nowIso;
          transition = {
            kind: "down",
            trunk,
            previousHealth: null,
            downSince,
          };
        }
      }
    } else if (alarming && !wasAlarming) {
      downSince = nowIso;
      lastAlertAt = nowIso;
      transition = {
        kind: "down",
        trunk,
        previousHealth: prev.alarmHealth,
        downSince,
      };
    } else if (!alarming && wasAlarming) {
      const since = prev.downSince ?? nowIso;
      if (options.alertOnRecovery) {
        transition = {
          kind: "recovery",
          trunk,
          previousHealth: prev.alarmHealth,
          downSince: since,
        };
        lastAlertAt = nowIso;
      }
      downSince = null;
    } else if (alarming && wasAlarming && options.reminderMinutes > 0) {
      const anchor = lastAlertAt ?? downSince;
      if (anchor) {
        const elapsed = options.now.getTime() - Date.parse(anchor);
        if (elapsed >= options.reminderMinutes * 60_000) {
          lastAlertAt = nowIso;
          transition = {
            kind: "reminder",
            trunk,
            previousHealth: prev.alarmHealth,
            downSince: downSince ?? nowIso,
          };
        }
      }
    }

    updates.push({
      id: trunk.id,
      alarmHealth: trunk.health,
      alarming,
      downSince,
      lastAlertAt,
      transition,
    });
  }

  return updates;
}

export function matchesWatchFilter(
  trunk: { id: string; name: string },
  filter: string,
): boolean {
  const tokens = filter
    .split(/[,;\n]/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const id = trunk.id.toLowerCase();
  const name = trunk.name.toLowerCase();
  return tokens.some((token) => id === token || name.includes(token));
}
