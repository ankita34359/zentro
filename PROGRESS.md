# Zentro: Progress

Resume file. A fresh session should be able to continue from this page alone, plus `ZENTRO_MASTER_PROMPT.md` (source of truth; its "Showcase overrides" section wins) and `docs/`.

Last updated: 2026-11-21 · Blueprint approved by the owner · Open questions answered · Not deployed

---

## Current status

**Milestone 0 (blueprint) is approved and merged to `main`.** All ten open questions are answered (below). No application code exists. No app packages are installed. Nothing is deployed.

Next action, in a **new session**: **Stage 1.1, the deploy spike** (proves a TypeScript backend compiled at build time runs on Embarko's Node 20). See `docs/milestones.md`. Branch for stage work: create `claude/stage-1-1` (or the branch the owner names) from `main`; do not push to `main` or deploy without asking.

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
2. **`better-sqlite3@13` and `vitest@5` need Node 22+.** Use `better-sqlite3 ^12.11` and `vitest ^3.2`. Vite 8 needs `^20.19`.
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

**M1 Foundation** · `[ ]` 1.1 Deploy spike · `[ ]` 1.2 Backend foundation · `[ ]` 1.3 Frontend foundation

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
| Before 1.1 | The Embarko deploy token available as `DEPLOY_TOKEN` in the session's environment settings (never in chat); app name `zentro` (fallback `zentro-ankita`) |
| 1.2 | `SESSION_SECRET`, `ENCRYPTION_KEY` typed on Embarko's App setup page, then **Apply changes** |
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
