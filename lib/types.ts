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

export type SbcConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  tlsVerify: boolean;
  enabled: boolean;
};

export type PublicSbc = Omit<SbcConfig, "password"> & {
  passwordSet: boolean;
};

export type Settings = {
  mode: MonitorMode;
  monitoringEnabled: boolean;
  sbcs: SbcConfig[];
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

export type PublicSettings = Omit<Settings, "sbcPassword" | "smtpPassword" | "sbcs"> & {
  sbcs: PublicSbc[];
  sbcPasswordSet: boolean;
  smtpPasswordSet: boolean;
};

export type CallStats = {
  ingressCurrent: number | null;
  egressCurrent: number | null;
  connected: number | null;
  total: number | null;
  refused: number | null;
  blocked: number | null;
  errored: number | null;
  ingressAttempts: number | null;
  ingressAccepted: number | null;
  ingressCompleted: number | null;
  ingressRejected: number | null;
  ingressBlocked: number | null;
  egressAttempts: number | null;
  egressAccepted: number | null;
  egressCompleted: number | null;
  egressRejected: number | null;
  egressBlocked: number | null;
};

export function emptyCallStats(): CallStats {
  return {
    ingressCurrent: null,
    egressCurrent: null,
    connected: null,
    total: null,
    refused: null,
    blocked: null,
    errored: null,
    ingressAttempts: null,
    ingressAccepted: null,
    ingressCompleted: null,
    ingressRejected: null,
    ingressBlocked: null,
    egressAttempts: null,
    egressAccepted: null,
    egressCompleted: null,
    egressRejected: null,
    egressBlocked: null,
  };
}

export type TrunkObservation = {
  id: string;
  sbcId: string;
  sbcName: string;
  sbcHost: string;
  sgId: string;
  name: string;
  health: Health;
  rawStatus: SipSgStatus | "unknown";
  statusLabel: string;
  adminState: AdminState;
  channels: number | null;
  currentCalls: number | null;
  calls: CallStats;
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
  sbcId: string;
  sbcName: string;
  sbcHost: string;
  sgId: string;
  name: string;
  health: Health;
  statusLabel: string;
  rawStatus: string;
  adminState: AdminState;
  channels: number | null;
  currentCalls: number | null;
  calls: CallStats;
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

export type DashboardSbc = {
  id: string;
  name: string;
  host: string;
  enabled: boolean;
  nodeName: string;
  softwareVersion: string;
  lastError: string | null;
  consecutiveFailures: number;
};

export type Dashboard = {
  mode: MonitorMode;
  sbcHost: string;
  sbcs: DashboardSbc[];
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
