/** A date and time in the organization's time zone (docs/frontend-structure.md: the UI formats in the organization's timezone). */
export function formatDateTime(iso: string, timeZone = "UTC"): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}
