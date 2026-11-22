import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export const COOKIE_NAME = "zentro_session";
/** Sliding window: a session stays alive while it is used at least once every 7 days. */
export const SESSION_SLIDING_MS = 7 * 24 * 3600 * 1000;
/** Hard stop: nobody stays signed in longer than 30 days without logging in again. */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 3600 * 1000;

/** A fresh random session id (the secret inside the cookie). 256 bits. */
export const newSessionSecret = (): string => crypto.randomBytes(32).toString("base64url");

/** What is stored in the database: the SHA-256 of the session id, so a database copy contains nothing replayable. */
export const sessionRowId = (sessionSecret: string): string => crypto.createHash("sha256").update(sessionSecret).digest("hex");

/** The cookie value: HS256 JWT `{sub, sid, iat, exp}` signed with SESSION_SECRET. `sid` is the random session id. */
export function signSessionJwt(secret: string, userId: string, sessionSecret: string, lifetimeSeconds: number): string {
  return jwt.sign({ sub: userId, sid: sessionSecret }, secret, { algorithm: "HS256", expiresIn: lifetimeSeconds });
}

/** Returns the user id and session id, or null for anything wrong (bad signature, wrong algorithm, expired, malformed). */
export function verifySessionJwt(secret: string, token: string): { userId: string; sessionSecret: string } | null {
  try {
    const p = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof p !== "object" || p === null) return null;
    const { sub, sid } = p as { sub?: unknown; sid?: unknown };
    if (typeof sub !== "string" || typeof sid !== "string" || sid.length < 20) return null;
    return { userId: sub, sessionSecret: sid };
  } catch {
    return null;
  }
}
