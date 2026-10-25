import { classifyHealth, statusLabel } from "./status";
import type { AdminState, SipSgStatus, TrunkObservation } from "./types";

type DemoBase = {
  id: string;
  name: string;
  status: SipSgStatus;
  admin: AdminState;
  channels: number;
  currentCalls: number;
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
      peers: base.peers,
      interop: base.interop,
      protocol: base.protocol,
      serverClusterId: "",
    };
  });
}
