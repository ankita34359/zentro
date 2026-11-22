import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import path from "node:path";
import request from "supertest";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { sendData } from "../backend/src/http/envelope.js";
import { isHashedAsset } from "../backend/src/http/cacheHeaders.js";
import { makeTestApp, tmpDir, type TestApp } from "./helpers/app.js";

let t: TestApp;
const dirs: string[] = [];
afterEach(() => {
  t?.cleanup();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const BIG_JS = "export const x = " + JSON.stringify("zentro performance ".repeat(400)) + ";\n"; // ~7.6 KB of text
const INDEX = "<!doctype html><html><body>" + "<p>Zentro</p>".repeat(200) + "</body></html>";

/** A tiny fake Vite build: index.html, a hashed asset, an unhashed one, a favicon and a hashed stylesheet. */
function fakeBuild(): string {
  const dir = tmpDir();
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), INDEX);
  fs.writeFileSync(path.join(dir, "assets", "index-DJlntg6D.js"), BIG_JS);
  fs.writeFileSync(path.join(dir, "assets", "style-Bop-s5eo.css"), "body{color:red}\n".repeat(200));
  fs.writeFileSync(path.join(dir, "assets", "plain.js"), BIG_JS);
  fs.writeFileSync(path.join(dir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'>" + "<path d='M0 0'/>".repeat(100) + "</svg>");
  return dir;
}

const withBuild = () =>
  makeTestApp({
    staticDir: fakeBuild(),
    extraRoutes: (r) =>
      r.add({
        method: "get",
        path: "/api/_t/big",
        access: { kind: "public", why: "test route" },
        summary: "t",
        handler: (_req, res) => sendData(res, { text: "lorem ipsum ".repeat(500) }),
      }),
  });

// supertest decompresses for us; use a real HTTP request so the tests see the bytes that are actually on the wire.
interface Wire { status: number; headers: http.IncomingHttpHeaders; body: Buffer }
const wire = (app: Express, urlPath: string, acceptEncoding: string): Promise<Wire> =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      http
        .get({ host: "127.0.0.1", port, path: urlPath, headers: { "accept-encoding": acceptEncoding } }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            server.close();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
          });
        })
        .on("error", (e) => {
          server.close();
          reject(e);
        });
    });
  });
const raw = (req: { app: Express; p: string; ae: string }) => wire(req.app, req.p, req.ae);

describe("response compression", () => {
  it("compresses the entry script with brotli when the browser accepts it, and the bytes decode back exactly", async () => {
    t = withBuild();
    const res = await raw({ app: t.app, p: "/assets/index-DJlntg6D.js", ae: "br, gzip" });
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["vary"]).toMatch(/Accept-Encoding/i);
    expect(res.body.length).toBeLessThan(BIG_JS.length / 4);
    expect(brotliDecompressSync(res.body).toString()).toBe(BIG_JS);
  });

  it("falls back to gzip when only gzip is accepted", async () => {
    t = withBuild();
    const res = await raw({ app: t.app, p: "/assets/index-DJlntg6D.js", ae: "gzip" });
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(res.body).toString()).toBe(BIG_JS);
  });

  it("sends the plain file when the browser accepts no compression", async () => {
    t = withBuild();
    const res = await raw({ app: t.app, p: "/assets/index-DJlntg6D.js", ae: "identity" });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.toString()).toBe(BIG_JS);
  });

  it("compresses text types (html, css, svg) too", async () => {
    t = withBuild();
    for (const p of ["/", "/overview", "/assets/style-Bop-s5eo.css", "/favicon.svg"]) {
      const res = await raw({ app: t.app, p: p, ae: "gzip" });
      expect(res.headers["content-encoding"], p).toBe("gzip");
    }
  });

  it("leaves tiny responses alone (/healthz is far under the 1 KB threshold)", async () => {
    t = withBuild();
    const res = await raw({ app: t.app, p: "/healthz", ae: "br, gzip" });
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("never compresses /api answers, even a large one", async () => {
    t = withBuild();
    const res = await raw({ app: t.app, p: "/api/_t/big", ae: "br, gzip" });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(5000); // the whole 6 KB body is on the wire
    expect(res.headers["content-encoding"]).toBeUndefined();
    const notFound = await raw({ app: t.app, p: "/api/nope", ae: "br, gzip" });
    expect(notFound.headers["content-encoding"]).toBeUndefined();
  });

  it("keeps the existing response rules: no x-powered-by, a request id on every answer, SPA fallback, JSON 404 for /api", async () => {
    t = withBuild();
    for (const p of ["/assets/index-DJlntg6D.js", "/overview", "/api/nope", "/healthz"]) {
      const res = await raw({ app: t.app, p: p, ae: "br" });
      expect(res.headers["x-powered-by"], p).toBeUndefined();
      expect(res.headers["x-request-id"], p).toMatch(/^req_/);
    }
    const deep = await request(t.app).get("/okrs/anything");
    expect(deep.status).toBe(200);
    expect(deep.text).toBe(INDEX);
    const api = await request(t.app).get("/api/nope");
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe("not_found");
  });
});

