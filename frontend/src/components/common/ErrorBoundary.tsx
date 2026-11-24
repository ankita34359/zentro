import { AlertTriangle, Home, RotateCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/services/api";

/** A reference a person can quote. For a server problem it is the request id, which is also in the server's log; for a crash in the browser it is made here. */
export function referenceOf(error: unknown): { id: string; fromServer: boolean } {
  if (error instanceof ApiError && error.requestId) return { id: error.requestId, fromServer: true };
  const rand = Math.random().toString(36).slice(2, 10);
  return { id: `browser-${rand}`, fromServer: false };
}

/** The full-page "Something went wrong": plain words, a reference id, a way forward. Never a stack trace or raw JSON. */
export function CrashPage({ reference, onReload }: { reference: { id: string; fromServer: boolean }; onReload: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-12 flex max-w-lg flex-col items-center gap-4 rounded-xl border border-off-track/30 bg-off-track-soft px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-card text-off-track-ink shadow-xs"><AlertTriangle aria-hidden="true" className="size-6" /></span>
      <h1 className="text-title font-semibold text-off-track-ink">Something went wrong</h1>
      <p className="text-body text-foreground/80">This page hit an unexpected problem. Your data is safe. Try again, or go back to the Overview.</p>
      <p className="text-caption text-foreground/70">Reference: <code className="font-mono">{reference.id}</code>{reference.fromServer ? " (the same number is in the server's log)" : " (this happened in your browser, so it is not in the server's log)"}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onReload}><RotateCw aria-hidden="true" /> Reload the page</Button>
        <Button asChild variant="outline"><a href="/overview"><Home aria-hidden="true" /> Go to Overview</a></Button>
      </div>
    </div>
  );
}

interface State { error: unknown; reference: { id: string; fromServer: boolean } | null }

/** Catches a page that crashes while drawing, so the whole app never turns into a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null, reference: null };
  static getDerivedStateFromError(error: unknown): State {
    return { error, reference: referenceOf(error) };
  }
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // for a developer's console only; nothing from it is shown to the person
    console.error("Page crashed", { reference: this.state.reference?.id, message: error instanceof Error ? error.message : "non-error thrown", component: info.componentStack?.split("\n")[1]?.trim() });
  }
  componentDidUpdate(prev: { resetKey?: string }): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) this.setState({ error: null, reference: null }); // moving to another page clears the crash
  }
  render(): ReactNode {
    if (this.state.error === null || !this.state.reference) return this.props.children;
    return <CrashPage reference={this.state.reference} onReload={() => window.location.reload()} />; // a reload also fetches the newest app files, which fixes a page that failed to load after an update
  }
}
