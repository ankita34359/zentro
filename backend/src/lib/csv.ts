/**
 * CSV for spreadsheets. A cell that starts with = + - @ (or a tab or carriage return) would be run as a formula by Excel or Sheets, so it
 * gets a leading apostrophe-free guard: a single quote inside the quoted cell. Numbers and dates are written as they are.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return `﻿${lines.join("\r\n")}\r\n`; // a byte-order mark so spreadsheets read UTF-8 names correctly
}
