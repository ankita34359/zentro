import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { newId } from "../backend/src/lib/ids.js";
import { makeTestApp, ORIGIN, type TestApp } from "./helpers/app.js";
import { createLogger } from "../backend/src/lib/logger.js";
import { notFound } from "../backend/src/lib/errors.js";
import { sendData } from "../backend/src/http/envelope.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const withRoutes = () =>
  makeTestApp({
    extraRoutes: (r) => {
      r.add({
        method: "post",
        path: "/api/_t/echo",
        access: { kind: "public", why: "test route" },
        summary: "t",
        schema: { body: z.object({ name: z.string().min(2), age: z.number().int().optional() }).strict() },
        handler: (_req, res, v) => sendData(res, v.body, 201),
      });
      r.add({
        method: "get",
        path: "/api/_t/boom",
        access: { kind: "public", why: "test route" },
        summary: "t",
        handler: () => {
          throw new Error("password=hunter2 SELECT * FROM secrets");
        },
      });
      r.add({
        method: "get",
        path: "/api/_t/missing",
        access: { kind: "public", why: "test route" },
        summary: "t",
        handler: async () => {
          throw notFound();
        },
      });
    },
  });

describe("envelope, request ids, errors", () => {
  it("wraps success in { data, meta.requestId } and echoes X-Request-Id", async () => {
    t = withRoutes();
    const res = await request(t.app).post("/api/_t/echo").set("Origin", ORIGIN).send({ name: "Ada" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ data: { name: "Ada" }, meta: { requestId: res.headers["x-request-id"] } });
  });

  it("accepts a harmless caller request id and replaces a hostile one", async () => {
    t = withRoutes();
    expect((await request(t.app).get("/healthz").set("X-Request-Id", "client-abc-12345")).headers["x-request-id"]).toBe("client-abc-12345");
    const bad = (await request(t.app).get("/healthz").set("X-Request-Id", "x y\"<script>")).headers["x-request-id"];
    expect(bad).toMatch(/^req_[0-9a-f]{12}$/);
  });

  it("answers unknown /api paths with the 404 envelope", async () => {
    t = withRoutes();
    const res = await request(t.app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: "Not found" }, meta: { requestId: res.headers["x-request-id"] } });
  });

  it("rejects unknown fields and bad values with validation_failed, naming paths and never echoing values", async () => {
    t = withRoutes();
    const res = await request(t.app).post("/api/_t/echo").set("Origin", ORIGIN).send({ name: "A", extra: "SENSITIVE-VALUE" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain("name");
    expect(JSON.stringify(res.body)).not.toContain("SENSITIVE-VALUE");
  });

  it("answers malformed JSON with invalid_json and oversized bodies with 413", async () => {
    t = withRoutes();
    const bad = await request(t.app).post("/api/_t/echo").set("Origin", ORIGIN).set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_json");
    const big = await request(t.app).post("/api/_t/echo").set("Origin", ORIGIN).send({ name: "x".repeat(200_000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("payload_too_large");
  });

  it("turns a thrown HttpError into its status and code", async () => {
    t = withRoutes();
    const res = await request(t.app).get("/api/_t/missing");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("hides the cause of an unexpected error and logs only the message, route and request id", async () => {
    t = withRoutes();
    const res = await request(t.app).get("/api/_t/boom").set("Authorization", "Bearer sekret-token-value").set("Cookie", "zentro_session=abc");
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: "internal_error", message: "Something went wrong" });
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|SELECT/);
    const logged = t.lines.join("\n");
    expect(logged).toContain(res.headers["x-request-id"]);
    expect(logged).toContain("/api/_t/boom");
    expect(logged).not.toMatch(/sekret-token-value|zentro_session|abc/);
    expect(logged).not.toContain("at "); // no stack frames
  });

  it("logs the route pattern, not the real path or query string", async () => {
    t = withRoutes();
    await request(t.app).get("/api/_t/missing?token=QUERY-SECRET");
    expect(t.lines.join("\n")).not.toContain("QUERY-SECRET");
  });
});

describe("logger", () => {
  it("redacts sensitive field names and respects the level", () => {
    const out: string[] = [];
    const log = createLogger("info", (l) => out.push(l));
    log.debug("hidden");
    log.info("hello", { requestId: "r1", password: "p", sessionToken: "t", userEmail: "a@b.c", webhookUrl: "https://x", ok: 1 });
    expect(out).toHaveLength(1);
    const line = JSON.parse(out[0]!);
    expect(line).toMatchObject({ level: "info", msg: "hello", requestId: "r1", ok: 1, password: "[redacted]", sessionToken: "[redacted]", userEmail: "[redacted]", webhookUrl: "[redacted]" });
    expect(out[0]).not.toMatch(/a@b\.c|https:\/\/x/);
  });

  it("child loggers carry their fields", () => {
    const out: string[] = [];
    createLogger("info", (l) => out.push(l)).child({ job: "j" }).info("m");
    expect(JSON.parse(out[0]!).job).toBe("j");
  });
});

describe("ids", () => {
  it("makes distinct text UUIDs", () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(newId());
  });
});
