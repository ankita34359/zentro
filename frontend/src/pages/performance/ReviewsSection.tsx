import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorState } from "@/components/common/ErrorState";
import { FormAlert, FormField } from "@/components/common/FormField";
import { PageSkeleton } from "@/components/common/PageSkeleton";
import { SelectField } from "@/components/common/SelectField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { problemText } from "@/lib/authForm";
import { acknowledgeReview, createReview, listReviews, updateReview, type ReviewView } from "@/services/reviews";

const STATUS_WORD = { draft: "Draft", submitted: "Submitted", acknowledged: "Acknowledged" } as const;

/**
 * Reviews of one person for one period (stage 5.6). The person reads the summary and development focus of submitted reviews and
 * never the private notes; the author sees their own private notes, labelled as private, and so do people allowed to read them.
 */
export function ReviewsSection({ periodId, subjectId, subjectName }: { periodId: string; subjectId: string; subjectName: string }) {
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ["performance-reviews", periodId, subjectId], queryFn: () => listReviews(periodId, subjectId), retry: false });
  const mine = me?.membership?.id === subjectId;
  const written = q.data?.some((r) => r.can.edit) ?? false;
  const [writing, setWriting] = useState(false);
  return (
    <section aria-label="Reviews" className="space-y-3">
      <h3 className="text-label font-semibold">Reviews</h3>
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState title="Reviews could not be loaded" error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {q.data.length === 0 && <p className="text-caption text-muted-foreground">{mine ? "No review has been shared with you for this period." : "No review you can read for this period."}</p>}
          <ul className="space-y-3">{q.data.map((r) => <ReviewCard key={r.id} r={r} periodId={periodId} subjectId={subjectId} />)}</ul>
          {!mine && !written && can("reviews.write") && !writing && <Button size="sm" variant="outline" onClick={() => setWriting(true)}>Write a review of {subjectName}</Button>}
          {writing && <Editor periodId={periodId} subjectId={subjectId} onDone={() => setWriting(false)} />}
        </>
      )}
    </section>
  );
}

function ReviewCard({ r, periodId, subjectId }: { r: ReviewView; periodId: string; subjectId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const ack = useMutation({ mutationFn: () => acknowledgeReview(r.id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["performance-reviews", periodId, subjectId] }) });
  return (
    <li className="space-y-2 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-label">
        <span className="font-medium">By {r.reviewer.name}</span>
        <Badge variant={r.status === "draft" ? "dashed" : r.status === "acknowledged" ? "onTrack" : "info"}>{STATUS_WORD[r.status]}</Badge>
        {r.rating !== null && <span className="text-muted-foreground">Rating {r.rating} of 5</span>}
      </div>
      {editing ? <Editor periodId={periodId} subjectId={subjectId} existing={r} onDone={() => setEditing(false)} /> : (
        <>
          {r.sharedSummary && <p className="text-body">{r.sharedSummary}</p>}
          {r.developmentFocus && <p className="text-label"><span className="font-medium">Development focus:</span> {r.developmentFocus}</p>}
          {r.privateNotes !== undefined && r.privateNotes !== "" && (
            <div role="note" aria-label="Private note" className="rounded-lg border border-dashed bg-muted/40 p-2 text-label">
              <p className="font-medium">Private note</p>
              <p className="text-caption text-muted-foreground">Only the person who wrote it and people allowed to read private notes can see this. {r.subject.name} cannot.</p>
              <p className="mt-1">{r.privateNotes}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {r.can.edit && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{r.status === "draft" ? "Edit draft" : "Edit review"}</Button>}
            {r.can.acknowledge && <Button size="sm" disabled={ack.isPending} onClick={() => ack.mutate()}>I have read this review</Button>}
          </div>
          {ack.isError && <FormAlert>{problemText(ack.error)}</FormAlert>}
        </>
      )}
    </li>
  );
}

function Editor({ periodId, subjectId, existing, onDone }: { periodId: string; subjectId: string; existing?: ReviewView; onDone: () => void }) {
  const qc = useQueryClient();
  const [summary, setSummary] = useState(existing?.sharedSummary ?? "");
  const [focus, setFocus] = useState(existing?.developmentFocus ?? "");
  const [priv, setPriv] = useState(existing?.privateNotes ?? "");
  const [rating, setRating] = useState(existing?.rating ? String(existing.rating) : "");
  const save = useMutation({
    mutationFn: (submit: boolean) => {
      const body = { sharedSummary: summary, developmentFocus: focus, privateNotes: priv, rating: rating ? Number(rating) : null, ...(submit ? { submit: true } : {}) };
      return existing ? updateReview(existing.id, body) : createReview({ periodId, subjectId, ...body });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["performance-reviews", periodId, subjectId] }); void qc.invalidateQueries({ queryKey: ["performance-scorecard"] }); onDone(); },
  });
  const submitted = existing !== undefined && existing.status !== "draft";
  return (
    <form aria-label={existing ? "Edit review" : "Write a review"} onSubmit={(e) => { e.preventDefault(); save.mutate(false); }} className="space-y-3">
      <FormField label="Summary the person will read" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} />
      <FormField label="Development focus (the person reads this too)" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={2000} />
      <FormField label="Private note" value={priv} onChange={(e) => setPriv(e.target.value)} maxLength={4000} hint="Only you and people allowed to read private notes see this. The person reviewed never does." />
      <SelectField label="Rating (optional)" value={rating} onChange={(e) => setRating(e.target.value)}><option value="">No rating</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} of 5</option>)}</SelectField>
      {save.isError && <FormAlert>{problemText(save.error)}</FormAlert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={save.isPending}>{submitted ? "Save changes" : "Save draft"}</Button>
        {!submitted && <Button type="button" size="sm" disabled={save.isPending || summary.trim() === ""} onClick={() => save.mutate(true)}>Submit to {existing?.subject.name ?? "the person"}</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
