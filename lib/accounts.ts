import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDirectory, getDb } from "./db";
import { hashPassword, verifyPassword } from "./passwords";

const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type SessionUser = {
  username: string;
  displayName: string;
  kind: "local" | "oidc";
};

let syncedAdmin = "";
let dummyHash = "";
const globalFailures: number[] = [];

export function resetLocalAdminSyncForTests() {
  syncedAdmin = "";
  dummyHash = "";
  globalFailures.length = 0;
}

export function configuredLocalUsername(): string {
  const raw = process.env.MONITOR_USERNAME?.trim() || "admin";
  return USERNAME_PATTERN.test(raw) ? raw : "admin";
}

export function ensureLocalAdmin() {
  const password = process.env.MONITOR_PASSWORD?.trim() ?? "";
  if (!password || password.length > 200) return;
  const username = configuredLocalUsername();
  const stamp = `${username}\0${password}`;
  if (syncedAdmin === stamp) return;
  const existing = findLocalUser(username);
  if (!existing || !verifyPassword(password, existing.passwordHash)) {
    const passwordHash = hashPassword(password);
    const now = new Date().toISOString();
    if (!existing) {
      getDb()
        .prepare("INSERT INTO local_users (username, password_hash, created_at) VALUES (?, ?, ?)")
        .run(username, passwordHash, now);
    } else {
      getDb()
        .prepare("UPDATE local_users SET password_hash = ? WHERE username = ? COLLATE NOCASE")
        .run(passwordHash, username);
    }
  }
  syncedAdmin = stamp;
}

export function localLoginAvailable(): boolean {
  ensureLocalAdmin();
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM local_users").get() as { n: number };
  return row.n > 0;
}

type LocalUser = { username: string; passwordHash: string };

function findLocalUser(username: string): LocalUser | null {
  const row = getDb()
    .prepare("SELECT username, password_hash FROM local_users WHERE username = ? COLLATE NOCASE")
    .get(username) as { username: string; password_hash: string } | undefined;
  return row ? { username: row.username, passwordHash: row.password_hash } : null;
}

function dummyPasswordHash(): string {
  dummyHash ||= hashPassword("edge-watch-not-a-real-password");
  return dummyHash;
}

function attemptKey(username: string): string {
  return username.toLowerCase();
}

export function authenticateLocal(
  username: string,
  password: string,
): { ok: true; username: string } | { ok: false; reason: "credentials" | "limited" } {
  ensureLocalAdmin();
  const name = username.trim();
  if (!USERNAME_PATTERN.test(name) || !password || password.length > 200) {
    return { ok: false, reason: "credentials" };
  }
  if (isRateLimited(name) || globallyLimited()) return { ok: false, reason: "limited" };
  const user = findLocalUser(name);
  const matches = verifyPassword(password, user?.passwordHash ?? dummyPasswordHash());
  if (!user || !matches) {
    recordLoginFailure(name);
    noteGlobalFailure();
    return { ok: false, reason: "credentials" };
  }
  clearLoginFailures(name);
  return { ok: true, username: user.username };
}

function globallyLimited(): boolean {
  const cutoff = Date.now() - 60_000;
  while (globalFailures.length > 0 && globalFailures[0] <= cutoff) globalFailures.shift();
  return globalFailures.length >= 30;
}

function noteGlobalFailure() {
  globalFailures.push(Date.now());
}

function isRateLimited(username: string): boolean {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE username = ? AND attempted_at > ?")
    .get(attemptKey(username), since) as { n: number };
  return row.n >= MAX_ATTEMPTS;
}

function recordLoginFailure(username: string) {
  const now = new Date();
  const db = getDb();
  db.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").run(new Date(now.getTime() - WINDOW_MS).toISOString());
  db.prepare("INSERT INTO login_attempts (username, attempted_at) VALUES (?, ?)").run(attemptKey(username), now.toISOString());
}

function clearLoginFailures(username: string) {
  getDb().prepare("DELETE FROM login_attempts WHERE username = ?").run(attemptKey(username));
}

export function createSession(user: SessionUser): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
  db.prepare(
    `INSERT INTO sessions (token_hash, kind, username, display_name, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    tokenHash(token),
    user.kind,
    user.username,
    user.displayName,
    new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    now.toISOString(),
  );
  return token;
}

export function readSession(token: string | undefined): SessionUser | null {
  if (!token || token.length < 20 || token.length > 200) return null;
  const row = getDb()
    .prepare("SELECT kind, username, display_name, expires_at FROM sessions WHERE token_hash = ?")
    .get(tokenHash(token)) as
    | { kind: string; username: string; display_name: string; expires_at: string }
    | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    deleteSession(token);
    return null;
  }
  if (row.kind !== "local" && row.kind !== "oidc") return null;
  return { kind: row.kind, username: row.username, displayName: row.display_name };
}

export function deleteSession(token: string | undefined) {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function authSecret(): string {
  const fromEnv = process.env.AUTH_SECRET?.trim() ?? "";
  if (fromEnv) {
    if (fromEnv.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
    return fromEnv;
  }
  const file = path.join(dataDirectory(), "auth-secret");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  if (existing.length >= 16) return existing;
  const secret = randomBytes(32).toString("base64url");
  fs.mkdirSync(dataDirectory(), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return secret;
}

export function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
