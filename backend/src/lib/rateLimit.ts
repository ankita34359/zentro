/**
 * Sliding-window attempt counter, kept in memory (the app is one process; a restart forgets the counts, which only
 * ever favours a legitimate user). Used for failed logins, failed registration codes and sign-up attempts.
 * Block time grows when someone keeps trying: each full block doubles the next one, up to maxBlockMs.
 */
export interface RateLimitRule {
  /** Failures allowed inside windowMs before the key is blocked. */
  max: number;
  windowMs: number;
  /** First block length; doubles each time the key is blocked again. */
  blockMs: number;
  maxBlockMs?: number;
}

interface Entry {
  hits: number[];
  blockedUntil: number;
  strikes: number;
}

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly rule: RateLimitRule,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Milliseconds the caller must wait, or 0 if it may go ahead. Does not count as an attempt. */
  retryAfterMs(key: string): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    return Math.max(0, e.blockedUntil - this.now());
  }

  /** Record one failed attempt. Returns the block time in ms if this failure triggered a block. */
  fail(key: string): number {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= this.maxKeys) this.sweep(t);
      if (this.entries.size >= this.maxKeys) return 0; // memory guard: never grow without bound
      e = { hits: [], blockedUntil: 0, strikes: 0 };
      this.entries.set(key, e);
    }
    e.hits = e.hits.filter((h) => t - h < this.rule.windowMs);
    e.hits.push(t);
    if (e.hits.length >= this.rule.max) {
      const block = Math.min(this.rule.blockMs * 2 ** e.strikes, this.rule.maxBlockMs ?? this.rule.blockMs * 32);
      e.strikes += 1;
      e.blockedUntil = t + block;
      e.hits = [];
      return block;
    }
    return 0;
  }

  /** A success clears the key (for example the account's failed-login count). */
  reset(key: string): void {
    this.entries.delete(key);
  }

  private sweep(t: number): void {
    for (const [k, e] of this.entries) {
      if (e.blockedUntil <= t && e.hits.every((h) => t - h >= this.rule.windowMs)) this.entries.delete(k);
    }
  }
}
