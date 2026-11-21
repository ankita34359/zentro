import { Check, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Brand } from "@/components/common/Brand";
import { Metric } from "@/components/common/Metric";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ILLUSTRATION_NAMES, Illustration } from "@/components/illustrations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

const VIOLET_BG: Record<number, string> = { 400: "bg-violet-400", 500: "bg-violet-500", 600: "bg-violet-600", 700: "bg-violet-700" };
const ORCHID_BG: Record<number, string> = { 300: "bg-orchid-300", 400: "bg-orchid-400", 500: "bg-orchid-500", 600: "bg-orchid-600", 700: "bg-orchid-700" };
const SERIES = [
  { n: 1, name: "indigo", bg: "bg-series-1", fill: "fill-series-1", shape: "circle" },
  { n: 2, name: "teal", bg: "bg-series-2", fill: "fill-series-2", shape: "square" },
  { n: 3, name: "orchid", bg: "bg-series-3", fill: "fill-series-3", shape: "diamond" },
  { n: 4, name: "gold", bg: "bg-series-4", fill: "fill-series-4", shape: "triangle" },
  { n: 5, name: "sky", bg: "bg-series-5", fill: "fill-series-5", shape: "circle-ring" },
  { n: 6, name: "lime", bg: "bg-series-6", fill: "fill-series-6", shape: "square-ring" },
] as const;

function Marker({ shape, fill }: { shape: (typeof SERIES)[number]["shape"]; fill: string }) {
  const ring = shape.endsWith("ring");
  const common = ring ? { fill: "none", strokeWidth: 2, className: fill.replace("fill-", "stroke-") } : { className: fill };
  return (
    <svg viewBox="0 0 12 12" className="size-3.5 shrink-0" aria-hidden="true" focusable="false">
      {shape.startsWith("circle") && <circle cx="6" cy="6" r={ring ? 4 : 5} {...common} />}
      {shape.startsWith("square") && <rect x={ring ? 2 : 1} y={ring ? 2 : 1} width={ring ? 8 : 10} height={ring ? 8 : 10} rx="1.5" {...common} />}
      {shape === "diamond" && <path d="M6 0.5 11.5 6 6 11.5 0.5 6z" {...common} />}
      {shape === "triangle" && <path d="M6 1 11.5 11H0.5z" {...common} />}
    </svg>
  );
}

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

/** Shows a token's authored value, read from the live CSS (so the page never repeats a literal). */
function TokenValue({ name }: { name: string }) {
  const [v, setV] = useState("");
  useEffect(() => setV(getComputedStyle(document.documentElement).getPropertyValue(name).trim()), [name]);
  return <span className="font-mono">{v}</span>;
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
  { label: "Body text on page", fg: "--foreground", bg: "--background" },
  { label: "Body text on card", fg: "--card-foreground", bg: "--card" },
  { label: "Body text on raised surface", fg: "--foreground", bg: "--raised" },
  { label: "Muted text on page", fg: "--muted-foreground", bg: "--background" },
  { label: "Muted text on card", fg: "--muted-foreground", bg: "--card" },
  { label: "Muted text on raised surface", fg: "--muted-foreground", bg: "--raised" },
  { label: "Muted text on muted well", fg: "--muted-foreground", bg: "--muted" },
  { label: "Muted text on sidebar", fg: "--muted-foreground", bg: "--sidebar" },
  { label: "Indigo text and links on page", fg: "--primary", bg: "--background" },
  { label: "Indigo text and links on card", fg: "--primary", bg: "--card" },
  { label: "Eyebrow and link ink on page", fg: "--primary-ink", bg: "--background" },
  { label: "Eyebrow and link ink on card", fg: "--primary-ink", bg: "--card" },
  { label: "Button text on gradient: start", fg: "--on-gradient", bg: "--strong-from" },
  { label: "Button text on gradient: middle", fg: "--on-gradient", bg: "--strong-via" },
  { label: "Button text on gradient: end", fg: "--on-gradient", bg: "--strong-to" },
  { label: "Gradient text: start on card", fg: "--text-from", bg: "--card" },
  { label: "Gradient text: middle on card", fg: "--text-via", bg: "--card" },
  { label: "Gradient text: end on card", fg: "--text-to", bg: "--card" },
  { label: "Gradient text: start on page", fg: "--text-from", bg: "--background" },
  { label: "Gradient text: end on page", fg: "--text-to", bg: "--background" },
  { label: "Active navigation item", fg: "--selected-foreground", bg: "--selected" },
  { label: "Brand badge", fg: "--primary-soft-foreground", bg: "--primary-soft" },
  { label: "On track badge", fg: "--on-track-ink", bg: "--on-track-soft" },
  { label: "At risk badge", fg: "--at-risk-ink", bg: "--at-risk-soft" },
  { label: "Off track badge", fg: "--off-track-ink", bg: "--off-track-soft" },
  { label: "Info badge", fg: "--info-ink", bg: "--info-soft" },
  { label: "On track text on card", fg: "--on-track-ink", bg: "--card" },
  { label: "Off track text on card", fg: "--off-track-ink", bg: "--card" },
];

