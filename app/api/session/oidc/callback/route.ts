import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authSecret, createSession, sameSecret, SESSION_TTL_SECONDS } from "@/lib/accounts";
import { cookieBase, OIDC_COOKIE, SESSION_COOKIE } from "@/lib/auth";
import { claimsAllow, oidcConfig, openOidcTxn, principalName, principalUsername, redeemCode } from "@/lib/oidc";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = oidcConfig();
  if (!config) return fail("oidc_unconfigured");
  if (url.searchParams.get("error")) return fail("oidc_denied");
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const jar = await cookies();
  const txn = openOidcTxn(jar.get(OIDC_COOKIE)?.value ?? "", secretOrEmpty());
  if (!txn || !sameSecret(txn.state, state) || !code) return fail("oidc_state");
  try {
    const payload = await redeemCode(config, code, txn.verifier, txn.nonce);
    const allowed = claimsAllow(payload as Record<string, unknown>, config.allowedGroups);
    if (allowed === "overage") return fail("oidc_overage");
    if (allowed === "deny") return fail("oidc_group");
    const token = createSession({
      kind: "oidc",
      username: principalUsername(payload),
      displayName: principalName(payload),
    });
    const response = redirect("/");
    response.cookies.set(OIDC_COOKIE, "", { ...cookieBase(), maxAge: 0 });
    response.cookies.set(SESSION_COOKIE, token, { ...cookieBase(), maxAge: SESSION_TTL_SECONDS });
    return response;
  } catch (error) {
    console.error("Entra sign-in failed.", error instanceof Error ? error.message : "error");
    return fail("oidc_failed");
  }
}

function secretOrEmpty(): string {
  try {
    return authSecret();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "AUTH_SECRET is invalid.");
    return "";
  }
}

function fail(code: string) {
  const response = redirect(`/?error=${code}`);
  response.cookies.set(OIDC_COOKIE, "", { ...cookieBase(), maxAge: 0 });
  return response;
}

function redirect(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}
