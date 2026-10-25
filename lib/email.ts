import type { AlarmKind, Settings, TrunkObservation } from "./types";

export function formatStamp(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "long",
    }).format(date);
  } catch {
    return `${date.toISOString()} UTC`;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function headline(kind: AlarmKind, name: string): string {
  if (kind === "recovery") return `${name} recovered`;
  if (kind === "reminder") return `${name} is still down`;
  return `${name} is down`;
}

function subjectPrefix(kind: AlarmKind): string {
  if (kind === "recovery") return "RECOVERED";
  if (kind === "reminder") return "STILL DOWN";
  return "DOWN";
}

export function renderTrunkMail(input: {
  kind: AlarmKind;
  trunk: TrunkObservation;
  previousHealth: string | null;
  sbcName: string;
  sbcHost: string;
  downSince: string;
  now: Date;
  timezone: string;
}): { subject: string; text: string; html: string } {
  const when = formatStamp(input.now, input.timezone);
  const since = formatStamp(new Date(input.downSince), input.timezone);
  const sbc = input.sbcName || input.sbcHost || "Ribbon SBC Edge";
  const subject = `[Edge Watch] ${subjectPrefix(input.kind)}: ${input.trunk.name} on ${sbc}`;
  const lines = [
    headline(input.kind, input.trunk.name),
    "",
    `Signaling group: ${input.trunk.name} (id ${input.trunk.id})`,
    `State: ${input.trunk.statusLabel} (${input.trunk.rawStatus})`,
    `Previous: ${input.previousHealth ?? "first observation"}`,
    `SBC: ${sbc}${input.sbcHost ? ` (${input.sbcHost})` : ""}`,
    `Admin: ${input.trunk.adminState}`,
    `Channels: ${input.trunk.channels ?? "unknown"}`,
    `Active calls: ${input.trunk.currentCalls ?? "unknown"}`,
    `Peers: ${input.trunk.peers.join(", ") || "none reported"}`,
    `Listen: ${input.trunk.protocol || "not reported"}`,
    `Interop: ${input.trunk.interop || "not reported"}`,
    `Down since: ${since}`,
    `Time: ${when}`,
    "",
    input.kind === "recovery"
      ? "The signaling group has left the alarm state."
      : "Edge Watch will send another message when the trunk recovers.",
  ];
  return { subject, text: lines.join("\n"), html: htmlMessage(subject, lines) };
}

export function renderReachabilityMail(input: {
  kind: "unreachable" | "reachable" | "reminder";
  sbcName: string;
  sbcHost: string;
  detail: string;
  failures: number;
  now: Date;
  timezone: string;
}): { subject: string; text: string; html: string } {
  const sbc = input.sbcName || input.sbcHost || "Ribbon SBC Edge";
  const prefix =
    input.kind === "reachable" ? "SBC REACHABLE" : input.kind === "reminder" ? "SBC STILL UNREACHABLE" : "SBC UNREACHABLE";
  const subject = `[Edge Watch] ${prefix}: ${sbc}`;
  const lines = [
    input.kind === "reachable" ? `${sbc} is reachable again` : `${sbc} could not be polled`,
    "",
    `SBC: ${sbc}${input.sbcHost ? ` (${input.sbcHost})` : ""}`,
    `Consecutive failures: ${input.failures}`,
    `Detail: ${input.detail || "none"}`,
    `Time: ${formatStamp(input.now, input.timezone)}`,
    "",
    input.kind === "reachable"
      ? "Polling succeeded. Trunk alarms resume from the new snapshot."
      : "Trunk states were left unchanged so a network failure does not look like a trunk outage.",
  ];
  return { subject, text: lines.join("\n"), html: htmlMessage(subject, lines) };
}

export function renderTestMail(settings: Settings, now = new Date()): { subject: string; text: string; html: string } {
  const subject = "[Edge Watch] Test message";
  const lines = [
    "This is a test message from Edge Watch.",
    "",
    `SBC: ${settings.sbcHost || "not configured"}`,
    `Mode: ${settings.mode}`,
    `Time: ${formatStamp(now, settings.timezone)}`,
    "",
    "If you can read this, SMTP delivery is working.",
  ];
  return { subject, text: lines.join("\n"), html: htmlMessage(subject, lines) };
}

function htmlMessage(title: string, lines: string[]): string {
  const body = lines
    .map((line) => (line === "" ? "<br>" : `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`))
    .join("");
  return `<div style="font-family:Georgia,serif;background:#121920;color:#e7eef6;padding:24px">
    <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#e0a15a">Edge Watch</div>
    <h1 style="font-size:22px;line-height:1.3;margin:8px 0 16px">${escapeHtml(title.replace("[Edge Watch] ", ""))}</h1>
    ${body}
  </div>`;
}