describe("cache headers", () => {
  it("hashed files in /assets are cached for a year and marked immutable", async () => {
    t = withBuild();
    for (const p of ["/assets/index-DJlntg6D.js", "/assets/style-Bop-s5eo.css"]) {
      const res = await request(t.app).get(p);
      expect(res.headers["cache-control"], p).toBe("public, max-age=31536000, immutable");
    }
  });

  it("index.html, the app shell fallback, an unhashed file and /healthz are revalidated, never cached long", async () => {
    t = withBuild();
    for (const p of ["/", "/index.html", "/overview", "/okrs/deep/link", "/favicon.svg", "/assets/plain.js", "/healthz"]) {
      const res = await request(t.app).get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers["cache-control"], p).toBe("no-cache");
      expect(res.headers["cache-control"], p).not.toMatch(/immutable|max-age=[1-9]/);
    }
  });

  it("answers a repeat request for an unchanged page with 304 (that is what revalidation buys)", async () => {
    t = withBuild();
    const first = await request(t.app).get("/index.html");
    const again = await request(t.app).get("/index.html").set("If-None-Match", String(first.headers["etag"]));
    expect(again.status).toBe(304);
  });

  it("sets no cache header on /api answers (success or 404)", async () => {
    t = withBuild();
    for (const p of ["/api/_t/big", "/api/nope"]) {
      const res = await request(t.app).get(p);
      expect(res.headers["cache-control"], p).toBeUndefined();
    }
  });

  it("only treats /assets files whose name carries a hash as hashed", () => {
    expect(isHashedAsset("/assets/index-DJlntg6D.js")).toBe(true);
    expect(isHashedAsset("/assets/inter-latin-wght-normal-Dx4kXJAl.woff2")).toBe(true);
    expect(isHashedAsset("/assets/plain.js")).toBe(false);
    expect(isHashedAsset("/index-DJlntg6D.js")).toBe(false);
    expect(isHashedAsset("/api/assets/index-DJlntg6D.js")).toBe(false);
  });
});

describe("request log volume", () => {
  const requestLines = (lines: string[]) => lines.map((l) => JSON.parse(l)).filter((l) => l.msg === "request");

  it("logs static files, the app shell and other unmatched non-API requests at debug only", async () => {
    t = withBuild();
    await request(t.app).get("/assets/index-DJlntg6D.js");
    await request(t.app).get("/overview");
    await request(t.app).get("/favicon.svg");
    const lines = requestLines(t.lines).filter((l) => l.route === "unmatched");
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.level === "debug")).toBe(true);
  });

  it("keeps info for real API routes and for unknown /api paths, so the useful lines remain", async () => {
    t = withBuild();
    await request(t.app).get("/api/_t/big");
    await request(t.app).get("/api/nope");
    const lines = requestLines(t.lines);
    expect(lines.find((l) => l.route === "/api/_t/big")?.level).toBe("info");
    expect(lines.find((l) => l.route === "unmatched" && l.status === 404)?.level).toBe("info");
  });

  it("at the default info level the log has no static-file lines at all", async () => {
    const lines: string[] = [];
    const { createLogger } = await import("../backend/src/lib/logger.js");
    t = makeTestApp({ staticDir: fakeBuild(), log: createLogger("info", (l) => lines.push(l)) });
    await request(t.app).get("/assets/index-DJlntg6D.js");
    await request(t.app).get("/overview");
    await request(t.app).get("/healthz");
    expect(lines.filter((l) => JSON.parse(l).msg === "request")).toHaveLength(0);
  });
});
