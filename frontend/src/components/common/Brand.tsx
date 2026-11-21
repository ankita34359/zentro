import { publicConfig } from "@/config/public";

export function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <svg aria-hidden="true" viewBox="0 0 32 32" className="size-7 shrink-0">
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path d="M9 9h14v3.2L13.6 20H23v3H9v-3.2L18.4 12H9z" className="fill-primary-foreground" />
      </svg>
      <span className="text-lg">{publicConfig.appName}</span>
    </span>
  );
}
