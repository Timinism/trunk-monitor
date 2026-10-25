import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authSecret } from "@/lib/accounts";
import { cookieBase, OIDC_COOKIE } from "@/lib/auth";
import { buildAuthorizationUrl, codeChallenge, discover, oidcConfig, sealOidcTxn } from "@/lib/oidc";

export async function GET() {
  const config = oidcConfig();
  if (!config) return fail("oidc_unconfigured");
  try {
    const state = randomBytes(16).toString("base64url");
    const nonce = randomBytes(16).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const discovery = await discover(config.tenantId);
    const location = buildAuthorizationUrl(discovery.authorization_endpoint, config, {
      state,
      nonce,
      challenge: codeChallenge(verifier),
    });
    const response = redirect(location);
    response.cookies.set(OIDC_COOKIE, sealOidcTxn({ state, nonce, verifier, exp: Date.now() + 10 * 60 * 1000 }, authSecret()), {
      ...cookieBase(),
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    console.error("Entra sign-in could not start.", message);
    return fail(message.includes("AUTH_SECRET") ? "oidc_unconfigured" : "oidc_discovery");
  }
}

function fail(code: string) {
  return redirect(`/?error=${code}`);
}

function redirect(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}
