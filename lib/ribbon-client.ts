import { Agent, fetch as undiciFetch } from "undici";
import { RibbonError } from "./errors";
import { parseApiStatus, parseSignalingGroups, parseSipServers, parseSystem } from "./ribbon-xml";
import type { TrunkObservation } from "./types";

const SESSION_TTL_MS = 8 * 60 * 1000;

export type RibbonClientOptions = {
  baseUrl: string;
  username: string;
  password: string;
  tlsVerify: boolean;
};

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const single = response.headers.get("set-cookie");
  const cookies = list.length > 0 ? list : single ? [single] : [];
  return cookies
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter((part) => part.includes("="))
    .join("; ");
}

export function explainNetworkError(error: unknown, tlsVerify: boolean): RibbonError {
  if (error instanceof RibbonError) return error;
  const record = error as { code?: string; cause?: { code?: string }; message?: string };
  const code = record?.code || record?.cause?.code || "";
  const message = error instanceof Error ? error.message : "Could not reach the SBC.";
  if (
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    /self-signed|unable to verify/i.test(message)
  ) {
    return new RibbonError(
      tlsVerify
        ? "TLS certificate verification failed. Ribbon Edge appliances usually present a self-signed certificate. Turn off Verify TLS, or install the SBC certificate on this host."
        : "TLS negotiation with the SBC failed.",
    );
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new RibbonError("The SBC hostname could not be resolved.");
  }
  if (code === "ECONNREFUSED") {
    return new RibbonError("The SBC refused the connection. Check the address, port, and that HTTPS is reachable.");
  }
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || /timeout|aborted/i.test(message)) {
    return new RibbonError("The connection to the SBC timed out.");
  }
  return new RibbonError(message || "Could not reach the SBC.");
}

export class RibbonClient {
  private cookie: string | null = null;
  private cookieAt = 0;
  private loginPromise: Promise<void> | null = null;
  private readonly agent: Agent | null;

  constructor(private readonly options: RibbonClientOptions) {
    this.agent = options.baseUrl.startsWith("https:")
      ? new Agent({ connect: { rejectUnauthorized: options.tlsVerify } })
      : null;
  }

  async getSystem(): Promise<{ name: string; version: string }> {
    const xml = await this.request("system");
    return parseSystem(xml);
  }

  async getSignalingGroups(): Promise<TrunkObservation[]> {
    let xml: string;
    try {
      xml = await this.request("sipsg?details=true");
    } catch (error) {
      if (!(error instanceof RibbonError) || error.status !== 400) throw error;
      xml = await this.request("sipsg");
    }
    let groups = parseSignalingGroups(xml);
    const stubs = groups.filter((group) => group.stub);
    if (stubs.length > 0) {
      const detailed = groups.filter((group) => !group.stub);
      for (const stub of stubs) {
        const one = await this.request(`sipsg/${encodeURIComponent(stub.id)}`);
        const parsed = parseSignalingGroups(one).find((group) => !group.stub);
        if (parsed) detailed.push({ ...parsed, id: parsed.id || stub.id, stub: false });
      }
      groups = detailed;
    }

    const clusters = [...new Set(groups.map((group) => group.serverClusterId).filter(Boolean))];
    const peersByCluster = new Map<string, string[]>();
    for (const clusterId of clusters) {
      try {
        const serverXml = await this.request(
          `sipservertable/${encodeURIComponent(clusterId)}/sipserver?details=true`,
        );
        peersByCluster.set(clusterId, parseSipServers(serverXml));
      } catch {
        peersByCluster.set(clusterId, []);
      }
    }

    return groups
      .filter((group) => !group.stub)
      .map((group) => ({
        id: group.id,
        name: group.name,
        health: group.health,
        rawStatus: group.rawStatus,
        statusLabel: group.statusLabel,
        adminState: group.adminState,
        channels: group.channels,
        currentCalls: group.currentCalls,
        calls: group.calls,
        peers: peersByCluster.get(group.serverClusterId) ?? [],
        interop: group.interop,
        protocol: group.protocol,
        serverClusterId: group.serverClusterId,
      }));
  }

  private async request(path: string, retry = true): Promise<string> {
    await this.login(false);
    const url = `${this.options.baseUrl}/${path.replace(/^\//, "")}`;
    let response: Response;
    try {
      response = await this.fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/xml, text/xml",
          Cookie: this.cookie ?? "",
        },
      });
    } catch (error) {
      throw explainNetworkError(error, this.options.tlsVerify);
    }
    const text = await response.text();
    if (response.status === 401 && retry) {
      this.cookie = null;
      await this.login(true);
      return this.request(path, false);
    }
    if (response.status >= 400) {
      throw new RibbonError(`SBC returned HTTP ${response.status} for ${path}.`, response.status);
    }
    const status = parseApiStatus(text);
    if (status.httpCode && status.httpCode !== 200) {
      const application = status.appCode ? ` (application ${status.appCode})` : "";
      throw new RibbonError(
        `SBC rejected ${path} with code ${status.httpCode}${application}.`,
        status.httpCode,
      );
    }
    return text;
  }

  private async login(force: boolean): Promise<void> {
    if (!force && this.cookie && Date.now() - this.cookieAt < SESSION_TTL_MS) return;
    if (!force && this.loginPromise) return this.loginPromise;
    const run = this.performLogin();
    this.loginPromise = run;
    try {
      await run;
    } finally {
      if (this.loginPromise === run) this.loginPromise = null;
    }
  }

  private async performLogin(): Promise<void> {
    const body = new URLSearchParams({
      Username: this.options.username,
      Password: this.options.password,
    });
    let response: Response;
    try {
      response = await this.fetch(`${this.options.baseUrl}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/xml, text/xml",
        },
        body,
      });
    } catch (error) {
      throw explainNetworkError(error, this.options.tlsVerify);
    }
    const cookie = cookieHeader(response);
    if (response.status === 401 || response.status === 403 || !cookie.includes("PHPSESSID=")) {
      throw new RibbonError(
        "SBC login failed. Check the REST username and password. The account has to be created in the SBC Web UI with the REST access level.",
        response.status,
      );
    }
    if (response.status >= 400) {
      throw new RibbonError(`SBC login returned HTTP ${response.status}.`, response.status);
    }
    this.cookie = cookie;
    this.cookieAt = Date.now();
  }

  private fetch(url: string, init: RequestInit): Promise<Response> {
    const options = {
      ...init,
      signal: AbortSignal.timeout(20_000),
      dispatcher: this.agent ?? undefined,
    };
    return undiciFetch(url, options as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
  }
}
