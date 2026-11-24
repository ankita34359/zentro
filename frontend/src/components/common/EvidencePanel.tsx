import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert, FormField } from "@/components/common/FormField";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { attachEvidenceFile, CONFIDENTIALITY_LABEL, createEvidence, EVIDENCE_TYPE_LABEL, evidenceFileUrl, listEvidence, readFileAsBase64, verifyEvidence, VERIFICATION_LABEL, type EvidenceView } from "@/services/evidence";

const VARIANT = { verified: "onTrack", rejected: "offTrack", needs_info: "atRisk", unverified: "dashed" } as const;

/**
 * The evidence behind one record (a task, an objective or a key result): what people attached, whether anyone verified it, and a
 * form to add a link or a small file. Evidence is shown beside the numbers; it does not change a score.
 */
export function EvidencePanel({ targetType, targetId }: { targetType: "task" | "objective" | "key_result"; targetId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const key = ["evidence", targetType, targetId];
  const q = useQuery({ queryKey: key, queryFn: () => listEvidence(targetType, targetId), retry: false, enabled: can("evidence.view") });
  const [adding, setAdding] = useState(false);
  if (!can("evidence.view")) return null;
  return (
    <section aria-label="Evidence" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-label font-semibold">Evidence</h3>{can("evidence.submit") && !adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}>Attach evidence</Button>}</div>
      {adding && <AddForm targetType={targetType} targetId={targetId} onDone={() => { setAdding(false); void qc.invalidateQueries({ queryKey: key }); }} />}
      {q.isPending ? <p className="text-caption text-muted-foreground">Loading…</p> : q.isError ? <FormAlert>{problemText(q.error)}</FormAlert> : q.data.length === 0 ? <p className="text-caption text-muted-foreground">No evidence is attached to this yet.</p> : (
        <ul className="space-y-2">{q.data.map((e) => <Item key={e.id} e={e} onChange={() => void qc.invalidateQueries({ queryKey: key })} />)}</ul>
      )}
    </section>
  );
}

function Item({ e, onChange }: { e: EvidenceView; onChange: () => void }) {
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<null | "rejected" | "needs_info">(null);
  const verify = useMutation({ mutationFn: (v: { status: string; note?: string }) => verifyEvidence(e.id, v), onSuccess: () => { setAsking(null); setNote(""); onChange(); } });
  return (
    <li className="space-y-1 rounded-lg border bg-card p-3 text-label">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{e.title}</span>
        <Badge variant={VARIANT[e.verification.status as keyof typeof VARIANT] ?? "dashed"}>{VERIFICATION_LABEL[e.verification.status] ?? e.verification.status}</Badge>
        {e.confidentiality !== "scope" && <Badge variant="outline">{CONFIDENTIALITY_LABEL[e.confidentiality]}</Badge>}
        {e.isDemo && <Badge variant="outline">Demo</Badge>}
      </div>
      <p className="text-caption text-muted-foreground">{EVIDENCE_TYPE_LABEL[e.type] ?? e.type} · {e.occurredOn} · attached by {e.submittedBy.name}{e.about && e.about.id !== e.submittedBy.id ? ` about ${e.about.name}` : ""}</p>
      {e.description && <p>{e.description}</p>}
      {e.externalRef && <p><a className="text-primary-ink underline" href={e.externalRef} target="_blank" rel="noopener noreferrer">Open the link</a></p>}
      {e.file && <p><a className="text-primary-ink underline" href={evidenceFileUrl(e.id)}>Download {e.file.filename}</a> <span className="text-caption text-muted-foreground">({Math.max(1, Math.round(e.file.sizeBytes / 1024))} KB)</span></p>}
      {e.verification.by && <p className="text-caption text-muted-foreground">{VERIFICATION_LABEL[e.verification.status]} by {e.verification.by.name}{e.verification.note ? `: ${e.verification.note}` : ""}</p>}
      {e.can.attachFile && <FileForm id={e.id} onDone={onChange} />}
      {e.can.verify && e.verification.status !== "verified" && !asking && (
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" aria-label={`Verify ${e.title}`} disabled={verify.isPending} onClick={() => verify.mutate({ status: "verified" })}>Verify</Button><Button size="sm" variant="ghost" onClick={() => setAsking("rejected")}>Reject</Button><Button size="sm" variant="ghost" onClick={() => setAsking("needs_info")}>Ask for more</Button></div>
      )}
      {asking && (
        <form aria-label="Say why" onSubmit={(ev) => { ev.preventDefault(); verify.mutate({ status: asking, note }); }} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1"><FormField label={asking === "rejected" ? "Why is it rejected?" : "What is missing?"} value={note} onChange={(x) => setNote(x.target.value)} required /></div>
          <Button type="submit" size="sm" disabled={verify.isPending || note.trim() === ""}>Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
        </form>
      )}
      {verify.isError && <FormAlert>{problemText(verify.error)}</FormAlert>}
    </li>
  );
}

function FileForm({ id, onDone }: { id: string; onDone: () => void }) {
  const up = useMutation({ mutationFn: async (file: File) => attachEvidenceFile(id, { filename: file.name, dataBase64: await readFileAsBase64(file) }), onSuccess: onDone });
  return (
    <div className="space-y-1">
      <label className="text-caption font-medium" htmlFor={`file-${id}`}>Add a small file (png, jpg, pdf, txt, csv or md, up to 2 MB)</label>
      <input id={`file-${id}`} type="file" accept=".png,.jpg,.jpeg,.pdf,.txt,.csv,.md" className="block text-caption" disabled={up.isPending} onChange={(ev) => { const f = ev.target.files?.[0]; if (f) up.mutate(f); }} />
      {up.isError && <FormAlert>{problemText(up.error)}</FormAlert>}
    </div>
  );
}

function AddForm({ targetType, targetId, onDone }: { targetType: string; targetId: string; onDone: () => void }) {
  const { can } = useAuth();
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [type, setType] = useState("other");
  const [level, setLevel] = useState("scope");
  const [description, setDescription] = useState("");
  const create = useMutation({ mutationFn: () => createEvidence({ title, evidenceType: type, description, externalRef: link.trim() || null, confidentiality: level, links: [{ type: targetType, id: targetId }] }), onSuccess: onDone });
  return (
    <form aria-label="Attach evidence" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <FormField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
      <FormField label="Link (optional)" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" hint="You can add a small file after saving." />
      <FormField label="What it shows (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Kind" value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(EVIDENCE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</SelectField>
        <SelectField label="Who can see it" value={level} onChange={(e) => setLevel(e.target.value)}><option value="scope">{CONFIDENTIALITY_LABEL.scope}</option><option value="organization">{CONFIDENTIALITY_LABEL.organization}</option>{can("evidence.view_restricted") && <option value="restricted">{CONFIDENTIALITY_LABEL.restricted}</option>}</SelectField>
      </div>
      {create.isError && <FormAlert>{problemText(create.error)}</FormAlert>}
      <div className="flex gap-2"><Button type="submit" size="sm" disabled={create.isPending || title.trim() === ""}>{create.isPending ? "Saving…" : "Save evidence"}</Button><Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}
