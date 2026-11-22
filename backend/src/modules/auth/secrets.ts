import crypto from "node:crypto";

/** A fresh 256-bit random secret, URL-safe. */
export const newSecret = (): string => crypto.randomBytes(32).toString("base64url");

/** What the database stores for a link secret: SHA-256 hex. */
export const hashSecret = (secret: string): string => crypto.createHash("sha256").update(secret).digest("hex");

/** Constant-time comparison of two hex hashes of the same length. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** Invitation codes are `<organization id>.<secret>`: the (non-secret) organization id says where to look the hash up. */
export const makeInvitationCode = (organizationId: string): string => `${organizationId}.${newSecret()}`;

export function parseInvitationCode(code: string): { organizationId: string } | null {
  const [org, secret, ...rest] = code.split(".");
  if (rest.length > 0 || !org || !secret || !UUID.test(org) || !SECRET.test(secret)) return null;
  return { organizationId: org };
}

export const isResetTokenShape = (token: string): boolean => SECRET.test(token);
