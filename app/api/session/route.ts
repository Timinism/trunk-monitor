import { authenticateLocal, createSession, localLoginAvailable } from "@/lib/accounts";
import { clearAuthCookies, currentSession, writeSessionCookie } from "@/lib/auth";
import { oidcConfigured } from "@/lib/oidc";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await currentSession();
  return Response.json(
    {
      locked: session === null,
      local: localLoginAvailable(),
      oidc: oidcConfigured(),
      user: session ? { name: session.displayName, kind: session.kind } : null,
    },
    { headers: noStore },
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const result = authenticateLocal(username, password);
  if (!result.ok) {
    const status = result.reason === "limited" ? 429 : 401;
    const error =
      result.reason === "limited"
        ? "Too many attempts. Wait 15 minutes and try again."
        : "Wrong username or password.";
    return Response.json({ error }, { status, headers: noStore });
  }
  await writeSessionCookie(createSession({ kind: "local", username: result.username, displayName: result.username }));
  return Response.json({ ok: true }, { headers: noStore });
}

export async function DELETE() {
  await clearAuthCookies();
  return Response.json({ ok: true }, { headers: noStore });
}
