import { classifyHealth, statusLabel } from "./status";
import type { AdminState, CallStats, SipSgStatus, TrunkObservation } from "./types";

type DemoBase = {
  id: string;
  name: string;
  status: SipSgStatus;
  admin: AdminState;
  channels: number;
  currentCalls: number;
  calls: CallStats;
  peers: string[];
  interop: string;
  protocol: string;
};

export const DEMO_TRUNKS: DemoBase[] = [
  {
    id: "1",
    name: "PSTN — Lumen primary",
    status: "sgsUP",
    admin: "enabled",
    channels: 24,
    currentCalls: 6,
    calls: {
      ingressCurrent: 4,
      egressCurrent: 2,
      connected: 5,
      total: 18420,
      refused: 37,
      blocked: 6,
      errored: 2,
      ingressAttempts: 10240,
      ingressAccepted: 9901,
      ingressCompleted: 9744,
      ingressRejected: 88,
      ingressBlocked: 4,
      egressAttempts: 8210,
      egressAccepted: 7988,
      egressCompleted: 7902,
      egressRejected: 41,
      egressBlocked: 2,
    },
    peers: ["sip.lumen.example:5060"],
    interop: "Standard",
    protocol: "UDP 5060",
  },
  {
    id: "2",
    name: "PSTN — Lumen backup",
    status: "sgsUP",
    admin: "enabled",
    channels: 24,
    currentCalls: 0,
    calls: {
      ingressCurrent: 0,
      egressCurrent: 0,
      connected: 0,
      total: 640,
      refused: 4,
      blocked: 1,
      errored: 0,
      ingressAttempts: 410,
      ingressAccepted: 390,
      ingressCompleted: 388,
      ingressRejected: 9,
      ingressBlocked: 1,
      egressAttempts: 230,
      egressAccepted: 226,
      egressCompleted: 224,
      egressRejected: 3,
      egressBlocked: 0,
    },
    peers: ["sip-backup.lumen.example:5060"],
    interop: "Standard",
    protocol: "UDP 5060",
  },
  {
    id: "3",
    name: "Microsoft Teams Direct Routing",
    status: "sgsUP",
    admin: "enabled",
    channels: 100,
    currentCalls: 18,
    calls: {
      ingressCurrent: 11,
      egressCurrent: 7,
      connected: 16,
      total: 45210,
      refused: 120,
      blocked: 14,
      errored: 9,
      ingressAttempts: 26110,
      ingressAccepted: 24880,
      ingressCompleted: 24602,
      ingressRejected: 310,
      ingressBlocked: 9,
      egressAttempts: 19440,
      egressAccepted: 18990,
      egressCompleted: 18840,
      egressRejected: 142,
      egressBlocked: 5,
    },
    peers: ["sip.pstnhub.microsoft.com:5061"],
    interop: "Office 365",
    protocol: "TLS 5061",
  },
  {
    id: "4",
    name: "Analog fax gateway",
    status: "sgsDOWN",
    admin: "disabled",
    channels: 4,
    currentCalls: 0,
    calls: {
      ingressCurrent: 0,
      egressCurrent: 0,
      connected: 0,
      total: 120,
      refused: 0,
      blocked: 0,
      errored: 1,
      ingressAttempts: 80,
      ingressAccepted: 74,
      ingressCompleted: 73,
      ingressRejected: 2,
      ingressBlocked: 0,
      egressAttempts: 46,
      egressAccepted: 44,
      egressCompleted: 44,
      egressRejected: 1,
      egressBlocked: 0,
    },
    peers: ["10.20.4.15:5060"],
    interop: "Standard",
    protocol: "UDP 5060",
  },
];

export const DEMO_NODE_NAME = "edge-lab-01";
export const DEMO_VERSION = "12.3.1 demo";

export function demoTrunkIds(): string[] {
  return DEMO_TRUNKS.map((trunk) => trunk.id);
}

export function buildDemoTrunks(downIds: Iterable<string>): TrunkObservation[] {
  const down = new Set(downIds);
  return DEMO_TRUNKS.map((base) => {
    const simulated = down.has(base.id);
    const rawStatus: SipSgStatus = simulated ? "sgsDOWN" : base.status;
    const adminState: AdminState = simulated && base.admin === "disabled" ? "enabled" : base.admin;
    const health = classifyHealth(rawStatus, adminState);
    return {
      id: base.id,
      name: base.name,
      health,
      rawStatus,
      statusLabel: statusLabel(health, rawStatus),
      adminState,
      channels: base.channels,
      currentCalls: simulated ? 0 : base.currentCalls,
      calls: simulated
        ? { ...base.calls, ingressCurrent: 0, egressCurrent: 0, connected: 0 }
        : base.calls,
      peers: base.peers,
      interop: base.interop,
      protocol: base.protocol,
      serverClusterId: "",
    };
  });
}
