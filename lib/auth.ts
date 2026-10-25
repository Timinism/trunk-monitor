import { cookies } from "next/headers";
import { deleteSession, readSession, SESSION_TTL_SECONDS, type SessionUser } from "./accounts";

export const SESSION_COOKIE = "edge_watch_session";
export const OIDC_COOKIE = "edge_watch_oidc";

export function cookieBase() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.MONITOR_COOKIE_SECURE === "true",
    path: "/",
  };
}

export async function currentSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value);
}

export async function isLocked(): Promise<boolean> {
  return (await currentSession()) === null;
}

export async function assertAuthorized(): Promise<Response | null> {
  if (await currentSession()) return null;
  return Response.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export async function writeSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS });
}

export async function clearAuthCookies() {
  const jar = await cookies();
  deleteSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  jar.delete(OIDC_COOKIE);
}
