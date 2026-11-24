# Zentro: Milestones and Stages

The master prompt's 9 milestones are re-cut into **51 small stages**. Each stage is deployable to Embarko on its own, leaves the live app working, and ends with a short list of exactly what to click to test it (the Curevia method, showcase override 10).

Related: [architecture](architecture.md) section 15 (deploy procedure), [risks](risks.md), [known-limitations](known-limitations.md). Progress is tracked in `PROGRESS.md` at the repo root.

---

## 1. How every stage works

**Rules**

1. **I stop after every stage** and tell you what to click on the live link. I do not start the next stage until you say so.
2. **I never push to `main` and never deploy without asking you first.** Work happens on a branch; a stage is deployed from the branch only after you approve.
3. A stage ships **only what it lists**. Nothing is silently skipped; anything deferred is written into [known-limitations](known-limitations.md).
4. Every stage keeps the app deployable: migrations are append-only and backward-safe for one version (Embarko's rollback does not roll `DATA_DIR` back), and new features sit behind permissions that default to off for roles that should not have them.
5. Secrets are typed by you on Embarko's App setup page. I never print, commit or ask you to paste secrets in chat.

**Definition of done for every stage**

- [ ] Code builds and **all tests pass on a real Node 20.20.2** (not the sandbox's Node 22); `check:node20` passes (no dependency needing Node > 20).
- [ ] New tables have migrations; load-then-remove of demo data still leaves zero `is_demo` rows.
- [ ] New routes are registered with a permission, covered by the generated **tenancy and permission matrices**.
- [ ] New screens have loading, empty (with guidance), error states, and confirmations for destructive actions.
- [ ] `docs/api-documentation.md`, `database-design.md` and `PROGRESS.md` updated.
- [ ] I list: what was implemented, files changed, decisions made, tests run, what is incomplete, and the exact next step.
- [ ] After your approval: deploy, run the smoke test (`/healthz`, one login, the stage's checklist), report the result.

**Size key:** S = under half a day of build time, M = about a day, L = more than a day.

---

## 2. Milestone 1: Foundation (original "Product architecture and foundation")

The blueprint (this document set) is Milestone 0. Stage 1.1 comes first because it proves the riskiest assumption: that a **TypeScript backend compiled at build time runs on Embarko's Node 20**, which neither Curevia nor HireDrive has done.

| ID | Stage | Delivers | Live check on the Embarko link | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| **1.1** | **Deploy spike** | Express 5 + TypeScript compiled by `tsc` into `build/`, Vite React page, `better-sqlite3@^12`, a counter table in `DATA_DIR`, migration runner (one table), `/healthz`, `/api/cron/tick` with `CRON_SECRET`, `embarko.json` with one 5-minute schedule, `scripts/embarko-deploy.sh`, `scripts/check-node20.mjs` | Open the link: page shows app version, Node version (must be 20.x), database path, a visit counter. **Redeploy, reload: the counter is still there.** `/healthz` returns ok. Embarko's "Scheduled jobs" shows the tick with outcome ok. | Deploy token on the machine; app name; claim the app (schedules need a kept app) | M |
| 1.2 | Backend foundation | Config validation with the holding page, error envelope, request ids, logger, **route registry with permission markers**, tenant-scoped repository base, **SQL-lint test and strict-tenant mode**, migration checksums and pre-migration copy, job registry and `scheduled_job_runs`, Vitest harness | `/healthz` shows migration count and tick time. With `SESSION_SECRET` unset the site shows the holding page and `/api` says "Server is missing: SESSION_SECRET" (names only); after you set it and press Apply changes it works. | Set `SESSION_SECRET`, `ENCRYPTION_KEY` on App setup; Apply | M |
| 1.3 | Frontend foundation | Tailwind 4 + shadcn/ui shell, router, AppShell (sidebar with all eleven items, header), theme (light/dark), API client, error/loading/empty primitives, `public.ts` config | Site loads with the sidebar and placeholder empty states; dark mode toggles; unknown URL shows a 404 page; mobile width shows the collapsed sidebar | | M |
| **1.4** | **Visual design and motion (added at the owner's request)** | One design-token file (Tailwind 4 theme variables: palette, type scale, radii, shadows, spacing, motion timings) for light and dark; indigo/violet brand plus one accent, cool slate neutrals, soft off-white and deep navy; fixed status colours (emerald on track, amber at risk, rose off track, sky info); Inter self-hosted; grouped sidebar with a sliding active indicator, blurred header, refined cards, page-header glow, in-code SVG empty-state illustrations; `motion` with `LazyMotion` for page transitions, staggered entrances, count-up number, progress ring and bar; theme-icon morph, Online pulse, skeleton shimmer, blurred-backdrop mobile menu; reduced-motion honoured; unlisted `/design` style-guide page; motion rules written into `docs/frontend-structure.md`. Frontend only. | Site looks calmer and more polished in light and dark; sidebar indicator slides; pages fade in; Getting started shows a progress ring at 0 of 6; open `/design` (not in the sidebar) to review the palette, type, components and motion samples; with the operating system's "reduce motion" on, nothing moves | | M |
| **1.5** | **Performance hygiene (added at the owner's request)** | The follow-ups left over from the 1.3 and 1.4 deploys. Backend: response compression for text (brotli when accepted, else gzip, Node's own zlib via the `compression` package) except `/api`; `Cache-Control: public, max-age=31536000, immutable` for hashed files in `/assets`; `no-cache` (revalidate) for `index.html`, the app-shell fallback, unhashed files and `/healthz`; no cache headers and no compression on `/api`; static files and other unmatched non-API requests logged at `debug` only. Frontend: every page chunk (and, on phones, the menu chunk first) is fetched while the browser is idle after first load, so the first visit to a section is not late and the phone menu opens at once. Tests for each. Measured before and after on the live site. | `/healthz` still ok; reload the site and confirm in the browser's Network tab that scripts are `br` and `immutable`; the first click on each sidebar section is instant; on a phone the menu opens at once even right after loading | | S |

## 3. Milestone 2: Authentication and organization management

| ID | Stage | Delivers | Live check | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Auth core (built; `REGISTRATION_MODE=code`, owner decision 3) | `users`, `sessions`; register, login, logout, `me`; scrypt; JWT cookie + session row; rate limits; same-origin check; create organization (seeds minimal Owner role); onboarding page; `REGISTRATION_MODE` | Register, create an organization, log out, log in, wrong password shows an error, refresh keeps you signed in, a second browser profile can register a **different** organization | Choose registration mode (open question) | L |
| 2.2 | Reset and invitations (built; **no email**: owner decision on open question 8, links are copied by an administrator, email arrives in stage 8) | Password reset (admin-copied link; email through the platform flow if configured), invitation code/link, accept invitation, memberships | Invite a second person, copy the link, accept it in a private window; reset a password via the copied link | Optional: platform email flow URL | M |
| 2.3 | RBAC engine (built; **plus "Delete my account"**, added at the owner's request: the last member also deletes the then-empty organization, with a clear warning) | Permission catalog, roles, role permissions, assignments, scope resolver, `requirePermission`, `me.capabilities`, baseline self-service rights, role templates seeded on organization creation, **tenancy and permission matrix test harness** | Settings → Roles lists the nine template roles (read only); the second organization cannot see the first's people or roles | | L |
| 2.4 | Roles and permissions UI (built; owner decisions: Owner role protected, remove keeps the login, archive refused while held, audit Owner only with no IPs, department/team scopes disabled until 2.5) | Role matrix editor with scope modes, assignments with scope and time bounds, escalation and last-admin guards, audit log writer and Audit page | Create a custom role "Program Director", assign it to the invited person, watch their sidebar change; try to remove the last admin (refused); see every change in Audit | | L |
| 2.5 | Organization structure (built; owner decisions: keep the 2.5/2.6 split, department heads and team leads wait for 2.6, free depth with a cap of 8 levels) | Departments, teams, sub-teams, designations, role families, archive/rename, organization settings | Build a department → team → sub-team tree; rename; archive with confirmation; create a designation "Mentor" in a role family | | M |
| 2.6 | People and reporting (live, batch A; owner decisions: people without a login are directory people, a new primary manager ends the old one on the start day, a new head or lead replaces the old one who stays as a member, department/team role scopes enabled here) | Employees (memberships), department/team membership with dates, reporting relationships (several managers, history), designation history, move a person, profile drawer | Add six people, give one two managers, move one to another team on a date, open the history tab | | L |
| 2.7 | Organization chart (live, batch A; a vertical ARIA tree for every screen size, no heavy dependency) | Hierarchy tree API with depth, `OrgChart` (expand/collapse, reporting vs department view, profile panel, keyboard access, list fallback) | Expand from the top person down to an employee; switch views; open a profile; resize to phone width | | M |
| 2.8 | Demo data framework (live, batch C; owner decision: view as demo person = yes) | Admin **Load demo data / Remove demo data**, `demo_data_batches`, fictional company structure (about 60 people), "Demo data" badges, **View as demo persona** (if approved) | Load demo data: the chart fills; view as an employee, then as the CEO; remove demo data: back to empty states with your real data intact | Decide on view-as (open question) | L |

## 4. Milestone 3: OKR and KPI engine

| ID | Stage | Delivers | Live check | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Objectives and key results (live, batch D) | CRUD for all four levels, measurement types, attainment math (shared library with tests), recording actuals, history, lifecycle | Create a company objective with three key results (percentage, number, boolean); record actuals; progress and attainment update; history shows entries | | L |
| 3.2 | Alignment and health (live, batch E) | Parent/child relationships with cycle check, assignments, publish leadership objectives, health computation plus hourly sweep, alignment-gaps report | Link a department objective to the company one; the tree shows contribution; an objective past pace turns **at risk** with its reason; a non-manager employee sees the published company objective read-only | | L |
| 3.3 | KPI definitions (live, batch E) | KPIs, frequency, direction, aggregation, assignments to person/team/department/designation/role family, thresholds | Create "Qualified leads", assign to a role family, set warning and critical thresholds | | M |
| 3.4 | KPI measurements and trends (live, batch E) | Append-only measurements, supersede (correction), coverage and **missing-period display**, trend chart with threshold lines, KPI overview | Record three monthly values, skip one: the chart shows a gap and "1 missing", not a zero; correct a value and see both rows in history | | L |
| 3.5 | OKR and KPI polish (live, batch E) | List filters, empty states, extended demo seed (objectives, key results, KPI history) | With demo data, browse OKRs and KPIs with filters; remove demo data cleanly | | M |

## 5. Milestone 4: Task management and evidence

| ID | Stage | Delivers | Live check | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| 4.1 | Tasks core (live, batch B; owner decisions: statuses follow a workflow, assignees update their own work, creator and managers edit) | Tasks, assignment to person/team, status workflow, updates, comments, basic My Work list | Create a task, assign it, move it through statuses, comment; as the assignee see it in My Work | | L |
| 4.2 | Links, dependencies, outcomes (live, batch D; KPI links arrive with 3.3) | Link to objective/key result/KPI, dependencies with cycle check, estimate vs actual, recorded outcome and reviewer quality, unaligned-work report | Link a task to a key result; add a dependency (cycle refused); complete it and record the actual result; see "unaligned tasks" | | L |
| 4.3 | Evidence | Evidence CRUD, links to objectives/key results/measurements, verification workflow, confidentiality levels, small file upload stored in the database (capped), authenticated download | Attach a link and a small PDF to a task; verify it; try opening the file from another organization (denied); a restricted item is hidden from a normal employee | | L |
| 4.4 | My Work dashboard (live, batch B) | Daily workspace (today/pending/overdue/upcoming/priorities/linked objectives/KPI progress/achievements), daily update form, **rule-based suggested order** | Open My Work as a demo employee; submit a daily update | | M |
| 4.5 | Notifications and overdue job (live, batch B) | In-app notifications, preferences, `automation_events` written for task events, overdue and due-soon jobs on the tick | Wait for a tick: the bell shows overdue tasks; mark read; change a preference | | M |
| 4.6 | Task demo seed and checkpoint | Demo tasks, updates, evidence; walk Scenario 3 (daily execution) end to end | Employee updates a task with evidence; the manager sees the update; key result progress changes after the recorded outcome | | S |

## 6. Milestone 5: Performance engine

| ID | Stage | Delivers | Live check | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Scoring engine (batch F) | Pure engine, provider registry, role-model templates, `scoring_models` CRUD with versions, **what-if calculator**, golden and property tests | Settings → Scoring: pick the Employee model, enter 85/90/80/90 → **86.5**; remove the KPI value → **85.0, provisional, 70% coverage**; only one component → "insufficient" | | L |
| 5.2 | Scorecards from real data (batch F) | Periods, input collector, score runs, components with inputs, deterministic explanation, scorecard page with **"How was this calculated?"**, verify action | Open a demo person's scorecard; expand each component to its records; press Verify (matches); see a "missing" chip where data is absent | | L |
| 5.3 | History and recalculation (batch F) | Close period, nightly recalculation, immutable run history, trends and period comparison | Close last quarter; see run history; compare two quarters | | M |
| 5.4 | Peer and department comparison (batch F; department comparison compares people inside a department) | Cohorts by role family as of the period, percentile/z-score rules, context factors, saved comparisons, privacy rules | Compare demo project managers (names visible to a manager with permission); as an employee see only your own position; cross-role comparison refused | | L |
| 5.5 | Mentorship (batch F) | Assignments, activities, progress, effectiveness calculation with factors disclosed, mentor model | Assign mentees, log an activity, see the mentor's development component and the caveats; compare mentors | | L |
| 5.6 | Leadership accountability and reviews (batch F; executive KPIs wait for an owner decision) | CEO / department head / manager providers, contribution chain, reviews with private notes and visibility rules, demo score seed | Open the CEO scorecard (no task component); see a department's contribution to a company objective; write a review with a private note and confirm the employee cannot see it | | L |

## 7. Milestone 6: Dashboards

| ID | Stage | Delivers | Live check | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| 6.1 | Overview dashboard (live, batch C) | Capability-adaptive widgets, getting-started checklist | View as employee, manager, department head, CEO: different widgets, all from real rows | | M |
| 6.2 | Team Performance (batch G first version, batch H full) | Team page and manager/department views | Open a team: objectives, KPIs, task distribution, members, mentorship | | M |
| 6.3 | Performance Intelligence page | Scorecards, compare, trends, evidence tabs with charts | Walk the tabs with demo data; chart gaps for missing data; "view as table" | | M |
| 6.4 | Leadership dashboard (batch G first version, batch H full; no waterfall) | Company performance, strategic objectives, department contribution, executive KPIs, risks, drill-down, waterfall | Click Company → Department → Team → Individual | | L |
| 6.5 | Historical analytics (batch H: date range on Leadership only) | Date-range filter everywhere (7 days to custom), period comparison | Switch presets; compare this and last quarter | | M |

## 8. Milestone 7: AI Intelligence

| ID | Stage | Delivers | Live check | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| 7.1 | Provider wrapper and run logging (only the rule-based insights page exists, batch G; no provider) | `AiProvider` interface, viaSocket provider, Anthropic provider stub, settings, `agent_runs`/`agent_run_steps`, **"AI is not configured"** states, fake-provider test suite, model ids verified against viaSocket's current `ai.md` | AI Intelligence shows "AI is not configured" until you set the keys; after Apply, "Test AI connection" works; the run appears in history | viaSocket keys on Embarko; workspace AI credits | M |
| 7.2 | Tools, orchestrator, chat, Performance Analysis | Tool layer, orchestrator, grounding and number guards, chat with references, first agent | Ask "Explain my score": the answer cites records; numbers match the scorecard; an out-of-scope question is refused politely | | L |
| 7.3 | Daily Planner and Copilot | Planner agent with rule ranking and validated task ids | My Work → "My plan for today": every item is a real task with its objective | | M |
| 7.4 | Risk Detection | Detectors, hourly job, AI explanations, projections with intervals | Demo risks appear **without AI** labelled "Rule-based"; with AI the explanation and corrective actions are added; a projection shows its interval or "insufficient history" | | L |
| 7.5 | Goal Alignment and approvals | Alignment agent, proposals, approval requests, execute-as-approver | Ask for alignment gaps; approve a suggested key result; reject another; see the audit trail | | L |
| 7.6 | Comparison and Leadership agents | Both agents with their guards | "Compare our project managers"; "Which department is falling behind?" | | M |
| 7.7 | AI Intelligence Center complete | Insights feed, risk alerts, recommendations, run history with step logs, approvals tab, example prompts, redaction modes | Open a run's step log; switch redaction mode and see names vs aliases in the stored prompt summary | | M |

## 9. Milestone 8: viaSocket integration

| ID | Stage | Delivers | Live check | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| 8.1 | Embed spike and token (only the status page exists, batch G; nothing is connected) | Live proof the embed renders on Embarko with a real token; `POST /integrations/viasocket/token`; `ViaSocketEmbed` + `useViaSocketEmbedToken`; Integrations page; `check:viasocket`; re-verify the two component names | Integrations shows the embedded viaSocket UI; connect an app inside it | viaSocket keys typed on Embarko (see [viasocket-integration](viasocket-integration.md) section 9) | M |
| 8.2 | Slots and connected accounts | Flow events, server read-back, encrypted storage, slot cards, test send, `viasocket.sync`, alerts endpoint | Build a Slack flow in the embed, bind it to `notify_slack`, press Test: a labelled message arrives; pause the flow in viaSocket and see the slot turn paused after sync | You build the Slack/Gmail flows; add the alert addresses | L |
| 8.3 | Events, outbox, dispatcher | Event catalog, rules, transactional outbox, dispatcher with backoff, execution history, retry/cancel, idempotency | Assign a task: a message goes out; break the flow: attempts back off and end `dead` with an admin notification; retry works; repeating the action does not duplicate | | L |
| 8.4 | Backend-triggered workflows | The eight events from master section 14.B wired with dedupe keys, quiet hours, content policy, daily-update summary | Trigger each event (using "send test event" in Rules) and see it in history | | L |
| 8.5 | Notification channels, reports and inbound evidence | External notification preferences, report distribution, review reminders, **authenticated inbound evidence endpoint** (a viaSocket flow, for example on a merged GitHub pull request, posts unverified evidence into Zentro) | Close a period: the report goes to authorized recipients only; run a test flow that posts evidence: it appears as **unverified** until you verify it | A viaSocket flow for the inbound test (optional) | M |
| 8.6 | AI-approved integration actions | Approved automation policy, auto-approval for low-risk notifications, end-to-end Scenarios 7 and 8 | Ask the AI to notify a manager about a risk: it proposes, you approve, it sends once | | M |

## 10. Milestone 9: Production readiness

| ID | Stage | Delivers | Live check | Needs from you | Size |
| --- | --- | --- | --- | --- | --- |
| 9.1 | Security review | Threat model walk-through, headers, cookie flags, rate limits, secret and dependency scan, route fuzzing; fix list | Report listing findings and fixes | | M |
| 9.2 | Full isolation and permission matrices | Matrices cover every route; Scenario 9 | Two-organization checklist; role matrix verified | | M |
| 9.3 | Performance | 300-person seed, `EXPLAIN QUERY PLAN` review, indexes, memory under 256 MB, bundle size | Load the 300-person demo; dashboards stay responsive | | M |
| 9.4 | Operations | Error and logging pass, data export, nightly snapshot copy, restore drill, migration verification (fresh vs upgrade), System panel | Export all data; restore a snapshot locally; System panel shows jobs | | M |
| 9.5 | Documentation and acceptance | `deployment.md`, README, runbook notes, walk all nine acceptance scenarios on the live link, refresh known-limitations | Guided demo script | | M |

---

## 11. How the 9 original milestones map

| Original milestone | Stages |
| --- | --- |
| 1 Product architecture and foundation | Blueprint = Milestone 0; 1.1 to 1.3 |
| 2 Authentication and organization management | 2.1 to 2.8 |
| 3 OKR and KPI engine | 3.1 to 3.5 |
| 4 Task management | 4.1 to 4.6 |
| 5 Performance engine | 5.1 to 5.6 |
| 6 Dashboards | 6.1 to 6.5 |
| 7 AI Intelligence | 7.1 to 7.7 |
| 8 viaSocket integration | 8.1 to 8.6 |
| 9 Production readiness | 9.1 to 9.5 |

## 12. Coverage: where each master requirement is built

| Master section | Built in |
| --- | --- |
| 3 Organizational structure, chart | 2.5, 2.6, 2.7 |
| 4 OKR management, Goal Alignment | 3.1, 3.2, 7.5 |
| 5 KPI management | 3.3, 3.4 |
| 6 Tasks, daily dashboard, AI Daily Planner | 4.1 to 4.4, 7.3 |
| 7 Scoring engine | 5.1 to 5.3 |
| 8 Peer comparison, vertical accountability, mentorship | 5.4, 5.5, 5.6 |
| 9 Leadership/CEO dashboard | 5.6, 6.4 |
| 10, 11 AI agents and Intelligence Center | 7.1 to 7.7 |
| 12 Evidence | 4.3 (+ links in 3.x/5.x) |
| 13 The eleven application modules | 6.1 to 6.5 plus each module's own stages |
| 14 viaSocket (embed, backend automations, AI actions, outbox) | 8.1 to 8.6 |
| 15 Auth and RBAC, multi-tenant security | 2.1 to 2.4, 9.1, 9.2 |
| 16 Database | migrations in every stage; checklist in [database-design](database-design.md) section 7 |
| 17 Stack | 1.1 to 1.3 |
| 18 UI/UX | 1.3 and every UI stage |
| 19 API | every stage; [api-documentation](api-documentation.md) |
| 20 Business logic rules | spread; each rule has a test named in the owning stage |
| 21 Notifications | 4.5 (in-app), 8.4, 8.5 (external) |
| 22 Historical data and date ranges | 5.3, 6.5 |
| 23 Testing | every stage's definition of done; 9.2 |
| 26 Acceptance scenarios | 1: 2.7, 2.8 · 2: 3.2, 4.2 · 3: 4.6 · 4: 5.2 · 5: 5.4 · 6: 5.6, 6.4 · 7: 7.5 to 7.7 · 8: 8.6 · 9: 9.2 |

## 13. Cross-stage notes

- **Demo data grows with the product.** Each stage that adds tables extends the seed and the removal order, so any stage can be demoed with realistic rows.
- **First things I need from you** (and when): deploy token and app name (stage 1.1); `SESSION_SECRET` and `ENCRYPTION_KEY` (1.2); registration policy (2.1); viaSocket keys (7.1 if AI goes through viaSocket, and 8.1); Slack/Gmail logins inside the embed (8.2).
- **Rollback:** Embarko's rollback does not roll back `DATA_DIR`, so each stage's migrations are additive; a destructive migration is split across two stages with a deploy in between.
- **If stage 1.1 fails:** the fallback order is `tsx` at runtime (still TypeScript), then plain JavaScript for the backend (Curevia's proven shape). I will report which, and nothing later changes except the build scripts.
