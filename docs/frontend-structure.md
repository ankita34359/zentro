# Zentro: Frontend Structure

Covers master sections 13, 17 (frontend), 18 and 21. Stack (unchanged by the overrides): **React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui, React Router 7, TanStack Query 5, Recharts 3, React Hook Form, Zod**. It is built to a static bundle by `vite build` into `dist/` and served by the same Express process as the API (one Embarko app).

Principles (from master sections 18 and 27):

1. **The frontend is never an authority.** It hides controls the user cannot use, for convenience; the server enforces permissions and computes every number. No score, status or permission is calculated in the browser.
2. **Every visualization reads real API data.** No hardcoded numbers anywhere in production views. Demo data is real rows flagged `is_demo`.
3. **Missing is shown as missing**, not as zero (gaps in charts, "No data recorded" chips).
4. **Every screen has loading, empty (with onboarding guidance), and error states**, and destructive actions ask for confirmation.
5. **No secrets in the browser.** Auth is an httpOnly cookie; the viaSocket embed token lives in memory only.

Related: [api-documentation](api-documentation.md), [permission-model](permission-model.md), [scoring-architecture](scoring-architecture.md).

---

## 1. Folder structure

```
frontend/
├── index.html
├── vite.config.ts                  # root: frontend, outDir: ../dist, proxy /api → :3000 in dev
├── tsconfig.json
└── src/
    ├── main.tsx  App.tsx           # providers: QueryClient, Router, Auth, Theme, Toaster
    ├── config/public.ts            # non-secret constants only (VITE_* cannot come from env on Embarko)
    ├── routes/                     # route table, guards (RequireAuth, RequireCapability), lazy imports
    ├── layouts/                    # AppShell (sidebar + header), AuthLayout, PageLayout
    ├── contexts/                   # AuthContext (me, capabilities), ThemeContext, DateRangeContext
    ├── services/                   # api.ts (fetch wrapper), one file per module: objectives.ts, kpis.ts, tasks.ts…
    ├── hooks/                      # TanStack Query hooks per module: useObjectives, useKpiHistory, useScorecard…
    ├── types/                      # generated/re-exported from shared/ (Zod-inferred), UI-only types
    ├── lib/                        # format (dates, numbers, units), a11y helpers, chart helpers, cn()
    ├── components/
    │   ├── ui/                     # shadcn/ui primitives (copied in, themed)
    │   ├── common/                 # EmptyState, ErrorState, ConfirmDialog, DataTable, DateRangeFilter, PeriodSelect…
    │   ├── org/                    # OrgChart, PersonCard, PersonPicker, ScopePicker, DesignationBadge…
    │   ├── okr/                    # ObjectiveTree, ObjectiveCard, KeyResultRow, ProgressBar, HealthBadge…
    │   ├── kpi/                    # KpiTrendChart, KpiSparkline, ThresholdBands, MeasurementForm…
    │   ├── tasks/                  # TaskTable, TaskBoard, TaskDrawer, DependencyList, DailyPlan…
    │   ├── evidence/               # EvidenceList, EvidenceUploader, VerificationBadge
    │   ├── performance/            # ScoreCard, ScoreBreakdown, DataStateChip, ConfidenceMeter, FormulaExplainer,
    │   │                           # CohortChart, ContributionWaterfall, MentorshipPanel
    │   ├── ai/                     # ChatPanel, InsightCard, RefChip, ApprovalCard, AgentRunTimeline, AiNotConfigured
    │   ├── leadership/             # StrategicObjectivesPanel, DepartmentContribution, ExecutiveSummary
    │   └── integrations/           # ViaSocketEmbed, useViaSocketEmbedToken, SlotCard, OutboxTable, RuleEditor
    └── pages/
        ├── Auth/                   # Login, Register, ForgotPassword, ResetPassword, AcceptInvite, CreateOrganization
        ├── Dashboard/              # Overview (role-adaptive widgets)
        ├── Organization/           # Chart, Departments, Teams, People, PersonProfile, Designations
        ├── OKRs/                   # List, Tree, Detail, Editor
        ├── KPIs/                   # List, Detail, Editor
        ├── Tasks/                  # MyWork, TaskList, DailyUpdate
        ├── TeamPerformance/        # TeamPicker, TeamDashboard
        ├── Performance/            # Scorecard, Compare, Trends, Mentorship, Reviews, Evidence
        ├── AIIntelligence/         # Chat, Insights, Risks, Approvals, History, RunDetail
        ├── Leadership/             # Dashboard, Drilldown
        ├── Integrations/           # Connected apps (embed), Slots, Automation history, Rules
        ├── Notifications/
        └── Settings/               # Organization, Users, Roles, Scoring, KpiConfig, Notifications, Audit, AI, System, Demo, Profile
```

