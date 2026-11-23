import { addDays } from "../tasks/dates.js";

/**
 * Measurement periods (stage 3.4). A KPI is measured once per period of its frequency, and a period is named by its first day:
 * every day for daily KPIs, a Monday for weekly, the 1st for monthly, 1 January/April/July/October for quarterly, 1 January for
 * annual. So "which periods should have a value" is a plain list, and a period with no row is plainly MISSING (never zero).
 * Pure date arithmetic on whole days (UTC), no clock.
 */
export type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "annual";

const parts = (day: string): [number, number, number] => [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
const iso = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const lastDayOfMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The first day of the period that contains `day`. */
export function periodStartOf(frequency: Frequency, day: string): string {
  const [y, m, d] = parts(day);
  switch (frequency) {
    case "daily": return day;
    case "weekly": {
      const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
      return addDays(day, -dow);
    }
    case "monthly": return iso(y, m, 1);
    case "quarterly": return iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
    case "annual": return iso(y, 1, 1);
  }
}
/** The last day of the period that starts on `start`. */
export function periodEndOf(frequency: Frequency, start: string): string {
  const [y, m] = parts(start);
  switch (frequency) {
    case "daily": return start;
    case "weekly": return addDays(start, 6);
    case "monthly": return iso(y, m, lastDayOfMonth(y, m));
    case "quarterly": return iso(y, m + 2, lastDayOfMonth(y, m + 2));
    case "annual": return iso(y, 12, 31);
  }
}
export const isPeriodStart = (frequency: Frequency, day: string): boolean => periodStartOf(frequency, day) === day;
export const nextPeriodStart = (frequency: Frequency, start: string): string => addDays(periodEndOf(frequency, start), 1);

/** How many completed periods the screens look back over by default. */
export const LOOKBACK: Readonly<Record<Frequency, number>> = { daily: 14, weekly: 8, monthly: 6, quarterly: 4, annual: 3 };

/** The starts of every period from the one containing `from` up to the one containing `to`, oldest first (at most `max`, keeping the latest). */
export function periodStarts(frequency: Frequency, from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  for (let s = periodStartOf(frequency, from); s <= to && out.length < 2000; s = nextPeriodStart(frequency, s)) out.push(s);
  return out.slice(-max);
}
/** Periods that have fully ended before `today`, newest `count` of them, oldest first, not before `notBefore`. */
export function completedPeriods(frequency: Frequency, today: string, count: number, notBefore?: string): string[] {
  const current = periodStartOf(frequency, today);
  const out: string[] = [];
  let s = current;
  for (let i = 0; i < count; i++) {
    // step back one period: the day before this start belongs to the previous period
    const prev = periodStartOf(frequency, addDays(s, -1));
    if (notBefore !== undefined && periodEndOf(frequency, prev) < notBefore) break;
    out.unshift(prev);
    s = prev;
  }
  return out;
}
export function periodLabel(frequency: Frequency, start: string): string {
  const [y, m] = parts(start);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]!;
  switch (frequency) {
    case "daily": return start;
    case "weekly": return `Week of ${start}`;
    case "monthly": return `${mon} ${y}`;
    case "quarterly": return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case "annual": return String(y);
  }
}
