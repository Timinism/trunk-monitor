"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AlertEvent, EventKind } from "@/lib/types";

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

const kindLabel: Record<EventKind, string> = {
  down: "Down",
  recovery: "Recovered",
  reminder: "Reminder",
  unreachable: "SBC unreachable",
  reachable: "SBC reachable",
  test: "Test",
};

function kindClass(kind: EventKind): string {
  if (kind === "down" || kind === "unreachable") return "bg-down/15 text-down";
  if (kind === "recovery" || kind === "reachable") return "bg-up/15 text-up";
  if (kind === "reminder") return "bg-degraded/15 text-degraded";
  return "bg-muted text-muted-foreground";
}

export function AlertsView() {
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  async function load() {
    const response = await fetch("/api/alerts", { cache: "no-store" });
    if (response.status === 401) {
      window.location.reload();
      return;
    }
    if (!response.ok) {
      setError("The alert history could not be loaded.");
      setEvents([]);
      return;
    }
    const body = (await response.json()) as { events: AlertEvent[] };
    setEvents(body.events);
    setError("");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    const poll = window.setInterval(() => void load(), 8000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, []);

  if (!events) {
    return <div className="h-48 animate-pulse rounded-2xl bg-card" />;
  }

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="font-heading text-4xl tracking-tight">Alerts</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Each row is an email Edge Watch tried to send. Open one to read the message body, including deliveries that were skipped because SMTP is not configured yet.
        </p>
      </div>
      {error ? <p className="text-sm text-down">{error}</p> : null}
      {events.length === 0 ? (
        <div className="rounded-2xl bg-card px-4 py-8 text-sm text-muted-foreground ring-1 ring-foreground/10">
          No alerts yet. When a monitored trunk changes to down, the message and the SMTP result show up here.
        </div>
      ) : (
        <div className="grid gap-2">
          {events.map((event) => {
            const open = openId === event.id;
            return (
              <article key={event.id} className="rounded-2xl bg-card ring-1 ring-foreground/10">
                <button
                  type="button"
                  className="flex w-full flex-col gap-2 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
                  onClick={() => setOpenId(open ? null : event.id)}
                >
                  <span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${kindClass(event.kind)}`}>{kindLabel[event.kind]}</span>
                    <span className="mt-1 block font-medium">{event.subject}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatWhen(event.createdAt)} · email {event.emailStatus}
                  </span>
                </button>
                {open ? (
                  <div className="border-t border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">{event.emailDetail}</p>
                    <pre className="mt-3 overflow-x-auto font-mono text-xs leading-5 whitespace-pre-wrap">{event.body}</pre>
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpenId(null)}>
                      Close
                    </Button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
