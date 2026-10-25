import { XMLParser } from "fast-xml-parser";
import { RibbonError } from "./errors";
import { classifyHealth, normalizeAdmin, normalizeStatus, statusLabel } from "./status";
import { emptyCallStats, type CallStats, type TrunkObservation } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (tagName) =>
    tagName === "sipsg" || tagName === "sipserver" || tagName === "app_status_entry",
});

export type ParsedSignalingGroup = TrunkObservation & {
  stub: boolean;
};

function parseDocument(xml: string): unknown {
  const cleaned = xml.replace(/^\uFEFF/, "").trim();
  try {
    return parser.parse(cleaned);
  } catch {
    const fixed = cleaned.replace(/<\?xml([^>?]*)>/i, "<?xml$1?>");
    try {
      return parser.parse(fixed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid XML";
      throw new RibbonError(`The SBC returned XML that could not be parsed (${message}).`);
    }
  }
}

function field(node: Record<string, unknown>, name: string): string {
  const value = node[name];
  if (value == null) return "";
  if (typeof value === "object") {
    if (Array.isArray(value)) return field({ nested: value[0] }, "nested");
    const record = value as Record<string, unknown>;
    if ("#text" in record) return String(record["#text"] ?? "");
    return "";
  }
  return String(value).trim();
}

function walk(node: unknown, visit: (record: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const record = node as Record<string, unknown>;
  visit(record);
  for (const value of Object.values(record)) walk(value, visit);
}

function collect(node: unknown, key: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  walk(node, (record) => {
    const value = record[key];
    if (!value) return;
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        found.push(item as Record<string, unknown>);
      }
    }
  });
  return found;
}

