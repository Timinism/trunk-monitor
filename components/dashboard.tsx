"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AlertEvent, Dashboard, Health, TrunkView } from "@/lib/types";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

function formatAgo(iso: string | null, now: number): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return formatWhen(iso);
}

function tone(health: Health): string {
  if (health === "up") return "bg-up/15 text-up";
  if (health === "down") return "bg-down/15 text-down";
  if (health === "degraded") return "bg-degraded/15 text-degraded";
  return "bg-muted text-muted-foreground";
}

function borderTone(health: Health): string {
  if (health === "down") return "border-l-down";
  if (health === "degraded") return "border-l-degraded";
  if (health === "up") return "border-l-up";
  return "border-l-border";
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (${response.status}).`;
}

export function DashboardView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (response.status === 401) {
      window.location.reload();
      return;
    }
    if (!response.ok) {
      setError(await readError(response));
      setLoading(false);
      return;
    }
    setData((await response.json()) as Dashboard);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const poll = window.setInterval(() => void load(), 5000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [load]);

  async function act(url: string, body: unknown, key: string, success: string) {
    setPending(key);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending("");
    if (!response.ok) {
      toast.error(await readError(response));
      return;
    }
    setData((await response.json()) as Dashboard);
    toast.success(success);
  }

  if (loading && !data) {
    return (
      <div className="grid gap-3">
        <div className="h-28 animate-pulse rounded-2xl bg-card" />
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
        <h1 className="font-heading text-2xl">The monitor API did not respond</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error || "Try the request again."}</p>
        <Button className="mt-4" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const nextAt = data.poll.lastPollAt
    ? Date.parse(data.poll.lastPollAt) + data.poll.intervalSeconds * 1000
    : null;
  const remain = nextAt == null ? null : Math.max(0, Math.ceil((nextAt - now) / 1000));
  const modeMismatch = data.poll.snapshotMode && data.poll.snapshotMode !== data.mode;

  return (
    <div className="grid gap-5">
      {error ? <p className="text-sm text-down">{error}</p> : null}
      {data.mode === "demo" ? (
        <div className="rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
          Demo mode is showing sample trunks. Connect a Ribbon SBC Edge in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          to monitor a live system. Use Simulate outage to fire the alert path.
        </div>
      ) : null}
      {data.poll.lastError ? (
        <div className="rounded-2xl border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">
          {data.poll.lastError}
          {data.poll.consecutiveFailures > 0 ? ` (${data.poll.consecutiveFailures} in a row)` : ""}
          {modeMismatch ? " Trunk rows below are from the previous successful poll." : ""}
        </div>
      ) : null}
      {!data.poll.monitoringEnabled ? (
        <div className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          Scheduled polling is paused. Poll now still checks once.
        </div>
      ) : null}

      <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">
              {data.mode === "demo" ? "Demo SBC" : data.sbcHost || "Live SBC"}
            </p>
            <h1 className="mt-1 font-heading text-4xl tracking-tight">
              {data.poll.sbcName || (data.mode === "demo" ? "edge-lab-01" : "Waiting for the first poll")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.poll.softwareVersion || "SIP signaling groups"}
              {data.poll.softwareVersion ? " · SIP signaling groups" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending !== ""} onClick={() => void act("/api/poll", {}, "poll", "Poll finished")}>
              {pending === "poll" ? "Polling…" : "Poll now"}
            </Button>
            {data.mode === "demo" ? (
              <>
                <Button
                  variant="destructive"
                  disabled={pending !== ""}
                  onClick={() => void act("/api/demo", { action: "down", trunkId: "1" }, "down", "Primary trunk marked down")}
                >
                  {pending === "down" ? "Updating…" : "Simulate outage"}
                </Button>
                <Button
                  variant="outline"
                  disabled={pending !== ""}
                  onClick={() => void act("/api/demo", { action: "restore" }, "restore", "Demo trunks restored")}
                >
                  Restore all
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Up" value={data.summary.up} className="text-up" />
          <Stat label="Down" value={data.summary.down} className="text-down" />
          <Stat label="Draining" value={data.summary.degraded} className="text-degraded" />
          <Stat label="Disabled" value={data.summary.disabled} />
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Last poll {formatAgo(data.poll.lastPollAt, now)}
          {data.poll.monitoringEnabled && remain != null ? ` · next in ${remain}s` : ""}
          {data.poll.lastSuccessAt ? ` · last success ${formatWhen(data.poll.lastSuccessAt)}` : ""}
        </p>
      </section>

      {data.trunks.length === 0 ? (
        <section className="rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
          <h2 className="font-heading text-2xl">No signaling groups yet</h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            {data.mode === "live"
              ? "A successful poll will list every SIP signaling group on the SBC. If the watch filter is set, only matching names and ids appear."
              : "The demo set appears after the first poll. Use Poll now if this stays empty."}
          </p>
        </section>
      ) : (
        <section className="grid gap-3">
          {data.trunks.map((trunk) => (
            <TrunkCard
              key={trunk.id}
              trunk={trunk}
              now={now}
              demo={data.mode === "demo"}
              pending={pending !== ""}
              onToggle={() =>
                void act(
                  "/api/demo",
                  { action: trunk.simulated ? "restore" : "down", trunkId: trunk.id },
                  trunk.id,
                  trunk.simulated ? `${trunk.name} restored` : `${trunk.name} marked down`,
                )
              }
            />
          ))}
        </section>
      )}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-heading text-2xl">Recent alerts</h2>
          <Link href="/alerts" className="text-sm text-primary hover:underline">
            All alerts
          </Link>
        </div>
        {data.recentEvents.length === 0 ? (
          <p className="rounded-2xl bg-card px-4 py-5 text-sm text-muted-foreground ring-1 ring-foreground/10">
            No alerts yet. A message is recorded when a trunk enters or leaves the down state.
          </p>
        ) : (
          <div className="grid gap-2">
            {data.recentEvents.map((event) => (
              <EventLine key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-xl bg-background/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`font-heading text-3xl ${className ?? ""}`}>{value}</dd>
    </div>
  );
}

function TrunkCard({
  trunk,
  now,
  demo,
  pending,
  onToggle,
}: {
  trunk: TrunkView;
  now: number;
  demo: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const used = trunk.channels && trunk.currentCalls != null ? Math.min(100, (trunk.currentCalls / trunk.channels) * 100) : null;
  return (
    <article className={`rounded-2xl border-l-4 bg-card p-4 ring-1 ring-foreground/10 ${borderTone(trunk.health)}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone(trunk.health)}`}>{trunk.statusLabel}</span>
            <span className="text-xs text-muted-foreground">SG {trunk.id}</span>
            {trunk.simulated ? <span className="text-xs text-primary">Simulated</span> : null}
          </div>
          <h2 className="mt-1 truncate font-heading text-2xl">{trunk.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {trunk.peers.join(" · ") || "No SIP server table"}
            {trunk.protocol ? ` · ${trunk.protocol}` : ""}
            {trunk.interop ? ` · ${trunk.interop}` : ""}
          </p>
        </div>
        <div className="text-sm sm:text-right">
          <p>
            <span className="font-medium">{trunk.currentCalls ?? "—"}</span>
            <span className="text-muted-foreground"> active / {trunk.channels ?? "—"} channels</span>
          </p>
          <p className="text-muted-foreground capitalize">Admin {trunk.adminState}</p>
          {trunk.downSince && (trunk.health === "down" || trunk.health === "degraded") ? (
            <p className="text-down">Down since {formatAgo(trunk.downSince, now)}</p>
          ) : null}
          {demo && trunk.adminState !== "disabled" ? (
            <Button variant="outline" size="sm" className="mt-2" disabled={pending} onClick={onToggle}>
              {trunk.simulated ? "Restore" : "Mark down"}
            </Button>
          ) : null}
        </div>
      </div>
      {used != null ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${used}%` }} />
        </div>
      ) : null}
    </article>
  );
}

function EventLine({ event }: { event: AlertEvent }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <span className="font-medium">{event.subject}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{formatWhen(event.createdAt)}</span>
      </div>
      <span className={event.emailStatus === "sent" ? "text-up" : event.emailStatus === "failed" ? "text-down" : "text-muted-foreground"}>
        Email {event.emailStatus}
      </span>
    </div>
  );
}
