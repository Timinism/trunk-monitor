"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not sign in.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid min-h-full place-items-center px-4 py-16">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">Edge Watch</p>
        <h1 className="mt-2 font-heading text-3xl">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This monitor stores the SBC and mail passwords, so it is locked with the password from MONITOR_PASSWORD.
        </p>
        <div className="mt-6 grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <p className="mt-3 text-sm text-down">{error}</p> : null}
        <Button type="submit" className="mt-5 w-full" disabled={pending}>
          {pending ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
