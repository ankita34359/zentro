import { useId, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/** A label, an input and its error, wired together for screen readers (aria-invalid, aria-describedby). */
export function FormField({ label, error, hint, ...input }: { label: string; error?: string; hint?: string } & ComponentProps<"input">) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-label font-medium">
        {label}
      </label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-caption text-off-track-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/** A form-level problem (wrong password, too many attempts) in plain words, announced to screen readers. */
export function FormAlert({ children }: { children: string }) {
  return (
    <div role="alert" className="rounded-lg border border-off-track/30 bg-off-track-soft px-3 py-2.5 text-label text-off-track-ink">
      {children}
    </div>
  );
}

export function FormNotice({ children }: { children: string }) {
  return (
    <div role="status" className="rounded-lg border border-on-track/30 bg-on-track-soft px-3 py-2.5 text-label text-on-track-ink">
      {children}
    </div>
  );
}
