import { ConfigError } from "./errors";

function userWrotePort(host: string): boolean {
  const stripped = host
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  if (stripped.startsWith("[")) return /\]:\d+$/.test(stripped);
  return /:\d+$/.test(stripped);
}

export function sbcRestBase(host: string, port: number): string {
  const trimmed = host.trim();
  if (!trimmed) throw new ConfigError("SBC address is empty.");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ConfigError("SBC address is not a valid host or URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError("SBC address must use https.");
  }
  if (!userWrotePort(trimmed)) url.port = String(port);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") url.pathname = "/rest";
  else if (path.endsWith("/rest")) url.pathname = path;
  else url.pathname = `${path}/rest`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
