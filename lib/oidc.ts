import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createLocalJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export type OidcConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedGroups: string[];
};

export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export type OidcTxn = {
  state: string;
  nonce: string;
  verifier: string;
  exp: number;
};

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const discoveryCache = new Map<string, { at: number; value: Discovery }>();
const jwksCache = new Map<string, { at: number; set: JWTVerifyGetKey }>();

export class OidcError extends Error {
  constructor(readonly code: "discovery" | "token" | "nonce" | "tenant") {
    super(code);
  }
}

export function oidcConfig(): OidcConfig | null {
  const tenantId = process.env.OIDC_TENANT_ID?.trim() ?? "";
  const clientId = process.env.OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.OIDC_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = configuredRedirectUri();
  if (!TENANT_ID.test(tenantId) || !clientId || clientId.length > 200 || !clientSecret || !redirectUri) return null;
  const allowedGroups = (process.env.OIDC_ALLOWED_GROUPS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return { tenantId, clientId, clientSecret, redirectUri, allowedGroups };
}

export function oidcConfigured(): boolean {
  return oidcConfig() !== null;
}

function configuredRedirectUri(): string | null {
  const explicit = process.env.OIDC_REDIRECT_URI?.trim() ?? "";
  const appUrl = process.env.APP_URL?.trim().replace(/\/$/, "") ?? "";
  const value = explicit || (appUrl ? `${appUrl}/api/session/oidc/callback` : "");
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function entraDiscovery(tenantId: string, body: unknown): Discovery {
  if (!body || typeof body !== "object") throw new OidcError("discovery");
  const record = body as Record<string, unknown>;
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  if (record.issuer !== issuer) throw new OidcError("discovery");
  return {
    issuer,
    authorization_endpoint: entraHttpsUrl(record.authorization_endpoint),
    token_endpoint: entraHttpsUrl(record.token_endpoint),
    jwks_uri: entraHttpsUrl(record.jwks_uri),
  };
}

function entraHttpsUrl(value: unknown): string {
  if (typeof value !== "string") throw new OidcError("discovery");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "login.microsoftonline.com") throw new OidcError("discovery");
  return url.toString();
}

export async function discover(tenantId: string): Promise<Discovery> {
  const hit = discoveryCache.get(tenantId);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value;
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0/.well-known/openid-configuration`,
    { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (response.status !== 200) throw new OidcError("discovery");
  const body: unknown = await response.json().catch(() => null);
  const value = entraDiscovery(tenantId, body);
  discoveryCache.set(tenantId, { at: Date.now(), value });
  return value;
}

export function buildAuthorizationUrl(
  authorizationEndpoint: string,
  config: Pick<OidcConfig, "clientId" | "redirectUri">,
  txn: { state: string; nonce: string; challenge: string },
): string {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", txn.state);
  url.searchParams.set("nonce", txn.nonce);
  url.searchParams.set("code_challenge", txn.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function redeemCode(config: OidcConfig, code: string, verifier: string, nonce: string): Promise<JWTPayload> {
  if (!code || code.length > 2048) throw new OidcError("token");
  const discovery = await discover(config.tenantId);
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (response.status !== 200) throw new OidcError("token");
  const tokens = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!tokens || typeof tokens.id_token !== "string") throw new OidcError("token");
  return verifyIdToken(tokens.id_token, await jwksFor(discovery.jwks_uri), {
    issuer: discovery.issuer,
    audience: config.clientId,
    nonce,
    tenantId: config.tenantId,
  });
}

export async function verifyIdToken(
  idToken: string,
  key: JWTVerifyGetKey | CryptoKey,
  checks: { issuer: string; audience: string; nonce: string; tenantId: string },
): Promise<JWTPayload> {
  if (idToken.length > 16_000) throw new OidcError("token");
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, key, {
      issuer: checks.issuer,
      audience: checks.audience,
      algorithms: ["RS256"],
      clockTolerance: 60,
    }));
  } catch {
    throw new OidcError("token");
  }
  if (typeof payload.nonce !== "string" || !fixedEqual(payload.nonce, checks.nonce)) throw new OidcError("nonce");
  if (payload.tid !== checks.tenantId) throw new OidcError("tenant");
  return payload;
}

async function jwksFor(uri: string): Promise<JWTVerifyGetKey> {
  const hit = jwksCache.get(uri);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.set;
  const response = await fetch(uri, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (response.status !== 200) throw new OidcError("token");
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || !Array.isArray((body as { keys?: unknown }).keys)) throw new OidcError("token");
  const set = createLocalJWKSet(body as { keys: [] });
  jwksCache.set(uri, { at: Date.now(), set });
  return set;
}

export function claimsAllow(payload: Record<string, unknown>, allowed: string[]): "allow" | "deny" | "overage" {
  if (allowed.length === 0) return "allow";
  const have = new Set<string>([...stringList(payload.groups), ...stringList(payload.roles)]);
  if (allowed.some((entry) => have.has(entry))) return "allow";
  if (payload.hasgroups === true || payload.hasgroups === "true") return "overage";
  const claimNames = payload._claim_names;
  if (claimNames && typeof claimNames === "object" && "groups" in claimNames) return "overage";
  return "deny";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function principalName(payload: JWTPayload): string {
  if (typeof payload.name === "string" && payload.name.trim()) return payload.name.trim().slice(0, 120);
  if (typeof payload.preferred_username === "string" && payload.preferred_username.trim()) {
    return payload.preferred_username.trim().slice(0, 120);
  }
  return "Entra user";
}

export function principalUsername(payload: JWTPayload): string {
  if (typeof payload.preferred_username === "string" && payload.preferred_username.trim()) {
    return payload.preferred_username.trim().slice(0, 120);
  }
  if (typeof payload.sub === "string" && payload.sub.trim()) return payload.sub.trim().slice(0, 120);
  return "entra";
}

export function sealOidcTxn(txn: OidcTxn, secret: string): string {
  const payload = Buffer.from(JSON.stringify(txn)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function openOidcTxn(value: string, secret: string): OidcTxn | null {
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!fixedEqual(sig, expected)) return null;
  try {
    const txn = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OidcTxn;
    if (!txn || typeof txn.state !== "string" || typeof txn.nonce !== "string" || typeof txn.verifier !== "string") {
      return null;
    }
    if (typeof txn.exp !== "number" || txn.exp <= Date.now()) return null;
    return txn;
  } catch {
    return null;
  }
}

function fixedEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
