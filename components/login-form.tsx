"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const oidcErrors: Record<string, string> = {
  oidc_denied: "Microsoft did not complete sign-in.",
  oidc_state: "That sign-in attempt expired. Start it again.",
  oidc_failed: "Microsoft sign-in failed. Try again, or use the local account.",
  oidc_group: "This Microsoft account is not allowed to open Edge Watch.",
  oidc_overage:
    "Entra ID did not include group membership in the token. Ask the Entra admin to emit group claims, or use an app role.",
  oidc_unconfigured: "Entra ID sign-in is not configured on this server.",
  oidc_discovery: "Edge Watch could not reach Microsoft Entra ID.",
};

export function LoginForm({ local, oidc }: { local: boolean; oidc: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(oidcErrors[params.get("error") ?? ""] ?? "");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not sign in.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="grid min-h-full place-items-center px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">Edge Watch</p>
        <h1 className="mt-2 font-heading text-3xl">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">{intro(local, oidc)}</p>
        {local ? (
          <form onSubmit={onSubmit} className="mt-6 grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Checking…" : "Sign in"}
            </Button>
          </form>
        ) : null}
        {local && oidc ? (
          <div className="my-5 flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : null}
        {oidc ? (
          <a
            href="/api/session/oidc"
            className={cn(buttonVariants({ variant: local ? "outline" : "default" }), "w-full", local ? "" : "mt-6")}
          >
            <MicrosoftMark />
            Sign in with Microsoft
          </a>
        ) : null}
        {error ? <p className="mt-4 text-sm text-down">{error}</p> : null}
      </div>
    </div>
  );
}

export function LoginFallback() {
  return (
    <div className="grid min-h-full place-items-center px-4 py-16">
      <p className="text-sm text-muted-foreground">Loading sign-in…</p>
    </div>
  );
}

function intro(local: boolean, oidc: boolean): string {
  if (local && oidc) return "Use the local account, or your Microsoft work account. Keep this app on the internal network.";
  if (local) return "Use the local Edge Watch account. Keep this app on the internal network.";
  if (oidc) return "Use your Microsoft work account. Keep this app on the internal network.";
  return "Sign-in is not set up yet. Set MONITOR_PASSWORD for a local account, or the Entra ID variables, then restart Edge Watch.";
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden="true">
      <rect width="9" height="9" fill="#f25022" />
      <rect x="12" width="9" height="9" fill="#7fba00" />
      <rect y="12" width="9" height="9" fill="#00a4ef" />
      <rect x="12" y="12" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
