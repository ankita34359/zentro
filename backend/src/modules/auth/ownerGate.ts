import type { Request, Response } from "express";
import { permissionDenied } from "../../lib/errors.js";
import type { AuthContext, AuthService } from "./service.js";

/**
 * TEMPORARY (stage 2.2 only, replaced by the permission engine in stage 2.3).
 *
 * There is no permission catalogue yet, so these route keys are allowed for people holding the Owner role and
 * nobody else. The keys are the real ones the engine will check (docs/permission-model.md section 2), so the route
 * registry, and the tenancy and permission matrices generated from it, already list them correctly. Stage 2.3
 * deletes this file and `authorize` evaluates `key` against role rows.
 */
export const TEMPORARY_OWNER_ONLY_KEYS: ReadonlySet<string> = new Set(["invitations.manage", "people.manage"]);

export function temporaryOwnerGate(service: AuthService) {
  return (_req: Request, res: Response, key: string): void => {
    const auth = res.locals.auth as AuthContext | undefined;
    if (!auth || !TEMPORARY_OWNER_ONLY_KEYS.has(key) || !service.isOwner(auth)) throw permissionDenied();
  };
}
