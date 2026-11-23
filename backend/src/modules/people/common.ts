import { HttpError } from "../../lib/errors.js";

/** `YYYY-MM-DD`, a real calendar day. */
export const isDay = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export function cleanDay(raw: string | null | undefined, field: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (!isDay(raw)) throw new HttpError(400, "invalid_date", `${field} must be a real date written YYYY-MM-DD.`);
  return raw;
}

/** The later of two days (`YYYY-MM-DD` strings compare correctly as text). */
export const laterDay = (a: string, b: string): string => (a >= b ? a : b);

/** Single spaces, trimmed, 1 to 120 characters, no control characters. */
export function cleanPersonName(raw: string): string {
  const n = raw.replace(/\s+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (n.length < 1 || n.length > 120 || /[\u0000-\u001f\u007f]/.test(n)) throw new HttpError(400, "invalid_name", "A name is 1 to 120 characters, without control characters.");
  return n;
}

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "internship"] as const;
export const RELATIONSHIP_TYPES = ["primary", "secondary", "dotted", "project"] as const;
export const TEAM_ROLES = ["lead", "deputy_lead", "member"] as const;
export const DEPT_ROLES = ["head", "deputy", "member"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export function cleanText(raw: string | null | undefined, max: number, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  const t = raw.trim();
  if (t === "") return null;
  if (t.length > max) throw new HttpError(400, "invalid_text", `${field} is at most ${max} characters.`);
  return t;
}
