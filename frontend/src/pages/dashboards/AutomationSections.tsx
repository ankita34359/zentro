import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { FormAlert, FormField, FormNotice } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { createEndpoint, deleteEndpoint, getWebhook, listDeliveries, listEndpoints, rotateWebhookSecret, saveWebhook, sendTestEvent, type EndpointView } from "@/services/automation";
import { listKpis } from "@/services/kpi";

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "never");
const RESULT: Record<string, { label: string; variant: "onTrack" | "atRisk" | "offTrack" | "dashed" }> = {
  delivered: { label: "Delivered", variant: "onTrack" }, pending: { label: "Waiting", variant: "dashed" }, retrying: { label: "Will retry", variant: "atRisk" }, dead: { label: "Failed", variant: "offTrack" },
};

/** A secret that is shown exactly once, with a copy button and a plain warning. */
function ShownOnce({ title, value, note, onDone }: { title: string; value: string; note: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="group" aria-label={title} className="space-y-2 rounded-lg border border-at-risk/40 bg-at-risk-soft p-3">
      <p className="text-label font-semibold">{title}</p>
      <p className="text-caption">{note}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly aria-label={title} value={value} onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 font-mono text-caption" />
        <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(value).catch(() => undefined); setCopied(true); }}><Copy aria-hidden="true" /> {copied ? "Copied" : "Copy"}</Button>
        <Button size="sm" onClick={onDone}>I have saved it</Button>
      </div>
    </div>
  );
}