function idFrom(node: Record<string, unknown>): string {
  const attr = node["@_id"];
  if (attr != null && String(attr).trim() !== "") return String(attr).trim();
  const href = String(node["@_href"] ?? "");
  const match = href.match(/\/sipsg\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function integerOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const CALL_STAT_FIELDS: Record<keyof CallStats, string> = {
  ingressCurrent: "rt_NumIngressCurrentCalls",
  egressCurrent: "rt_NumEgressCurrentCalls",
  connected: "rt_NumConnectedCalls",
  total: "rt_NumTotalCalls",
  refused: "rt_NumRefusedCalls",
  blocked: "rt_NumBlockedCalls",
  errored: "rt_NumErroredCalls",
  ingressAttempts: "rt_NumIngressCallAttempts",
  ingressAccepted: "rt_NumIngressCallsAccepted",
  ingressCompleted: "rt_NumIngressCallsCompleted",
  ingressRejected: "rt_NumIngressCallsRejected",
  ingressBlocked: "rt_NumIngressCallsBlocked",
  egressAttempts: "rt_NumEgressCallAttempts",
  egressAccepted: "rt_NumEgressCallsAccepted",
  egressCompleted: "rt_NumEgressCallsCompleted",
  egressRejected: "rt_NumEgressCallsRejected",
  egressBlocked: "rt_NumEgressCallsBlocked",
};

function callStats(node: Record<string, unknown>): CallStats {
  const stats = emptyCallStats();
  for (const key of Object.keys(CALL_STAT_FIELDS) as (keyof CallStats)[]) {
    stats[key] = integerOrNull(field(node, CALL_STAT_FIELDS[key]));
  }
  return stats;
}

const PROTOCOLS: Record<string, string> = {
  "1": "UDP",
  "2": "TCP",
  "3": "TCP/UDP",
  "4": "TLS",
  "5": "TLS/UDP",
  "6": "TLS/TCP",
  "7": "TLS/TCP/UDP",
  etrudp: "UDP",
  etrtcp: "TCP",
  etrtcp_udp: "TCP/UDP",
  etrtls: "TLS",
  etrtls_udp: "TLS/UDP",
  etrtls_tcp: "TLS/TCP",
  etrtls_tcp_udp: "TLS/TCP/UDP",
};

const INTEROP: Record<string, string> = {
  "0": "Standard",
  "1": "BroadSoft",
  "2": "Office 365",
  "3": "Office 365 with AD",
  "4": "Header transparency",
  estandard: "Standard",
  ebroadsoft: "BroadSoft",
  eo365: "Office 365",
  eo365wad: "Office 365 with AD",
  eheadertransparency: "Header transparency",
};

function listeners(node: Record<string, unknown>): string {
  const parts: string[] = [];
  for (let index = 1; index <= 6; index += 1) {
    const port = field(node, `ListenPort_${index}`);
    if (!port || port === "0") continue;
    const protocol = PROTOCOLS[field(node, `Protocol_${index}`).toLowerCase()] ?? "";
    parts.push(protocol ? `${protocol} ${port}` : port);
  }
  return parts.slice(0, 3).join(", ");
}

function isStub(node: Record<string, unknown>): boolean {
  return Object.keys(node).every((key) => key.startsWith("@_"));
}

export function parseApiStatus(xml: string): { httpCode: number | null; appCode: string | null } {
  const document = parseDocument(xml);
  let httpCode: number | null = null;
  let appCode: string | null = null;
  walk(document, (record) => {
    if (httpCode == null && "http_code" in record) {
      const parsed = Number(field(record, "http_code"));
      if (Number.isFinite(parsed)) httpCode = parsed;
    }
    const entries = record.app_status_entry;
    if (!appCode && entries) {
      const list = Array.isArray(entries) ? entries : [entries];
      for (const entry of list) {
        if (entry && typeof entry === "object") {
          const code = (entry as Record<string, unknown>)["@_code"];
          if (code != null && String(code).trim()) {
            appCode = String(code).trim();
            break;
          }
        }
      }
    }
  });
  return { httpCode, appCode };
}

export function parseSignalingGroups(xml: string): ParsedSignalingGroup[] {
  const document = parseDocument(xml);
  const nodes = collect(document, "sipsg");
  const groups: ParsedSignalingGroup[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const id = idFrom(node);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const stub = isStub(node);
    const rawStatus = normalizeStatus(field(node, "rt_Status"));
    const adminState = normalizeAdmin(field(node, "customAdminState"));
    const health = stub ? "unknown" : classifyHealth(rawStatus, adminState);
    const cluster = field(node, "ServerClusterId");
    const description = field(node, "Description");
    groups.push({
      id,
      sbcId: "",
      sbcName: "",
      sbcHost: "",
      sgId: id,
      name: description || `Signaling group ${id}`,
      health,
      rawStatus: stub ? "unknown" : rawStatus,
      statusLabel: stub ? "Unknown" : statusLabel(health, rawStatus),
      adminState: stub ? "unknown" : adminState,
      channels: integerOrNull(field(node, "rt_NumberOfChannels") || field(node, "Channels")),
      currentCalls: integerOrNull(field(node, "rt_NumCurrentCalls")),
      calls: stub ? emptyCallStats() : callStats(node),
      peers: [],
      interop: INTEROP[field(node, "InteropMode").toLowerCase()] ?? "",
      protocol: listeners(node),
      serverClusterId: cluster && cluster !== "0" ? cluster : "",
      stub,
    });
  }
  return groups;
}

export function parseSipServers(xml: string): string[] {
  const document = parseDocument(xml);
  const servers = collect(document, "sipserver");
  const peers: string[] = [];
  for (const server of servers) {
    const host = field(server, "Host") || field(server, "rt_RemoteServers");
    if (!host || host.toLowerCase() === "none") continue;
    const port = field(server, "Port");
    const label = port && port !== "0" ? `${host}:${port}` : host;
    if (!peers.includes(label)) peers.push(label);
  }
  return peers;
}

export function parseSystem(xml: string): { name: string; version: string } {
  const document = parseDocument(xml);
  const systems = collect(document, "system");
  const system = systems[0];
  if (!system) return { name: "", version: "" };
  const name = field(system, "NodeName") || field(system, "rt_HostName");
  const base = field(system, "rt_Software_Base_Version");
  const patch = field(system, "rt_Software_Patch_Version");
  const build = field(system, "rt_Software_Base_BuildNumber");
  const parts = [
    base,
    patch && patch !== "0" && patch.toLowerCase() !== "none" ? `patch ${patch}` : "",
    build ? `build ${build}` : "",
  ].filter(Boolean);
  return { name, version: parts.join(" ") };
}
