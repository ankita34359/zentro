# Zentro: Progress

Resume file. A fresh session should be able to continue from this page alone, plus `ZENTRO_MASTER_PROMPT.md` (source of truth; its "Showcase overrides" section wins) and `docs/`.

Last updated: 2026-11-22 · Stage 2.1 complete and merged · Stage 2.2 (reset and invitations) complete (owner-verified live on `fe85552`) and merged to `main` (PR #8, `8ebb100`) · next stage 2.3 awaiting the owner's approval of the plan · Blueprint approved · Stages 1.1, 1.2, 1.3, 1.4 and 1.5 (performance hygiene, added at the owner's request) complete; live on `dfc4401`; 1.5 merged to `main`. Stages 1.1 to 1.4 complete (Milestone 1 done, including the owner-requested 1.4 visual design and motion with the Aurora indigo colour refresh) · next stage 2.1 not started · live at https://zentro.embarko.app

---

## Current status

**Stage 1.1 (deploy spike) is DEPLOYED** as app `zentro` (kind `service`, `claimed: true`): **https://zentro.embarko.app** (app id `cmwq8dc5l047m7p7fwgtufeuu`, now in `embarko.json`; now on version `f3fca7d`). Branch `claude/stage-1-1` is pushed; nothing merged to `main` (ask first).

Stage 1.1 is complete and live-checked and is merged into `main` (pull request #2).

**Stage 1.2 (backend foundation) is complete and live** (version `6fc8aac`, checked by the owner: `/healthz` ready, migrations 2 of 2, `lastTick` shows). It is merged into `main` by pull request (owner-approved). `SESSION_SECRET` and `ENCRYPTION_KEY` are set on Embarko (see "Secrets set" below). **Stage 1.3 (frontend foundation) is complete and live** (version `d128fc5`, checked by the owner) and merged into `main` by pull request (owner-approved). **Milestone 1 (Foundation) was done at 1.3.** The owner then added **stage 1.4 "Visual design and motion (added at the owner's request)"** because the UI felt dull: it is built, tested and **deployed** (live version `81f6d5c`) from branch `claude/stage-1-4` (from `main` at `4641378`), frontend only, **not merged**; details in "Stage 1.4" below. After 1.4 the next stage is **stage 2.1** (auth core) in a new session from `main`; not started (it needs the owner to type `REGISTRATION_CODE`). First small backend follow-up to fold in: log requests that match no route (static files, app shell) at `debug` (see the 1.3 deploy record). Details in "Stage 1.3" below. Details in "Stage 1.2" below. Stage 1.3 (frontend foundation) has not been started.

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
| 3 | Registration mode on the live link | **`code`**: registration needs a registration code (re-confirmed at the start of 2.1) | Implemented in 2.1: `REGISTRATION_MODE=code` with `REGISTRATION_CODE` (at least 8 characters, set on Embarko through the env-vars API at deploy time). **Fail closed**: unset, wrong or incomplete means registration is refused with one generic message; the site never goes into holding mode because of it, and existing logins keep working. (Replaces "default to `code` when unset".) |
| 4 | viaSocket credentials | **The owner's own `VIASOCKET_*` keys typed on Embarko, as in Curevia** | Do not use Embarko's Integrations capability. Read `VIASOCKET_ORG_ID`, `VIASOCKET_PROJECT_ID`, `VIASOCKET_EMBED_SECRET`; the `INTEGRATIONS_*` fallback stays unused |
| 5 | Evidence files | **Private storage in the database** | D11 confirmed: capped BLOBs (2 MB per file, 100 MB per organization) behind the authenticated download route; no Embarko public file links |
| 6 | View as demo persona | **Yes**: read-only, demo users only, bannered and audited | Build in stage 2.8 as specified in `docs/permission-model.md` section 6, item 7 |
| 7 | What the AI sees | **Aliases**, with real names allowed for the fictional demo | `AI_REDACTION=refs` is the default; `names` allowed for the demo company (`docs/agent-specifications.md` section 2) |
| 8 | Platform email flow | ~~**Yes**: the owner will build one viaSocket "send email" flow at stage 2.2~~ **Changed at the start of 2.2: not now.** No email is built or sent in 2.2; administrators copy links; the outbox and email arrive in stage 8 through one marked plug-in point (`modules/auth/delivery.ts`). Original answer: | Stage 2.2 should wire `VIASOCKET_EMAIL_FLOW_URL` (an Embarko secret the owner types) for password reset and invitation emails, with the admin-copied-link fallback kept. Earlier than the blueprint's stage 8 timing, so the owner needs the viaSocket keys (question 4) by 2.2 |
| 9 | Embarko app name and deploy token | App name **`zentro`**; if taken, **`zentro-ankita`**. The owner puts the deploy token on the machine as **`DEPLOY_TOKEN` in the environment settings**, never in chat | Use `scripts/embarko-deploy.sh <app-name>` (reads `DEPLOY_TOKEN`). Never print the token. On `409 app_name_taken` use `zentro-ankita`, then tell the owner which name is live |
| 10 | Source of `ViaSocketActionEmbed` / `useGetViaSocketEmbedToken` | **Nowhere**: they appeared only in the master prompt | Use our own `<ViaSocketEmbed>` and `useViaSocketEmbedToken` over the documented script embed (`docs/viasocket-integration.md` section 1). Still re-run `check:viasocket` at 8.1 |

## Stage checklist (details in `docs/milestones.md`)

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and live-checked.

**M1 Foundation** · `[x]` 1.1 Deploy spike (live, checked by the owner and by me) · `[x]` 1.2 Backend foundation (live, checked by the owner) · `[x]` 1.3 Frontend foundation (live, checked by the owner) · `[x]` 1.4 Visual design and motion (added at the owner's request; live on `fce10f1`, checked by the owner) · `[x]` 1.5 Performance hygiene (added at the owner's request; live on `dfc4401`, checked by the owner)

**M2 Auth and organization** · `[x]` 2.1 Auth core (live on `ea52494`, checked by the owner) · `[x]` 2.2 Reset and invitations (live on `fe85552`, checked by the owner) · `[ ]` 2.3 RBAC engine · `[ ]` 2.4 Roles UI · `[ ]` 2.5 Organization structure · `[ ]` 2.6 People and reporting · `[ ]` 2.7 Organization chart · `[ ]` 2.8 Demo data framework

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
| 2026-11-21 | 1.4 complete | The owner confirmed the live checks passed for the design/motion stage and the Aurora indigo colour refresh. Ticked. Pull request `claude/stage-1-4` → `main` opened and merged with the owner's explicit approval. No further stage started. |
| 2026-11-21 | 1.4 colour refresh deployed | Owner said "yes, deploy". Uploaded `fce10f1` (99 files): `action: updated`, `claimed:true`, build success, live. Live checks passed (see "Colour refresh deploy record"). Not ticked; not merged. |
| 2026-11-21 | 1.4 colour refresh built | The owner found the colours still dull and asked me to choose a direction: "Aurora indigo". Frontend only, same branch `claude/stage-1-4`. 163 tests pass on Node 20.20.2 from a clean checkout; contrast measured from real pixels. **Not deployed, not merged.** Details in "Stage 1.4 colour and depth refresh" below. |
| 2026-11-22 | 2.2 built | Branch `claude/stage-2-2` from `main` (`f3b361d`, contains stage 2.1 / PR #7). Reset and invitations built and tested on Node 20.20.2. **Not deployed, not merged.** Waiting for "yes, deploy". Needs nothing from the owner. Details in "Stage 2.2" below. |
| 2026-11-22 | 2.1 built | Branch `claude/stage-2-1` from `main` (`bf1b2bf`, contains stage 1.5 / PR #6). Auth core built and tested on Node 20.20.2. **Not deployed, not merged.** Waiting for "yes, deploy"; then I ask once for the registration code. Details in "Stage 2.1" below. |
| 2026-11-22 | 1.5 built | Owner added stage **1.5 "Performance hygiene (added at the owner's request)"**: compression, cache headers, quiet logs, idle prefetch. Branch `claude/stage-1-5` from `origin/main` (`6024888`). 185 tests pass on Node 20.20.2. Details in "Stage 1.5" below. |
| 2026-11-21 | 1.4 deployed | Owner said "yes, deploy". Uploaded `81f6d5c` (98 files): `action: updated`, `claimed:true`, build success, live. Live checks passed (see "Stage 1.4 deploy record"). Not ticked until the owner confirms; not merged. |
| 2026-11-21 | 1.4 added and built | The owner asked for a new stage 1.4 "Visual design and motion" (the UI felt dull). Recorded in `docs/milestones.md` and here. Branch `claude/stage-1-4` from `main` (`4641378`). Frontend only. 156 tests pass on Node 20.20.2 from a clean checkout; checked in real Chromium. **Not deployed.** Details in "Stage 1.4" below. |
| 2026-11-21 | 1.3 complete | The owner confirmed the live checks passed. Ticked. Pull request `claude/stage-1-3` → `main` opened and merged with the owner's explicit approval. Milestone 1 done. Nothing further started. |
| 2026-11-21 | 1.3 deployed | Owner said "yes, deploy". Uploaded `d128fc5` (85 files): `action: updated`, `claimed:true`, build success, live. Live checks passed (see "Stage 1.3 deploy record"). Not ticked until the owner confirms; not merged. |
| 2026-11-21 | 1.3 built | Branch `claude/stage-1-3` (from `main` after the 1.2 merge). Frontend shell built, spike page removed; 125 tests pass on Node 20.20.2 from a clean checkout; checked in real Chromium at desktop and phone width, light and dark. **Not deployed.** Details in "Stage 1.3" below. |
| 2026-11-21 | 1.2 complete | Secrets set through the env-vars API; the owner confirmed `/healthz` ready, migrations 2 of 2 and `lastTick`. Ticked. Pull request `claude/stage-1-2` → `main` opened and merged with the owner's explicit approval. Stage 1.3 deliberately not started. |
| 2026-11-21 | 1.2 deployed | Owner said "yes, deploy". `scripts/embarko-deploy.sh zentro` uploaded `6fc8aac` (60 files): `action: updated`, `claimed:true`, build success, status live. Live probe: holding page, `/healthz` `ready:false` with the two names, `/api/*` 503, tick 401 without a secret; the app log shows `holding mode` on Node 20.20.2. Waiting for the owner to type the secrets. |
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

## Stage 1.2: backend foundation (complete, live)

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

### Stage 1.2 deploy record (2026-11-21)
- Owner said "yes, deploy". Uploaded version `6fc8aac` (60 files, 180 KB) to `zentro`: `action: updated`, `claimed:true`, `kind:service`, build success, **status live**. Same app id; the database from 1.1 is untouched (holding mode does not open it).
- Live checks I ran (no secrets were set yet, so holding mode is the expected result): `/` 200 with "Server is missing: SESSION_SECRET, ENCRYPTION_KEY"; `/healthz` `{"ok":true,"ready":false,"version":"6fc8aac","node":"20.20.2","migrations":null,"missing":[...]}`; `/api/anything` 503 `server_missing_settings`; `/api/cron/tick` 401 without a secret. Embarko log: `holding mode` warning, Node 20.20.2, no restarts.
- **Not yet verified (needs the owner's secrets):** normal mode live, `migrations 2/2`, the pre-migration copy of the 1.1 database (log field `preMigrationCopy` at the first normal start), `lastTick`, and the heartbeat counter. The 5-minute ticks do nothing while in holding mode.
- 1.2 is ticked only after the owner types the secrets, presses Apply changes, and these checks pass.

### Secrets set (2026-11-21)
- The owner could not find Embarko's App setup page (screens changed) and asked me to set the two secrets through the env-vars API (`PUT /api/apps/zentro/env-vars`, `apply: true`, as documented in `docs/env-vars.md`). I generated each with `openssl rand -hex 32` (64 hex characters, different from each other) into shell variables and sent them on stdin; the values were never printed, logged, stored in the repo or read back. Only those two keys were sent; `CRON_SECRET` and `STORAGE_TOKEN` were not touched. Reply: HTTP 202.
- Because the values were never shown to anyone, **the owner does not know them**. That is fine for `SESSION_SECRET` and `ENCRYPTION_KEY` (the app is the only user). Consequence for later: if they are ever lost, set new ones the same way; a new `SESSION_SECRET` signs everyone out and a new `ENCRYPTION_KEY` makes already-encrypted values unreadable (nothing is encrypted yet).
- Names set on the app now: `CRON_SECRET`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `STORAGE_TOKEN`.
- Live after Apply: `/healthz` `ready:true`, `migrations {applied:2,total:2}`, version `6fc8aac`; the site no longer shows the holding page. For a few seconds while Embarko swapped instances, one probe still hit the old (holding) instance; repeated probes afterwards were all ready.
- Still to confirm: a `lastTick` after the next 5-minute tick, the tick counter on the page, and Embarko's "Scheduled jobs" showing ok. Then tick 1.2.

### Stage 1.2 closed (2026-11-21)
- Owner reported all live checks passed: `/healthz` ready, 2 of 2 migrations, `lastTick` shown. Stage 1.2 ticked.
- Owner approved this one merge: `claude/stage-1-2` → `main` by pull request. Nothing else merged. Exact next step: stage 1.3 (frontend foundation) in a new session from `main`: Tailwind 4 + shadcn/ui shell, router, AppShell with the eleven sidebar items, light/dark theme, API client that reads the error envelope, error/loading/empty primitives, `public.ts` config; it also replaces the 1.1 spike page and removes the two spike routes and the `platform.heartbeat` job.

---

## Stage 1.3: frontend foundation (complete, live)

**Implemented** (branch `claude/stage-1-3`; design notes in `docs/frontend-structure.md` section 10):
- **Tailwind 4 + shadcn-style shell.** Design tokens for light and dark (CSS variables, `.dark` class), self-hosted Inter, hand-copied primitives (`Button`, `Card`, `Badge`, `Skeleton`, slide-in `SheetLeft` on Radix Dialog).
- **AppShell.** Fixed sidebar from 1024 px, slide-in sheet below it; header with the server status pill and the theme toggle; skip link; focus moves to the page after navigation; document title per page; focus returns to the menu button after Escape.
- **Sidebar with all eleven items** in master section 18 order (`frontend/src/routes/navigation.ts`), each with the permission key it will need later (all shown until sessions exist).
- **Router.** React Router 7: `/` → `/overview`; one lazy page per section; `/<section>/*` stays inside its section; unknown address → "Page not found" inside the shell.
- **Placeholders, honest and real-data-only.** Overview = "Getting started" steps (each shows the stage that builds it) + a live "Server status" card from `/healthz` (status, version, migrations x of y, last tick). Other sections show the empty-state wording from the docs and a "Planned for stage N" badge. No numbers, no sample data. AI says "AI is not configured".
- **Theme.** Light/dark toggle; follows the OS until a choice is made; stored in `localStorage` inside try/catch; applied before first render.
- **API client.** Reads the envelope into a typed `ApiError` (api, bad_response, network), survives non-JSON proxy pages, `notConfigured()` helper, 401 hook for stage 2.1. `useHealth` (TanStack Query) over `/healthz`.
- **Primitives:** `EmptyState`, `ErrorState` (message + request id + retry; never prints an unexpected error's text), `PageSkeleton`, `PageHeader`, `StatusPill`.
- `frontend/src/config/public.ts` (non-secret constants only).
- **Spike removed**, as PROGRESS.md said: the 1.1 page, `GET /api/spike`, `POST /api/spike/visit`, the `platform.heartbeat` job and `db/counters.ts`. The `spike_counters` table stays one more release (a rollback to 1.2 still reads it) and is dropped by a later migration. The tick now runs only `platform.housekeeping`.

**Files.** New: `frontend/src/{config/public.ts, lib/{cn,safeStorage}.ts, contexts/ThemeContext.tsx, services/{api,system}.ts, hooks/useHealth.ts, components/ui/*.tsx (5), components/common/*.tsx (7), layouts/{AppShell,SidebarNav}.tsx, routes/navigation.ts, pages/{OverviewPage,SectionPage,NotFoundPage}.tsx, pages/sections.ts, vite-env.d.ts}`, `frontend/public/favicon.svg`, `tests/frontend/{setup.ts,helpers.tsx,navigation,theme,api,components,safety}.test.*`. Changed: `frontend/{index.html,vite.config.ts,tsconfig.json,src/{App,main}.tsx,src/styles.css}`, `backend/src/{app,server}.ts`, `backend/src/jobs/index.ts`, `backend/src/db/sqlLint.ts` (comment), `vitest.config.ts`, `tests/{foundation,jobs,registry}.test.ts`, `tests/helpers/app.ts`, `tests/tsconfig.json`, `package.json` (version 0.1.3, `typecheck` now covers the frontend), `package-lock.json`, docs (`architecture`, `api-documentation`, `database-design`, `frontend-structure`, `known-limitations`). Removed: `backend/src/{routes/spike,jobs/jobs/heartbeat,db/counters}.ts`.

**Decisions / changes to the blueprint.**
- **React Router pinned to `^7.18`**: `react-router@8` needs Node >= 22.22 (it would have broken the build on Embarko's Node 20). Docs said 7 already.
- **Test tooling for Node 20:** `jsdom ^28.1` (29+ needs Node 22); **no `@testing-library/jest-dom`** (its 6.x and 8.x need Node >= 22), tests use plain DOM assertions. `npm run check:node20` passes (372 packages).
- **shadcn components are hand-copied**, not generated by the CLI (no network-dependent dev tool); only the five primitives this stage needs.
- **Theme toggle has two states** (light and dark), not three; it follows the OS until the first click.
- **Unknown web addresses return HTTP 200** (the app shell) and show the 404 page client-side; unknown `/api/*` still returns a real 404 (listed in `docs/known-limitations.md`).
- Nothing in this stage needs a secret or a setting from the owner.

**Tests run (real Node 20.20.2 from `npm i node@20.20.2`, not the sandbox's 22).**
- Clean checkout from `git archive HEAD` (committed state): `npm ci` → `npm run build` (check-node20 ok; tsc; Vite; main bundle 382 KB, **122 KB gzipped**, pages are separate small chunks) → `npm run typecheck` (backend, frontend, tests) → `npm test`: **16 files, 125 of 125 tests pass** (77 backend; 48 frontend: navigation, focus, routes, 404, theme, API client, components, safety rules). `npm ci --omit=dev` + build ok; `npm audit`: 0 vulnerabilities.
- Real Chromium against the compiled server (also against the clean build): Overview, OKRs and the 404 page at **desktop 1280x800 and phone 390x844, in light and dark**; no horizontal overflow; correct titles; no console or page errors; phone menu opens, closes on choosing a page and on Escape (focus returns to the button); keyboard: first Tab is "Skip to content", focus lands on `main` after navigation; theme toggles and survives a reload; OS dark-mode change is followed until a choice is made; deep link `/kpis` loads; `/healthz` blocked shows the Offline pill and the error state with retry; holding-mode health shows "Setup incomplete".
- **Contrast measured in the browser** (every visible text element, light and dark, three pages): all pass AA; smallest ratio 6.12 (light) and 7.12 (dark) against a 4.5 requirement.
- `DRY_RUN=1 scripts/embarko-deploy.sh zentro`: 85 files, 212 KB; no `.env`, `node_modules`, `dist`, `data` or `.git`.

**Not done / incomplete.** Not deployed, so the live checks below have not run on the live link. Not built (later stages): auth context and route guards, organization switcher, date-range filter, notifications bell, toasts, data table and confirm dialog primitives, charts, an automated axe accessibility pass (planned M9; this stage used the contrast measurement and a keyboard pass).

**Live checklist for the owner (after "yes, deploy").** On https://zentro.embarko.app:
1. Open the site: the Zentro shell with the eleven sidebar items, the green **Online** pill, and the Overview with "Getting started" and a **Server status** card (Ready, version, migrations 2 of 2 applied, last tick).
2. Click the moon icon (top right): dark mode; reload: it stays dark. Click again: light.
3. Click through the sidebar items: each shows a page with a "Planned for stage N" note.
4. Type a wrong address such as `/nothing-here`: "Page not found" with a button back to Overview.
5. Make the browser window narrow (or open on your phone): the sidebar becomes a menu button at the top left; it opens a panel and closes after you pick a page.
6. `/healthz` still shows `"ready":true` and 2 of 2 migrations. The old visit-counter page is gone (intended).

**Exact next step.** Show the owner these results; on "yes, deploy": push the branch, run `scripts/embarko-deploy.sh zentro`, run the live checklist, record the result here and tick 1.3. Merge to `main` only with the owner's separate approval. Then stage 2.1 (auth core; needs `REGISTRATION_CODE` typed by the owner) in a new session.

### Stage 1.3 deploy record (2026-11-21)
- Owner said "yes, deploy". `scripts/embarko-deploy.sh zentro` uploaded `d128fc5` (85 files, 212 KB): `action: updated`, `claimed:true`, `kind:service`, build success, status live; no restarts in the Embarko task events.
- Live checks I ran: `/healthz` `{"ok":true,"ready":true,"version":"d128fc5","node":"20.20.2","migrations":{"applied":2,"total":2},"lastTick":{...,"status":"ok"}}` (the app kept its secrets and database across the deploy; the automatic tick was running); `/`, `/overview`, `/okrs` and an unknown address `/nothing-here` answer HTTP 200 with the app shell (expected, see known-limitations); `/favicon.svg` 200; `/api/spike` is now a real JSON 404 (spike removed); `/api/cron/tick` 401 without a secret. The same real-Chromium scripts used before the deploy, pointed at the live URL: desktop and phone, light and dark: no horizontal overflow, correct titles, phone menu closes on choosing a page, theme toggle survives a reload, no console or page errors, text contrast minimum 6.12 (light) / 7.12 (dark).
- **Follow-up noticed on the live log (not fixed, to avoid a redeploy without approval):** every static file request (JS, CSS, fonts) is logged at `info` with route `unmatched`, which will crowd Embarko's ~8 KB recent-log window once there is real traffic. Fix in the next stage that touches the backend: log requests that match no route (static files, the app shell) at `debug`, and keep `info` for API routes and errors.
- Not yet verified by the owner: the live checklist in the stage section above. 1.3 is ticked only after that, and merged to `main` only with a separate approval.

### Stage 1.3 closed (2026-11-21)
- Owner reported all live checks passed. Stage 1.3 ticked; Milestone 1 (1.1 to 1.3) is complete.
- Owner approved this one merge: `claude/stage-1-3` → `main` by pull request. Nothing else merged or deployed.
- Exact next step: stage 2.1 (auth core: `users`, `sessions`, register/login/logout/me, scrypt, JWT cookie + session row, rate limits, same-origin check, create organization, onboarding page, `REGISTRATION_MODE=code` with `REGISTRATION_CODE` typed by the owner). Start in a new session from `main`. Also in that stage: demote no-route request logging to `debug`, make `APP_URL` required, drop the unused `spike_counters` table in a later migration (not in the same deploy as the code change that stops using it, which was 1.3), and replace the placeholder sidebar visibility with the real capability check.

---

## Stage 1.4: visual design and motion (added at the owner's request; complete, live)

**Why.** The owner found the 1.3 UI dull. Goal: a calm, trustworthy, data-first, professional SaaS look in light and dark, with restrained, advanced animation. **Frontend only: no backend, API, database, script or `embarko.json` change** (checked: `git diff origin/main..HEAD -- backend database scripts embarko.json` is empty).

**Implemented** (design rules and tokens are in `docs/frontend-structure.md` section 11):
- **One token file** `frontend/src/styles/tokens.css` (Tailwind 4 theme variables): palette, semantic roles for light and dark, type scale, radii, shadows, layout sizes, motion timings. Edit it to retune the whole look. `lib/motion.ts` mirrors the timings for the motion library; tests keep them in step and ban raw colours and hard-coded durations in components.
- **Palette:** indigo/violet brand (700 = the Z logo colour), one accent (orchid), cool slate neutrals, soft off-white light mode, deep navy dark mode (not black). Fixed status colours: emerald on track, amber at risk, rose off track, sky info; each with solid, soft and ink; always icon + words (`StatusBadge`).
- **Typography:** Inter variable, self-hosted from `@fontsource-variable/inter`; display/title/heading/body/label/caption/overline scale; tabular numbers for metrics.
- **Polish:** sidebar grouped (Strategy, Execution, Insight, System; all eleven items, master order) with one indicator that slides to the active item; header with a soft blur; cards with fine border, soft shadow and a gentle hover lift; gradient glow behind the Overview heading; one `PageHeader`; ten small SVG empty-state illustrations (+ compass for 404) drawn in code; refined buttons, badges, error state, skeletons; gradient Z logo.
- **Motion** (`motion` library with `LazyMotion` and `m`): page transition (fade and 8 px rise), staggered card entrance, progress ring (used for Getting started, **0 of 6**) and progress bar. CSS: card lift, sliding indicator, theme-icon morph, Online pill pulse, skeleton shimmer, slide-in phone menu with a blurred backdrop. Count-up is a small `requestAnimationFrame` tween on the same easing (motion's `animate()` cost about 13 KB gzipped on first load).
- **Motion rules** written into `docs/frontend-structure.md` section 11.5: purposeful; interface motion 150 to 350 ms, data reveals up to 700 ms; never block content or shift layout; **nothing loops except the Online pulse and the loading shimmer (only while loading)**; reduced motion fully honoured; failure-safe when the engine has not loaded.
- **Unlisted `/design` page** (not in the sidebar): palette ramps and roles, status colours, type scale, radii and shadows, buttons, badges, cards, skeleton, error and empty states, all illustrations, replayable motion samples (page transition, stagger, count-up, ring, bars), timings, and a live contrast table for the current theme. Its motion numbers are labelled as examples, not data.
- **Kept:** all stage 1.3 behaviour, the Skip to content link, keyboard access, the 404 page, the phone menu, the status pill, and all 125 earlier tests.

**Files.** New: `frontend/src/styles/tokens.css`, `frontend/src/lib/{motion,contrast}.ts`, `frontend/src/motion/{MotionProvider,features,PageTransition,Stagger,CountUp,ProgressRing,ProgressBar}`, `frontend/src/components/illustrations/index.tsx`, `frontend/src/components/common/StatusBadge.tsx`, `frontend/src/pages/DesignPage.tsx`, `tests/frontend/{tokens,design,motion-reduced,motion-not-ready}.test.*`. Changed: `frontend/src/{styles.css,App.tsx}`, `frontend/src/layouts/{AppShell,SidebarNav}.tsx`, `frontend/src/routes/navigation.ts` (groups, `titleFor`), `frontend/src/components/ui/{badge,button,card,sheet,skeleton}.tsx`, `frontend/src/components/common/{Brand,EmptyState,ErrorState,PageHeader,PageSkeleton,StatusPill,ThemeToggle}.tsx`, `frontend/src/pages/{OverviewPage,SectionPage,NotFoundPage,sections}`, `tests/frontend/helpers.tsx`, `package.json`/lock (`motion ^14.14.0`), docs (`frontend-structure` section 11, `architecture`, `milestones`).

**Decisions / changes.**
- `motion` is `^14.14.0`; `npm run check:node20` passes (376 packages).
- **Count-up is hand-rolled**, not motion's `animate()` (size). Theme-icon morph, pulse, shimmer, card lift, indicator and the phone menu are CSS (robust, no JavaScript, and they keep the main chunk small). Page transition, stagger, ring and bar use the motion library.
- **The phone menu (Radix Dialog) is its own chunk**, prefetched while idle on narrow screens and held in state (not `React.lazy`: a suspended boundary made React wait about 300 ms before showing the menu; measured 330 ms, now 22 to 32 ms).
- Renamed the shadcn-style `accent` role (it meant "subtle highlight") to `selected` / `primary-soft`; `accent` is now the real accent colour. Status classes are `on-track`, `at-risk`, `off-track`, `info` (the old `success`/`warning`/`destructive` names are gone).
- Content for a loading or failed motion engine: components render their final state (tested by blocking the chunk).
- Two real bugs found and fixed by my own measurements: (1) with reduced motion the page wrapper still showed an 8 px offset for one frame, now no transform at all; (2) the Z logo's gradient id was duplicated between the sidebar and the phone header, so on phones the hidden copy broke the logo's fill (washed out); now one id per instance, with a test. Also fixed a 16 px horizontal overflow on phones caused by the heading glow (clipped with `overflow-x: clip`).

**Tests run (real Node 20.20.2 from `npm i node@20.20.2`, not the sandbox's 22).**
- Clean checkout from `git archive HEAD`: `npm ci` → `npm run build` (check-node20 ok, tsc, Vite) → `npm run typecheck` → `npm test`: **20 files, 156 of 156 tests pass** (the 125 from 1.3 unchanged, plus 31 new: tokens, design page, status badges, illustrations, ring/bar/count-up, reduced motion, engine-not-loaded, logo). `npm ci --omit=dev` + build ok; `npm audit`: 0 vulnerabilities.
- **Contrast, measured in real Chromium on the built app:** every visible text node (1,698 text nodes: Overview, a section page, the 404 page and `/design`; desktop 1280 and phone 390; light and dark; phone menu open) **at least 4.5:1, lowest ratio 6.09** (light) and 7.27 (dark); no failures. Text over the gradient glow, sampled from real screenshot pixels behind the heading and description: **lowest 5.37**. The `/design` page's own token-pair table also shows all 16 pairs passing in both themes.
- **Bundle (gzip level 9, real first load of `/overview`):** **entry chunk 109.0 KB** (limit 150 KB); **all JavaScript fetched on first load 144.3 KB** in 8 files (this includes the 18 KB animation-engine chunk, which loads in the background right after start); CSS 8.6 KB. For comparison 1.3 was about 126 KB total. Not on the first load: phone menu 11.9 KB (idle prefetch on phones only), `/design` 5.0 KB, section and 404 pages under 2 KB each.
- **Motion, measured frame by frame in the browser (reduced motion off / on):** page transition fade about 146 ms, 8 px rise / fade only with **0 px movement in every frame**; sidebar indicator slides 12 distinct positions settling at about 215 ms / jumps instantly; card hover lift 2 px / none; looping animations present: pulse and shimmer / **none**; count-up counts through 5 values / final value in the first frame; ring arc animates through 44 steps / final at once; phone menu slides in over a `blur(4px)` backdrop in 0.35 s / fades in 1 ms; theme icon morph 0.35 s and 0.22 s / 1 ms. **Cumulative layout shift 0** in both modes.
- Real Chromium, desktop 1280x800 and phone 390x844, light and dark, reduced motion on and off: no horizontal overflow, no console or page errors. Stage 1.3 behaviours re-checked: Skip to content is the first Tab stop, focus moves to the page after navigation, Escape closes the phone menu and returns focus to its button, the theme toggles and follows the OS until a choice is made, an unreachable `/healthz` shows Offline with retry, a deep link loads.
- `DRY_RUN=1 scripts/embarko-deploy.sh zentro`: 98 files, 232 KB; no `.env`, `node_modules`, `dist`, `data` or `.git`.

**Not done / incomplete.** Not deployed, so the checklist below has not run on the live link. Not built: a user-facing choice of "system" theme (the toggle is light/dark and follows the OS until the first click), a custom 3-state theme menu, an automated axe pass (planned M9), contrast of hover states (hover only changes a background by 10% or less; the measured pairs are the resting states). The full animation engine (`domAnimation`, 18 KB gzipped) starts loading at once; it cannot delay or hide content.

**Live checklist for the owner (after "yes, deploy").** On https://zentro.embarko.app:
1. Open the site: Overview in the new look: grouped sidebar (Strategy, Execution, Insight, System), gradient Z logo, soft glow behind the heading, cards fading in one after another, a **ring showing 0/6** in Getting started, a pulsing dot in the green **Online** pill.
2. Click through the sidebar: the highlight slides from item to item; each page fades in and shows a small illustration.
3. Click the moon/sun icon: dark mode (deep navy), the icon morphs. Reload: it stays.
4. Hover a card: it lifts slightly.
5. Open `https://zentro.embarko.app/design` (not in the sidebar): palette, type scale, components, illustrations; press the **Replay** buttons for the motion samples; the contrast table at the bottom shows every pair passing.
6. Narrow the window or use your phone: menu button top left opens a panel that slides in over a blurred backdrop and closes after you pick a page.
7. Turn on your system's "reduce motion" setting (Windows: Settings > Accessibility > Visual effects > Animation effects off; macOS: Accessibility > Display > Reduce motion; iOS: Accessibility > Motion): reload. Nothing slides, lifts, counts or pulses; pages only fade.

**Exact next step.** Show the owner these results; on "yes, deploy": push the branch, run `scripts/embarko-deploy.sh zentro`, run the checklist, record the result here and tick 1.4. Merge to `main` only with the owner's separate approval. Then stage 2.1 (auth core) in a new session.

### Stage 1.4 deploy record (2026-11-21)
- Owner said "yes, deploy". `scripts/embarko-deploy.sh zentro` uploaded `81f6d5c` (98 files, 236 KB): `action: updated`, `claimed:true`, `kind:service`, build success, status live.
- Live checks I ran: `/healthz` `{"ok":true,"ready":true,"version":"81f6d5c","migrations":{"applied":2,"total":2},"lastTick":{...,"status":"ok"}}` (secrets and database kept; automatic ticks running); `/overview`, `/design`, `/okrs`, an unknown address and `/favicon.svg` answer 200 (the app shell, as designed). One probe right after the swap returned non-JSON from `/healthz` (the old instance being replaced); the next probes were fine.
- The same real-Chromium scripts used before the deploy, pointed at the live URL: **contrast** 1,698 text nodes, lowest 6.09, no failures; **text over the glow** lowest 5.37; **bundle** entry chunk 109.0 KB gzipped and 144.3 KB total JavaScript on first load, identical to the local build; **motion** with reduced motion off: page rise 8 px, indicator slides through 12 positions, card lift 2 px, pulse and shimmer running; with reduced motion on: 0 px movement in every frame, no looping animations; **cumulative layout shift 0** in both; **phone menu** opens in 26 to 27 ms; desktop and phone, light and dark, no horizontal overflow, no console or page errors; skip link, Escape focus return, theme following the OS, offline and setup-incomplete states, deep link all as before.
- **Follow-ups noticed on the live site (not fixed, to avoid a redeploy without approval):**
  1. The first visit to each section commits about 300 ms late (measured 320 ms to Leadership, then 14 to 17 ms for the next two), because React Router wraps navigation in a transition and holds the old page until that page's lazy chunk (0.3 to 2 KB) has arrived. Fix in the next frontend change: prefetch the page chunks while idle after first paint (and on link hover). The sidebar indicator, title and focus all follow the committed navigation, so they lag by the same amount on that first visit. Not visible on localhost, which is why the pre-deploy numbers were faster.
  2. Still open from the 1.3 deploy: log requests that match no route (static files, the app shell) at `debug`, not `info`.
- Not yet verified by the owner: the live checklist in the stage section above. 1.4 is ticked only after that, and merged to `main` only with a separate approval.

---

## Stage 1.4 colour and depth refresh, "Aurora indigo" (complete, live)

**Why.** The owner still found the colours dull and wanted a more vibrant, premium, professional look, and asked me to choose. Direction chosen with the owner's brief: **Aurora indigo**, confident and vivid but not neon. Frontend only (`git diff origin/main..HEAD -- backend database scripts embarko.json` is empty). Branch `claude/stage-1-4`, commit `7fe4eb1`, on top of the deployed `81f6d5c`. Rules and tokens: `docs/frontend-structure.md` section 11.

**Implemented** (almost all in `frontend/src/styles/tokens.css` and the shared components):
- **Brand gradient token** (135 degrees): indigo `#4F46E5` to violet `#8B5CF6` to orchid `#D946EF`. Used on the logo tile, the active sidebar indicator (a tinted wash plus a gradient bar), the progress ring and bar, hero metric numbers (as gradient text), the glow behind page headings, the card hover border, and the primary button (deepened variant, see decisions). Elsewhere the brighter solid indigo family (`#6366F1`, 500).
- **Dark mode:** deep navy page `#070B1A`; layered surfaces card `#0E1530` and raised `#151D3F`; fine 1px borders with a faint top highlight on cards; a soft indigo/violet ambient glow in the top corners; gradient border glow on hovered and keyboard-focused cards. No pure black and no flat grey-on-grey.
- **Light mode:** crisp white cards on a very light cool lavender-grey page `#F4F5FB`; indigo-tinted soft shadows; vivid indigo primary; the same gradient accent glows (ambient and behind headings), so it is as polished as dark mode.
- **Data series tokens** for later charts (six hues, colour-blind friendly, always with a legend/label, never for status): indigo `#6366F1`, teal `#14B8A6`, orchid `#D946EF`, gold `#F59E0B`, sky `#38BDF8`, lime `#84CC16`. Shown on `/design` with marker shapes and a sample legend.
- **Typography polish:** bold, tighter titles (`-0.035em`), semibold headings, tiny uppercase section labels (an eyebrow with the sidebar group above every page title), new `text-hero` (2.75rem, bold, tabular, gradient) used by the new `Metric` component (the Overview's "0 of 6 steps" and `/design`).
- **Illustrations** (eleven, in code) are filled with the brand gradient plus a second teal-to-sky hue, with gold and orchid accents.
- **Fixed status colours** (emerald, amber, rose, sky) are unchanged in value and meaning (a test checks their hues).
- **`/design` page updated:** both indigo/violet/orchid ramps and the lavender-grey neutrals, surfaces (page, card, raised), a Brand gradient section (the two fills, where it appears, indicator, glow), Data series, a **light and dark side by side** section (the same sample screen forced into each theme), typography with hero and eyebrow, and a contrast table computed live for **both** themes (28 pairs).
- **Kept:** all stage 1.4 behaviour, motion rules and reduced-motion support (re-verified), the Skip to content link, keyboard access, the phone menu, the 404 page, all earlier tests. Only tokens are used (the raw-colour test still passes).

**Decisions / things the owner should know.**
- **The exact brand gradient cannot sit under white text.** White on violet `#8B5CF6` is 4.23:1 and on orchid `#D946EF` about 3.7:1, below the 4.5:1 rule. So there are two fills: `--gradient-brand` (exact aurora) for decoration, and `--gradient-brand-strong` (same hues, deepened: `#4F46E5`, `#7C3AED`, `#A21CAF`) for the **primary button**, where text sits on it. Gradient *text* (hero numbers) uses per-theme stops (light `#4F46E5`, `#7C3AED`, `#A21CAF`; dark `#818CF8`, `#A78BFA`, `#F0ABFC`). Small indigo text over glows (eyebrows, links) uses a new `primary-ink` token (light `#3730A3`, dark `#A5B4FC`) because plain indigo measured 3.9 to 4.5:1 over the glow. `#6366F1` is used for non-text (focus ring, borders, icons, chart series): white on it is 4.47:1 and as text on the page about 4.1:1.
- **Bug found and fixed by the measurement:** `tailwind-merge` did not know our custom font sizes (`text-label`, `text-body`...) and treated them as colours, silently dropping `text-label` whenever another `text-*` colour class was present (button text and card descriptions rendered at 15px instead of 13px). `lib/cn.ts` now registers the type scale; test `tests/frontend/cn.test.ts`. Visible effect: nav items, descriptions and button labels are now their intended, slightly smaller size.
- The page background colour now comes from `<html>`; the body is transparent so the fixed ambient glow (`body::before`) shows behind the shell.
- `.theme-light` / `.theme-dark` scopes exist so `/design` can show both themes side by side.

**Files.** Rewritten: `frontend/src/styles/tokens.css`, `frontend/src/styles.css`, `frontend/src/components/illustrations/index.tsx`, `frontend/src/pages/DesignPage.tsx`, `frontend/src/lib/cn.ts`. Changed: `frontend/src/components/ui/{button,card,sheet}.tsx`, `components/common/{Brand,PageHeader}.tsx`, `motion/{ProgressRing,ProgressBar}.tsx`, `layouts/AppShell.tsx`, `pages/{OverviewPage,SectionPage}.tsx`, `tests/frontend/{tokens,navigation}.test.*`, `docs/frontend-structure.md`. New: `frontend/src/components/common/Metric.tsx`, `tests/frontend/cn.test.ts`.

**Tests run (real Node 20.20.2 from `npm i node@20.20.2`, not the sandbox's 22).**
- Clean checkout from `git archive HEAD`: `npm ci` → `npm run build` (check-node20: 376 packages accept 20.20.2) → `npm run typecheck` → `npm test`: **21 files, 163 of 163 tests pass** (156 before, plus 7: new palette, gradient, series and dark/light surface token tests, and the `cn` test). `npm ci --omit=dev` + build ok; `npm audit`: 0 vulnerabilities.
- **Contrast, measured from real pixels in Chromium** (all text made transparent, the page screenshotted, each text node compared with every pixel behind it; so glows, the ambient light, the blurred header and gradients are included; gradient text is checked at 21 points along the gradient against every pixel behind it; every size held to 4.5:1, not the 3:1 large-text allowance): Overview, a section page, Performance, the 404 page and `/design`; desktop 1280 and phone 390; light and dark; the open phone menu (text inside the dialog); the primary button in its hovered, brightened state. **2,564 text nodes, lowest ratio 4.92 (the hovered gradient button label), light 4.92, dark 4.92; gradient text lowest 5.73; no failures.** Typical body text is 6 to 17. The `/design` page's own 28-pair table shows every pair passing in both themes.
- **Bundle (gzip level 9, real first load of `/overview`):** **entry chunk 109.1 KB** (limit 150 KB); all JavaScript fetched on first load **144.8 KB** (limit respected even on the strictest reading); CSS 9.5 KB. Phone menu chunk 11.9 KB (idle prefetch on phones), `/design` 7.1 KB.
- Motion re-verified on the new build, reduced motion off / on: page rise 8 px / 0 px in every frame; sidebar indicator slides 12 positions / jumps; card lift 2 px / none; pulse and shimmer present / none; cumulative layout shift 0 / 0; phone menu opens in 27 to 29 ms over a `blur(5px)` backdrop. Stage 1.3 and 1.4 behaviours re-checked in the browser (skip link, focus after navigation, Escape returning focus, theme following the OS, offline and setup-incomplete states, deep link). Desktop and phone, light and dark: no horizontal overflow, no console or page errors.
- `DRY_RUN=1 scripts/embarko-deploy.sh zentro`: 99 files, 244 KB; no `.env`, `node_modules`, `dist`, `data` or `.git`.

**Not done / incomplete.** Not deployed, so the checklist below has not run on the live link. The two follow-ups from the 1.4 deploy are still open: prefetch the lazy page chunks while idle (first visit to each section commits about 300 ms late on a real network) and log requests that match no route at `debug`. Charts do not exist yet, so the data-series colours are only shown as swatches and a sample legend.

**Live checklist for the owner (after "yes, deploy").** On https://zentro.embarko.app:
1. Overview: a violet-to-orchid gradient Z logo tile, a soft indigo/violet/orchid glow behind the heading and in the top corners, a tiny uppercase "WORKSPACE" label, a big gradient **0 of 6**, a gradient ring, cards with soft shadows. Toggle the moon/sun icon: deep navy dark mode with layered cards and a faint top highlight; light mode is lavender-grey with white cards.
2. Hover a card (it lifts and a gradient border glows) and Tab into a card's link (the gradient border shows). Click through the sidebar: the highlight (tint plus a gradient bar) slides; empty states show richer gradient illustrations.
3. Buttons are an indigo-violet-magenta gradient with white text that glows on hover.
4. Open `/design`: Brand gradient section, Data series (six colours with a legend), **Light and dark side by side**, and at the bottom the contrast table for both themes, all passing.
5. Phone: the menu slides in over a blurred backdrop. With the system's reduce-motion setting on, nothing slides, lifts, counts or pulses.

**Exact next step.** Show the owner these results; on "yes, deploy": push the branch, run `scripts/embarko-deploy.sh zentro`, run the checklist, record the result here. Tick 1.4 only after the owner confirms; merge to `main` only with a separate approval. Then stage 2.1 (auth core) in a new session.

### Colour refresh deploy record (2026-11-21)
- Owner said "yes, deploy". `scripts/embarko-deploy.sh zentro` uploaded `fce10f1` (99 files, 248 KB): `action: updated`, `claimed:true`, `kind:service`, build success, status live.
- Live checks I ran: `/healthz` `{"ok":true,"ready":true,"version":"fce10f1","migrations":{"applied":2,"total":2},"lastTick":{...,"status":"ok"}}` (secrets and database kept; ticks running); `/overview`, `/design`, `/okrs`, an unknown address and `/favicon.svg` answer 200.
- The same real-Chromium scripts as before the deploy, pointed at the live URL: **contrast from real pixels** 2,564 text nodes, **lowest 4.92** (the hovered gradient button label), gradient text lowest 5.73, no failures in the app's own text (one exception below); **bundle** entry chunk 109.1 KB gzipped, 144.8 KB total first-load JavaScript, CSS 9.5 KB (identical to the local build); **motion**: reduced motion off, page rise 8 px, card lift 2 px, pulse and shimmer running; on: 0 px movement in every frame, no loops; **layout shift 0** in both; desktop and phone, light and dark: no horizontal overflow, no console or page errors; skip link, focus after navigation, Escape returning focus to the menu button, theme following the OS, offline and setup-incomplete states, deep link all as before.
- **Findings on the live site (none fixed; all outside "frontend only" or caused by the platform):**
  1. **Embarko overlays its own "Embarko" badge at the bottom-left of every page** (a pill about 100 x 32 px). On a phone it covers the "Version" footer text of the open menu, which is why the pixel measurement of that one text node reads about 1.0:1 on the live link (the badge's pixels are behind it). It is injected by the platform, not by our code, so it was not counted as an app contrast failure; excluding that node the lowest live ratio is 4.92. Worth asking Embarko whether the badge can be moved or removed on this plan; otherwise move the sidebar version footer up or accept it.
  2. **The live server sends assets uncompressed and with `cache-control: public, max-age=0`.** The entry script is 350,701 bytes on the wire (no `content-encoding`, even when the client asks for gzip or brotli) and the browser revalidates every file on each load. All the gzip sizes quoted in this file and in the PROGRESS stage sections are what a compressed transfer would be; the real transfer today is about three times larger (roughly 480 KB of JavaScript on first load). Measured from this sandbox (about 0.85 s per request, about 300 KB/s) the entry script took about 1.9 s and the phone-menu chunk about 1.1 s. **Recommended backend follow-up (needs the owner's approval because stage 1.4 was frontend only):** add the `compression` middleware (or serve pre-compressed files) and send `cache-control: public, max-age=31536000, immutable` for the hashed files in `/assets` (keep `no-cache` for `index.html`).
  3. Because of 2, the phone menu can take 0.3 to 0.6 s to open if it is tapped within a second of loading the page (its chunk is prefetched while idle but may not have arrived). After the chunk is cached it opens in about 30 ms. Compression and caching (finding 2) are the fix; the earlier local measurement (22 to 32 ms) assumed an instant network.
  4. Still open from before: prefetch the lazy page chunks while idle; log requests that match no route at `debug`.
- Not yet verified by the owner: the live checklist in the colour refresh section above. 1.4 is ticked only after that, and merged to `main` only with a separate approval.

### Stage 1.4 closed (2026-11-21)
- Owner reported the live checks passed (design and motion stage and the Aurora indigo refresh). Stage 1.4 ticked; Milestone 1 (1.1 to 1.4) is complete.
- Owner approved this one merge: `claude/stage-1-4` → `main` by pull request. Nothing else merged or deployed; the live app already runs the merged code (`fce10f1`).
- **Exact next step: stage 2.1 (auth core)** in a new session from `main` (it needs the owner to type `REGISTRATION_CODE`). Fold in these small follow-ups, in this order of value:
  1. **Backend/static serving (needs the owner's OK, was out of scope for the frontend-only 1.4):** compress responses (`compression` middleware or pre-compressed files) and send `cache-control: public, max-age=31536000, immutable` for the hashed files under `/assets` (keep `no-cache` for `index.html`). The live server currently sends the 350 KB entry script uncompressed with `max-age=0`.
  2. Log requests that match no route (static files, the app shell) at `debug`, not `info`.
  3. Prefetch the lazy page chunks while idle (first visit to each section commits about 300 ms late on a real network) and keep the phone-menu prefetch.
  4. Make `APP_URL` required, drop the unused `spike_counters` table in a migration of its own, and replace the placeholder sidebar visibility with the real capability check (all from earlier notes).
  5. Ask Embarko whether its bottom-left "Embarko" badge, which covers the phone-menu version footer, can be moved or removed; otherwise move that footer.

### Stage 1.5 Performance hygiene (added at the owner's request) (2026-11-22, in progress)

Covers the follow-ups listed under "Stage 1.4 closed" (items 1 to 3). Nothing from the owner is needed (no secret).

**What was implemented**
- **Compression** (`backend/src/http/compress.ts`): the `compression` package (1.8.2; it uses Node's built-in zlib for brotli, so no native code; `npm run check:node20` still passes for all 384 locked packages). Brotli when the browser accepts it, else gzip; text only; responses under 1 KB are left alone; **`/api` is never compressed** (small JSON that can hold cookies and secrets later; avoids BREACH-style risk).
- **Cache headers** (`backend/src/http/cacheHeaders.ts`, `spa.ts`): hashed files under `/assets` (Vite's `name-<8 chars>.ext`) get `public, max-age=31536000, immutable`. `index.html`, the app-shell fallback for deep links, unhashed files (favicon) and `/healthz` get `no-cache` (browser must revalidate; unchanged files answer 304 through their weak ETag). `/api` answers carry no cache header from us.
- **Quiet logs** (`requestLog.ts`): requests that match no route and are **not** under `/api` (static files, the app shell) log at `debug` unless they fail (status 400 or more). Unknown `/api` paths and every real API route stay at `info`.
- **Idle prefetch** (`frontend/src/lib/preload.ts`, `routes/pages.ts`, `AppShell.tsx`): `lazyWithPreload` gives each page a `preload()` that shares one download with the real navigation (a failed download is forgotten so the visit can retry). After the window `load` event and when the browser is idle, the shell fetches one chunk at a time: the phone menu first (narrow screens only), then Overview, section and 404 pages. `/design` (unlisted) is not prefetched.
- **Security headers:** the repo sets none today (no helmet; only `x-powered-by` is disabled and `X-Request-Id` is sent). Both are kept and tested on compressed and static answers. No header was removed; adding security headers is not part of this stage (belongs to 9.1).

**Files.** New: `backend/src/http/{compress,cacheHeaders}.ts`, `frontend/src/lib/preload.ts`, `frontend/src/routes/pages.ts`, `tests/performance.test.ts`, `tests/frontend/prefetch.test.tsx`. Changed: `backend/src/{app.ts, http/spa.ts, http/requestLog.ts}`, `frontend/src/{App.tsx, layouts/AppShell.tsx}`, `package.json` and lock (+`compression`, +dev `@types/compression`), `docs/milestones.md`, this file.

**Tests (Node 20.20.2).** `npm ci` → `npm run typecheck` → `npm run build` → `npm test`: 23 files, **185 of 185 pass** (163 before, 22 new): brotli and gzip bytes on the wire decode back exactly, identity when nothing is accepted, text types compressed, tiny responses and `/api` (200 and 404) not compressed, per-path cache headers, 304 on revalidation, no cache header on `/api`, `x-powered-by`/request id/SPA fallback/JSON 404 unchanged, static and shell requests at debug and none in an info-level log, API lines still info, prefetch (shared download, retry after failure, waits for idle and for `load`, in order, survives a failed chunk, cancels, shell preloads all pages, phone menu opens at once).


**Deployed (2026-11-22, owner said "yes, deploy").** `scripts/embarko-deploy.sh zentro` uploaded `347c762` (103 files): `action: updated`, build success, live. `/healthz` shows version `347c762`, migrations 2 of 2, tick ok.

**Before and after, live site, from this sandbox (Chromium, cold cache, median of 3; same script both times).**

| Measure | Before (`fce10f1`) | After (`347c762`) |
| --- | --- | --- |
| First load, total bytes on the wire (incl. 2.5 s of idle prefetch) | 559,460 | **231,468** |
| First load, JavaScript on the wire | 456,355 | **164,237** |
| Entry script on the wire | 351,414 (no compression) | **114,431** (brotli) |
| Hashed `/assets` files | `public, max-age=0` | `public, max-age=31536000, immutable` |
| `/overview` (index.html) | `public, max-age=0` | `no-cache` (still brotli from the platform, 6,085 bytes, same as before) |
| `/healthz` | no header | `no-cache` |
| `/api/*` | no cache header, not compressed | unchanged |
| First visit to Leadership (first section) | 389 ms | **71 ms** |
| First visit to OKRs / My Work | 62 / 63 ms | 62 / 64 ms |
| Phone menu tapped 300 ms after load | 842 ms | **248 ms** (one run 855 ms, see below) |
| Phone menu tapped 3 s after load | 102 ms | 98 ms |

**Notes.** The 15 requests after include the page chunks fetched by the idle prefetch (before: 12). Fonts (woff2) are already compressed, so they stay the same size. Embarko's own HTML handling still works with the app's `no-cache` HTML (same 6,085-byte brotli answer). Still not instant: a phone tap in the first moments after load, before the browser has gone idle, can still wait for the 12 KB menu chunk (248 ms median, one 855 ms outlier); a second or more later it is about 100 ms. Possible refinement if wanted: start the menu chunk straight after first paint instead of waiting for idle.

**Next.** The owner checks the live list; then tick 1.5. Merge to `main` only with a separate approval. After that, stage 2.1.

**Phone menu follow-up (2026-11-22, owner asked; built, tests pass, not deployed).** The menu chunk now starts loading right after the first paint (two animation frames, narrow screens only) instead of waiting for browser idle; page chunks still wait for idle. One file changed (`frontend/src/layouts/AppShell.tsx`) plus its test (`tests/frontend/prefetch.test.tsx`, which fails on the old code and passes on the new). 185 of 185 tests pass on Node 20.20.2; typecheck and build ok. Local throttled run (400 ms latency, 300 KB/s, 5 runs) could not tell old from new (tap at 0 ms: 179 vs 162 ms; at 300 ms: 101 vs 100 ms), because on localhost the idle callback fires almost at once. The live numbers are the real check and are recorded after the deploy.

**Phone menu follow-up deployed (2026-11-22, owner said "yes, deploy").** Uploaded `dfc4401`: build success, live, `/healthz` ok (migrations 2 of 2). Live numbers, same script, from this sandbox: tap 300 ms after load, 3 runs **366, 354, 356 ms** (median 356), then a second batch of 6 runs **352, 344, 95, 251, 873, 877 ms** (median 352); before the fix the 3 runs were 248, 855, 245 ms (median 248). Tap 3 s after load: about 100 ms (unchanged). First visit to sections 74 / 73 / 73 ms; first-load bytes unchanged (231,480). **Result: no clear improvement.** A tap in the first 300 ms is dominated by the network round trip for the 12 KB chunk (this sandbox sees about 0.4 to 0.85 s per request), so the numbers swing between about 100 ms (chunk already there) and about 870 ms (a tap that has to wait for the chunk). The change is correct (chunk requested earlier, test proves it) but cannot beat the round trip. Only remaining lever: a `modulepreload` hint in `index.html` so the browser fetches the chunk in parallel with the entry script (costs desktop visitors 12 KB they never use unless done by a media query). Not done; awaiting the owner's decision.

### Stage 1.5 closed (2026-11-22)
- Owner reported the live checks passed. Stage 1.5 ticked. Owner decided: **no `modulepreload` hint; the current phone-menu behaviour is accepted** (an early tap can wait for the 12 KB chunk, about 100 ms once it has arrived).
- Owner approved this one merge: `claude/stage-1-5` → `main` by pull request. Live runs `dfc4401`.
- **Exact next step: stage 2.1 (auth core)** in a new session from `main` (needs the owner to type `REGISTRATION_CODE`). Remaining small follow-ups from the 1.4 list: make `APP_URL` required, drop the unused `spike_counters` table in its own migration, replace the placeholder sidebar visibility with the real capability check, and ask Embarko about the bottom-left badge covering the phone-menu version footer.

### Stage 2.1 Auth core (2026-11-22, built, not deployed)

**Decision recorded (open question 3): registration mode is `code`.** Registration works only with the registration code; the server needs `REGISTRATION_MODE=code` and `REGISTRATION_CODE` (the code is typed by the owner at deploy time, set through the env-vars API, and is never written to the repo, logs, tests or this file).

**What was implemented**
- **Migration `0003_auth_core.sql`** (append-only): `users`, `organizations`, `organization_memberships`, `roles`, `user_role_assignments`, `sessions` (only the columns 2.1 needs; later stages ALTER them). `sessions.id` is the SHA-256 of the random session id in the cookie.
- **Passwords:** Node `crypto.scrypt` (N=16384, r=8, p=1, 16-byte salt, 64-byte key), stored `scrypt$N$r$p$salt$hash`, async only, `timingSafeEqual`; 10 to 128 characters; a decoy hash is checked for unknown emails so timing does not reveal which emails exist.
- **Sessions:** cookie `zentro_session` = HS256 JWT `{sub, sid, iat, exp}` (`jsonwebtoken` 9.0.3, algorithm pinned to HS256) **plus a session row checked on every request** (revoked, sliding 7 days, absolute 30 days, user still active, membership still active). HttpOnly, SameSite=Lax, Secure (everywhere except plain http on the developer's machine). Logout revokes the row. The housekeeping job purges sessions past their hard expiry.
- **Routes (all in the route registry):** `POST /api/auth/register` (public), `POST /api/auth/login` (public), `POST /api/auth/logout` (public: always clears the cookie, revokes only the caller's own session), `GET /api/auth/me` (baseline), `POST /api/organizations` (baseline), `GET /api/organization` (baseline, needs an organization). `authorize` (permission keys) still fails closed until 2.3.
- **Registration:** closed unless `REGISTRATION_MODE=code` with a code of 8 or more characters (or `open` set explicitly). Wrong, missing and closed all give one generic 403 message; the code is compared in constant time; wrong codes are rate-limited per address (5 per 15 minutes) and across everyone (40 per hour); every attempt is counted per address (20 per hour). An existing email gets the same 202 as a new one. Registering does not sign anyone in.
- **Login:** generic `401 invalid_credentials`; 8 failures per account and 30 per address in 15 minutes then `429` with `retryAfterSeconds`, blocks double on repeats; a success clears the account's count. Limits are in memory (see known-limitations).
- **Same-origin check** on every non-GET `/api` request (Origin, else Referer, must match `APP_URL`, or the request's own Host / X-Forwarded-Host). **`APP_URL` stays optional** (it was planned to become required): making it required could have put the live site into holding mode, so I did not.
- **Create organization:** one transaction creates the organization, the person's membership, the minimal **Owner** role and the Owner @ organization assignment, then points the session and the user's default organization at it. The organization id never comes from the request (an unknown field such as `organizationId` is a 400). One organization per person for now (409 after that).
- **Tenancy:** organization-owned tables are reached only through the tenant-scoped handle (strict lint on in tests); the module's repositories live under `modules/auth/repositories/`; a `store.ts` keeps the database handle out of the service (the layering test enforces this).
- **Config:** `registration` added to `Config`; `/healthz` shows `registration: "code" | "open" | "closed"` (never the code); the server logs a warning at start when registration is closed. The logger also redacts any field name containing "registration".
- **Frontend:** `/login`, `/register`, `/onboarding`, `AuthContext` (from `GET /api/auth/me`; a 401 from any API call signs the browser out), `RequireAuth` guard (signed out → `/login` and back; no organization → `/onboarding`), header `UserMenu` (name and organization, Log out; an initial and an icon on phones; a Sign in link on public pages), reusable `FormField`/`FormAlert`/`FormNotice`/`Input`. Public when signed out: `/login`, `/register`, `/design`, the 404 page. Plain controlled forms (no form library for three small forms). Uses the existing tokens and motion (page rise, reduced motion honoured).

**Files.** New: `database/migrations/0003_auth_core.sql`; `backend/src/lib/{passwords,cookies,rateLimit}.ts`; `backend/src/http/sameOrigin.ts`; `backend/src/modules/auth/{service,guards,routes,tokens}.ts` and `repositories/{users,sessions,organizations,store}.ts`; `frontend/src/{contexts/AuthContext.tsx, services/auth.ts, lib/authForm.ts, layouts/AuthLayout.tsx, routes/RequireAuth.tsx, pages/auth/{Login,Register,Onboarding}Page.tsx, components/common/{FormField,UserMenu}.tsx, components/ui/input.tsx}`; tests `tests/auth.test.ts`, `tests/frontend/auth.test.tsx`, `tests/helpers/auth.ts`. Changed: `backend/src/{app,server}.ts`, `config/env.ts`, `routes/system.ts`, `jobs/jobs/housekeeping.ts`, `lib/logger.ts`, `frontend/src/{App.tsx, layouts/AppShell.tsx, routes/pages.ts}`, existing tests (Origin header, migration count 3, registry list, healthz shape, signed-in stub for the frontend tests), `package.json` (+`jsonwebtoken`, dev `@types/jsonwebtoken`), `.env.example`, docs (`api-documentation`, `permission-model`, `architecture`, `database-design`, `frontend-structure`, `known-limitations`, `milestones`).

**Tests (Node 20.20.2).** `npm ci` → `npm run typecheck` → `npm run build` → `npm test`: **25 files, 244 of 244 pass** (185 before, 59 new; run twice from a clean `git archive` checkout), typecheck clean, `npm audit` 0 vulnerabilities, `npm ci --omit=dev` ok, `check:node20` accepts all 398 locked packages. Entry chunk 115.0 KB gzipped (limit 150 KB); the three auth pages are 0.9 to 1.1 KB each. New backend tests cover: scrypt format, salt, wrong and damaged hashes; registration closed/wrong/missing code (same message), fail closed without breaking the site or logins, existing-email indistinguishable, password 10 to 128, code rate limits, nothing secret in the log; login wrong password vs unknown email identical, account and address lockout, cookie flags and JWT claims, only a hash in the database, forged/other-secret/`alg: none`/expired JWTs, revoked/expired/absolute-expired session rows, sliding window, logout revokes, disabled user; same-origin (no Origin, foreign, `null`, lookalike host, Referer fallback, all methods, derived host); create organization (rows, Owner assignment, body `organizationId` rejected, validation, one per person, slugs); **cross-tenant**: a second organization's person sees only their own data under every spoof (query, header, path), a session row pointing at another organization yields no access, the tenant handle returns no foreign rows and refuses un-scoped SQL; removing a membership denies the next request; the rate limiter unit; every new route is registered. Frontend tests cover the guards, public pages, login/register/onboarding forms, the 401 reaction, the header menu and Log out. Test registration code is `test-only-registration-code-0001` (tests only).
**Real browser (Chromium against the compiled server on Node 20.20.2, a random local code):** register with a wrong code refused, register, login with a wrong password refused, onboarding, organization shown in the header, refresh keeps the session, the cookie is HttpOnly + SameSite=Lax and unreadable by script, a second browser profile (phone size) registers and creates a different organization and sees none of the first one's data, a cross-origin POST is refused, log out, public `/design` reachable signed out, no script errors, no horizontal overflow on a phone. The server log contained neither the code nor any password. **Contrast measured from real pixels** on login, register, onboarding, the error and success notices and the header user menu, desktop and phone, light and dark: **all above 5.6** (lowest 5.67, the gradient button label).

**Exact next step.** Show the owner these results. On "yes, deploy": ask once for the registration code; set `REGISTRATION_MODE=code` and `REGISTRATION_CODE` through the env-vars API (`PUT /api/apps/zentro/env-vars`, `apply: true`, only those two keys, never printing or storing the code); push the branch; run `scripts/embarko-deploy.sh zentro`; check `/healthz` (`registration: "code"`, migrations 3 of 3); give the owner the click list. Tick 2.1 only after the owner confirms; merge to `main` only with a separate approval. Then stage 2.2 in a new session.

**Deployed (2026-11-22, owner said "yes, deploy" and approved the env-vars call).** The owner typed the registration code in chat when asked. It was sent only to the Embarko env-vars API (`PUT /api/apps/zentro/env-vars`, `apply: true`, only `REGISTRATION_MODE=code` and `REGISTRATION_CODE`; the other four variables untouched, confirmed by listing the keys). The code is not in the repo, logs, tests or this file. Then `scripts/embarko-deploy.sh zentro` uploaded `ea52494`: build success, live. `/healthz`: version `ea52494`, migrations **3 of 3**, `registration: "code"`, tick ok. Live probes (no account created): `/api/auth/me` signed out 401; login with the site's own Origin and wrong credentials 401 `invalid_credentials` (so the same-origin check works behind Embarko's proxy without `APP_URL`); a foreign Origin 403 `cross_origin`; register with a wrong code 403 generic `registration_unavailable`; `/login`, `/register`, `/overview`, `/design` 200.
**Not yet verified (needs the owner):** the click list below on the live site. Tick 2.1 only after the owner confirms; merge to `main` only with a separate approval.

### Stage 2.1 closed (2026-11-22)
- Owner reported the live checks passed. Stage 2.1 ticked.
- Owner approved this one merge: `claude/stage-2-1` → `main` by pull request. Live runs `ea52494`; registration is `code` (the code lives only in Embarko's environment variables).
- **Exact next step: stage 2.2 (password reset and invitations)** in a new session from `main`. Likely needs nothing from the owner unless the viaSocket email flow is wanted (`VIASOCKET_EMAIL_FLOW_URL`). Open follow-ups: make `APP_URL` required when emailed links arrive (2.2), drop the unused `spike_counters` table in its own migration, replace the placeholder sidebar visibility with the real capability check (2.3), ask Embarko about the bottom-left badge covering the phone-menu version footer.

### Stage 2.2 Reset and invitations (2026-11-22, built, not deployed)

**Decisions recorded (owner, at the start of 2.2)**
1. **Open question 8 (platform email flow): not now.** No email sending is built. Administrators copy links. The outbox and email arrive in stage 8. One clearly marked place is left for it: `backend/src/modules/auth/delivery.ts` (`LinkDelivery`; stage 2.2 uses `noDelivery`; `createApp` takes a `delivery` option). `VIASOCKET_EMAIL_FLOW_URL` is not read before stage 8. (This replaces the earlier answer "wire it at stage 2.2".)
2. **An invitation replaces the registration code, for the invited address only.** A valid, unexpired, unused invitation lets the invitee create an account without the registration code, but only with the invited email address (checked case-insensitively). The invitation is the proof of permission. (An existing login signs in first and accepts as that person.)
3. **TEMPORARY: only Owners can create invitations and reset links until the permission engine arrives in stage 2.3.** The check is `backend/src/modules/auth/ownerGate.ts` (marked TEMPORARY in the file), wired as `authorize` for the real keys `invitations.manage` and `people.manage`; every other permission key is still refused. Stage 2.3 deletes that file. Recorded in the code, in `docs/permission-model.md` and in `docs/known-limitations.md`.

**What was implemented**
- **Migration `0004_invitations_and_reset.sql`** (append-only): `invitations` (organization-owned; code hash UNIQUE; one open invitation per address per organization) and `auth_tokens` (global; token hash UNIQUE; `revoked_at` added for "replaced by a newer link").
- **Invite:** `POST /api/invitations {email, name?}` creates the membership (status `invited`, no login yet) plus the invitation and returns the code **once**; only its SHA-256 is stored. Code = `<organization id>.<256-bit secret>` (the id tells the public accept route which organization to search; a forged id finds nothing). Valid 7 days, single use. `GET /api/invitations` lists pending/accepted/revoked/expired (never a code). `POST /api/invitations/:id/revoke` ends it and takes the never-joined person off the list; `POST /api/invitations/:id/regenerate` gives a fresh link and kills the old one (pending, expired or revoked; not accepted). Duplicates (open invitation, existing member) are `409 already_exists`; an expired open one is replaced.
- **Accept:** `POST /api/auth/invitation-preview {code}` (organization name and invited address) and `POST /api/auth/accept-invitation`. Signed in: the caller's email must be the invited one; not signed in: `{code, name, email, password}` creates the login (invited address only), binds the membership and signs in. Errors: `404 invitation_not_found` (unknown, malformed, wrong secret, made-up organization), `410 invitation_expired / invitation_used / invitation_revoked`, `403 invitation_email_mismatch`, `409 account_exists` (sign in first), `409 already_in_organization`. Single use even under a race (a conditional `UPDATE` inside a transaction; three simultaneous accepts produce exactly one success).
- **Reset by administrator link:** `POST /api/people/:membershipId/reset-link` returns `{token, expiresAt}` once (valid 1 hour, hash stored, a newer link replaces older unused ones). Only for a person with a login who belongs to the caller's own organization (another organization's person looks like 404); not for yourself (use change password). `POST /api/auth/reset-password {token, password}`: single use, errors `404 reset_link_invalid`, `410 reset_link_used / expired / revoked`; **revokes all the person's sessions**, clears their sign-in lockout, does not sign anyone in.
- **Forgot password:** `POST /api/auth/forgot-password {email}` always answers `202` with the same text ("ask your administrator"), for any address; creates no token; rate-limited per address and per email.
- **Change password:** `POST /api/auth/change-password {currentPassword, newPassword}`; wrong current password `403` and rate-limited; signs out the person's other sessions, keeps this one, cancels unused reset links.
- **Members list:** `GET /api/organization/members` (Owners only for now) for the Users screen; the people API (2.6) replaces it.
- **Rate limits (every public endpoint):** forgot 10/hour per address and 5/hour per email; reset 10 wrong tokens per 15 minutes (30 calls) per address; invitation preview/accept 10 wrong codes per 15 minutes (60 calls) per address; change password 5 wrong per 15 minutes per person. Same-origin check unchanged on all of them. In memory (restart forgets).
- **Secrets:** links, codes, tokens and passwords are never logged (tests scan the log); the database holds only hashes; hashes are compared with `timingSafeEqual`; the secret travels in the URL **fragment** (`/accept-invite#code=…`, `/reset-password#token=…`) so no server, proxy log or Referer header sees it (a change from the docs' `/reset-password/:token`, now documented).
- **Frontend:** `/forgot-password`, `/reset-password`, `/accept-invite` (preview, one-click join when signed in, "sign in first" link, clear messages for each refusal), `/settings` (real index), `/settings/users` (invite form, one-time link panel with Copy, invitations with state, New link, Revoke with a second confirm click, people list with Reset password link), `/settings/profile` (Change password). Login page has "Forgot your password?" and shows a notice after a reset. Invitation states use neutral/primary badges (not the status colours, which keep their one meaning). Uses the existing tokens and motion; phone layout checked.

**Files.** New: `database/migrations/0004_invitations_and_reset.sql`; `backend/src/modules/auth/{delivery,secrets,ownerGate,invitations,accounts,accountRoutes}.ts` and `repositories/{invitations,authTokens}.ts`; `frontend/src/{lib/format.ts, components/common/OneTimeLink.tsx, pages/auth/{ForgotPassword,ResetPassword,AcceptInvite}Page.tsx, pages/settings/{Settings,Users,Profile}Page.tsx}`; tests `tests/{invitations,passwordReset}.test.ts`, `tests/frontend/accounts.test.tsx`. Changed: `backend/src/{app.ts, jobs/jobs/housekeeping.ts}`, `modules/auth/{service,guards}.ts`, `repositories/{organizations,sessions,users,store}.ts`, `frontend/src/{App.tsx, routes/pages.ts, services/auth.ts, contexts/AuthContext.tsx, pages/auth/LoginPage.tsx}`, existing tests (migration count 4, route list, settings index, helpers), docs (`api-documentation`, `permission-model`, `architecture`, `database-design`, `frontend-structure`, `known-limitations`, `milestones`).

**Tests (Node 20.20.2).** `npm ci` → `npm run typecheck` → `npm run build` → `npm test`, from a clean `git archive` checkout, run twice: **28 files, 301 of 301 pass** (244 before, 57 new), typecheck clean, `npm audit` 0 vulnerabilities, `npm ci --omit=dev` ok, `check:node20` accepts all 398 locked packages (no new dependency in this stage). Entry chunk 115.2 KB gzipped (limit 150 KB); the new pages are 0.9 to 1.5 KB each and the Users page 4.6 KB (all lazy). Backend (`tests/invitations.test.ts`, `tests/passwordReset.test.ts`): expired, revoked and used invitations; wrong email on an invitation; garbage/forged/wrong-secret codes; accept without the registration code while registration is closed; existing account must sign in; already-in-organization; single use under a race (invitations and reset links); revoke and regenerate lifecycle; one open invitation per address; Owner-only gate (non-owner 403, signed out 401) on every administration route; the reset token single use, expiring after 1 hour, replaced by a newer link, revoking ALL sessions (and not the owner's), clearing lockout; forgot password identical for known and unknown addresses and creating no token; change password (other sessions out, this one stays, wrong current rate-limited); rate limits on every public endpoint; hashes only in the database (the secret is not found anywhere in a dump of every table); no code, token, password or email in any log line; **cross-tenant**: an administrator of organization B cannot list, revoke, regenerate, reset or invite into organization A whatever ids are sent, and A's rows are unchanged; the delivery hook receives the secret once and the default delivery does nothing. Frontend (`tests/frontend/accounts.test.tsx`): forgot, reset (token from the fragment, never in a URL), accept (every refusal in the server's words, signed in and out), Users screen (non-owner message, one-time link shown once and gone after hiding, copy, confirm-revoke, reset-link buttons only where allowed), profile change password.
**Real browser (Chromium against the compiled server on Node 20.20.2, a random local registration code):** owner invites Sam and copies the link; the link is gone after a reload; Sam, in a separate phone-size profile, accepts without a registration code and lands in the right organization (API confirms 2 members), is refused the administration API and sees the owners-only message; the used link says it was already used; the owner generates a reset link; Sam's old session is signed out when it is used, the old password stops working, the new one works, the link is single use; a revoked invitation link fails with the right message; forgot password gives the generic answer; change password works; no horizontal overflow on a phone; the server log contained neither the registration code, any link or fragment, nor any password. **Contrast from real pixels** on the Users page (with the one-time link and the confirm-revoke state), Profile with field errors, Settings, accept invitation (form, errors, refused), forgot password, reset password, desktop and phone, light and dark: **36 of 36 pass, lowest 5.19**.

**Exact next step.** Show the owner these results. On "yes, deploy": push the branch, run `scripts/embarko-deploy.sh zentro` (no environment variable changes, nothing needed from the owner), check `/healthz` (migrations 4 of 4, `registration: "code"`), run the click list. Tick 2.2 only after the owner confirms; merge to `main` only with a separate approval. Then stage 2.3 (RBAC engine), which deletes `ownerGate.ts`.

**Deployed (2026-11-22, owner said "yes, deploy").** `scripts/embarko-deploy.sh zentro` uploaded `fe85552`: build success, live. No environment variables were changed and nothing was asked of the owner. `/healthz`: version `fe85552`, migrations **4 of 4**, `registration: "code"`, tick ok. Live probes (no account, invitation or reset link created): forgot password 202 for an unknown address; invitation preview and reset with made-up secrets 404 `invitation_not_found` / `reset_link_invalid`; change password and `GET /api/invitations` signed out 401; a foreign Origin 403; the new pages `/forgot-password`, `/reset-password`, `/accept-invite`, `/settings/users` answer 200.
**Not yet verified (needs the owner):** the click list on the live site. Tick 2.2 only after the owner confirms; merge to `main` only with a separate approval.

### Stage 2.2 closed (2026-11-22)
- Owner reported all 11 live click-test steps passed. Stage 2.2 ticked.
- Pull request `claude/stage-2-2` → `main` is opened; it is merged only after the owner says yes. Live already runs the code (`fe85552`). Pull requests #6 (stage 1.5) and #7 (stage 2.1) are already merged into `main`, so this one targets `main` directly and no base change is needed.
- **Exact next step: stage 2.3 (RBAC engine)** in a new session from `main`, after the owner approves the plan. It deletes `backend/src/modules/auth/ownerGate.ts`.

### After stage 2.2: merge, decisions, rollback script (2026-11-22)
- Owner approved the merge: pull request #8 (`claude/stage-2-2` → `main`) merged as `8ebb100`. #6 (stage 1.5) and #7 (stage 2.1) were already merged; no base branch needed changing. Live runs `fe85552`.
- **Owner decisions:** (1) do **not** build "Delete organization" now; build a small **"Delete my account" at the end of stage 2.3**; an Owner removing a person goes into the people-management part of 2.3/2.4. (2) add `scripts/embarko-rollback.sh` (done, on branch `claude/rollback-script`, dry-run tested; it lists deployments, rolls back with `previous` or a deploymentId, polls the status and prints `/healthz`; it never prints the token). (3) before stage 2.3 touches the live database: backup and rehearsal options were laid out for the owner; the plan for 2.3 is approved only after that answer.
- Test accounts on the live site (the owner's) cannot be deleted until "Delete my account" exists; the last Owner of an organization cannot delete their account while others remain (see the open question to the owner about an empty organization).
