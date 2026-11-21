import { useId, type ReactNode } from "react";

/**
 * Small empty-state illustrations drawn in code (no image files, nothing external). Filled with the brand gradient
 * (indigo, violet, orchid) plus a second hue (teal to sky from the data-series tokens) so they feel rich. Colours
 * come from tokens only, so they follow light and dark mode and any retune of styles/tokens.css. Decorative: hidden
 * from screen readers.
 */
interface Paint {
  /** url() of the brand gradient */
  a: string;
  /** url() of the second-hue gradient (teal to sky) */
  b: string;
}

function Frame({ children }: { children: (p: Paint) => ReactNode }) {
  const uid = useId();
  const a = `${uid}-a`;
  const b = `${uid}-b`;
  return (
    <svg viewBox="0 0 160 120" className="h-28 w-auto" aria-hidden="true" focusable="false" role="presentation">
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-from)" />
          <stop offset="52%" stopColor="var(--brand-via)" />
          <stop offset="100%" stopColor="var(--brand-to)" />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-series-2)" />
          <stop offset="100%" stopColor="var(--color-series-5)" />
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="106" rx="48" ry="5" className="fill-foreground/10" />
      <circle cx="80" cy="58" r="46" className="fill-primary-soft" />
      <circle cx="80" cy="58" r="46" fill={`url(#${a})`} opacity="0.14" />
      <circle cx="122" cy="26" r="5" className="fill-accent" />
      <circle cx="30" cy="86" r="3.5" fill={`url(#${b})`} />
      <circle cx="136" cy="78" r="2.5" className="fill-series-4" />
      {children({ a: `url(#${a})`, b: `url(#${b})` })}
    </svg>
  );
}

const card = "fill-card stroke-border";