---

## 2. Navigation and routes

Left sidebar exactly as in master section 18, items hidden when the user has no capability for them (computed from `GET /api/auth/me`, which returns the caller's permission keys with scope modes and feature flags such as `aiConfigured` and `viasocketConfigured`). A hidden item is a convenience only; the route guard and the API both re-check.

| Sidebar item | Route | Shown when the caller has |
| --- | --- | --- |
| Overview | `/overview` | always |
| Organization | `/organization` (+ `/departments`, `/teams`, `/people`, `/people/:id`, `/designations`) | `org.view` |
| OKRs & Goals | `/okrs` (+ `/okrs/:id`, `/okrs/new`) | `okr.view` or published leadership objectives (always) |
| KPIs | `/kpis` (+ `/kpis/:id`) | `kpi.view` (own KPIs always) |
| My Work | `/my-work` (+ `/my-work/tasks`, `/my-work/updates`) | always |
| Team Performance | `/team-performance` (+ `/:teamId`) | any team-scope grant (`okr.view`, `task.view`, `performance.view_scores`) beyond own |
| Performance Intelligence | `/performance` (+ `/scorecards/:subject`, `/compare`, `/trends`, `/mentorship`, `/reviews`, `/evidence`) | own scorecard always; others by `performance.*`, `mentorship.view`, `reviews.*` |
| AI Intelligence | `/ai` (+ `/insights`, `/risks`, `/approvals`, `/history`, `/runs/:id`) | `ai.use` |
| Leadership | `/leadership` (+ `/drilldown/:level/:id`) | `leadership.view` |
| Integrations | `/integrations` (+ `/slots`, `/automations`, `/rules`) | `integrations.view` |
| Settings | `/settings/*` | any of `org.settings`, `roles.view`, `performance.configure`, `audit.view`, `ai.configure`, … (Profile and Notifications always) |
| (header) Notifications | bell → `/notifications` | always |

Public routes: `/login`, `/register`, `/forgot-password`, `/reset-password/:token`, `/accept-invite`, `/onboarding` (create organization, shown to a signed-in user with no membership).

Route guards: `RequireAuth` (redirects to `/login?next=`), `RequireCapability(permission)` (renders a 403 page; the API also returns 403/404). Pages are lazy-loaded per route; Recharts and the viaSocket embed are separate chunks.

---

## 3. Pages and what each shows (master section 13)

All data comes from the API; "Empty state" is what a brand-new organization sees.

| Page | Content | Key components | Empty state |
| --- | --- | --- | --- |
| **Overview** | Adapts to capabilities (not job titles): organization performance, objective achievement, KPI health, pending tasks, delayed objectives, department performance, recent achievements, AI insights. Preset by highest scope: personal, team, department, executive. | widget grid; `ProgressBar`, `HealthBadge`, `KpiSparkline`, `InsightCard` | "Getting started" checklist: create departments → invite people → set reporting lines → create a company objective → define KPIs → assign tasks (each links to the page; ticks when real data exists). Admin sees **Load demo data**. |
| **Organization** | Interactive org chart (expand/collapse, reporting lines vs department/team view), departments, teams, people table, designations, role families, reporting relationships with history, move a person, assign head/lead/mentor. Profile drawer: designation, teams, managers (current and past), objectives, KPIs, score if permitted. | `OrgChart`, `DataTable`, `PersonPicker`, `ScopePicker` | "Create your first department" with a one-minute guide |
| **OKRs & Goals** | Company/department/team/individual objectives, key results with target vs actual, health, deadlines, parent-child alignment tree, history, evidence, create/edit with owner and parent. Filters: level, status, owner, period. | `ObjectiveTree`, `KeyResultRow`, `HealthBadge`, `EvidenceList` | "Create the first company objective" |
| **KPIs** | Definitions, targets, thresholds, measurement history, trend charts with threshold lines, achievement %, **missing-data separated from poor performance**, assignments to roles/teams/people, compare equivalent roles. | `KpiTrendChart`, `ThresholdBands`, `MeasurementForm`, `DataStateChip` | "Define a KPI, assign it, record a measurement" |
| **My Work** | Personal daily workspace: today, pending, overdue, upcoming, priorities, linked objectives, KPI progress, recent achievements, **AI daily plan** (labelled AI; rule-based order shown even without AI), blockers; daily update form. Task drawer: updates, comments, dependencies, estimate vs actual, evidence, outcome. | `TaskTable`, `TaskDrawer`, `DailyPlan`, `EvidenceUploader` | "No tasks yet" with how tasks get assigned |
| **Team Performance** | Team objectives and KPIs, task progress, achievements, member performance (as permitted), mentorship effectiveness, team comparison. | `ProgressBar`, `ScoreCard` list, `MentorshipPanel`, `CohortChart` | "No team data in your scope yet" |
| **Performance Intelligence** | Scorecards with **"How was this calculated?"** (formula, component bars, data-state chips, confidence, contributing records, what would change it), history across periods, peer comparison, trends, reviews, evidence library, improvement recommendations (AI, labelled). | `ScoreCard`, `ScoreBreakdown`, `FormulaExplainer`, `ConfidenceMeter`, `CohortChart` | "Scores appear once objectives, KPIs and tasks have data" listing what is missing |
| **AI Intelligence** | Chat with references, insights feed, risk alerts, recommendations, agent history with step log, approval requests. If the provider is not configured: **"AI is not configured"** and what to set; rule-based alerts remain. | `ChatPanel`, `InsightCard`, `ApprovalCard`, `AgentRunTimeline`, `AiNotConfigured` | "Ask a question" with example prompts from master section 11 |
| **Leadership** | Company performance, strategic objectives and key results, revenue/growth KPIs, department contribution, executive KPIs, risks, delayed initiatives, trends, historical comparison, leadership accountability, executive summary (AI). Drill-down Company → Department → Team → Individual. | `StrategicObjectivesPanel`, `DepartmentContribution`, `ContributionWaterfall`, `ExecutiveSummary` | "Publish a company objective to start tracking strategy" |
| **Integrations** | Embedded viaSocket UI (connect apps, build workflows), slot cards, automation history (events, outbox status, attempts, retry), rules, trigger status. | `ViaSocketEmbed`, `SlotCard`, `OutboxTable`, `RuleEditor` | "viaSocket is not configured" listing missing setting **names** only |
| **Settings** | Organization, users and invitations, roles and permissions (matrix editor with scope modes), scoring models (weights editor, sum validator, what-if preview), KPI configuration, notification preferences, audit log, AI settings, system panel (jobs, outbox backlog), demo data, profile. | `RoleMatrix`, `ScoringModelEditor`, `AuditTable` | per section |

**Persistent notices:** a "Demo data" badge on flagged rows; a banner when viewing as a demo persona (read-only); a standing note on scorecards that scores are information and not employment decisions.

---

## 4. Key components

| Component | Behavior to get right |
| --- | --- |
| `OrgChart` | Custom tree (no heavy dependency): CSS layout with SVG connectors, expand/collapse, two views (reporting line / department-team), loads `GET /api/hierarchy/tree?root=&depth=2` and fetches deeper levels on expand so a 300-person organization stays fast. Keyboard accessible as an ARIA `tree` (arrows, Enter, Home/End); each node opens a side panel with objectives, KPIs and the permitted score; a list view is the small-screen fallback. |
| `ObjectiveTree` | Company → department → team → individual with contribution weights and health; collapsible; mark "unaligned" objectives; link to children/parents. |
| `ScoreBreakdown` + `FormulaExplainer` | Renders the server's `explanation_json` verbatim: weighted contribution bars, formula line, data-state chips (`ok` / `insufficient` / `missing`), confidence parts, contributor links, "what would change this". **Displays; never recomputes.** |
| `DataStateChip` | Distinguishes "No data recorded" (grey, dashed), "Not enough data (2 of 5)" (amber), and a real value including a real 0. Always has text, never color alone. |
| `KpiTrendChart` | Line with threshold `ReferenceLine`s, `connectNulls={false}` so missing periods are gaps, measurement markers show source and supersession; "View as table" toggle. |
| `CohortChart` | Peer position without names unless `performance.compare`; shows cohort size and context factors; refuses to render for mismatched role families (server returns 422). |
| `ChatPanel` | Posts the question, receives a run id, **polls** `GET /api/ai/runs/:id` every 2 s with a step indicator, renders the text, `references` as `RefChip`s, the system-generated Proposals block with approval status, and the "numbers not verified" badge when set. Answers render as plain text with a safe minimal formatting subset (no HTML injection). |
| `ViaSocketEmbed` | Loads `embed.viasocket.com/prod-embedcomponent.js` once, fetches a token via `useViaSocketEmbedToken`, mounts in a box with an explicit height, refreshes the token before expiry, forwards `flow` events to the server, destroys on unmount. Token held in memory only. |
| `ApprovalCard` | Shows exactly what will happen (action, target, payload preview, risk level, who asked, which AI run), Approve/Reject with a note, disabled with an explanation if the viewer lacks the underlying permission. |
| `DateRangeFilter` | Presets from master section 22 (last 7 days, last 30 days, this month, last month, this quarter, last quarter, this year, custom). State in URL search params; quarter boundaries follow the organization's fiscal start. Maps to a period where one exists, else an ad-hoc window (display-only scores). |
| `ConfirmDialog` | Required for archive department/team, end reporting relationship, revoke role, delete evidence, remove demo data, retry-all failed events. States the consequence. |

---

## 5. Data layer

- `services/api.ts`: one `fetch` wrapper (`credentials: 'same-origin'`, JSON), maps the error envelope (`{error:{code,message,details,requestId}}`) to a typed `ApiError`; 401 → clear auth cache and redirect to login; 503 `ai_not_configured` / `viasocket_not_configured` → typed errors the pages render as "not configured" states.
- Hooks per module wrap TanStack Query. Query keys are `[module, resource, params]`; mutations invalidate the affected keys; no optimistic updates for anything affecting scores or approvals (server truth first).
- **Polling hooks** (`useAgentRun`, `useOutboxStatus`) use `refetchInterval` until a terminal status, then stop.
- Forms use React Hook Form with `zodResolver` and the **same Zod schemas from `shared/`** the API validates with, so client and server agree. Server field errors map back onto fields.
- Pagination is server-side (`?limit&cursor`); tables never load all 300 people at once except in the org chart, which loads by depth.
- Dates: API sends ISO UTC; the UI formats in the organization's timezone (settings), calendar dates as plain `YYYY-MM-DD`.

---

## 6. Visualizations (all backed by API data)

| Chart | Where | Library / notes |
| --- | --- | --- |
| Objective progress bars | OKRs, Overview, Team | custom `ProgressBar` with expected-pace marker |
| KPI trend lines with thresholds | KPIs, Overview | Recharts `LineChart` + `ReferenceLine` |
| Department comparison | Leadership, Performance | Recharts `BarChart` (attainment, not output volume) |
| Performance trend lines | Performance, Leadership | Recharts `LineChart` over stored score runs; provisional points hollow |
| Task status distribution | My Work, Team | Recharts stacked bar or donut with counts |
| Strategic goal progress | Leadership | bullet/radial progress per company objective |
| Risk indicators | AI, Leadership | severity-sorted table with icon + label (not color alone) |
| Historical comparison (period vs period) | Performance, Leadership | grouped bars from `GET /api/performance/trends` |
| Contribution waterfall | Leadership drill-down | company → department → team contribution chain |

Every chart has: loading skeleton, empty state, accessible table alternative, no fabricated points, and gaps for missing data.

---

## 7. Design system and UX

- **Direction:** modern enterprise SaaS, clean and minimal; consistent 4 px spacing scale; Inter (variable, self-hosted via `@fontsource-variable/inter` as in Curevia, so no third-party font request); lucide icons; restrained palette with semantic colors for health (on track, at risk, delayed, completed, no data) that always pair color with an icon and label.
- **Tokens:** Tailwind 4 CSS variables for light and dark (follows system, user override stored in `user_preferences`).
- **Layout:** fixed left sidebar (collapses to a sheet below 1024 px), header with organization switcher, date range, notifications bell and user menu. Tables become stacked cards below 640 px; the org chart falls back to a list.
- **Feedback:** toasts for mutations (with the request id on errors), inline field errors, skeletons not spinners for page loads, empty states with a primary action, error states with retry and request id.
- **Accessibility target:** WCAG 2.1 AA for the main flows: semantic landmarks, labelled controls (Radix primitives via shadcn), visible focus, keyboard operable tree/table/dialogs, `prefers-reduced-motion`, contrast-checked tokens, chart table alternatives. Verified by component tests, an automated axe pass on key pages in M9, and a manual keyboard pass; full certification is out of scope (known-limitations).
- **Safety:** ESLint bans `dangerouslySetInnerHTML`; user and AI text is rendered as text; no tokens in `localStorage` (only non-sensitive UI prefs such as sidebar state, wrapped in try/catch).

---

## 8. Performance and build

- Route-level code splitting; Recharts, the embed and the markdown-lite renderer are lazy chunks. Target main bundle under about 250 KB gzipped.
- TanStack Query caching (30 s stale time for lists, longer for reference data like designations).
- Build: `vite build` with `root: 'frontend'`, `outDir: '../dist'`; `frontend/src/config/public.ts` holds public constants because `VITE_*` env values cannot reach the Embarko build. Express serves `dist/` and falls back to `index.html` for non-`/api` GET routes so deep links work.
- Dev: `npm run dev:client` (Vite proxy to the local API) and `npm run dev:server`.

---

## 9. Frontend tests (Vitest 3 + jsdom + Testing Library)

| Test | Proves |
| --- | --- |
| Nav by capability | Employee, manager, CEO fixtures see the expected sidebar items; hidden items are still blocked by guards |
| Guards | `/leadership` without `leadership.view` renders 403 |
| Data-state chips | `missing` ≠ 0; `insufficient` shows the count; a real 0 renders as 0 |
| Chart gaps | A null measurement renders a gap and the table alternative says "No data" |
| Forms | Shared Zod schemas produce the same errors as the API; server field errors map to inputs |
| Not-configured states | AI and viaSocket 503s render the right empty state with names of missing settings |
| ChatPanel | Polls until terminal; shows Proposals block from system data; shows the unverified-numbers badge |
| ConfirmDialog | Destructive actions do nothing until confirmed |
| Token handling | Embed token refresh timer; token not written to storage |
