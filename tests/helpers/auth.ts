import request from "supertest";
import type { Express } from "express";
import { makeTestApp, ORIGIN, testConfig, type TestApp } from "./app.js";

/** A registration code that exists only in tests. The real one is never written anywhere in this repository. */
export const TEST_CODE = "test-only-registration-code-0001";
export const PASSWORD = "correct horse battery";

export const withRegistration = (extra: NodeJS.ProcessEnv = {}) =>
  testConfig({ REGISTRATION_MODE: "code", REGISTRATION_CODE: TEST_CODE, ...extra });

export const makeAuthApp = (over: Parameters<typeof makeTestApp>[0] = {}): TestApp => makeTestApp({ config: withRegistration(), ...over });

export const post = (app: Express, path: string, body?: unknown, cookie?: string) => {
  const r = request(app).post(path).set("Origin", ORIGIN);
  if (cookie) r.set("Cookie", cookie);
  return body === undefined ? r : r.send(body as object);
};
export const get = (app: Express, path: string, cookie?: string) => {
  const r = request(app).get(path);
  return cookie ? r.set("Cookie", cookie) : r;
};

export const cookieFrom = (res: request.Response): string | undefined => {
  const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("zentro_session="));
  return raw?.split(";")[0];
};

/** Register (with the test code) and sign in; returns the session cookie. */
export async function signUp(app: Express, email: string, name = "Test Person", password = PASSWORD): Promise<string> {
  const reg = await post(app, "/api/auth/register", { email, name, password, registrationCode: TEST_CODE });
  if (reg.status !== 202) throw new Error(`register failed ${reg.status}`);
  const login = await post(app, "/api/auth/login", { email, password });
  const c = cookieFrom(login);
  if (login.status !== 200 || !c) throw new Error(`login failed ${login.status}`);
  return c;
}

/** Register, sign in and create an organization; returns the cookie. */
export async function signUpWithOrg(app: Express, email: string, orgName: string): Promise<string> {
  const c = await signUp(app, email);
  const r = await post(app, "/api/organizations", { name: orgName }, c);
  if (r.status !== 201) throw new Error(`create org failed ${r.status}`);
  return c;
}

/** Owner invites a person; returns the one-time code and the invitation. */
export async function invite(app: Express, ownerCookie: string, email: string, name?: string) {
  const res = await post(app, "/api/invitations", { email, ...(name ? { name } : {}) }, ownerCookie);
  if (res.status !== 201) throw new Error(`invite failed ${res.status} ${JSON.stringify(res.body)}`);
  return { code: res.body.data.code as string, invitation: res.body.data.invitation as { id: string; membershipId: string; status: string; expiresAt: string }, res };
}

/** The invited person (no account yet) accepts; returns the response and their cookie. */
export async function acceptNew(app: Express, code: string, email: string, name = "Invited Person", password = PASSWORD) {
  const res = await post(app, "/api/auth/accept-invitation", { code, email, name, password });
  return { res, cookie: cookieFrom(res) };
}

export const acceptAs = (app: Express, code: string, cookie: string) => post(app, "/api/auth/accept-invitation", { code }, cookie);
