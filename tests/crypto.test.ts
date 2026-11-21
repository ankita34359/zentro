import { describe, expect, it } from "vitest";
import { decryptField, deriveKey, encryptField } from "../backend/src/lib/crypto.js";

describe("field encryption (AES-256-GCM)", () => {
  const key = deriveKey("a-long-random-encryption-key-for-tests-0123456789");

  it("round-trips and never stores the plaintext", () => {
    const stored = encryptField(key, "https://flow.example/hook/very-secret");
    expect(stored).toMatch(/^enc1\./);
    expect(stored).not.toContain("very-secret");
    expect(decryptField(key, stored)).toBe("https://flow.example/hook/very-secret");
  });

  it("uses a fresh nonce each time", () => {
    expect(encryptField(key, "same")).not.toBe(encryptField(key, "same"));
  });

  it("fails with the wrong key or a tampered value, saying nothing about the content", () => {
    const stored = encryptField(key, "payload");
    expect(() => decryptField(deriveKey("another-key-another-key-another-key-xx"), stored)).toThrow();
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(key, parts.join("."))).toThrow();
    expect(() => decryptField(key, "not-encrypted")).toThrow("Unrecognised encrypted value");
  });

  it("derives a stable 32-byte key from the setting", () => {
    expect(deriveKey("x".repeat(40))).toHaveLength(32);
    expect(deriveKey("x".repeat(40)).equals(deriveKey("x".repeat(40)))).toBe(true);
    expect(deriveKey("x".repeat(40)).equals(deriveKey("y".repeat(40)))).toBe(false);
  });
});
