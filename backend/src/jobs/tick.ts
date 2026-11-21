import type Database from "better-sqlite3";
import { bump } from "../db/counters.js";

/**
 * The single scheduled entry point. Stage 1.1 only counts ticks so the live page can prove
 * Embarko's scheduler reached the app. Later stages register real jobs here.
 */
export function createTick(db: Database.Database) {
  let running = false;
  return {
    isRunning: () => running,
    async run(): Promise<void> {
      running = true;
      try {
        bump(db, "ticks");
      } finally {
        running = false;
      }
    },
  };
}
