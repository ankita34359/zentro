import { describe, expect, it } from "vitest";
import { describeProblem, loadConfig } from "../backend/src/config/env.js";
import { FAKE_ENV } from "./helpers/app.js";

describe("config validation", () => {
  it("accepts the two required settings and applies defaults", () => {
    const r = loadConfig({ SESSION_SECRET: FAKE_ENV.SESSION_SECRET, ENCRYPTION_KEY: FAKE_ENV.ENCRYPTION_KEY });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config).toMatchObject({ logLevel: "info", trustProxy: 1, appUrl: undefined, registration: { mode: "closed" } });
  });

  it("names every missing setting, and only names", () => {
    const r = loadConfig({});
    expect(r).toEqual({ ok: false, missing: ["SESSION_SECRET", "ENCRYPTION_KEY"], invalid: [] });
    if (!r.ok) expect(describeProblem(r)).toBe("Server is missing: SESSION_SECRET, ENCRYPTION_KEY");
  });

  it("treats a blank value as missing", () => {
    const r = loadConfig({ SESSION_SECRET: "   ", ENCRYPTION_KEY: FAKE_ENV.ENCRYPTION_KEY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["SESSION_SECRET"]);
  });

  it("flags a too-short secret without ever echoing the value", () => {
    const short = "tooshort-VALUE-must-not-appear";
    const r = loadConfig({ SESSION_SECRET: short, ENCRYPTION_KEY: FAKE_ENV.ENCRYPTION_KEY });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = describeProblem(r) + JSON.stringify(r);
      expect(text).toContain("SESSION_SECRET");
      expect(text).toContain("at least 32 characters");
      expect(text).not.toContain(short);
    }
  });

  it("refuses the same value for both secrets", () => {
    const same = "x".repeat(40);
    const r = loadConfig({ SESSION_SECRET: same, ENCRYPTION_KEY: same });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.invalid).toEqual([{ name: "ENCRYPTION_KEY", reason: "must differ from SESSION_SECRET" }]);
  });

  it("validates optional settings", () => {
    const bad = loadConfig({ ...FAKE_ENV, APP_URL: "not a url", LOG_LEVEL: "loud", TRUST_PROXY: "many" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.invalid.map((i) => i.name).sort()).toEqual(["APP_URL", "LOG_LEVEL", "TRUST_PROXY"]);
    const good = loadConfig({ ...FAKE_ENV, APP_URL: "https://zentro.embarko.app/", LOG_LEVEL: "DEBUG", TRUST_PROXY: "2" });
    expect(good.ok && good.config).toMatchObject({ appUrl: "https://zentro.embarko.app", logLevel: "debug", trustProxy: 2 });
  });
});