type Ratios = Record<string, number | null>;
function measure(el: HTMLElement | null): Ratios {
  const out: Ratios = {};
  if (!el) return out;
  const cs = getComputedStyle(el);
  const toRgb = (v: string): Rgb | null => cssColorToRgb(cs.getPropertyValue(v).trim());
  for (const p of PAIRS) {
    const a = toRgb(p.fg);
    const b = toRgb(p.bg);
    out[p.label] = a && b ? contrastRatio(a, b) : null;
  }
  return out;
}

function Result({ ratio }: { ratio: number | null | undefined }) {
  if (ratio == null) return <span className="text-muted-foreground">n/a</span>;
  const pass = ratio >= MIN_TEXT_CONTRAST;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums">{ratio.toFixed(2)}:1</span>
      {pass ? (
        <Badge variant="onTrack"><Check aria-hidden="true" /> Pass</Badge>
      ) : (
        <Badge variant="offTrack"><X aria-hidden="true" /> Below {MIN_TEXT_CONTRAST}</Badge>
      )}
    </span>
  );
}

/** Contrast of the token pairs for BOTH themes, computed in this browser from the live CSS values of the two previews. */
function ContrastTable({ light, dark }: { light: HTMLElement | null; dark: HTMLElement | null }) {
  const [rows, setRows] = useState<{ light: Ratios; dark: Ratios }>({ light: {}, dark: {} });
  useEffect(() => {
    setRows({ light: measure(light), dark: measure(dark) });
  }, [light, dark]);
  return (
    <Card lift={false}>
      <CardHeader>
        <CardTitle>Measured contrast, light and dark</CardTitle>
        <CardDescription>Minimum for text is {MIN_TEXT_CONTRAST}:1. Computed in this browser from the live token values.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-label">
            <caption className="sr-only">Contrast ratios of text and background token pairs, light and dark</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1.5 pr-4 font-medium">Pair</th>
                <th scope="col" className="py-1.5 pr-4 font-medium">Light</th>
                <th scope="col" className="py-1.5 font-medium">Dark</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {PAIRS.map((p) => (
                <tr key={p.label}>
                  <td className="py-1.5 pr-4">{p.label}</td>
                  <td className="py-1.5 pr-4"><Result ratio={rows.light[p.label]} /></td>
                  <td className="py-1.5"><Result ratio={rows.dark[p.label]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** One theme's sample screen, forced into that theme whatever the page theme is. */
function ThemePanel({ theme, setRef }: { theme: "light" | "dark"; setRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={setRef} className={`theme-preview ${theme === "dark" ? "theme-dark" : "theme-light"} relative isolate overflow-hidden rounded-2xl border p-5`}>
      <div className="heading-glow relative isolate mb-5">
        <p className="eyebrow mb-1.5 text-primary-ink">{theme} theme</p>
        <p className="text-title font-bold">Performance overview</p>
        <p className="mt-1.5 text-label text-muted-foreground">Calm, data-first, with a confident indigo-violet accent.</p>
      </div>
      <div className="card-surface card-lift mb-4 p-4">
        <Metric label="Objective progress" value={72} suffix="%" />
        <div className="mt-3"><ProgressBar value={0.72} label={`${theme} sample progress`} /></div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm">Primary</Button>
          <Button size="sm" variant="outline">Outline</Button>
          <a href="#design-top" className="text-label font-medium text-primary-ink underline-offset-4 hover:underline">Text link</a>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status="on-track" /> <StatusBadge status="at-risk" /> <StatusBadge status="off-track" /> <StatusBadge status="info" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {SERIES.map((x) => (
          <span key={x.n} className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <Marker shape={x.shape} fill={x.fill} /> {x.name}
          </span>
        ))}
      </div>
      <div className="mt-2 flex justify-center"><Illustration name="chart" /></div>
    </div>
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
  { token: "text-hero", cls: "text-hero font-bold tabular-nums text-gradient", sample: "1,284", note: "2.75rem · hero metrics, bold, gradient" },
  { token: "text-display", cls: "text-display font-bold tabular-nums", sample: "86.5%", note: "2rem · metric numbers" },
  { token: "text-title", cls: "text-title font-bold", sample: "Performance overview", note: "1.75rem · page titles, bold, tight" },
  { token: "text-heading", cls: "text-heading font-semibold", sample: "Getting started", note: "1.0625rem · card headings, semibold" },
  { token: "text-body", cls: "text-body", sample: "Reading text for descriptions and long copy.", note: "0.9375rem · body" },
  { token: "text-label", cls: "text-label font-medium", sample: "Control and table label", note: "0.8125rem · labels" },
  { token: "text-caption", cls: "text-caption text-muted-foreground", sample: "Help text and timestamps", note: "0.75rem · caption" },
  { token: "text-overline", cls: "eyebrow text-primary-ink", sample: "Section label", note: "0.6875rem · tiny uppercase label (eyebrow)" },
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
  const [lightEl, setLightEl] = useState<HTMLElement | null>(null);
  const [darkEl, setDarkEl] = useState<HTMLElement | null>(null);
  const again = () => setReplay((n) => n + 1);
  return (
    <>
      <PageHeader
        title="Design system"
        eyebrow="Style guide · Aurora indigo"
        description="The palette, gradient, type, components and motion every screen is built from. An unlisted page for review; the numbers shown in samples are examples, not data."
      />

      <Section title="Brand and neutrals" description="Vivid indigo (500 is the bright solid, 600 the primary), violet and orchid for the gradient, lavender-grey neutrals. Edit frontend/src/styles/tokens.css to retune.">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-label font-medium">Brand</p>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11">
              {RAMP.map((n) => <Swatch key={n} className={BRAND_BG[n]!} label={`brand-${n}`} />)}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-label font-medium">Violet</p>
              <div className="grid grid-cols-4 gap-3">
                {[400, 500, 600, 700].map((n) => <Swatch key={n} className={VIOLET_BG[n]!} label={`violet-${n}`} />)}
              </div>
            </div>
            <div>
              <p className="mb-2 text-label font-medium">Orchid (the one accent)</p>
              <div className="grid grid-cols-5 gap-3">
                {[300, 400, 500, 600, 700].map((n) => <Swatch key={n} className={ORCHID_BG[n]!} label={`orchid-${n}`} />)}
              </div>
            </div>
          </div>
          <div>
            <p className="mb-2 text-label font-medium">Lavender-grey</p>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-11">
              {RAMP.map((n) => <Swatch key={n} className={SLATE_BG[n]!} label={`slate-${n}`} />)}
            </div>
          </div>
          <div>
            <p className="mb-2 text-label font-medium">Interface roles (change with the theme)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Swatch className="bg-background" label="background" note="page" />
              <Swatch className="bg-card" label="card" note="surface" />
              <Swatch className="bg-raised" label="raised" note="layer above a card" />
              <Swatch className="bg-muted" label="muted" note="wells" />
              <Swatch className="bg-primary" label="primary" note="text, links" />
              <Swatch className="bg-selected" label="selected" note="active item" />
              <Swatch className="bg-accent" label="accent" note="highlights" />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Brand gradient"
        description="135 degrees: indigo to violet to orchid. Used on the primary button, logo tile, active sidebar indicator, progress ring, hero numbers and the glow behind headings. Elsewhere the bright solid indigo."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <Card lift={false}>
            <CardHeader><CardTitle>The two fills</CardTitle><CardDescription>Exact aurora for decoration; deepened for under text.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="bg-gradient-brand h-16 rounded-xl" />
              <p className="text-caption text-muted-foreground">
                --gradient-brand · <TokenValue name="--brand-from" /> → <TokenValue name="--brand-via" /> → <TokenValue name="--brand-to" />
              </p>
              <p className="text-caption text-muted-foreground">logo tile, ring, indicator, glows</p>
              <div className="bg-gradient-brand-strong h-16 rounded-xl" />
              <p className="text-caption text-muted-foreground">
                --gradient-brand-strong · <TokenValue name="--strong-from" /> → <TokenValue name="--strong-via" /> → <TokenValue name="--strong-to" />
              </p>
              <p className="text-caption text-muted-foreground">buttons: white text stays above 4.5:1 on every stop</p>
            </CardContent>
          </Card>
          <Card lift={false}>
            <CardHeader><CardTitle>Where it appears</CardTitle><CardDescription>Logo, button, hero number, ring, bar.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <Brand />
              <div className="flex flex-wrap items-center gap-3">
                <Button>Primary button</Button>
                <ProgressRing value={2} max={4} label="Sample ring" size={56} strokeWidth={6}>
                  <span className="text-caption font-bold text-gradient">50%</span>
                </ProgressRing>
              </div>
              <Metric label="Hero metric" value={1284} />
              <ProgressBar value={0.64} label="Sample bar" />
            </CardContent>
          </Card>
          <Card lift={false}>
            <CardHeader><CardTitle>Indicator and glow</CardTitle><CardDescription>Active sidebar item; the light behind page headings.</CardDescription></CardHeader>
            <CardContent className="space-y-5">
              <div className="relative h-10 w-full max-w-60">
                <span className="nav-indicator" style={{ height: 40 }} aria-hidden="true" />
                <span className="relative z-10 flex h-10 items-center px-3 text-label font-semibold text-selected-foreground">Active item</span>
              </div>
              <div className="heading-glow relative isolate pb-2 pt-4">
                <p className="text-heading font-bold">Heading with glow</p>
                <p className="text-label text-muted-foreground">Three soft lights, indigo, violet, orchid.</p>
              </div>
            </CardContent>
          </Card>
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

      <Section
        title="Data series"
        description="Six distinct hues for charts in later stages, chosen to stay apart for common colour-blindness. Always give a series a legend entry or a label, and a marker shape when several share a chart. Never use them to mean a status."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {SERIES.map((x) => (
            <Card key={x.n} lift={false}>
              <CardContent className="space-y-2 p-3">
                <div className={`h-12 rounded-lg ${x.bg}`} />
                <p className="flex items-center gap-1.5 text-label font-medium"><Marker shape={x.shape} fill={x.fill} /> {x.name}</p>
                <p className="text-caption text-muted-foreground">series-{x.n} · <TokenValue name={`--color-series-${x.n}`} /></p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card lift={false} className="mt-4">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
            <span className="eyebrow text-muted-foreground">Sample legend</span>
            {SERIES.map((x) => (
              <span key={x.n} className="inline-flex items-center gap-2 text-label"><Marker shape={x.shape} fill={x.fill} /> Series {x.n} ({x.name})</span>
            ))}
          </CardContent>
        </Card>
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

      <Section title="Light and dark side by side" description="The same screen forced into each theme, so you can compare them without switching.">
        <div className="grid gap-4 lg:grid-cols-2">
          <ThemePanel theme="light" setRef={setLightEl} />
          <ThemePanel theme="dark" setRef={setDarkEl} />
        </div>
      </Section>

      <Section title="Accessibility" description="Measured in this browser from the live CSS values of both previews above.">
        <ContrastTable light={lightEl} dark={darkEl} />
      </Section>
    </>
  );
}
