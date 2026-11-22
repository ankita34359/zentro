import type { Express } from "express";
import { acceptNew, get, invite, post } from "./auth.js";

export const ROLE_KEYS = ["owner", "ceo", "senior_management", "department_head", "manager", "team_lead", "mentor", "employee", "intern"] as const;

/** role id by key, read through the API as an administrator. */
export async function roleIds(app: Express, adminCookie: string): Promise<Record<string, string>> {
  const res = await get(app, "/api/roles", adminCookie);
  if (res.status !== 200) throw new Error(`roles failed ${res.status}`);
  return Object.fromEntries((res.body.data as { id: string; key: string }[]).map((r) => [r.key, r.id]));
}

/** An administrator invites a person INTO a role, the person accepts; returns their cookie and membership id. */
export async function addPerson(app: Express, adminCookie: string, email: string, roleId?: string, name = "Person"): Promise<{ cookie: string; membershipId: string }> {
  const body = await post(app, "/api/invitations", { email, name, ...(roleId ? { roleId } : {}) }, adminCookie);
  if (body.status !== 201) throw new Error(`invite failed ${body.status} ${JSON.stringify(body.body)}`);
  const accepted = await acceptNew(app, body.body.data.code, email, name);
  if (!accepted.cookie) throw new Error(`accept failed ${accepted.res.status}`);
  return { cookie: accepted.cookie, membershipId: accepted.res.body.data.membership.id };
}
export { invite };
