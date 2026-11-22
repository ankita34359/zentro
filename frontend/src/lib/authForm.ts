import { ApiError } from "@/services/api";

export const MIN_PASSWORD_LENGTH = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailError = (v: string): string | undefined => (EMAIL.test(v.trim()) ? undefined : "Enter a valid email address");
export const passwordError = (v: string): string | undefined => (v.length >= MIN_PASSWORD_LENGTH ? undefined : `Use at least ${MIN_PASSWORD_LENGTH} characters`);

/** What to show for a failed request. Server messages are already plain and generic; 429 gets the wait time. */
export function problemText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      const s = Number((e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds);
      return Number.isFinite(s) && s > 0 ? `Too many attempts. Try again in ${s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`}.` : e.message;
    }
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export const guessTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
