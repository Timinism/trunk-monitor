"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PublicSettings } from "@/lib/types";

type SbcDraft = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  passwordSet: boolean;
  clearPassword: boolean;
  tlsVerify: boolean;
  enabled: boolean;
};

type FormState = Omit<PublicSettings, "sbcs"> & {
  sbcs: SbcDraft[];
  smtpPassword: string;
};

const empty: FormState = {
  mode: "demo",
  monitoringEnabled: true,
  sbcs: [],
  sbcHost: "",
  sbcPort: 443,
  sbcUsername: "",
  sbcPasswordSet: false,
  tlsVerify: false,
  pollIntervalSeconds: 60,
  watchFilter: "",
  alertRecipients: "",
  alertOnRecovery: true,
  alertOnDegraded: false,
  alertOnStartup: false,
  reminderMinutes: 0,
  unreachableThreshold: 3,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  smtpPassword: "",
  smtpPasswordSet: false,
  alertFrom: "Edge Watch <edge-watch@localhost>",
  timezone: "America/Chicago",
};

function newSbc(): SbcDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    host: "",
    port: 443,
    username: "",
    password: "",
    passwordSet: false,
    clearPassword: false,
    tlsVerify: false,
    enabled: true,
  };
}

function fromPublic(settings: PublicSettings): FormState {
  return {
    ...empty,
    ...settings,
    smtpPassword: "",
    sbcs: (settings.sbcs ?? []).map((sbc) => ({
      id: sbc.id,
      name: sbc.name,
      host: sbc.host,
      port: sbc.port,
      username: sbc.username,
      password: "",
      passwordSet: sbc.passwordSet,
      clearPassword: false,
      tlsVerify: sbc.tlsVerify,
      enabled: sbc.enabled,
    })),
  };
}

function payload(form: FormState, clearSmtpPassword: boolean) {
  return {
    mode: form.mode,
    monitoringEnabled: form.monitoringEnabled,
    pollIntervalSeconds: Number(form.pollIntervalSeconds),
    watchFilter: form.watchFilter,
    alertRecipients: form.alertRecipients,
    alertOnRecovery: form.alertOnRecovery,
    alertOnDegraded: form.alertOnDegraded,
    alertOnStartup: form.alertOnStartup,
    reminderMinutes: Number(form.reminderMinutes),
    unreachableThreshold: Number(form.unreachableThreshold),
    smtpHost: form.smtpHost,
    smtpPort: Number(form.smtpPort),
    smtpSecure: form.smtpSecure,
    smtpUser: form.smtpUser,
    smtpPassword: form.smtpPassword,
    alertFrom: form.alertFrom,
    timezone: form.timezone,
    clearSmtpPassword,
    sbcs: form.sbcs.map((sbc) => ({
      id: sbc.id,
      name: sbc.name,
      host: sbc.host,
      port: Number(sbc.port),
      username: sbc.username,
      password: sbc.password,
      tlsVerify: sbc.tlsVerify,
      enabled: sbc.enabled,
      clearPassword: sbc.clearPassword,
    })),
  };
}

