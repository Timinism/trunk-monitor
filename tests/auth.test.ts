import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { generateKeyPair, SignJWT } from "jose";

import {
  authenticateLocal,
  authSecret,
  createSession,
  readSession,
  resetLocalAdminSyncForTests,
  deleteSession,
} from "../lib/accounts";
import { closeDb, getDb } from "../lib/db";
import {
  buildAuthorizationUrl,
  claimsAllow,
  codeChallenge,
  entraDiscovery,
  oidcConfig,
  openOidcTxn,
  principalName,
  principalUsername,
  sealOidcTxn,
  verifyIdToken,
  OidcError,
} from "../lib/oidc";
import { hashPassword, verifyPassword } from "../lib/passwords";

const tenant = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  closeDb();
  resetLocalAdminSyncForTests();
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "edge-watch-auth-"));
  for (const key of [
    "MONITOR_PASSWORD",
    "MONITOR_USERNAME",
    "AUTH_SECRET",
    "APP_URL",
    "OIDC_TENANT_ID",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
    "OIDC_REDIRECT_URI",
    "OIDC_ALLOWED_GROUPS",
  ]) {
    delete process.env[key];
  }
});

describe("local accounts", () => {
  it("hashes a password and rejects a retuned cost", () => {
    const stored = hashPassword("correct-horse");
    assert.equal(verifyPassword("correct-horse", stored), true);
    assert.equal(verifyPassword("wrong-password", stored), false);
    assert.equal(verifyPassword("correct-horse", stored.replace("16384", "1048576")), false);
  });

  it("seeds the local admin from the environment and rotates it on restart", () => {
    process.env.MONITOR_USERNAME = "noc";
    process.env.MONITOR_PASSWORD = "correct-horse";
    assert.deepEqual(authenticateLocal("NOC", "correct-horse"), { ok: true, username: "noc" });

    process.env.MONITOR_PASSWORD = "next-password";
    resetLocalAdminSyncForTests();
    assert.equal(authenticateLocal("noc", "correct-horse").ok, false);
    assert.deepEqual(authenticateLocal("noc", "next-password"), { ok: true, username: "noc" });
  });

  it("locks a username for 15 minutes after eight failures", () => {
    process.env.MONITOR_PASSWORD = "correct-horse";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assert.equal(authenticateLocal("admin", "wrong-password").ok, false);
    }
    assert.deepEqual(authenticateLocal("admin", "correct-horse"), { ok: false, reason: "limited" });
    getDb()
      .prepare("UPDATE login_attempts SET attempted_at = ?")
      .run(new Date(Date.now() - 16 * 60 * 1000).toISOString());
    assert.deepEqual(authenticateLocal("admin", "correct-horse"), { ok: true, username: "admin" });
  });

  it("does not count a malformed username as an attempt", () => {
    process.env.MONITOR_PASSWORD = "correct-horse";
    assert.deepEqual(authenticateLocal("bad name", "correct-horse"), { ok: false, reason: "credentials" });
    const row = getDb().prepare("SELECT COUNT(*) AS n FROM login_attempts").get() as { n: number };
    assert.equal(row.n, 0);
  });
});

describe("sessions", () => {
  it("stores only the hash of a random session token", () => {
    const token = createSession({ kind: "local", username: "noc", displayName: "noc" });
    assert.equal(readSession(token)?.displayName, "noc");
    assert.equal(readSession("a".repeat(64)), null);
    const row = getDb().prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
    assert.equal(row.token_hash.includes(token), false);
    deleteSession(token);
    assert.equal(readSession(token), null);
  });

  it("drops an expired session", () => {
    const token = createSession({ kind: "oidc", username: "avery@example.com", displayName: "Avery Chen" });
    getDb()
      .prepare("UPDATE sessions SET expires_at = ?")
      .run(new Date(Date.now() - 1000).toISOString());
    assert.equal(readSession(token), null);
  });

  it("persists an auth secret in the data directory", () => {
    const first = authSecret();
    assert.equal(authSecret(), first);
    assert.equal(first.length >= 16, true);
  });
});

