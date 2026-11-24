import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { FormAlert } from "@/components/common/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { problemText } from "@/lib/authForm";
import { askAi, getAiStatus, type AiAnswer } from "@/services/ai";

const TYPE_WORD: Record<string, string> = { objective: "Objective", kpi: "KPI", task: "Task", person: "Person" };

/** What was sent to the AI for one answer: the fixed instructions, the records (each with its reference), and the question. Nothing else. */
function SentPanel({ a }: { a: AiAnswer }) {
  return (
    <details className="rounded-lg border bg-muted/30 p-3 text-caption">
      <summary className="cursor-pointer text-label font-medium">What was sent to the AI</summary>
      <div className="mt-3 space-y-3">
        <p>{a.sent.characters.toLocaleString()} characters went to the AI service: the fixed instructions, the records below, and your question. These records come only from what you are allowed to see. Never sent: {a.sent.neverSent.join(", ")}.</p>
        <div><p className="font-medium">Your question</p><p className="whitespace-pre-wrap">{a.sent.question}</p></div>
        <div><p className="font-medium">Records</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-background p-2">{a.sent.records || "(no records)"}</pre></div>
        <div><p className="font-medium">Instructions</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2">{a.sent.instructions}</pre></div>
      </div>
    </details>
  );
}

export function AnswerCard({ a }: { a: AiAnswer }) {
  return (
    <Card aria-label="AI answer">
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="info">AI-generated</Badge><span className="text-caption text-muted-foreground">{a.basedOn}</span></div>
        <p className="whitespace-pre-wrap text-body">{a.answer}</p>
        {a.unmatchedNumbers.length > 0 && (
          <p role="note" className="rounded-lg border border-at-risk/40 bg-at-risk-soft p-2 text-caption">These figures in the answer are not in the records that were sent, so treat them as unchecked: {a.unmatchedNumbers.join(", ")}.</p>
        )}
        <div>
          <p className="text-label font-medium">Records it used</p>
          {a.citations.length === 0 ? <p className="text-caption text-muted-foreground">The answer did not point to any record.</p> : (
            <ul aria-label="Cited records" className="mt-1 space-y-1">
              {a.citations.map((c) => <li key={c.ref} className="text-label"><span className="text-muted-foreground">{TYPE_WORD[c.type] ?? c.type}: </span><Link className="font-medium text-primary-ink underline" to={c.to}>{c.label}</Link></li>)}
            </ul>
          )}
        </div>
        <SentPanel a={a} />
      </CardContent>
    </Card>
  );
}

/** The Ask AI box. Disabled and honest ("AI is not connected") until the server has a key AND an administrator has switched AI on. */
export function AskAi() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["ai", "status"], queryFn: getAiStatus, retry: false });
  const [question, setQuestion] = useState("");
  const ask = useMutation({ mutationFn: () => askAi(question), onSettled: () => void qc.invalidateQueries({ queryKey: ["ai", "status"] }) });
  const s = status.data;
  const max = s?.limits.maxQuestionChars ?? 400;
  return (
    <div className="mb-6 space-y-3" role="group" aria-label="Ask AI">
      <div className="space-y-2 rounded-xl border border-dashed bg-muted/30 p-4">
        <label htmlFor="ask-ai" className="flex items-center gap-2 text-label font-semibold"><Sparkles aria-hidden="true" className="size-4" /> Ask AI {s && !s.connected && <Badge variant="dashed">Not connected</Badge>}</label>
        {status.isPending ? <p className="text-caption text-muted-foreground">Checking whether AI is connected…</p> : status.isError || !s ? <p className="text-caption text-muted-foreground">AI is not connected. {status.isError ? "Its status could not be loaded." : ""}</p> : !s.connected ? (
          <>
            <input id="ask-ai" disabled placeholder="Ask a question about your data" className="h-10 w-full cursor-not-allowed rounded-lg border border-input bg-muted px-3 text-body text-muted-foreground" />
            <p className="text-label font-medium">AI is not connected.</p>
            <p className="text-caption text-muted-foreground">{s.reason} Everything else on this page works without it.{s.canConfigure && <> <Link className="underline" to="/settings/ai">AI settings</Link></>}</p>
          </>
        ) : !s.canUse ? (
          <>
            <input id="ask-ai" disabled className="h-10 w-full cursor-not-allowed rounded-lg border border-input bg-muted px-3" />
            <p className="text-caption text-muted-foreground">Your role does not include asking AI questions.</p>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask.mutate(); }} className="space-y-2">
            <div className="flex gap-2">
              <input id="ask-ai" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={max} placeholder="Ask a question about your data" className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-body" />
              <Button type="submit" disabled={ask.isPending || question.trim() === ""}>{ask.isPending ? "Asking…" : "Ask"}</Button>
            </div>
            <p className="text-caption text-muted-foreground">{question.length} of {max} characters. You have asked {s.usedToday.you} of {s.limits.perUserPerDay} questions today. The AI sees only records you are allowed to see.</p>
            {ask.isError && <FormAlert>{problemText(ask.error)}</FormAlert>}
          </form>
        )}
      </div>
      {ask.data && <AnswerCard a={ask.data} />}
    </div>
  );
}
