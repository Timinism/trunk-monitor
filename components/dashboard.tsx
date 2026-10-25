"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AlertEvent, CallStats, Dashboard, DashboardSbc, Health, TrunkView } from "@/lib/types";

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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
  const liveSbcs = data.sbcs.filter((sbc) => sbc.enabled);
  const multiple = data.mode === "live" && liveSbcs.length > 1;
  const groups = trunkGroups(data);

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
              {multiple ? "Live SBCs" : data.mode === "demo" ? "Demo SBC" : data.sbcHost || "Live SBC"}
            </p>
            <h1 className="mt-1 font-heading text-4xl tracking-tight">
              {multiple
                ? `${liveSbcs.length} SBCs`
                : data.poll.sbcName || (data.mode === "demo" ? "edge-lab-01" : "Waiting for the first poll")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {multiple
                ? liveSbcs.map((sbc) => sbc.nodeName || sbc.name || sbc.host).join(" · ")
                : data.poll.softwareVersion || "SIP signaling groups"}
              {!multiple && data.poll.softwareVersion ? " · SIP signaling groups" : ""}
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

      {data.trunks.length === 0 && groups.length < 2 ? (
        <section className="rounded-2xl bg-card p-6 ring-1 ring-foreground/10">
          <h2 className="font-heading text-2xl">No signaling groups yet</h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            {data.mode === "live"
              ? "A successful poll lists every SIP signaling group on each enabled SBC. If the watch filter is set, only matching names and ids appear."
              : "The demo set appears after the first poll. Use Poll now if this stays empty."}
          </p>
        </section>
      ) : (
        <div className="grid gap-6">
          <p className="text-sm text-muted-foreground">Select a trunk to see peers, channels, and call counters.</p>
          {groups.map((group) => (
            <section key={group.sbc.id} className="grid gap-3">
              {groups.length > 1 ? (
                <div>
                  <h2 className="font-heading text-2xl">{group.sbc.nodeName || group.sbc.name || group.sbc.host || "SBC"}</h2>
                  <p className="text-sm text-muted-foreground">
                    {[group.sbc.host, group.sbc.softwareVersion].filter(Boolean).join(" · ") || "Waiting for a poll"}
                    {group.sbc.lastError ? <span className="text-down"> · {group.sbc.lastError}</span> : null}
                  </p>
                </div>
              ) : null}
              {group.trunks.length === 0 ? (
                <p className="rounded-2xl bg-card px-4 py-5 text-sm text-muted-foreground ring-1 ring-foreground/10">
                  No signaling groups from this SBC yet.
                </p>
              ) : (
                group.trunks.map((trunk) => (
                  <TrunkCard
                    key={trunk.id}
                    trunk={trunk}
                    now={now}
                    open={Boolean(expanded[trunk.id])}
                    demo={data.mode === "demo"}
                    pending={pending !== ""}
                    onOpen={() => setExpanded((current) => ({ ...current, [trunk.id]: !current[trunk.id] }))}
                    onToggle={() =>
                      void act(
                        "/api/demo",
                        { action: trunk.simulated ? "restore" : "down", trunkId: trunk.sgId || trunk.id },
                        trunk.id,
                        trunk.simulated ? `${trunk.name} restored` : `${trunk.name} marked down`,
                      )
                    }
                  />
                ))
              )}
            </section>
          ))}
        </div>
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

function trunkGroups(data: Dashboard): { sbc: DashboardSbc; trunks: TrunkView[] }[] {
  const source = data.mode === "demo" ? data.sbcs : data.sbcs.filter((sbc) => sbc.enabled);
  if (source.length === 0) {
    if (data.trunks.length === 0) return [];
    return [
      {
        sbc: {
          id: "trunks",
          name: "",
          host: "",
          enabled: true,
          nodeName: "",
          softwareVersion: "",
          lastError: null,
          consecutiveFailures: 0,
        },
        trunks: data.trunks,
      },
    ];
  }
  return source.map((sbc) => ({
    sbc,
    trunks: data.trunks.filter((trunk) => trunk.sbcId === sbc.id),
  }));
}

function TrunkCard({
  trunk,
  now,
  open,
  demo,
  pending,
  onOpen,
  onToggle,
}: {
  trunk: TrunkView;
  now: number;
  open: boolean;
  demo: boolean;
  pending: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const used = trunk.channels && trunk.currentCalls != null ? Math.min(100, (trunk.currentCalls / trunk.channels) * 100) : null;
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <article className={`rounded-2xl border-l-4 bg-card ring-1 ring-foreground/10 ${borderTone(trunk.health)}`}>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        onClick={onOpen}
      >
        <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone(trunk.health)}`}>{trunk.statusLabel}</span>
        <span className="min-w-0 flex-1 truncate font-heading text-xl">{trunk.name}</span>
        {trunk.simulated ? <span className="text-xs text-primary">Simulated</span> : null}
      </button>
      {open ? (
        <div className="px-4 pb-4">
          <div className="flex flex-col gap-3 border-t border-border/70 pt-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">SG {trunk.sgId || trunk.id}</p>
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
          {hasCallStats(trunk.calls) ? <CallMetrics calls={trunk.calls} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function hasCallStats(calls: CallStats): boolean {
  return Object.values(calls).some((value) => value != null);
}

function formatCount(value: number | null): string {
  return value == null ? "—" : value.toLocaleString();
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{formatCount(value)}</div>
    </div>
  );
}

function DirectionMetrics({
  title,
  attempts,
  accepted,
  completed,
  rejected,
  blocked,
}: {
  title: string;
  attempts: number | null;
  accepted: number | null;
  completed: number | null;
  rejected: number | null;
  blocked: number | null;
}) {
  return (
    <div>
      <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{title}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Metric label="Attempts" value={attempts} />
        <Metric label="Accepted" value={accepted} />
        <Metric label="Completed" value={completed} />
        <Metric label="Rejected" value={rejected} />
        <Metric label="Blocked" value={blocked} />
      </div>
    </div>
  );
}

function CallMetrics({ calls }: { calls: CallStats }) {
  return (
    <div className="mt-4 grid gap-4 border-t border-border/70 pt-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Right now</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Metric label="In" value={calls.ingressCurrent} />
            <Metric label="Out" value={calls.egressCurrent} />
            <Metric label="Connected" value={calls.connected} />
          </div>
        </div>
        <div>
          <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Since the counters started</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Total" value={calls.total} />
            <Metric label="Refused" value={calls.refused} />
            <Metric label="Blocked" value={calls.blocked} />
            <Metric label="Errored" value={calls.errored} />
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DirectionMetrics
          title="Ingress"
          attempts={calls.ingressAttempts}
          accepted={calls.ingressAccepted}
          completed={calls.ingressCompleted}
          rejected={calls.ingressRejected}
          blocked={calls.ingressBlocked}
        />
        <DirectionMetrics
          title="Egress"
          attempts={calls.egressAttempts}
          accepted={calls.egressAccepted}
          completed={calls.egressCompleted}
          rejected={calls.egressRejected}
          blocked={calls.egressBlocked}
        />
      </div>
    </div>
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