const ART: Record<string, (p: Paint) => ReactNode> = {
  org: (p) => (
    <>
      <path d="M80 40v12M44 52h72M44 52v12M80 52v12M116 52v12" fill="none" strokeWidth="2" strokeLinecap="round" stroke={p.a} opacity="0.6" />
      <rect x="62" y="22" width="36" height="18" rx="6" fill={p.a} />
      <rect x="26" y="64" width="36" height="18" rx="6" className={card} strokeWidth="1.5" />
      <rect x="62" y="64" width="36" height="18" rx="6" className={card} strokeWidth="1.5" />
      <rect x="98" y="64" width="36" height="18" rx="6" className={card} strokeWidth="1.5" />
      <circle cx="35" cy="73" r="3.2" fill={p.b} />
      <circle cx="71" cy="73" r="3.2" fill={p.a} />
      <circle cx="107" cy="73" r="3.2" className="fill-series-4" />
    </>
  ),
  target: (p) => (
    <>
      <circle cx="78" cy="62" r="34" className={card} strokeWidth="1.5" />
      <circle cx="78" cy="62" r="23" className="fill-primary-soft" stroke={p.a} strokeWidth="2" />
      <circle cx="78" cy="62" r="11" fill={p.a} />
      <path d="M80 60l26-28" strokeWidth="3.5" strokeLinecap="round" stroke={p.b} />
      <path d="M106 32l-3 9m3-9l-9 3" fill="none" strokeWidth="3.5" strokeLinecap="round" stroke={p.b} />
    </>
  ),
  chart: (p) => (
    <>
      <rect x="34" y="28" width="92" height="66" rx="9" className={card} strokeWidth="1.5" />
      <rect x="46" y="62" width="12" height="20" rx="3" fill={p.a} opacity="0.45" />
      <rect x="64" y="52" width="12" height="30" rx="3" fill={p.a} opacity="0.65" />
      <rect x="82" y="58" width="12" height="24" rx="3" fill={p.a} opacity="0.85" />
      <rect x="100" y="42" width="12" height="40" rx="3" fill={p.a} />
      <path d="M46 50l18-8 18 6 30-14" fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" stroke={p.b} />
    </>
  ),
  tasks: (p) => (
    <>
      <rect x="38" y="24" width="84" height="76" rx="9" className={card} strokeWidth="1.5" />
      {[40, 58, 76].map((y, i) => (
        <g key={y}>
          {i < 2 ? (
            <>
              <circle cx="54" cy={y + 4} r="7" fill={p.b} />
              <path d={`M50.5 ${y + 4}l3 3 5-6`} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-card" />
            </>
          ) : (
            <circle cx="54" cy={y + 4} r="6.2" fill="none" strokeWidth="1.8" stroke={p.a} />
          )}
          <rect x="68" y={y} width={i === 1 ? 38 : 46} height="8" rx="4" className="fill-muted" />
        </g>
      ))}
    </>
  ),
  team: (p) => (
    <>
      <path d="M26 98c0-14 11-22 24-22s24 8 24 22z" fill={p.b} opacity="0.6" />
      <path d="M86 98c0-14 11-22 24-22s24 8 24 22z" className="fill-accent" opacity="0.6" />
      <circle cx="50" cy="58" r="11" fill={p.b} />
      <circle cx="110" cy="58" r="11" className="fill-accent" />
      <path d="M52 100c0-17 13-27 28-27s28 10 28 27z" fill={p.a} />
      <circle cx="80" cy="50" r="13" fill={p.a} />
      <circle cx="80" cy="50" r="13" fill="none" strokeWidth="3" className="stroke-card" />
    </>
  ),
  gauge: (p) => (
    <>
      <path d="M40 86a40 40 0 0 1 80 0" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-muted" />
      <path d="M40 86a40 40 0 0 1 28-38" fill="none" strokeWidth="12" strokeLinecap="round" stroke={p.a} />
      <path d="M80 86l22-26" strokeWidth="3.5" strokeLinecap="round" className="stroke-foreground" />
      <circle cx="80" cy="86" r="7" className="fill-card stroke-foreground" strokeWidth="3" />
      <circle cx="116" cy="62" r="3" fill={p.b} />
    </>
  ),
  spark: (p) => (
    <>
      <path d="M78 26c3 18 9 24 27 27-18 3-24 9-27 27-3-18-9-24-27-27 18-3 24-9 27-27z" fill={p.a} />
      <path d="M112 66c1.5 8 4 11 12 12-8 1.5-10.5 4-12 12-1.5-8-4-10.5-12-12 8-1 10.5-4 12-12z" fill={p.b} />
      <path d="M44 74c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9z" className="fill-series-4" />
    </>
  ),
  leadership: (p) => (
    <>
      <path d="M26 98l32-46 22 30 14-18 40 34z" fill={p.b} opacity="0.5" />
      <path d="M26 98l32-46 22 30 20 4z" fill={p.a} />
      <path d="M96 40v-22" strokeWidth="2.5" strokeLinecap="round" className="stroke-foreground" />
      <path d="M96 18l22 7-22 8z" className="fill-accent" />
    </>
  ),
  plug: (p) => (
    <>
      <rect x="26" y="46" width="44" height="30" rx="9" className={card} strokeWidth="1.5" />
      <rect x="90" y="46" width="44" height="30" rx="9" className={card} strokeWidth="1.5" />
      <path d="M70 61h20" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" stroke={p.a} />
      <circle cx="48" cy="61" r="7" fill={p.a} />
      <circle cx="112" cy="61" r="7" fill={p.b} />
      <circle cx="80" cy="61" r="3.5" className="fill-series-4" />
    </>
  ),
  settings: (p) => (
    <>
      {[40, 60, 80].map((y, i) => (
        <g key={y}>
          <rect x="34" y={y - 3} width="92" height="6" rx="3" className="fill-muted" />
          <rect x="34" y={y - 3} width={[52, 30, 68][i]} height="6" rx="3" fill={i === 1 ? p.b : p.a} opacity="0.8" />
          <circle cx={34 + [52, 30, 68][i]!} cy={y} r="8" className="fill-card" stroke={i === 1 ? p.b : p.a} strokeWidth="2.5" />
        </g>
      ))}
    </>
  ),
  compass: (p) => (
    <>
      <circle cx="80" cy="60" r="36" className={card} strokeWidth="1.5" />
      <path d="M80 28v6M80 86v6M48 60h6M106 60h6" strokeWidth="2.5" strokeLinecap="round" className="stroke-border" />
      <path d="M96 44L86 66 64 76l10-22z" fill={p.a} />
      <path d="M96 44L86 66 74 54z" fill={p.b} />
      <circle cx="80" cy="60" r="3.5" className="fill-card" />
    </>
  ),
};

export type IllustrationName = "org" | "target" | "chart" | "tasks" | "team" | "gauge" | "spark" | "leadership" | "plug" | "settings" | "compass";
export const ILLUSTRATION_NAMES = Object.keys(ART) as IllustrationName[];

export function Illustration({ name }: { name: IllustrationName }) {
  return <Frame>{(p) => ART[name]!(p)}</Frame>;
}
