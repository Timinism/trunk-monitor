import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  monitorPassword,
  passwordMatches,
  sessionToken,
} from "@/lib/auth";

export async function POST(request: Request) {
  const password = monitorPassword();
  if (!password) return Response.json({ ok: true, required: false });
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const submitted = typeof body?.password === "string" ? body.password : "";
  if (!passwordMatches(password, submitted)) {
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.MONITOR_COOKIE_SECURE === "true",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return Response.json({ ok: true, required: true });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