describe("entra id", () => {
  it("requires a tenant id and an http(s) redirect URI", () => {
    assert.equal(oidcConfig(), null);
    process.env.OIDC_TENANT_ID = "common";
    process.env.OIDC_CLIENT_ID = "client";
    process.env.OIDC_CLIENT_SECRET = "secret";
    process.env.APP_URL = "http://edge-watch.internal:3847";
    assert.equal(oidcConfig(), null);

    process.env.OIDC_TENANT_ID = tenant;
    process.env.OIDC_ALLOWED_GROUPS = " group-1 , role.user ";
    const config = oidcConfig();
    assert.equal(config?.redirectUri, "http://edge-watch.internal:3847/api/session/oidc/callback");
    assert.deepEqual(config?.allowedGroups, ["group-1", "role.user"]);

    process.env.OIDC_REDIRECT_URI = "javascript:alert(1)";
    assert.equal(oidcConfig(), null);
  });

  it("rejects a discovery document that leaves login.microsoftonline.com", () => {
    const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
    assert.throws(
      () =>
        entraDiscovery(tenant, {
          issuer,
          authorization_endpoint: "https://evil.example/authorize",
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
        }),
      OidcError,
    );
    const discovery = entraDiscovery(tenant, {
      issuer,
      authorization_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      token_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      jwks_uri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
    });
    const url = new URL(
      buildAuthorizationUrl(discovery.authorization_endpoint, { clientId: "client", redirectUri: "http://edge/callback" }, {
        state: "state-1",
        nonce: "nonce-1",
        challenge: codeChallenge("verifier-value"),
      }),
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), "openid profile email");
    assert.equal(url.hostname, "login.microsoftonline.com");
  });

  it("allows a matching group or app role and refuses everyone else", () => {
    assert.equal(claimsAllow({ groups: ["group-1"] }, []), "allow");
    assert.equal(claimsAllow({ groups: ["group-1"] }, ["group-1"]), "allow");
    assert.equal(claimsAllow({ roles: ["Edge.User"] }, ["Edge.User"]), "allow");
    assert.equal(claimsAllow({}, ["group-1"]), "deny");
    assert.equal(claimsAllow({ hasgroups: true }, ["group-1"]), "overage");
    assert.equal(claimsAllow({ _claim_names: { groups: "src1" } }, ["group-1"]), "overage");
  });

  it("accepts an Entra ID token only for the configured tenant, audience, and nonce", async () => {
    const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const token = await new SignJWT({
      nonce: "nonce-value",
      tid: tenant,
      name: "Avery Chen",
      preferred_username: "avery@example.com",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience("edge-watch-client")
      .setSubject("subject-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const payload = await verifyIdToken(token, publicKey, {
      issuer,
      audience: "edge-watch-client",
      nonce: "nonce-value",
      tenantId: tenant,
    });
    assert.equal(principalName(payload), "Avery Chen");
    assert.equal(principalUsername(payload), "avery@example.com");
    await assert.rejects(
      () => verifyIdToken(token, publicKey, { issuer, audience: "edge-watch-client", nonce: "other", tenantId: tenant }),
      (error: unknown) => error instanceof OidcError && error.code === "nonce",
    );
    await assert.rejects(
      () => verifyIdToken(token, publicKey, { issuer, audience: "edge-watch-client", nonce: "nonce-value", tenantId: "other" }),
      (error: unknown) => error instanceof OidcError && error.code === "tenant",
    );
    await assert.rejects(
      () => verifyIdToken(token, publicKey, { issuer, audience: "other-client", nonce: "nonce-value", tenantId: tenant }),
      (error: unknown) => error instanceof OidcError && error.code === "token",
    );
  });

  it("rejects a tampered or expired sign-in cookie", () => {
    const secret = "test-secret-value";
    const sealed = sealOidcTxn({ state: "state-1", nonce: "nonce-1", verifier: "verifier-1", exp: Date.now() + 60_000 }, secret);
    assert.equal(openOidcTxn(sealed, secret)?.verifier, "verifier-1");
    assert.equal(openOidcTxn(sealed, "another-test-secret"), null);
    const flipped = `${sealed.slice(0, -1)}${sealed.endsWith("a") ? "b" : "a"}`;
    assert.equal(openOidcTxn(flipped, secret), null);
    const expired = sealOidcTxn({ state: "state-1", nonce: "nonce-1", verifier: "verifier-1", exp: Date.now() - 1 }, secret);
    assert.equal(openOidcTxn(expired, secret), null);
  });
});
