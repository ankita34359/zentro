import crypto from "node:crypto";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { HttpError, unauthenticated, validationFailed } from "../lib/errors.js";

/**
 * Route registry. EVERY route is added through add() and MUST declare how it is protected. A route without a
 * marker cannot be registered (the type forbids it and add() throws), and assertAllRegistered() fails if anything
 * was mounted on Express by another way. The same list drives the tenancy and permission test matrices (2.3).
 */
export type Access =
  /** No sign-in needed. `why` says so in words, so a reviewer sees the intent. */
  | { kind: "public"; why: string }
  /** Machine caller: `Authorization: Bearer $CRON_SECRET`, checked here in constant time. */
  | { kind: "cron" }
  /** Any signed-in person (self-service rights such as "my profile"). */
  | { kind: "baseline" }
  /** Signed in AND holding this permission key (e.g. "okr.edit"). Scope is checked by the service. */
  | { kind: "permission"; key: string };

export type Method = "get" | "post" | "put" | "patch" | "delete";

export interface RouteDef {
  method: Method;
  path: string;
  access: Access;
  /** True when the path or body carries the id of a record (the tenancy matrix then tries another organization's id). */
  takesEntityId?: boolean;
  /** Short note for docs/api-documentation.md. */
  summary: string;
  schema?: { params?: ZodType; query?: ZodType; body?: ZodType };
  handler: (req: Request, res: Response, valid: Validated) => unknown | Promise<unknown>;
}

export interface Validated {
  params: unknown;
  query: unknown;
  body: unknown;
}

export interface Guards {
  /** Returns nothing when the caller is signed in; throws HttpError otherwise. Stage 2.1 replaces the default. */
  authenticate: (req: Request, res: Response) => void | Promise<void>;
  /** Throws when the signed-in caller lacks the permission key. Stage 2.3 replaces the default. */
  authorize: (req: Request, res: Response, key: string) => void | Promise<void>;
  /** Value of CRON_SECRET, or undefined (then the cron kind always answers 401). */
  cronSecret: string | undefined;
}

/** Fail closed: until real sessions exist (stage 2.1), nothing that needs a person can be reached. */
export const denyAllGuards = (cronSecret: string | undefined): Guards => ({
  authenticate: () => {
    throw unauthenticated();
  },
  authorize: () => {
    throw unauthenticated();
  },
  cronSecret,
});

export function bearerMatches(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer (.+)$/.exec(header);
  if (!m || m[1] === undefined) return false;
  const a = crypto.createHash("sha256").update(m[1]).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

const PERMISSION_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

function parse(schema: ZodType | undefined, value: unknown): unknown {
  if (!schema) return undefined;
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  // Only the path and the rule's message go back, never the submitted value.
  throw validationFailed(r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

export class RouteRegistry {
  private readonly routes: RouteDef[] = [];

  add(def: RouteDef): void {
    const a = def.access as { kind?: string; key?: string; why?: string } | undefined;
    if (!a || !a.kind) throw new Error(`Route ${def.method.toUpperCase()} ${def.path} must declare its access`);
    if (a.kind === "permission" && !PERMISSION_KEY.test(a.key ?? "")) {
      throw new Error(`Route ${def.method.toUpperCase()} ${def.path} has a malformed permission key`);
    }
    if (a.kind === "public" && !a.why) throw new Error(`Public route ${def.path} must say why it is public`);
    if (this.routes.some((r) => r.method === def.method && r.path === def.path)) {
      throw new Error(`Route ${def.method.toUpperCase()} ${def.path} is registered twice`);
    }
    this.routes.push(def);
  }

  list(): readonly RouteDef[] {
    return this.routes;
  }

  /** Mount every registered route on Express behind its guard and its Zod validation. */
  mount(app: Express, guards: Guards): void {
    for (const def of this.routes) {
      const wrapped: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
        try {
          switch (def.access.kind) {
            case "public":
              break;
            case "cron":
              if (!bearerMatches(req.header("authorization"), guards.cronSecret)) {
                throw new HttpError(401, "unauthenticated", "Unauthorized");
              }
              break;
            case "baseline":
              await guards.authenticate(req, res);
              break;
            case "permission":
              await guards.authenticate(req, res);
              await guards.authorize(req, res, def.access.key);
              break;
          }
          const valid: Validated = {
            params: parse(def.schema?.params, req.params),
            query: parse(def.schema?.query, req.query),
            body: parse(def.schema?.body, req.body),
          };
          await def.handler(req, res, valid);
        } catch (err) {
          next(err);
        }
      };
      app[def.method](def.path, wrapped);
    }
  }
}

/** Every route Express knows about, as "METHOD path". Reads Express 5's router stack. */
export function expressRoutes(app: Express): string[] {
  const router = (app as unknown as { router?: { stack?: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router;
  const out: string[] = [];
  for (const layer of router?.stack ?? []) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${layer.route.path}`);
  }
  return out;
}

/** Boot-time and test-time check: nothing is mounted on Express that is not in the registry. */
export function assertAllRegistered(app: Express, registry: RouteRegistry): void {
  const known = new Set(registry.list().map((r) => `${r.method.toUpperCase()} ${r.path}`));
  const stray = expressRoutes(app).filter((r) => !known.has(r));
  if (stray.length > 0) throw new Error(`Routes mounted without the registry: ${stray.join(", ")}`);
}
