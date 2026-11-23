import { daysBetween, addDays } from "./dates.js";

export interface Rankable {
  id: string;
  status: string;
  priority: string;
  importanceWeight: number;
  dueAt: string | null;
}

export interface Ranked {
  id: string;
  score: number;
  reasons: string[];
}

const PRIORITY_POINTS: Record<string, number> = { critical: 300, high: 200, medium: 100, low: 0 };

/**
 * The rule-based "what should I do first" order (stage 4.4). A plain, explainable score, no AI: overdue work first (more
 * days late first), then work due today, tomorrow and this week, then priority and business importance, with work that is
 * already under way lifted a little and blocked work always last (a blocked task cannot be worked on, however late). Every task comes back with the reasons, in words.
 */
export function suggestOrder(tasks: readonly Rankable[], today: string): Ranked[] {
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  const ranked = tasks.map((t): Ranked => {
    let score = 0;
    const reasons: string[] = [];
    if (t.dueAt !== null) {
      if (t.dueAt < today) {
        const late = daysBetween(t.dueAt, today);
        score += 1000 + Math.min(late, 30) * 10;
        reasons.push(late === 1 ? "Overdue by 1 day" : `Overdue by ${late} days`);
      } else if (t.dueAt === today) {
        score += 600;
        reasons.push("Due today");
      } else if (t.dueAt === tomorrow) {
        score += 350;
        reasons.push("Due tomorrow");
      } else if (t.dueAt <= weekEnd) {
        score += 150;
        reasons.push("Due this week");
      }
    }
    const p = PRIORITY_POINTS[t.priority] ?? 100;
    score += p;
    if (t.priority === "critical" || t.priority === "high") reasons.push(t.priority === "critical" ? "Critical priority" : "High priority");
    score += t.importanceWeight * 20;
    if (t.importanceWeight >= 4) reasons.push(`Importance ${t.importanceWeight} of 5`);
    if (t.status === "in_progress") {
      score += 50;
      reasons.push("Already under way");
    }
    if (t.status === "blocked") {
      score -= 5000; // always after everything that can be worked on
      reasons.length = 0;
      reasons.push("Blocked: ask for help or remove the blocker before spending time here");
    }
    if (reasons.length === 0) reasons.push("No deadline pressure; ordered by priority and importance");
    return { id: t.id, score, reasons };
  });
  // Highest score first; ties keep a stable order by due day, then id.
  const due = new Map(tasks.map((t) => [t.id, t.dueAt ?? "9999-12-31"]));
  return ranked.sort((a, b) => b.score - a.score || due.get(a.id)!.localeCompare(due.get(b.id)!) || a.id.localeCompare(b.id));
}
