"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AccountMenu() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then((response) => response.json())
      .then((body: { user?: { name?: string } }) => {
        if (!cancelled) setName(body.user?.name ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setPending(true);
    await fetch("/api/session", { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {name ? <span className="max-w-40 truncate text-xs text-muted-foreground">{name}</span> : null}
      <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
