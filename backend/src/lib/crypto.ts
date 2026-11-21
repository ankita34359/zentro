import crypto from "node:crypto";

/**
 * AES-256-GCM for secrets stored in the database (viaSocket flow URLs, connected-account ids).
 * The 256-bit key is derived from the ENCRYPTION_KEY setting with HKDF-SHA256, so the setting can be any
 * long random string (a password-manager value works); it does not have to be exactly 32 raw bytes.
 */
export function deriveKey(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", secret, "zentro-v1", "aes-256-gcm field encryption", 32));
}

const PREFIX = "enc1";

/** Returns `enc1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptField(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptField(key: Buffer, stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error("Unrecognised encrypted value");
  const [, iv, tag, body] = parts as [string, string, string, string];
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  // A wrong key or a tampered value makes final() throw: the caller sees a generic error, never the value.
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
