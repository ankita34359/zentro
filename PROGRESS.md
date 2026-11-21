# Zentro: Progress

Resume file. A fresh session should be able to continue from this page alone, plus `ZENTRO_MASTER_PROMPT.md` (source of truth; its "Showcase overrides" section wins) and `docs/`.

Last updated: 2026-11-21 · Blueprint approved · Stage 1.1 complete, live · Stage 1.2 built and tested, **not deployed (waiting for the owner's "yes, deploy")** · live at https://zentro.embarko.app

---

## Current status

**Stage 1.1 (deploy spike) is DEPLOYED** as app `zentro` (kind `service`, `claimed: true`): **https://zentro.embarko.app** (app id `cmwq8dc5l047m7p7fwgtufeuu`, now in `embarko.json`; now on version `f3fca7d`). Branch `claude/stage-1-1` is pushed; nothing merged to `main` (ask first).

Stage 1.1 is complete and live-checked and is merged into `main` (pull request #2).

**Stage 1.2 (backend foundation) is built and tested on Node 20.20.2 on branch `claude/stage-1-2`** (from `main`; nothing merged, nothing deployed). The live app is still stage 1.1 until the owner says "yes, deploy". Details in "Stage 1.2" below. Stage 1.3 (frontend foundation) has not been started.

## Working rules (from the master prompt overrides)

- Plan first; no application code until the blueprint is approved.
- Small stages. Stop after each, say exactly what to click on the **live Embarko link**.
- Work on a branch. **Ask before pushing to `main` and before deploying.**
- Never print or commit secrets, tokens, webhook URLs, `.env`, `node_modules`, `dist`, `build` or `data/`. Secrets are typed by the user on Embarko's App setup page.
- Update this file after every stage.
- All builds and tests must pass on a **real Node 20.20.2** (`npm i node@20.20.2` into a temp dir and put its `bin` first on `PATH`), not the sandbox's Node 22.

## Milestone 0: what was done

| Item | State |
| --- | --- |
| Read `ZENTRO_MASTER_PROMPT.md` in full | Done |
| Embarko docs (llms.txt, deploy, embarko-json, data, schedules, env-vars, files, status, integrations, ai, automations) | Read |
| HireDrive runbook (`ankita34359/Automation_Embed` → `EMBARKO-DEPLOY-RUNBOOK.md`) | Read (public repo cloned read-only into a temp location) |
| Curevia (`ankita34359/Curevia`) | Read: package/config/server/db/auth/cron/viaSocket/tests/deploy script |
| viaSocket docs (skill.md v2026-11-20.6, embed, apps-api, setup, connect, alerts, automations, ai) and npm `viasocket-apps@0.21.0` | Read / unpacked |
| `ViaSocketActionEmbed` / `useGetViaSocketEmbedToken` | **Not found anywhere readable** (docs, npm package, your repos, 2 web searches). Plan uses the proven script embed behind our own component and hook. |
| Docs written in `docs/` | architecture, database-design, permission-model, scoring-architecture, agent-specifications, viasocket-integration, frontend-structure, api-documentation, milestones, risks, known-limitations |
| Branch `claude/blueprint` pushed, reviewed and approved by the owner; merged into `main` by pull request (owner-approved, docs and `PROGRESS.md` only) | Done |

Not readable: anything behind a viaSocket or Embarko login (dashboard "Install Code" snippets, Embarko dashboard).

## Key findings that shaped the plan

1. **Embarko's docs state no Node version.** `engines.node: ">=20"` produced Node 20.20.2 in HireDrive/Curevia. Pin to that.
2. **`better-sqlite3@13` and `vitest@5` need Node 22+.** Use `better-sqlite3 ^12.11` and `vitest ^4.1.12` (changed from 3.2 in stage 1.1). Vite 8 needs `^20.19`.
3. **Curevia and HireDrive are plain JavaScript.** A compiled TypeScript backend is unproven on Embarko (stage 1.1 proves it; fallbacks `tsx`, then plain JS).
4. **Curevia uses DB sessions and bcryptjs, not JWT and scrypt.** The override asks for JWT + scrypt; the plan keeps JWT but backs it with a revocable session row.
5. **Embarko file storage is public by link.** Not usable for confidential evidence; evidence files go in capped SQLite BLOBs behind an authenticated route.
6. **viaSocket's AI assistant has web search and a browser always on**, and its tools are public HTTP endpoints. The orchestrator therefore runs the tool loop in-process (decision D10).
7. **`viasocket-apps` is at 0.21.0**; Curevia pins `^0.7.0` (API changed). Re-verify at stage 8.
8. Scheduler: max 5 schedules, ≥5 min apart, 5 min per call, GET with `Bearer CRON_SECRET`, missed runs not replayed. One 5-minute tick with a job registry.

## Decisions locked in the blueprint (see `docs/architecture.md` section 16)

SQLite + SQL migrations (D1) · one Express app (D2) · `tsc` → `build/` (D3, **confirmed**) · Express 5 (D4) · Tailwind 4 (D5) · JWT cookie + session row (D6, **confirmed**) · scrypt (D7) · single tick + job registry (D8) · `AiProvider` interface, viaSocket default (D9) · in-process tool loop (D10) · evidence files as capped BLOBs (D11, **confirmed**) · person = membership id (D12) · one viaSocket project, per-organization `unique_identifier` (D13) · effective-dated hierarchy (D14) · text UUIDs (D15) · no CHECK on growing enums (D16) · transactional outbox (D17) · pure scoring function (D18) · demo data via `is_demo` (D19) · Node 20.20.2 verification (D20).

## Owner decisions (all answered 2026-11-21)

| # | Question | Answer | Effect on the plan |
| --- | --- | --- | --- |
| 1 | TypeScript compile approach | **Yes**: compile the backend with `tsc` at build, run `node build/…` | D3 confirmed. Stage 1.1 proves it on Embarko; fallbacks are `tsx` at runtime, then plain JS (report to the owner if 1.1 fails) |
| 2 | Sessions | **Yes**: JWT cookie backed by a revocable `sessions` row | D6 confirmed (`docs/permission-model.md` section 8) |
| 3 | Registration mode on the live link | **`code`**: registration needs a registration code | Implement `REGISTRATION_MODE=code` with `REGISTRATION_CODE` (an Embarko secret the owner types) in stage 2.1; default the mode to `code` when unset |
| 4 | viaSocket credentials | **The owner's own `VIASOCKET_*` keys typed on Embarko, as in Curevia** | Do not use Embarko's Integrations capability. Read `VIASOCKET_ORG_ID`, `VIASOCKET_PROJECT_ID`, `VIASOCKET_EMBED_SECRET`; the `INTEGRATIONS_*` fallback stays unused |
| 5 | Evidence files | **Private storage in the database** | D11 confirmed: capped BLOBs (2 MB per file, 100 MB per organization) behind the authenticated download route; no Embarko public file links |
| 6 | View as demo persona | **Yes**: read-only, demo users only, bannered and audited | Build in stage 2.8 as specified in `docs/permission-model.md` section 6, item 7 |
| 7 | What the AI sees | **Aliases**, with real names allowed for the fictional demo | `AI_REDACTION=refs` is the default; `names` allowed for the demo company (`docs/agent-specifications.md` section 2) |
| 8 | Platform email flow | **Yes**: the owner will build one viaSocket "send email" flow **at stage 2.2** | Stage 2.2 should wire `VIASOCKET_EMAIL_FLOW_URL` (an Embarko secret the owner types) for password reset and invitation emails, with the admin-copied-link fallback kept. Earlier than the blueprint's stage 8 timing, so the owner needs the viaSocket keys (question 4) by 2.2 |
| 9 | Embarko app name and deploy token | App name **`zentro`**; if taken, **`zentro-ankita`**. The owner puts the deploy token on the machine as **`DEPLOY_TOKEN` in the environment settings**, never in chat | Use `scripts/embarko-deploy.sh <app-name>` (reads `DEPLOY_TOKEN`). Never print the token. On `409 app_name_taken` use `zentro-ankita`, then tell the owner which name is live |
| 10 | Source of `ViaSocketActionEmbed` / `useGetViaSocketEmbedToken` | **Nowhere**: they appeared only in the master prompt | Use our own `<ViaSocketEmbed>` and `useViaSocketEmbedToken` over the documented script embed (`docs/viasocket-integration.md` section 1). Still re-run `check:viasocket` at 8.1 |

## Stage checklist (details in `docs/milestones.md`)

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and live-checked.

**M1 Foundation** · `[x]` 1.1 Deploy spike (live, checked by the owner and by me) · `[~]` 1.2 Backend foundation (built and tested, awaiting deploy approval) · `[ ]` 1.3 Frontend foundation

**M2 Auth and organization** · `[ ]` 2.1 Auth core · `[ ]` 2.2 Reset and invitations · `[ ]` 2.3 RBAC engine · `[ ]` 2.4 Roles UI · `[ ]` 2.5 Organization structure · `[ ]` 2.6 People and reporting · `[ ]` 2.7 Organization chart · `[ ]` 2.8 Demo data framework

**M3 OKR and KPI** · `[ ]` 3.1 Objectives and key results · `[ ]` 3.2 Alignment and health · `[ ]` 3.3 KPI definitions · `[ ]` 3.4 KPI measurements and trends · `[ ]` 3.5 OKR/KPI polish

**M4 Tasks and evidence** · `[ ]` 4.1 Tasks core · `[ ]` 4.2 Links, dependencies, outcomes · `[ ]` 4.3 Evidence · `[ ]` 4.4 My Work dashboard · `[ ]` 4.5 Notifications and overdue job · `[ ]` 4.6 Task demo seed and checkpoint

**M5 Performance** · `[ ]` 5.1 Scoring engine · `[ ]` 5.2 Scorecards from real data · `[ ]` 5.3 History and recalculation · `[ ]` 5.4 Peer and department comparison · `[ ]` 5.5 Mentorship · `[ ]` 5.6 Leadership accountability and reviews

**M6 Dashboards** · `[ ]` 6.1 Overview · `[ ]` 6.2 Team Performance · `[ ]` 6.3 Performance Intelligence page · `[ ]` 6.4 Leadership dashboard · `[ ]` 6.5 Historical analytics

**M7 AI** · `[ ]` 7.1 Provider and run logging · `[ ]` 7.2 Tools, orchestrator, chat, Performance Analysis · `[ ]` 7.3 Daily Planner · `[ ]` 7.4 Risk Detection · `[ ]` 7.5 Goal Alignment and approvals · `[ ]` 7.6 Comparison and Leadership agents · `[ ]` 7.7 AI Intelligence Center

**M8 viaSocket** · `[ ]` 8.1 Embed spike and token · `[ ]` 8.2 Slots and connected accounts · `[ ]` 8.3 Events, outbox, dispatcher · `[ ]` 8.4 Backend-triggered workflows · `[ ]` 8.5 Channels, reports, inbound evidence · `[ ]` 8.6 AI-approved integration actions

**M9 Production readiness** · `[ ]` 9.1 Security review · `[ ]` 9.2 Isolation and permission matrices · `[ ]` 9.3 Performance · `[ ]` 9.4 Operations · `[ ]` 9.5 Documentation and acceptance

## What I need from the owner, and when

| When | Need |
| --- | --- |
| Before 1.1 deploy | `DEPLOY_TOKEN` is set in the environment (see the token note in the Stage 1.1 section); the owner's "yes, deploy"; after deploy: **claim the app** in the Embarko dashboard (schedules need a kept app) |
| 1.2 | `SESSION_SECRET` and `ENCRYPTION_KEY` typed by the owner on Embarko's App setup page (each a long random string, at least 32 characters, **different from each other**; a password-manager generator works), then **Apply changes**. Where: https://embarko.ai/app, choose `zentro`, open **App setup**. |
| 2.1 | `REGISTRATION_CODE` typed on Embarko's App setup page (mode is `code`) |
| 2.2 | viaSocket keys (`VIASOCKET_*`) typed on Embarko, and one viaSocket "send email" flow built; its run URL typed as `VIASOCKET_EMAIL_FLOW_URL` |
| 2.8 | Nothing (view-as is approved) |
| 4.3 | Nothing (private database storage is approved) |
| 7.1 / 8.1 | viaSocket keys already typed by 2.2; viaSocket workspace AI credits for 7.1 |
| 8.2 | Build Slack/Gmail flows inside the embed; add the alert addresses |

## How to resume in a new session

1. Read `ZENTRO_MASTER_PROMPT.md` (overrides first), then `docs/architecture.md` sections 3, 4 and 16, then this file.
2. `git fetch && git checkout main && git pull`, then create the stage branch named in the latest log entry below (never push to `main` or deploy without asking).
3. Find the first unchecked stage above, open its row in `docs/milestones.md`, and build only that stage.
4. For Node 20 verification: `mkdir -p /tmp/n20 && cd /tmp/n20 && npm init -y && npm i node@20.20.2`, then `export PATH=/tmp/n20/node_modules/node/bin:$PATH` before `npm ci && npm run build && npm test`.
5. Re-verify external facts rather than trusting memory: Embarko docs `https://embarko.ai/llms.txt` (append `.md` to a docs page for plain text), viaSocket `https://flow.viasocket.com/documentation/skill.md`, the HireDrive runbook, and Curevia.
6. Finish each stage with: what was implemented, files changed, decisions, tests run, what is incomplete, exact next step. Update this file. Stop and ask before deploying or merging.

## Log

| Date | Stage | Notes |
| --- | --- | --- |
| 2026-11-21 | M0 blueprint | Research done; 11 docs plus this file written; branch `claude/blueprint` pushed |
| 2026-11-21 | M0 approved | Owner approved the blueprint and answered all ten questions (recorded above); pull request `claude/blueprint` → `main` merged with the owner's explicit approval (docs and `PROGRESS.md` only). Stage 1.1 deliberately **not** started; it begins in a new session. |
| 2026-11-21 | 1.1 built | Branch `claude/stage-1-1` (from `origin/main`). Spike built and tested on Node 20.20.2; **not deployed**. Details in "Stage 1.1" below. |
| 2026-11-21 | 1.1 live | Deployed (owner's yes), redeploy test passed (counter survived), merged to `main` by pull request #2. |
| 2026-11-21 | 1.2 built | Branch `claude/stage-1-2` (from `main`). Backend foundation built; 78 tests pass on Node 20.20.2 from a clean checkout. **Not deployed.** Details in "Stage 1.2" below. |

---

## Stage 1.1: deploy spike (built, not yet deployed)

**Implemented.** Express 5 + TypeScript compiled by `tsc -p backend/tsconfig.json` into `build/` (server starts with `node build/backend/src/server.js`); Vite 8 + React 19 page built into `dist/` and served by Express with a single-page-app fallback; `better-sqlite3@^12.11.1` database at `$DATA_DIR/zentro.db` (WAL, foreign keys on); migration runner (`schema_migrations` with checksums, one table: `spike_counters`); `GET /healthz`; `GET /api/spike`, `POST /api/spike/visit` (visit counter); `GET /api/cron/tick` (constant-time `Bearer $CRON_SECRET`, 401 when unset or wrong, answers 202 at once and counts the tick); `embarko.json` with one `*/5 * * * *` schedule (`/api/cron/tick`, Asia/Kolkata); `scripts/embarko-deploy.sh` (from Curevia, tests excluded from the upload); `scripts/check-node20.mjs` (fails the build if any locked package's `engines.node` rejects 20.20.2; runs first in `npm run build`); `.gitignore` (added before anything was installed).

**Files.** `package.json`, `package-lock.json`, `tsconfig.base.json`, `backend/tsconfig.json`, `backend/src/{server,app}.ts`, `backend/src/db/{open,migrate,counters}.ts`, `backend/src/jobs/tick.ts`, `backend/src/lib/paths.ts`, `database/migrations/0001_spike_counters.sql`, `frontend/{index.html,vite.config.ts,tsconfig.json,src/{main,App}.tsx,src/styles.css}`, `vitest.config.ts`, `tests/spike.test.ts`, `scripts/{embarko-deploy.sh,check-node20.mjs}`, `embarko.json`, `.env.example`, `.gitignore`.

**Decisions / changes to the blueprint.**
- **vitest pin changed from `^3.2` to `^4.1.12`**: 3.x pulls `tinypool`/`@vitest/mocker` versions with npm-audit advisories (2 critical, 1 moderate); 4.1.12 fixes them and its `engines.node` is `^20 || ^22 || >=24`. Vitest 5 is still excluded (Node 22+). `npm audit` now reports 0 vulnerabilities. (`docs/architecture.md` section 6 updated.)
- `@types/node` is `^20` (matches the runtime); `@types/better-sqlite3` is `^7.6.13` (9.x is not a match for the 12.x runtime API line we use).
- The migration runner locates `database/migrations/` by walking up to `package.json`, so it works both from `backend/src` (tsx) and `build/backend/src` (compiled).
- Build tools and `typescript` are in `dependencies` (runbook 5.D); proven with `npm ci --omit=dev && npm run build`.
- `check-node20.mjs` had two parser bugs while being written (spaces in `>= 18`, wildcard `20.x`); fixed, and checked with a negative case that a Node-22-only package fails the script.

**Tests run (all under Node 20.20.2 from `npm i node@20.20.2`, not the sandbox's 22).**
- Clean checkout from `git archive HEAD`: `npm ci` → `npm run build` → `npm test`: build ok, **8 of 8 tests pass** (migration idempotent + checksum-mismatch refusal, `/healthz`, counter survives reopening the database, JSON 404, cron 401 without or with a wrong secret and when `CRON_SECRET` is unset, cron 202 records the tick, strict bearer matching).
- Production-style install: `npm ci --omit=dev` then `npm run build` ok; `vite` and `tsc` present.
- Ran the compiled server with `npm start`: log line `listening on 0.0.0.0:PORT | node 20.20.2 | db <DATA_DIR>/zentro.db | migrations applied 1/1`; `/healthz` ok; visits 1 then 2; tick 401/401/202; `/` 200, a deep link 200 (SPA fallback), unknown `/api/x` JSON 404; **stopped and restarted the process: the counter stayed at 2 and the migration reported 0/1 applied**.
- Real Chromium (Playwright) loaded the page: shows `20.20.2 OK (20.x)`, version, database path, visit counter; reload raised the counter 1 → 2; no console or page errors.
- `DRY_RUN=1 scripts/embarko-deploy.sh zentro`: archive is 25 files / 56 KB; no `.env`, `node_modules`, `dist`, `data` or `.git`; `package.json` and `package-lock.json` at the root.

**DEPLOY_TOKEN check (honest result).** `DEPLOY_TOKEN` is set in this environment (68 characters; never printed). It could **not** be proven valid or invalid by a read-only call: `ship.embarko.ai` is a proxy-authenticated host in this session, and the API answered the **same** `404 app_not_found` ("No app named zentro that this Embarko key can reach") for the real token, a deliberately bogus token and no token at all. So the session proxy supplies its own credential, which the API accepts (it was not a 401). The real proof is the upload reply: it must show `"claimed":true` and `"kind":"service"`. If it shows `claimed:false` or 401, request a new deploy token for the owner's email and wait for the owner to add it in the environment settings (never in chat).

**Not done / incomplete.** Not deployed; not claimed; `appId` not yet in `embarko.json`; live checks (Embarko "Scheduled jobs" shows the tick with outcome ok; the counter after a redeploy) cannot be verified until the deploy. No backups exist on Embarko, so the spike's counter is disposable.

**Live checklist for the owner (after deploy).**
1. Open the live link: the page shows app `zentro`, a Node version starting `20.`, a database path under the data folder, and a visit counter.
2. Reload twice: the counter goes up by 1 each time.
3. Open `/healthz`: `{"ok":true,...,"node":"20.x.x"}`.
4. Claim the app in the Embarko dashboard (schedules need a kept app), wait up to 5 minutes, then open **Scheduled jobs**: the `zentro tick` shows outcome ok; reload the page: "Scheduled ticks" is at least 1.
5. Redeploy (I do this when you say so) and reload: the counter continues from where it was.

**Exact next step.** After "yes, deploy": deploy, record `appId` and the live URL here, run the checklist, tick 1.1. Then stage 1.2 in a new session.

### Stage 1.1 deploy record (2026-11-21)
- Owner said "yes, deploy". `scripts/embarko-deploy.sh zentro` uploaded version `5440c31` (37 files, 160 KB): reply `claimed:true`, `kind:service`, action `created`, name `zentro` was free (no need for `zentro-ankita`). Build succeeded on Embarko; **live reported Node 20.20.2** (`/healthz` and the page).
- The deploy token worked, so no new token was requested. (Earlier read-only probing could not tell, as the proxy supplies its own credential; the upload reply is the real proof.)
- Live checks I ran: `/` 200; `/healthz` `{"ok":true,"version":"5440c31","node":"20.20.2"}`; database path `/data/zentro.db`; `/api/cron/tick` without a secret 401. Ran the schedule once through Embarko's run-schedules API: **outcome ok, HTTP 202, 58 ms**, and the page's tick counter went 0 → 1.
- Not yet verified: the counter surviving a *redeploy* (the next deploy, which will also ship `appId` in `embarko.json`, is the test: note the counter, redeploy, reload); the automatic 5-minute schedule (only the manual run was exercised); the app being listed in the owner's dashboard (the `claimed:true` reply says it is).
- Owner dashboard (App setup / env vars): `https://embarko.ai/app/projects/cmwq8dc5l047m7p7fwgtufeuu/environment` (pattern from the runbook; not opened by me, login required).
- **Redeploy test (owner said "redeploy now, counter was 7")**: before: visits 7, ticks 3, version `5440c31`. Redeployed `f3fca7d` (reply `action: updated`, `claimed:true`); after: **visits 7, ticks 3** (same last tick time), version `f3fca7d`, Node 20.20.2, database `/data/zentro.db`. So **the database survives a redeploy**. Ticks 3 at that time (1 manual + 2 automatic) shows the 5-minute schedule fires by itself; the owner was also to check Embarko's Scheduled jobs page (not seen by me).
- 1.1 is done. Nothing merged to `main` yet: the owner must approve the merge of `claude/stage-1-1`. Stage 1.2 starts in a new session from `main`.


---

## Stage 1.2: backend foundation (built and tested, NOT deployed)

**Implemented** (branch `claude/stage-1-2`, commit message starts "Stage 1.2"; design notes in `docs/architecture.md` section 8.1):
- **Config validation + holding page.** Required: `SESSION_SECRET`, `ENCRYPTION_KEY` (each at least 32 characters, different). Optional and validated if set: `APP_URL`, `LOG_LEVEL`, `TRUST_PROXY`. If anything is missing or invalid the server **still listens** in holding mode: the site address shows a plain notice, every `/api/*` answers `503 server_missing_settings` with `Server is missing: SESSION_SECRET` (names only; a bad value is never echoed), `/healthz` answers `ok:true, ready:false`, the cron route authenticates and does nothing, and **the database is not opened**.
- **Error envelope, request ids, logger.** `{data, meta.requestId}` / `{error:{code,message,details?}, meta.requestId}`; `X-Request-Id` on every answer; JSON logs with the route *pattern* only; sensitive field names redacted; unexpected errors become a generic 500 and log only the message. Malformed JSON → 400 `invalid_json`; body over 100 KB → 413.
- **Route registry with permission markers.** `public` (needs a written reason) / `cron` / `baseline` / `permission(key)`, Zod validation, boot-time check that nothing bypasses the registry. Until sessions exist (2.1) `baseline` and `permission` routes fail closed (401).
- **Tenant-scoped data layer + SQL lint + strict mode.** `createTenantDb(db, ctx)` binds `@organization_id` from the session context only; strict mode (tests, or `ZENTRO_STRICT_TENANT=1`) lints every statement and checks every returned row. Tests also enforce: SQL only in `db/` and `modules/*/repositories/`, and every table in a migration has `organization_id` or is on the explicit global list.
- **Migrations.** Checksums verified *before* anything runs; consistent copy (`VACUUM INTO`) to `$DATA_DIR/backups/pre-NNNN-<time>.db` before applying to an existing database, newest 3 kept; reports migrations the database has but the code does not.
- **Job registry + `scheduled_job_runs`** (migration `0002`): one tick at a time, 200 s budget, stale-tick limit 10 min, per-job `minIntervalSeconds`, rows for the tick and every job, interrupted rows marked failed. Jobs: `platform.heartbeat` (keeps the 1.1 "Scheduled ticks" counter alive), `platform.housekeeping` (daily, prunes runs older than 30 days).
- **`/healthz`** now shows `migrations: {applied, total}`, `lastTick`, `node`, `memoryMb`, `ready`. No paths, no secrets.
- Field encryption helper (AES-256-GCM, key derived from `ENCRYPTION_KEY`), unused by data until stage 8.
- Vitest harness: `tests/helpers/app.ts` (temp database, fake secrets, captured log lines), `npm run typecheck` (backend and tests).
- The 1.1 spike page and routes stay (now in the envelope) until 1.3 replaces them.

**Files.** New: `backend/src/{config/{env,holding}.ts, http/{envelope,errorHandler,registry,requestId,requestLog,spa}.ts, db/{health,jobRuns,sqlLint,tenant}.ts, jobs/{index,registry}.ts, jobs/jobs/{heartbeat,housekeeping}.ts, lib/{crypto,errors,ids,logger}.ts, routes/{spike,system}.ts}`, `database/migrations/0002_scheduled_job_runs.sql`, `tests/{config,crypto,foundation,holding,http,jobs,layering,migrate,registry,sqllint,tenant}.test.ts`, `tests/helpers/app.ts`, `tests/tsconfig.json`. Changed: `backend/src/{app,server}.ts`, `backend/src/db/migrate.ts`, `backend/src/jobs/tick.ts`, `frontend/src/App.tsx` (reads the envelope), `package.json` (+`zod ^4.6.7`, `typecheck` script, version 0.1.2), `.env.example`, `docs/{architecture,api-documentation,database-design}.md`. Removed: `tests/spike.test.ts` (its cases moved into `foundation.test.ts` and `migrate.test.ts`).

**Decisions / changes to the blueprint.**
- **`ENCRYPTION_KEY` is any long random string (>= 32 characters), not exactly "32 random bytes base64"**: the AES key is derived with HKDF-SHA256. Reason: the owner has no code editor and types it by hand; same strength. (`docs/architecture.md` section 11 updated.)
- **`APP_URL` is optional in 1.2** (required from 2.1) so this stage needs only the two secrets the owner agreed to type. `NODE_ENV` is not required either.
- **Holding page returns HTTP 200 at the site address** (the notice) while `/api/*` returns 503: a 200 root cannot make the platform think the process is unhealthy; `/healthz` says `ready:false`.
- `scheduled_job_runs.organization_id` has **no foreign key** (operational log; SQLite cannot add one later without a table rebuild).
- `REGISTRATION_MODE` / `REGISTRATION_CODE` are **not** read yet; they arrive in 2.1, so the owner is not forced to set them now.
- The layering test found two real slips while I wrote it (a `prepare` in a route file, a regex `.exec` false positive); fixed (SQL moved to `db/health.ts`, test pattern tightened).

**Tests run (all with a real Node 20.20.2 from `npm i node@20.20.2`, not the sandbox's 22).**
- Clean checkout from `git archive HEAD` (committed state): `npm ci` → `npm run build` (check-node20: 248 packages accept 20.20.2; tsc; Vite) → `npm run typecheck` → `npm test`: **11 files, 78 of 78 tests pass**. `npm ci --omit=dev` + build ok; `npm audit`: 0 vulnerabilities.
- Compiled server (`node build/backend/src/server.js`): **holding mode** with no secrets (`/` shows "Server is missing: SESSION_SECRET, ENCRYPTION_KEY", `/api/*` 503 with the same sentence, `/healthz` `ready:false`, tick 401 without a secret and 202 with it, no database file created); **normal mode** with temporary random local secrets (`/healthz` migrations 2/2, tick 202 then `lastTick` set, visit counter, SPA fallback 200, JSON 404); stop and restart: data persisted. The log contained neither secret.
- Real Chromium: the holding page text is correct; the normal page loads with no console or page errors.
- `DRY_RUN=1 scripts/embarko-deploy.sh zentro`: archive has no `.env`, `node_modules`, `dist`, `data` or `.git`.

**Embarko state before deploying 1.2** (checked with `read_app`, names only): env vars set are `CRON_SECRET` and `STORAGE_TOKEN` (Embarko's own). `SESSION_SECRET` and `ENCRYPTION_KEY` are **not set**, so the first deploy of 1.2 will correctly show the holding page until the owner types them and presses Apply changes.

**Where the secrets page is (from Embarko's docs, `docs/env-vars.md` and `docs/quickstart.md`).** Open `https://embarko.ai/app`, choose the app `zentro`, open its **App setup** tab, add the name and value, save, then press **Apply changes** (saving alone only stores; Apply restarts the app without a rebuild). The deep link `https://embarko.ai/app/projects/<project-id>/environment` that I gave earlier is only a URL pattern from the docs (which say no reply contains it ready-made) and it redirected to the app overview, so use the `https://embarko.ai/app` route instead. I cannot open the dashboard (login), so the exact button wording beyond "App setup" and "Apply changes" is from the docs and the HireDrive runbook.

**Not done / incomplete.** Not deployed, so the live checks below are not yet run on the live link. Not built (by design, later stages): sessions and real guards (2.1/2.3), real repositories (first module), the route-table-vs-docs diff script, nightly snapshot and export (9.4), the System panel.

**Live checklist for the owner (after "yes, deploy").**
1. Open https://zentro.embarko.app: the **holding page** "Zentro is almost ready: Server is missing: SESSION_SECRET, ENCRYPTION_KEY".
2. Open `/healthz`: `"ready":false` and `"missing":["SESSION_SECRET","ENCRYPTION_KEY"]`. Open `/api/anything`: the 503 with `Server is missing: ...`.
3. On Embarko: `https://embarko.ai/app` → `zentro` → **App setup**: type `SESSION_SECRET` and `ENCRYPTION_KEY` yourself (long random, different), save, press **Apply changes**. Wait about a minute.
4. Reload the site: the stage 1.2 page shows (Node 20.x, visit counter continues from before). `/healthz` shows `"ready":true`, `"migrations":{"applied":2,"total":2}`, and after the next 5-minute tick a `lastTick` time.
5. Embarko **Scheduled jobs** still shows `zentro tick` ok. (Optional, for me: the app log line `preMigrationCopy` shows a copy of the 1.1 database was taken before migration 0002.)

**Exact next step.** Show the owner these results; on "yes, deploy": push the branch, run `scripts/embarko-deploy.sh zentro`, run the live checklist (holding page first), then the owner types the secrets; record the result here and tick 1.2. Merge to `main` only with the owner's approval. Then stage 1.3 in a new session.
