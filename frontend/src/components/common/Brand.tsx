import { useId } from "react";
import { publicConfig } from "@/config/public";

export function Brand() {
  // One gradient id per instance: the sidebar and the phone header both render a logo, and a duplicate id would point
  // at the copy inside a hidden (display: none) container, which paints nothing.
  const id = useId();
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8 shrink-0 drop-shadow-sm">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
        <path d="M9 9h14v3.2L13.6 20H23v3H9v-3.2L18.4 12H9z" className="fill-primary-foreground" />
      </svg>
      <span className="text-heading">{publicConfig.appName}</span>
    </span>
  );
}
