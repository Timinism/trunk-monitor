import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "edge_watch_session";

export function monitorPassword(): string | null {
  const value = process.env.MONITOR_PASSWORD?.trim();
  return value ? value : null;
}

export function sessionToken(password: string): string {
  return createHmac("sha256", password).update("edge-watch-v1").digest("hex");
}

export function passwordMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function tokenMatches(password: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(sessionToken(password));
  const actual = Buffer.from(token);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function isLocked(): Promise<boolean> {
  const jar = await cookies();
  const password = monitorPassword();
  if (!password) return false;
  return !tokenMatches(password, jar.get(SESSION_COOKIE)?.value);
}

export async function assertAuthorized(): Promise<Response | null> {
  if (!(await isLocked())) return null;
  return Response.json({ error: "Sign in required." }, { status: 401 });
}
