import type { ReactNode } from "react";

/**
 * Small empty-state illustrations drawn in code (no image files, nothing external). They use the colour tokens
 * only, so they follow light and dark mode and any future retune of styles/tokens.css. Decorative: hidden from
 * screen readers.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 120" className="h-28 w-auto" aria-hidden="true" focusable="false" role="presentation">
      <ellipse cx="80" cy="106" rx="48" ry="5" className="fill-foreground/5" />
      <circle cx="80" cy="58" r="46" className="fill-primary-soft" />
      <circle cx="122" cy="26" r="5" className="fill-accent/70" />
      <circle cx="30" cy="86" r="3.5" className="fill-primary/50" />
      {children}
    </svg>
  );
}

const card = "fill-card stroke-border";

const ART = {
  org: (
    <>
      <path d="M80 40v12M44 52h72M44 52v12M80 52v12M116 52v12" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-primary/50" />
      <rect x="62" y="22" width="36" height="18" rx="6" className="fill-primary" />
      <rect x="26" y="64" width="36" height="18" rx="6" className={`${card}`} strokeWidth="1.5" />
      <rect x="62" y="64" width="36" height="18" rx="6" className={`${card}`} strokeWidth="1.5" />
      <rect x="98" y="64" width="36" height="18" rx="6" className={`${card}`} strokeWidth="1.5" />
      <circle cx="35" cy="73" r="3" className="fill-accent" />
      <circle cx="71" cy="73" r="3" className="fill-primary" />
      <circle cx="107" cy="73" r="3" className="fill-on-track" />
    </>
  ),
  target: (
    <>
      <circle cx="78" cy="62" r="34" className={card} strokeWidth="1.5" />
      <circle cx="78" cy="62" r="23" className="fill-primary-soft stroke-primary/40" strokeWidth="1.5" />
      <circle cx="78" cy="62" r="11" className="fill-primary" />
      <path d="M80 60l26-28" strokeWidth="3" strokeLinecap="round" className="stroke-accent" />
      <path d="M106 32l-3 9m3-9l-9 3" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-accent" />
    </>
  ),
  chart: (
    <>
      <rect x="34" y="28" width="92" height="66" rx="9" className={card} strokeWidth="1.5" />
      <rect x="46" y="62" width="12" height="20" rx="3" className="fill-primary/40" />
      <rect x="64" y="52" width="12" height="30" rx="3" className="fill-primary/60" />
      <rect x="82" y="58" width="12" height="24" rx="3" className="fill-primary/80" />
      <rect x="100" y="42" width="12" height="40" rx="3" className="fill-primary" />
      <path d="M46 50l18-8 18 6 30-14" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-on-track" />
    </>
  ),
  tasks: (
    <>
      <rect x="38" y="24" width="84" height="76" rx="9" className={card} strokeWidth="1.5" />
      {[40, 58, 76].map((y, i) => (
        <g key={y}>
          {i < 2 ? (
            <>
              <circle cx="54" cy={y + 4} r="7" className="fill-on-track" />
              <path d={`M50.5 ${y + 4}l3 3 5-6`} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-card" />
            </>
          ) : (
            <circle cx="54" cy={y + 4} r="6.2" fill="none" strokeWidth="1.8" className="stroke-border" />
          )}
          <rect x="68" y={y} width={i === 1 ? 38 : 46} height="8" rx="4" className="fill-muted" />
        </g>
      ))}
    </>
  ),
  team: (
    <>
      <path d="M26 98c0-14 11-22 24-22s24 8 24 22z" className="fill-accent/40" />
      <path d="M86 98c0-14 11-22 24-22s24 8 24 22z" className="fill-info/40" />
      <circle cx="50" cy="58" r="11" className="fill-accent/70" />
      <circle cx="110" cy="58" r="11" className="fill-info/70" />
      <path d="M52 100c0-17 13-27 28-27s28 10 28 27z" className="fill-primary" />
      <circle cx="80" cy="50" r="13" className="fill-primary" />
      <circle cx="80" cy="50" r="13" fill="none" strokeWidth="3" className="stroke-primary-soft" />
    </>
  ),
  gauge: (
    <>
      <path d="M40 86a40 40 0 0 1 80 0" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-muted" />
      <path d="M40 86a40 40 0 0 1 28-38" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-primary" />
      <path d="M80 86l22-26" strokeWidth="3.5" strokeLinecap="round" className="stroke-foreground" />
      <circle cx="80" cy="86" r="7" className="fill-card stroke-foreground" strokeWidth="3" />
    </>
  ),
  spark: (
    <>
      <path d="M78 26c3 18 9 24 27 27-18 3-24 9-27 27-3-18-9-24-27-27 18-3 24-9 27-27z" className="fill-primary" />
      <path d="M112 66c1.5 8 4 11 12 12-8 1.5-10.5 4-12 12-1.5-8-4-10.5-12-12 8-1 10.5-4 12-12z" className="fill-accent" />
      <path d="M44 74c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9z" className="fill-primary/60" />
    </>
  ),
  leadership: (
    <>
      <path d="M26 98l32-46 22 30 14-18 40 34z" className="fill-primary/30" />
      <path d="M26 98l32-46 22 30 20 4z" className="fill-primary/60" />
      <path d="M96 40v-22" strokeWidth="2.5" strokeLinecap="round" className="stroke-foreground" />
      <path d="M96 18l22 7-22 8z" className="fill-accent" />
    </>
  ),
  plug: (
    <>
      <rect x="26" y="46" width="44" height="30" rx="9" className={card} strokeWidth="1.5" />
      <rect x="90" y="46" width="44" height="30" rx="9" className={card} strokeWidth="1.5" />
      <path d="M70 61h20" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" className="stroke-primary" />
      <circle cx="48" cy="61" r="7" className="fill-primary" />
      <circle cx="112" cy="61" r="7" className="fill-accent" />
      <circle cx="80" cy="61" r="3.5" className="fill-on-track" />
    </>
  ),
  settings: (
    <>
      {[40, 60, 80].map((y, i) => (
        <g key={y}>
          <rect x="34" y={y - 3} width="92" height="6" rx="3" className="fill-muted" />
          <rect x="34" y={y - 3} width={[52, 30, 68][i]} height="6" rx="3" className="fill-primary/50" />
          <circle cx={34 + [52, 30, 68][i]!} cy={y} r="8" className="fill-card stroke-primary" strokeWidth="2.5" />
        </g>
      ))}
    </>
  ),
  compass: (
    <>
      <circle cx="80" cy="60" r="36" className={card} strokeWidth="1.5" />
      <path d="M80 28v6M80 86v6M48 60h6M106 60h6" strokeWidth="2.5" strokeLinecap="round" className="stroke-border" />
      <path d="M96 44L86 66 64 76l10-22z" className="fill-primary" />
      <path d="M96 44L86 66 74 54z" className="fill-accent" />
      <circle cx="80" cy="60" r="3.5" className="fill-card" />
    </>
  ),
} as const;

export type IllustrationName = keyof typeof ART;
export const ILLUSTRATION_NAMES = Object.keys(ART) as IllustrationName[];

export function Illustration({ name }: { name: IllustrationName }) {
  return <Frame>{ART[name]}</Frame>;
}