export function AutomationSections() {
  const { can } = useAuth();
  const manage = can("integrations.manage");
  const qc = useQueryClient();
  const hook = useQuery({ queryKey: ["automation", "webhook"], queryFn: getWebhook, retry: false });
  const log = useQuery({ queryKey: ["automation", "deliveries"], queryFn: listDeliveries, retry: false });
  const eps = useQuery({ queryKey: ["automation", "endpoints"], queryFn: listEndpoints, retry: false });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["automation"] }); void qc.invalidateQueries({ queryKey: ["integrations"] }); };
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const save = useMutation({ mutationFn: saveWebhook, onSuccess: (v) => { setSecret(v.signingSecret ?? null); setUrl(""); refresh(); } });
  const rotate = useMutation({ mutationFn: rotateWebhookSecret, onSuccess: (v) => { setSecret(v.signingSecret ?? null); refresh(); } });
  const test = useMutation({ mutationFn: sendTestEvent, onSettled: refresh });
  const h = hook.data;
  return (
    <div className="space-y-6">
      <Card aria-label="Send events">
        <CardHeader><CardTitle>Send events to viaSocket</CardTitle><CardDescription>Zentro posts a signed message to one address when something you switch on happens. Only ids, names and numbers are sent, never private notes or secrets.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {!h ? <p className="text-caption text-muted-foreground">{hook.isError ? problemText(hook.error) : "Loading…"}</p> : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-label">
                <dt className="text-muted-foreground">Address</dt><dd>{h.host ? <>{h.host} <span className="text-caption text-muted-foreground">(the rest of the address is kept secret)</span></> : "Not saved yet"}</dd>
                <dt className="text-muted-foreground">Status</dt><dd>{h.enabled ? <Badge variant="onTrack">On</Badge> : <Badge variant="dashed">Off</Badge>}</dd>
                <dt className="text-muted-foreground">Signing secret</dt><dd>{h.secretSet ? `Set ${h.secretCreatedAt ? `on ${when(h.secretCreatedAt)}` : ""} (never shown again)` : "Made when you save an address"}</dd>
              </dl>
              {secret && <ShownOnce title="Signing secret (shown once)" value={secret} note="Paste this into viaSocket so it can check each message. Zentro will never show it again; if you lose it, make a new one." onDone={() => setSecret(null)} />}
              {manage && (
                <>
                  <form aria-label="Webhook address" className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) save.mutate({ url: url.trim() }); }}>
                    <div className="min-w-[16rem] flex-1"><FormField label="viaSocket webhook address (https)" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://flow.sokt.io/…" autoComplete="off" /></div>
                    <Button type="submit" disabled={save.isPending || !url.trim()}>Save address</Button>
                  </form>
                  {save.isError && <FormAlert>{problemText(save.error)}</FormAlert>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant={h.enabled ? "outline" : "default"} disabled={save.isPending || !h.configured} onClick={() => save.mutate({ enabled: !h.enabled })}>{h.enabled ? "Switch the webhook off" : "Switch the webhook on"}</Button>
                    <Button variant="outline" disabled={test.isPending || !h.configured} onClick={() => test.mutate()}><Send aria-hidden="true" /> Send test event</Button>
                    <Button variant="ghost" disabled={rotate.isPending || !h.configured} onClick={() => rotate.mutate()}>Make a new signing secret</Button>
                  </div>
                  {test.isSuccess && <FormNotice>{`Test event ${test.data.status === "delivered" ? "delivered" : "not delivered"}${test.data.responseCode ? ` (answer ${test.data.responseCode})` : test.data.error ? ` (${test.data.error})` : ""}. See the delivery log below.`}</FormNotice>}
                  {test.isError && <FormAlert>{problemText(test.error)}</FormAlert>}
                </>
              )}
              <fieldset className="space-y-1" disabled={!manage}>
                <legend className="text-label font-semibold">Events to send</legend>
                {h.events.map((e) => (
                  <label key={e.type} className="flex items-start gap-2 text-label"><input type="checkbox" className="mt-1" checked={e.enabled} onChange={(ev) => save.mutate({ events: { [e.type]: ev.target.checked } })} /> <span><code>{e.type}</code> <span className="text-muted-foreground">{e.description}</span></span></label>
                ))}
              </fieldset>
              <p className="text-caption text-muted-foreground">Each message waits at most {h.limits.timeoutSeconds} seconds for an answer, is at most {h.limits.maxPayloadBytes / 1024} KB, and is tried up to {h.limits.maxAttempts} times (after {h.limits.retryMinutes.join(", ")} minutes). Only events that happen after you switch it on are sent. {h.signing.how}</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card aria-label="Delivery log">
        <CardHeader><CardTitle>Delivery log</CardTitle><CardDescription>The last 50 messages: when, which event, and what the other side answered. The address, the secret and the message itself are never shown here.</CardDescription></CardHeader>
        <CardContent>
          {log.isPending ? <p className="text-caption text-muted-foreground">Loading…</p> : log.isError ? <FormAlert>{problemText(log.error)}</FormAlert> : log.data.length === 0 ? <p className="text-label text-muted-foreground">Nothing has been sent yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-label">
                <caption className="sr-only">Delivery log</caption>
                <thead><tr className="text-left text-caption text-muted-foreground"><th scope="col" className="py-1 font-medium">Time</th><th scope="col" className="py-1 font-medium">Event</th><th scope="col" className="py-1 font-medium">Result</th><th scope="col" className="py-1 font-medium">Answer</th><th scope="col" className="py-1 font-medium">Tries</th></tr></thead>
                <tbody>{log.data.map((d) => (
                  <tr key={d.id} className="border-t"><td className="py-1.5">{when(d.at)}</td><td className="py-1.5"><code>{d.eventType}</code>{d.isTest ? " (test)" : ""}</td><td className="py-1.5"><Badge variant={RESULT[d.status]?.variant ?? "dashed"}>{RESULT[d.status]?.label ?? d.status}</Badge></td><td className="py-1.5 tabular-nums">{d.responseCode ?? d.error ?? "none"}</td><td className="py-1.5 tabular-nums">{d.attempts}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Endpoints manage={manage} endpoints={eps.data} error={eps.isError ? problemText(eps.error) : null} onChange={refresh} />
    </div>
  );
}

function Endpoints({ manage, endpoints, error, onChange }: { manage: boolean; endpoints: EndpointView[] | undefined; error: string | null; onChange: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"task" | "kpi_value">("task");
  const [kpiId, setKpiId] = useState("");
  const [shown, setShown] = useState<{ token: string; url: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const kpis = useQuery({ queryKey: ["kpis", "for-endpoint"], queryFn: () => listKpis(), retry: false, enabled: manage && kind === "kpi_value" });
  const create = useMutation({
    mutationFn: createEndpoint,
    onSuccess: (e) => { setShown({ token: e.token, url: `${window.location.origin}${e.path}`, name: e.name }); setName(""); onChange(); },
  });
  const del = useMutation({ mutationFn: deleteEndpoint, onSuccess: () => { setConfirm(null); onChange(); } });
  return (
    <Card aria-label="Incoming endpoints">
      <CardHeader><CardTitle>Incoming endpoints</CardTitle><CardDescription>Let a viaSocket flow create a task or record a KPI value in Zentro. Each endpoint has its own secret token, shown once.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {shown && (
          <>
            <ShownOnce title={`Token for "${shown.name}" (shown once)`} value={shown.token} note="Zentro keeps only a fingerprint of this token, so it can never be shown again. Put it in viaSocket now." onDone={() => setShown(null)} />
            <p className="text-label">Address to call: <code className="break-all">{shown.url}</code></p>
            <p className="text-caption text-muted-foreground">In viaSocket use a "send a request" step: method POST, that address, the header <code>Authorization: Bearer &lt;the token&gt;</code>, and a JSON body {kind === "task" ? <code>{`{"title": "Call the customer"}`}</code> : <code>{`{"value": 42, "periodStart": "2026-11-01"}`}</code>}.</p>
          </>
        )}
        {error ? <FormAlert>{error}</FormAlert> : !endpoints ? <p className="text-caption text-muted-foreground">Loading…</p> : endpoints.length === 0 ? <p className="text-label text-muted-foreground">No incoming endpoint yet.</p> : (
          <ul aria-label="Endpoints" className="space-y-2">
            {endpoints.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-label">
                <span className="font-medium">{e.name}</span>
                <Badge variant="outline">{e.kind === "task" ? "creates tasks" : "records a KPI value"}</Badge>
                <span className="text-caption text-muted-foreground">token {e.tokenPrefix}… · used {e.calls} {e.calls === 1 ? "time" : "times"}, last {when(e.lastUsedAt)}</span>
                {manage && (confirm === e.id
                  ? <span className="ml-auto flex items-center gap-2"><span className="text-caption">Delete it? Its token stops working at once.</span><Button size="sm" variant="outline" disabled={del.isPending} onClick={() => del.mutate(e.id)}>Yes, delete</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep it</Button></span>
                  : <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Delete ${e.name}`} onClick={() => setConfirm(e.id)}><Trash2 aria-hidden="true" /> Delete</Button>)}
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <form aria-label="New endpoint" className="grid gap-3 sm:grid-cols-2" onSubmit={(ev) => { ev.preventDefault(); create.mutate({ name, kind, ...(kind === "kpi_value" ? { kpiId, subject: { type: "organization" as const } } : {}) }); }}>
            <FormField label="Endpoint name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            <SelectField label="What it does" value={kind} onChange={(e) => setKind(e.target.value as "task" | "kpi_value")}>
              <option value="task">Creates a task</option>
              <option value="kpi_value">Records a KPI value (for the whole organization)</option>
            </SelectField>
            {kind === "kpi_value" && (
              <SelectField label="KPI" value={kpiId} onChange={(e) => setKpiId(e.target.value)} required>
                <option value="">Choose a KPI…</option>
                {(kpis.data ?? []).filter((k) => !k.archived).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </SelectField>
            )}
            <div className="sm:col-span-2"><Button type="submit" disabled={create.isPending || name.trim() === "" || (kind === "kpi_value" && !kpiId)}>Create endpoint</Button></div>
          </form>
        )}
        {create.isError && <FormAlert>{problemText(create.error)}</FormAlert>}
        {del.isError && <FormAlert>{problemText(del.error)}</FormAlert>}
      </CardContent>
    </Card>
  );
}
