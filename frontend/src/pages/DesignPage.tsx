import { Check, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ILLUSTRATION_NAMES, Illustration } from "@/components/illustrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/contexts/ThemeContext";
import { contrastRatio, cssColorToRgb, MIN_TEXT_CONTRAST, type Rgb } from "@/lib/contrast";
import { CountUp } from "@/motion/CountUp";
import { PageTransition } from "@/motion/PageTransition";
import { ProgressBar, type Tone } from "@/motion/ProgressBar";
import { ProgressRing } from "@/motion/ProgressRing";
import { Stagger, StaggerItem } from "@/motion/Stagger";

const RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const BRAND_BG: Record<number, string> = {
  50: "bg-brand-50", 100: "bg-brand-100", 200: "bg-brand-200", 300: "bg-brand-300", 400: "bg-brand-400", 500: "bg-brand-500",
  600: "bg-brand-600", 700: "bg-brand-700", 800: "bg-brand-800", 900: "bg-brand-900", 950: "bg-brand-950",
};
const SLATE_BG: Record<number, string> = {
  50: "bg-slate-50", 100: "bg-slate-100", 200: "bg-slate-200", 300: "bg-slate-300", 400: "bg-slate-400", 500: "bg-slate-500",
  600: "bg-slate-600", 700: "bg-slate-700", 800: "bg-slate-800", 900: "bg-slate-900", 950: "bg-slate-950",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`sec-${title.replace(/\W+/g, "-").toLowerCase()}`} className="mb-12">
      <h2 id={`sec-${title.replace(/\W+/g, "-").toLowerCase()}`} className="text-heading font-semibold">
        {title}
      </h2>
      {description && <p className="mb-4 mt-1 max-w-prose text-label text-muted-foreground">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Swatch({ className, label, note }: { className: string; label: string; note?: string }) {
  return (
    <div className="min-w-0">
      <div className={`h-12 rounded-lg border ${className}`} />
      <p className="mt-1.5 truncate text-caption font-medium">{label}</p>
      {note && <p className="truncate text-caption text-muted-foreground">{note}</p>}
    </div>
  );
}

const PAIRS: { label: string; fg: string; bg: string }[] = [
  { label: "Body text on background", fg: "--foreground", bg: "--background" },
  { label: "Body text on card", fg: "--card-foreground", bg: "--card" },
  { label: "Muted text on background", fg: "--muted-foreground", bg: "--background" },
  { label: "Muted text on card", fg: "--muted-foreground", bg: "--card" },
  { label: "Muted text on muted surface", fg: "--muted-foreground", bg: "--muted" },
  { label: "Muted text on sidebar", fg: "--muted-foreground", bg: "--sidebar" },
  { label: "Primary button text", fg: "--primary-foreground", bg: "--primary" },
  { label: "Primary link text on background", fg: "--primary", bg: "--background" },
  { label: "Active navigation item", fg: "--selected-foreground", bg: "--selected" },
  { label: "Brand badge", fg: "--primary-soft-foreground", bg: "--primary-soft" },
  { label: "On track badge", fg: "--on-track-ink", bg: "--on-track-soft" },
  { label: "At risk badge", fg: "--at-risk-ink", bg: "--at-risk-soft" },
  { label: "Off track badge", fg: "--off-track-ink", bg: "--off-track-soft" },
  { label: "Info badge", fg: "--info-ink", bg: "--info-soft" },
  { label: "On track text on card", fg: "--on-track-ink", bg: "--card" },
  { label: "Off track text on card", fg: "--off-track-ink", bg: "--card" },
];

/** Contrast of the live theme's token pairs, computed in this browser from the actual CSS values. */
function ContrastTable() {
  const { theme } = useTheme();
  const [rows, setRows] = useState<{ label: string; ratio: number | null }[]>([]);
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const toRgb = (v: string): Rgb | null => cssColorToRgb(cs.getPropertyValue(v).trim());
    setRows(
      PAIRS.map((p) => {
        const a = toRgb(p.fg);
        const b = toRgb(p.bg);
        return { label: p.label, ratio: a && b ? contrastRatio(a, b) : null };
      }),
    );
  }, [theme]);
  return (
    <Card lift={false}>
      <CardHeader>
        <CardTitle>Measured contrast ({theme} theme)</CardTitle>
        <CardDescription>Minimum for text is {MIN_TEXT_CONTRAST}:1. Toggle the theme to see the other one.</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-label">
          <caption className="sr-only">Contrast ratios of text and background token pairs</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1.5 pr-4 font-medium">Pair</th>
              <th scope="col" className="py-1.5 pr-4 text-right font-medium">Ratio</th>
              <th scope="col" className="py-1.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-1.5 pr-4">{r.label}</td>
                <td className="py-1.5 pr-4 text-right tabular-nums">{r.ratio ? `${r.ratio.toFixed(2)}:1` : "n/a"}</td>
                <td className="py-1.5">
                  {r.ratio === null ? null : r.ratio >= MIN_TEXT_CONTRAST ? (
                    <Badge variant="onTrack"><Check aria-hidden="true" /> Pass</Badge>
                  ) : (
                    <Badge variant="offTrack"><X aria-hidden="true" /> Below {MIN_TEXT_CONTRAST}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Replay({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Play aria-hidden="true" /> {label}
    </Button>
  );
}

const TYPE_SAMPLES = [
  { token: "text-display", cls: "text-display font-semibold", sample: "1,284", note: "2rem · metric numbers" },
  { token: "text-title", cls: "text-title font-semibold", sample: "Performance overview", note: "1.625rem · page titles" },
  { token: "text-heading", cls: "text-heading font-semibold", sample: "Getting started", note: "1.0625rem · card headings" },
  { token: "text-body", cls: "text-body", sample: "Reading text for descriptions and long copy.", note: "0.9375rem · body" },
  { token: "text-label", cls: "text-label font-medium", sample: "Control and table label", note: "0.8125rem · labels" },
  { token: "text-caption", cls: "text-caption text-muted-foreground", sample: "Help text and timestamps", note: "0.75rem · caption" },
  { token: "text-overline", cls: "text-overline font-semibold uppercase text-muted-foreground", sample: "Group label", note: "0.6875rem · overline" },
];

const TONES: { tone: Tone; label: string; value: number }[] = [
  { tone: "primary", label: "Progress", value: 0.64 },
  { tone: "on-track", label: "On track", value: 0.82 },
  { tone: "at-risk", label: "At risk", value: 0.45 },
  { tone: "off-track", label: "Off track", value: 0.22 },
  { tone: "info", label: "Info", value: 0.58 },
];

export default function DesignPage() {
  const [replay, setReplay] = useState(0);
  const again = () => setReplay((n) => n + 1);
  return (
    <>
      <PageHeader
        title="Design system"
        description="The palette, type, components and motion every screen is built from. An unlisted page for review; the values shown in the motion samples are examples, not data."
        glow
      />

      <Section title="Brand and neutrals" description="Indigo/violet brand from the Z logo (700), cool slate neutrals, and one accent (orchid). Edit frontend/src/styles/tokens.css to retune.">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-label font-medium">Brand</p>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11">
              {RAMP.map((n) => <Swatch key={n} className={BRAND_BG[n]!} label={`brand-${n}`} />)}
            </div>
          </div>
          <div>
            <p className="mb-2 text-label font-medium">Slate</p>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11">
              {RAMP.map((n) => <Swatch key={n} className={SLATE_BG[n]!} label={`slate-${n}`} />)}
            </div>
          </div>
          <div>
            <p className="mb-2 text-label font-medium">Interface roles (change with the theme)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <Swatch className="bg-background" label="background" note="page" />
              <Swatch className="bg-card" label="card" note="surfaces" />
              <Swatch className="bg-muted" label="muted" note="wells" />
              <Swatch className="bg-primary" label="primary" note="actions" />
              <Swatch className="bg-selected" label="selected" note="active item" />
              <Swatch className="bg-accent" label="accent" note="highlights" />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Status colours" description="Fixed meaning, used the same way everywhere, always with an icon and words.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["on-track", "Emerald", "bg-on-track", "bg-on-track-soft"],
              ["at-risk", "Amber", "bg-at-risk", "bg-at-risk-soft"],
              ["off-track", "Rose", "bg-off-track", "bg-off-track-soft"],
              ["info", "Sky", "bg-info", "bg-info-soft"],
            ] as const
          ).map(([status, name, solid, soft]) => (
            <Card key={status} lift={false}>
              <CardContent className="space-y-3 p-4">
                <StatusBadge status={status} />
                <div className="grid grid-cols-2 gap-2">
                  <Swatch className={solid} label="solid" note={`${name} · icons, bars`} />
                  <Swatch className={soft} label="soft" note="badge background" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusBadge status="no-data" />
          <Badge>Neutral</Badge>
          <Badge variant="primary">Brand</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </Section>

      <Section title="Typography" description="Inter variable, self-hosted. Tabular numbers keep metric columns aligned.">
        <Card lift={false}>
          <CardContent className="divide-y p-0">
            {TYPE_SAMPLES.map((t) => (
              <div key={t.token} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3.5">
                <p className={t.cls}>{t.sample}</p>
                <p className="font-mono text-caption text-muted-foreground">{t.token} · {t.note}</p>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-6 px-5 py-4 sm:max-w-md">
              <div>
                <p className="mb-1 text-caption text-muted-foreground">Tabular numbers</p>
                <p className="text-label font-medium tabular-nums">1,111.11<br />8,888.88<br />12.50%</p>
              </div>
              <div>
                <p className="mb-1 text-caption text-muted-foreground">Proportional</p>
                <p className="text-label font-medium">1,111.11<br />8,888.88<br />12.50%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Radii, shadows and layout">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {(
            [
              ["sm", "rounded-sm"],
              ["md", "rounded-md"],
              ["lg", "rounded-lg"],
              ["xl", "rounded-xl"],
              ["2xl", "rounded-2xl"],
            ] as const
          ).map(([r, cls]) => (
            <div key={r} className={`flex h-20 items-center justify-center border bg-card text-caption text-muted-foreground shadow-sm ${cls}`}>
              rounded-{r}
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ["xs", "shadow-xs"],
              ["sm", "shadow-sm"],
              ["md", "shadow-md"],
              ["lg", "shadow-lg"],
            ] as const
          ).map(([s, cls]) => (
            <div key={s} className={`flex h-20 items-center justify-center rounded-xl border bg-card text-caption text-muted-foreground ${cls}`}>
              shadow-{s}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Components">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card lift={false}>
            <CardHeader><CardTitle>Buttons</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button size="sm">Small</Button>
              <Button disabled>Disabled</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Card with hover lift</CardTitle>
              <CardDescription>Fine border, soft shadow. Hover it: it lifts 2 px (no movement under reduced motion).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              <StatusBadge status="on-track" /> <StatusBadge status="at-risk" /> <StatusBadge status="off-track" /> <StatusBadge status="info" />
            </CardContent>
          </Card>
          <Card lift={false}>
            <CardHeader><CardTitle>Loading skeleton</CardTitle><CardDescription>Shimmers only while loading.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </CardContent>
          </Card>
          <ErrorState title="Something went wrong" error={new Error("x")} onRetry={() => undefined} />
        </div>
        <div className="mt-6">
          <EmptyState illustration="org" title="Create your first department">
            <p>Empty states carry a small illustration, say what the page is for, and point to the next step.</p>
          </EmptyState>
        </div>
      </Section>

      <Section title="Illustrations" description="Drawn in code from the colour tokens. They follow light and dark mode.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {ILLUSTRATION_NAMES.map((n) => (
            <Card key={n} lift={false}>
              <CardContent className="flex flex-col items-center gap-2 p-4">
                <Illustration name={n} />
                <p className="font-mono text-caption text-muted-foreground">{n}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="Motion"
        description="Interface motion takes 150 to 350 ms; data reveals up to 700 ms. Nothing loops except the Online pulse and the loading shimmer. With the system's reduce-motion setting on, nothing moves."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card lift={false}>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Page transition</CardTitle>
              <Replay onClick={again} label="Replay" />
            </CardHeader>
            <CardContent>
              <PageTransition key={`pt-${replay}`}>
                <div className="rounded-lg border bg-muted p-4 text-label">Short fade and rise (220 ms).</div>
              </PageTransition>
            </CardContent>
          </Card>
          <Card lift={false}>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Staggered entrance</CardTitle>
              <Replay onClick={again} label="Replay" />
            </CardHeader>
            <CardContent>
              <Stagger className="grid grid-cols-3 gap-3" replayKey={replay + 1}>
                {[1, 2, 3].map((n) => (
                  <StaggerItem key={n}>
                    <div className="rounded-lg border bg-muted p-4 text-center text-label tabular-nums">Card {n}</div>
                  </StaggerItem>
                ))}
              </Stagger>
            </CardContent>
          </Card>
          <Card lift={false}>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Count-up and ring</CardTitle>
              <Replay onClick={again} label="Replay" />
            </CardHeader>
            <CardContent className="flex items-center gap-6" key={`ring-${replay}`}>
              <ProgressRing value={4} max={6} label="Sample: 4 of 6" size={96}>
                <span className="text-heading font-semibold leading-none"><CountUp value={4} />/6</span>
              </ProgressRing>
              <div>
                <p className="text-display font-semibold"><CountUp value={1284} /></p>
                <p className="text-caption text-muted-foreground">sample number · <CountUp value={86.5} decimals={1} suffix="%" /></p>
              </div>
            </CardContent>
          </Card>
          <Card lift={false}>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Progress bars</CardTitle>
              <Replay onClick={again} label="Replay" />
            </CardHeader>
            <CardContent className="space-y-3" key={`bars-${replay}`}>
              {TONES.map((t) => (
                <div key={t.tone}>
                  <div className="mb-1 flex justify-between text-caption text-muted-foreground">
                    <span>{t.label}</span>
                    <span className="tabular-nums">{Math.round(t.value * 100)}%</span>
                  </div>
                  <ProgressBar value={t.value} label={`${t.label} sample`} tone={t.tone} />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card lift={false} className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Timings</CardTitle>
              <CardDescription>From the motion tokens in tokens.css.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-label sm:grid-cols-5">
                {[["fast", "150 ms"], ["base", "220 ms"], ["slow", "350 ms"], ["data", "700 ms"], ["stagger", "50 ms"]].map(([k, v]) => (
                  <div key={k}><dt className="text-muted-foreground">--duration-{k}</dt><dd className="tabular-nums">{v}</dd></div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Accessibility" description="Measured in this browser from the live CSS values.">
        <ContrastTable />
      </Section>
    </>
  );
}
