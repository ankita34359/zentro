import { Check, Copy, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * A link the server will never show again (an invitation or a password-reset link). The administrator copies it and
 * sends it themselves. Nothing here is stored, logged or sent anywhere: it lives in this component's props only.
 */
export function OneTimeLink({ title, link, note, onDismiss }: { title: string; link: string; note: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      field.current?.select(); // no clipboard permission: select it so Ctrl+C works
      document.execCommand?.("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  return (
    <section aria-label={title} className="rounded-xl border border-primary/30 bg-primary-soft p-4 text-primary-soft-foreground">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-heading font-semibold">{title}</h3>
        <Button variant="ghost" size="icon" aria-label="Hide this link" onClick={onDismiss}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <p className="mt-1 text-label">{note}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input ref={field} readOnly value={link} aria-label={title} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 font-mono text-caption text-foreground" />
        <Button onClick={() => void copy()} className="shrink-0">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {copied ? "Link copied" : ""}
      </p>
    </section>
  );
}
