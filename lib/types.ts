export type MonitorMode = "demo" | "live";

export type Health = "up" | "down" | "degraded" | "disabled" | "unknown";

export type SipSgStatus =
  | "sgsUP"
  | "sgsDOWN"
  | "sgsUpDraining"
  | "sgsUpDrained"
  | "sgsUpPeersDown"
  | "sgsNONE_EXISTS";

export type AdminState = "enabled" | "disabled" | "drain" | "unknown";

export type Settings = {
  mode: MonitorMode;
  monitoringEnabled: boolean;
  sbcHost: string;
  sbcPort: number;
  sbcUsername: string;
  sbcPassword: string;
  tlsVerify: boolean;
  pollIntervalSeconds: number;
  watchFilter: string;
  alertRecipients: string;
  alertOnRecovery: boolean;
  alertOnDegraded: boolean;
  alertOnStartup: boolean;
  reminderMinutes: number;
  unreachableThreshold: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  alertFrom: string;
  timezone: string;
};

export type PublicSettings = Omit<Settings, "sbcPassword" | "smtpPassword"> & {
  sbcPasswordSet: boolean;
  smtpPasswordSet: boolean;
};

export type TrunkObservation = {
  id: string;
  name: string;
  health: Health;
  rawStatus: SipSgStatus | "unknown";
  statusLabel: string;
  adminState: AdminState;
  channels: number | null;
  currentCalls: number | null;
  peers: string[];
  interop: string;
  protocol: string;
  serverClusterId: string;
};

export type AlarmKind = "down" | "recovery" | "reminder";

export type EventKind = AlarmKind | "unreachable" | "reachable" | "test";

export type EmailStatus = "sent" | "failed" | "skipped";

export type AlertEvent = {
  id: number;
  createdAt: string;
  kind: EventKind;
  trunkId: string | null;
  trunkName: string | null;
  subject: string;
  body: string;
  emailStatus: EmailStatus;
  emailDetail: string;
};

export type TrunkView = {
  id: string;
  name: string;
  health: Health;
  statusLabel: string;
  rawStatus: string;
  adminState: AdminState;
  channels: number | null;
  currentCalls: number | null;
  peers: string[];
  interop: string;
  protocol: string;
  downSince: string | null;
  simulated: boolean;
  updatedAt: string;
};

export type PollView = {
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  unreachableAlerted: boolean;
  sbcName: string;
  softwareVersion: string;
  snapshotMode: MonitorMode | null;
  intervalSeconds: number;
  monitoringEnabled: boolean;
};

export type Dashboard = {
  mode: MonitorMode;
  sbcHost: string;
  poll: PollView;
  summary: {
    total: number;
    up: number;
    down: number;
    degraded: number;
    disabled: number;
    unknown: number;
  };
  trunks: TrunkView[];
  recentEvents: AlertEvent[];
};
