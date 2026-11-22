import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

/** scrypt parameters (docs/architecture.md section 12): N=16384, r=8, p=1, 16-byte salt, 64-byte key. */
const N = 16384;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export const MIN_PASSWORD_LENGTH = 10;
/** An upper bound so a huge "password" cannot be used to burn server time. */
export const MAX_PASSWORD_LENGTH = 128;

/** Stored as `scrypt$N$r$p$salt$hash` (base64url). Async API only, so the event loop is never blocked. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_BYTES, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time comparison. Any malformed stored value simply fails (never throws to the caller). */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const nn = Number(n);
  const rr = Number(r);
  const pp = Number(p);
  if (![nn, rr, pp].every((v) => Number.isInteger(v) && v > 0) || nn > 1 << 20) return false;
  try {
    const expected = Buffer.from(hash, "base64url");
    const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N: nn, r: rr, p: pp });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Hash of a throwaway password, computed once. Checked when the email is unknown so the answer takes about as long. */
let decoy: Promise<string> | undefined;
export const decoyHash = (): Promise<string> => (decoy ??= hashPassword(crypto.randomBytes(16).toString("hex")));

/** Constant-time string comparison that does not leak the length of either value through timing. */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