export function SettingsForm() {
  const [form, setForm] = useState<FormState>(empty);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [note, setNote] = useState("");
  const [clearSmtpPassword, setClearSmtpPassword] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (response.status === 401) {
          window.location.reload();
          return;
        }
        if (!response.ok) {
          setNote("Settings could not be loaded.");
          setLoading(false);
          return;
        }
        const settings = (await response.json()) as PublicSettings;
        setForm(fromPublic(settings));
        setClearSmtpPassword(false);
        setLoading(false);
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function patch(partial: Partial<FormState>) {
    setForm((current) => ({ ...current, ...partial }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending("save");
    setNote("");
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(form, clearSmtpPassword)),
    });
    setPending("");
    const body = (await response.json().catch(() => null)) as { error?: string; settings?: PublicSettings } | null;
    if (!response.ok) {
      const message = body?.error ?? "Could not save settings.";
      setNote(message);
      toast.error(message);
      return;
    }
    if (body?.settings) setForm(fromPublic(body.settings));
    setClearSmtpPassword(false);
    setNote("Saved. Each SBC in this list is what the monitor polls.");
    toast.success("Settings saved");
  }

  function updateSbc(id: string, partial: Partial<SbcDraft>) {
    setForm((current) => ({
      ...current,
      sbcs: current.sbcs.map((sbc) => (sbc.id === id ? { ...sbc, ...partial } : sbc)),
    }));
  }

  function removeSbc(id: string) {
    const sbc = form.sbcs.find((item) => item.id === id);
    const label = sbc?.name.trim() || sbc?.host.trim() || "this SBC";
    if (sbc && (sbc.host.trim() || sbc.passwordSet) && !window.confirm(`Remove ${label}? Save afterward to keep the change.`)) return;
    setForm((current) => ({ ...current, sbcs: current.sbcs.filter((item) => item.id !== id) }));
  }

  async function testSbc(id: string) {
    const sbc = form.sbcs.find((item) => item.id === id);
    if (!sbc) return;
    setPending(`sbc:${id}`);
    setNote("");
    const response = await fetch("/api/sbc/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sbc: {
          id: sbc.id,
          name: sbc.name,
          host: sbc.host,
          port: Number(sbc.port),
          username: sbc.username,
          password: sbc.password,
          tlsVerify: sbc.tlsVerify,
          enabled: sbc.enabled,
          clearPassword: sbc.clearPassword,
        },
      }),
    });
    const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    setPending("");
    const message = body?.message ?? body?.error ?? "Connection test failed.";
    setNote(message);
    if (response.ok) toast.success(message);
    else toast.error(message);
  }

  async function testEmail() {
    setPending("email");
    setNote("");
    const response = await fetch("/api/email/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(form, clearSmtpPassword)),
    });
    const body = (await response.json().catch(() => null)) as { detail?: string; error?: string; status?: string } | null;
    setPending("");
    const message = body?.detail ?? body?.error ?? "Test email failed.";
    setNote(message);
    if (body?.status === "sent") toast.success(message);
    else toast.error(message);
  }

  if (loading) return <div className="h-64 animate-pulse rounded-2xl bg-card" />;

  return (
    <form onSubmit={save} className="grid gap-5">
      <div>
        <h1 className="font-heading text-4xl tracking-tight">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Add every Ribbon SBC Edge to watch. Save stores the addresses, REST usernames, and passwords in this app. A `.env` file only seeds the first launch.
        </p>
      </div>

      <section className="grid gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
        <div>
          <h2 className="font-heading text-2xl">SBCs</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Choose Live SBC, then add each appliance. The REST account is created in the SBC Web UI and needs the REST access level. Demo mode ignores this list and shows sample trunks.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={form.mode === "demo" ? "default" : "outline"} onClick={() => patch({ mode: "demo" })}>
            Demo
          </Button>
          <Button type="button" variant={form.mode === "live" ? "default" : "outline"} onClick={() => patch({ mode: "live" })}>
            Live SBC
          </Button>
        </div>
        {form.sbcs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
            No SBCs yet. Add one to start polling a live Ribbon Edge.
          </p>
        ) : (
          form.sbcs.map((sbc, index) => (
            <div key={sbc.id} className="grid gap-4 rounded-xl border border-border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <h3 className="font-heading text-xl">{sbc.name.trim() || sbc.host.trim() || `SBC ${index + 1}`}</h3>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={pending !== ""} onClick={() => void testSbc(sbc.id)}>
                    {pending === `sbc:${sbc.id}` ? "Testing…" : "Test connection"}
                  </Button>
                  <Button type="button" variant="outline" disabled={pending !== ""} onClick={() => removeSbc(sbc.id)}>
                    Remove
                  </Button>
                </div>
              </div>
              <Toggle
                label="Poll this SBC"
                hint="Off keeps the saved login but skips it on the trunk page and in alerts."
                checked={sbc.enabled}
                onChange={(enabled) => updateSbc(sbc.id, { enabled })}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Label" hint="Optional. Shown on the trunk page when the appliance name is not known yet.">
                  <Input value={sbc.name} onChange={(event) => updateSbc(sbc.id, { name: event.target.value })} placeholder="Chicago edge" autoComplete="off" />
                </Field>
                <Field label="SBC address" hint="Hostname or IP. https:// is optional.">
                  <Input
                    value={sbc.host}
                    onChange={(event) => updateSbc(sbc.id, { host: event.target.value })}
                    placeholder="sbc.example.com"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label="HTTPS port">
                  <Input type="number" min={1} max={65535} value={sbc.port} onChange={(event) => updateSbc(sbc.id, { port: Number(event.target.value) })} />
                </Field>
                <Field label="REST username">
                  <Input value={sbc.username} onChange={(event) => updateSbc(sbc.id, { username: event.target.value })} autoComplete="off" spellCheck={false} />
                </Field>
                <Field
                  label="REST password"
                  hint={sbc.passwordSet ? "A password is saved. Type a new one to replace it, or leave this blank to keep it." : "Required before this SBC can be polled."}
                >
                  <Input type="password" value={sbc.password} onChange={(event) => updateSbc(sbc.id, { password: event.target.value })} autoComplete="new-password" />
                </Field>
              </div>
              {sbc.passwordSet ? (
                <Toggle
                  label="Remove saved REST password"
                  hint="Forgets the password already stored for this SBC. A new password typed above is kept instead."
                  checked={sbc.clearPassword}
                  onChange={(clearPassword) => updateSbc(sbc.id, { clearPassword })}
                />
              ) : null}
              <Toggle
                label="Verify TLS certificate"
                hint="Leave this off for the self-signed certificate that ships on most SBC Edge appliances."
                checked={sbc.tlsVerify}
                onChange={(tlsVerify) => updateSbc(sbc.id, { tlsVerify })}
              />
            </div>
          ))
        )}
        <Button type="button" variant="outline" disabled={form.sbcs.length >= 20} onClick={() => patch({ sbcs: [...form.sbcs, newSbc()] })}>
          Add SBC
        </Button>
      </section>

      <section className="grid gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
        <h2 className="font-heading text-2xl">Monitoring</h2>
        <Toggle
          label="Scheduled polling"
          hint="While this is off, the background poller waits. Poll now on the trunk page still runs a check."
          checked={form.monitoringEnabled}
          onChange={(monitoringEnabled) => patch({ monitoringEnabled })}
        />
        <Field label="Poll interval (seconds)" hint="15 to 3600. The SBC session expires after 10 minutes idle, so keep this under that.">
          <Input
            type="number"
            min={15}
            max={3600}
            value={form.pollIntervalSeconds}
            onChange={(event) => patch({ pollIntervalSeconds: Number(event.target.value) })}
          />
        </Field>
        <Field label="Watch filter" hint="Blank monitors every SIP signaling group. Otherwise comma-separated names or signaling group ids.">
          <Input value={form.watchFilter} onChange={(event) => patch({ watchFilter: event.target.value })} placeholder="Lumen, Teams, 3" />
        </Field>
      </section>

      <section className="grid gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
        <h2 className="font-heading text-2xl">When to email</h2>
        <Toggle
          label="Email when a trunk recovers"
          hint="Sends a follow-up after the signaling group leaves the alarm state."
          checked={form.alertOnRecovery}
          onChange={(alertOnRecovery) => patch({ alertOnRecovery })}
        />
        <Toggle
          label="Also alarm on draining and drained"
          hint="Down and peers-down always alarm. Draining is a controlled state unless you turn this on."
          checked={form.alertOnDegraded}
          onChange={(alertOnDegraded) => patch({ alertOnDegraded })}
        />
        <Toggle
          label="Alert if a trunk is already down at first sight"
          hint="Off avoids a burst of mail when the monitor starts and the trunk was already down."
          checked={form.alertOnStartup}
          onChange={(alertOnStartup) => patch({ alertOnStartup })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Repeat while down (minutes)" hint="0 sends a single message until recovery.">
            <Input type="number" min={0} max={1440} value={form.reminderMinutes} onChange={(event) => patch({ reminderMinutes: Number(event.target.value) })} />
          </Field>
          <Field label="SBC unreachable after (polls)" hint="Mail when the SBC itself cannot be polled this many times in a row.">
            <Input
              type="number"
              min={1}
              max={20}
              value={form.unreachableThreshold}
              onChange={(event) => patch({ unreachableThreshold: Number(event.target.value) })}
            />
          </Field>
        </div>
        <Field label="Alert timezone" hint="Used in the email body. Example: America/Chicago.">
          <Input value={form.timezone} onChange={(event) => patch({ timezone: event.target.value })} />
        </Field>
      </section>

      <section className="grid gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="font-heading text-2xl">Email</h2>
          <Button type="button" variant="outline" disabled={pending !== ""} onClick={() => void testEmail()}>
            {pending === "email" ? "Sending…" : "Send test email"}
          </Button>
        </div>
        <Field label="Recipients" hint="Comma or line separated. Alerts are still recorded if this is empty.">
          <Textarea value={form.alertRecipients} onChange={(event) => patch({ alertRecipients: event.target.value })} placeholder="noc@example.com" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SMTP host">
            <Input value={form.smtpHost} onChange={(event) => patch({ smtpHost: event.target.value })} placeholder="smtp.example.com" />
          </Field>
          <Field label="SMTP port">
            <Input type="number" min={1} max={65535} value={form.smtpPort} onChange={(event) => patch({ smtpPort: Number(event.target.value) })} />
          </Field>
          <Field label="SMTP username">
            <Input value={form.smtpUser} onChange={(event) => patch({ smtpUser: event.target.value })} autoComplete="off" />
          </Field>
          <Field label="SMTP password" hint={form.smtpPasswordSet ? "A password is saved. Type a new one to replace it, or leave this blank to keep it." : "Leave blank for an open relay."}>
            <Input type="password" value={form.smtpPassword} onChange={(event) => patch({ smtpPassword: event.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        {form.smtpPasswordSet ? (
          <Toggle
            label="Remove saved SMTP password"
            hint="Forgets the password already stored. A new password typed above is kept instead."
            checked={clearSmtpPassword}
            onChange={setClearSmtpPassword}
          />
        ) : null}
        <Field label="From">
          <Input value={form.alertFrom} onChange={(event) => patch({ alertFrom: event.target.value })} />
        </Field>
        <Toggle
          label="Implicit TLS (port 465)"
          hint="Off uses STARTTLS when the server offers it, which is the usual setup for port 587."
          checked={form.smtpSecure}
          onChange={(smtpSecure) => patch({ smtpSecure })}
        />
      </section>

      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      <Button type="submit" size="lg" disabled={pending !== ""}>
        {pending === "save" ? "Saving…" : "Save and poll"}
      </Button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
