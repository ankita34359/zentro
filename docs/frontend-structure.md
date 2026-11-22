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

Public routes: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/onboarding` (create organization, shown to a signed-in user with no membership). **Changed in 2.2:** the reset token and the invitation code travel in the URL **fragment** (`/reset-password#token=…`, `/accept-invite#code=…`), never in the path or query, so no server, proxy log or Referer header ever sees them.

**Settings (2.2).** `/settings` is a real index (Users and invitations, Profile); `/settings/users` (invitations: invite, copy the one-time link, new link, revoke with a confirmation; people: generate a reset link) and `/settings/profile` (account details and Change password). Since 2.3 what shows follows the permissions in `me.capabilities` (`useAuth().can(key)`): the sidebar hides items that need a permission the person lacks (items without `requires` always show), Settings lists only what the person can open (Profile always), `RequireCapability` shows a clear "no access" page for a direct visit, and Users shows the invite form, the invitation list and the people list according to `invitations.manage` and `people.manage`. All of this is convenience: the server enforces access. `/settings/roles` is the role editor (2.4): a grid of permissions by scope mode (cells the catalogue forbids, or that you do not hold, are disabled with a reason; unticking is always allowed), "N to add, M to remove", a confirmation tick for sensitive additions, Save/Discard, New role (empty or a copy), rename, and Archive with confirmation; the Owner role shows as protected and view only; people with only `roles.view` see the same grid read only. The Users screen's people list shows each person's roles (take one away, with confirmation), **Assign role** (role, "applies to" with department and team disabled until 2.5, optional end date), **Remove from organization** (two clicks; the login stays) and the reset link; people with no role show "No role". `/settings/audit` (`audit.view`) lists entries newest first with who and when, expandable before/after details, a filter by action and dates, and "Load older entries". Previously `/settings/roles` was a read-only roles screen; Profile has Change password and **Delete my account**, which asks the server what would happen first (account only / account and organization / blocked) and shows a clear warning before anything can be confirmed. `OneTimeLink` shows a link the server will not show again, with a Copy button; it exists only in component state.

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
- **Tokens:** Tailwind 4 CSS variables for light and dark (follows system, user override stored in `user_preferences`). Since stage 1.4 they live in one file, `frontend/src/styles/tokens.css`; see section 11.
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

## 9. Frontend tests (Vitest 4 + jsdom + Testing Library)

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

---

## 10. What stage 1.3 built (frontend foundation)

| Piece | Where | Notes |
| --- | --- | --- |
| Design tokens | `src/styles.css` | Tailwind 4 with CSS variables for light and dark (`.dark` class on `<html>`), semantic `success` / `warning` / `destructive` tokens that are always paired with an icon and words. Measured in a real browser: smallest text contrast ratio 6.1 (light) and 7.1 (dark), above the 4.5 AA minimum. Inter Variable is self-hosted through `@fontsource-variable/inter`. |
| UI primitives | `src/components/ui/` | shadcn-style, hand-copied (no CLI): `Button`, `Card`, `Badge`, `Skeleton`, `SheetLeft` (Radix Dialog). Add more only when a stage needs them. |
| Shared components | `src/components/common/` | `EmptyState`, `ErrorState` (message, request id, retry; never prints an unexpected error's text), `PageSkeleton`, `PageHeader`, `StatusPill`, `ThemeToggle`, `Brand`. |
| Shell | `src/layouts/` | `AppShell` (skip link, sidebar, header, main landmark, focus moved to the page after navigation, document title per page), `SidebarNav` (shared by the fixed sidebar and the phone sheet). |
| Navigation | `src/routes/navigation.ts` | The eleven items in master section 18 order. Each item can carry the permission key it will need (`requires`); until sessions exist (2.1, 2.3) every item is shown. |
| Routes | `src/App.tsx` | `/` redirects to `/overview`; each section is one lazy page; `/<section>/*` stays inside its section; anything else shows the 404 page inside the shell. |
| Theme | `src/contexts/ThemeContext.tsx` | Follows the operating system until the person chooses; the choice is stored in `localStorage` (wrapped in try/catch) and applied before the first render. A single toggle: light and dark. |
| API client | `src/services/api.ts` | Reads the envelope into a typed `ApiError` (`api`, `bad_response`, `network`), survives non-JSON proxy pages, exposes `notConfigured()` for 503 "not configured" answers and a 401 hook that stage 2.1 will use. `src/services/system.ts` + `src/hooks/useHealth.ts` read `/healthz`. |
| Config | `src/config/public.ts` | Non-secret constants only (a test checks the file for secret-looking words). |
| Placeholders | `src/pages/` | `OverviewPage` (getting-started steps with the stage that builds each, and a live "Server status" card from `/healthz`), `SectionPage` + `sections.ts` (the empty-state wording from section 3 and a "Planned for stage N" badge), `NotFoundPage`. No numbers or sample data. |
| Tests | `tests/frontend/` | Navigation (eleven items, order, hrefs, `aria-current`, phone menu, focus), routes and 404, theme (system, saved choice, storage failure), API client, components, and source-level safety rules (no `dangerouslySetInnerHTML`, browser storage only through `lib/safeStorage.ts`, no `VITE_*`). |

**Built in 2.1:** `contexts/AuthContext.tsx` (who is signed in, from `GET /api/auth/me`; a 401 from any API call signs the browser out), `routes/RequireAuth.tsx` (signed out → `/login` and back; signed in without an organization → `/onboarding`), pages `/login`, `/register`, `/onboarding` (`pages/auth/`, `layouts/AuthLayout.tsx`), `components/common/UserMenu.tsx` (name, organization and Log out in the header; an initial on phones; a Sign in link on public pages when signed out), `FormField`/`FormAlert`/`FormNotice`, plain controlled forms (no form library yet: three small forms; React Hook Form arrives with the first large form). Public pages when signed out: `/login`, `/register`, `/onboarding` (redirects), `/design` and the 404 page. The browser never decides access; the guards only choose the screen.

Not built yet (by design, later stages): permission-based route guards (2.3), organization switcher, date-range filter, notifications bell, toasts, the data-table and confirm-dialog primitives, charts.

---

## 11. Visual design system and motion (stage 1.4, added at the owner's request)

Goal: calm, trustworthy, data-first, professional. Everything below is implemented; review it live on the unlisted page `/design` (not in the sidebar). **Frontend only: no API, database or backend change.**

### 11.1 One file decides the look

`frontend/src/styles/tokens.css` holds, as Tailwind 4 theme variables: the raw palette, the semantic roles for light and dark, the type scale, radii, shadows, layout sizes and motion timings. `styles.css` imports it and holds only base rules, the few shared component rules (card, skeleton, pulse, glow, sheet, indicator) and the reduced-motion overrides. **Retune the whole look by editing `tokens.css`.** Components use token names (`bg-card`, `text-on-track-ink`, `rounded-xl`, `shadow-md`, `text-heading`), never raw values: `tests/frontend/tokens.test.ts` fails on any hex, `rgb()`, `hsl()` or `oklch()` outside `tokens.css`, on any hard-coded animation duration, if a themed role is missing in dark mode, or if `lib/motion.ts` drifts from the CSS timings.

### 11.2 Palette: "Aurora indigo" (confident and vivid, not neon)

| Group | Tokens | Use |
| --- | --- | --- |
| Brand indigo | `brand-50` to `brand-950` (500 = bright solid indigo, 600 = primary) | Primary text and links, focus ring, borders, icons |
| Violet and orchid | `violet-400..700`, `orchid-300..700` | The gradient's middle and end; orchid is the one accent |
| Lavender-grey neutrals | `slate-50` to `slate-950` | Reference ramp; components use the roles below |
| **Brand gradient** | `--brand-from/via/to` = indigo `#4F46E5`, violet `#8B5CF6`, orchid `#D946EF`; `--gradient-brand` at 135 degrees | Logo tile, active sidebar indicator, progress ring and bar, the glow behind page headings, the card hover border |
| Gradient under text | `--gradient-brand-strong` (`--strong-from/via/to` = `#4F46E5`, `#7C3AED`, `#A21CAF`) | Primary button fill. White text on the exact gradient is only about 4.2:1 (violet) and 3.7:1 (orchid), so the button uses the same hues deepened, which keeps white above 4.5:1 on every stop |
| Gradient text | `--text-from/via/to`, per theme (light `#4F46E5`, `#7C3AED`, `#A21CAF`; dark `#818CF8`, `#A78BFA`, `#F0ABFC`), class `text-gradient` | Hero metric numbers and the ring label. Every point along the gradient is above 4.5:1 on cards and the page |
| Light surfaces | `background` `#F4F5FB` (very light cool lavender-grey), `card` white, `raised` white, `muted`, `border`, `sidebar` | Crisp white cards on a lavender page, indigo-tinted soft shadows, gradient glows |
| Dark surfaces | `background` `#070B1A` (deep navy), `card` `#0E1530`, `raised` `#151D3F` | Layered: page < card < raised. Fine 1px borders, a faint top highlight on cards (`--card-highlight`), a soft indigo/violet ambient glow in the top corners. No pure black |
| Text roles | `foreground`, `muted-foreground`, `primary` (indigo text), `primary-ink` (small indigo text that may sit over a glow: eyebrows, links) | |
| **Status (fixed meaning, unchanged)** | `on-track` (emerald), `at-risk` (amber), `off-track` (rose), `info` (sky), each with `-soft` and `-ink` | `StatusBadge` and `Badge` variants, always icon plus words |
| **Data series (for charts in later stages)** | `series-1` indigo `#6366F1`, `series-2` teal `#14B8A6`, `series-3` orchid `#D946EF`, `series-4` gold `#F59E0B`, `series-5` sky `#38BDF8`, `series-6` lime `#84CC16` | Six distinct hues chosen to stay apart under common colour-blindness. **Always give a series a legend entry or a label, and a marker shape (circle, square, diamond, triangle, ring) when several share a chart. Never use them to mean a status.** |

Rules: **status colours mean exactly one thing** (emerald only "on track", amber only "at risk", rose only "off track", sky only "information"). The accent and the series colours are never used to signal state. Small text that can sit over a glow uses `primary-ink`, not `primary`.

### 11.3 Typography

Inter variable, self-hosted from `@fontsource-variable/inter` (no external font link or CDN). Scale (utility, size, role): `text-hero` 2.75rem bold tabular gradient (hero metrics), `text-display` 2rem bold tabular (big numbers), `text-title` 1.75rem bold, letter-spacing -0.035em (page titles), `text-heading` 1.0625rem semibold, -0.02em (card and section headings), `text-body` 0.9375rem, `text-label` 0.8125rem (controls, nav, table headers), `text-caption` 0.75rem, `text-overline` 0.6875rem (tiny uppercase section labels; the `eyebrow` utility adds uppercase and weight). **Metrics and any column of numbers use `tabular-nums`.** `lib/cn.ts` teaches `tailwind-merge` these custom sizes; without that it read `text-label` as a colour and silently dropped it next to another `text-*` class (found and fixed in 1.4's colour refresh, with a test).

### 11.4 Shape, depth and layout

Radii `sm` to `2xl` (`rounded-lg` controls, `rounded-xl` cards). Shadows `xs`, `sm`, `md`, `lg` and `glow` are tinted by the theme (`--shadow-ink`: indigo in light, deep navy in dark). Cards: fine border, soft shadow, a faint inner top highlight (visible in dark), a 2 px hover lift and a **gradient border glow on hover and on keyboard focus-within** (a masked `::before` that fades in; shadow only under reduced motion). Pages have an ambient glow in the top corners (`body::before`, fixed) and the page header carries the brand-gradient glow by default (`PageHeader glow`, three soft radial lights). The header has a soft blur. The sidebar is grouped (Strategy, Execution, Insight, System; the eleven items keep the master order) with one indicator (a tinted wash plus a gradient bar) that slides to the active item. Every page starts with a tiny uppercase eyebrow (its sidebar group) over a bold, tight title. Layout tokens: `--sidebar-width` 16rem, `--header-height` 3.5rem, `--page-max-width` 72rem.

### 11.5 Motion rules (later stages must follow these)

1. **Purposeful and restrained.** Motion explains a change (a page arrived, a value counted up, a panel opened). No decorative movement.
2. **Timing.** Interface motion is **150 to 350 ms**: `--duration-fast` 150, `--duration-base` 220, `--duration-slow` 350. Data reveals (count-up, ring, bar) may take up to **700 ms** (`--duration-data`). Stagger step is 50 ms. Easing is `--ease-out` for entrances and `--ease-in-out` for exits. Use the tokens, not numbers.
3. **Never block content, never shift layout.** Animate only `opacity` and `transform` (and the width of a bar inside a fixed-size track). No exit animations on navigation. Content is visible and usable from the first frame.
4. **Nothing loops** except two things: the Online pill pulse, and the skeleton shimmer, which runs only while something is loading.
5. **Reduced motion is honoured fully** (the operating system's setting): no transform is ever applied, not even for one frame; the page and cards fade only; count-up, ring and bar show their final value at once; the sidebar indicator jumps; the phone menu fades; hover lift is shadow only; the pulse and the shimmer stop. CSS rules live in `styles.css`; the motion library is set to `reducedMotion="user"` and components that animate other properties also check `useReducedMotion()`.
6. **Failure-safe.** The animation engine is a separate lazy chunk. Until it has loaded, every animated component renders in its final state (a test blocks the chunk and checks nothing is hidden). Read `useMotionReady()` once at mount to decide whether to play an entrance.
7. **Small and lazy.** Use `LazyMotion` with the `m` components (never the full `motion` component; the provider is `strict`). Keep heavy pieces off the first paint (the phone menu and `/design` are separate chunks). **Main entry chunk must stay under 150 KB gzipped**; total first-load JavaScript is tracked in PROGRESS.md.
8. **Where each effect lives.** `motion` library: page transition (`PageTransition`), staggered entrance (`Stagger`, `StaggerItem`), progress ring and bar (`ProgressRing`, `ProgressBar`). CSS: card lift, sidebar indicator, theme-icon morph, Online pulse, skeleton shimmer, phone-menu slide and blurred backdrop (robust and free of JavaScript). The count-up (`CountUp`) is a 20-line `requestAnimationFrame` tween on the same easing curve, because motion's `animate()` added about 13 KB gzipped to the first load.

### 11.6 Components added in 1.4 (and the colour refresh)

`StatusBadge`, `Metric` (hero number with an eyebrow label, counts up), `Illustration` (eleven in-code SVG illustrations filled with the brand gradient plus a second teal-to-sky hue; decorative, hidden from screen readers, built from tokens so they follow the theme), `EmptyState` (takes `illustration`), `PageHeader` (eyebrow, bold title, glow), `ProgressRing`, `ProgressBar` (tones: primary gradient, on-track, at-risk, off-track, info), `CountUp`, `PageTransition`, `Stagger`/`StaggerItem`, `MotionProvider`, `Badge` status variants, `Card` (`raised`, `lift`), `lib/contrast.ts`.

### 11.7 Contrast

Every text and background pair must be at least **4.5:1** in both themes, for every size (the stricter rule, not the 3:1 large-text allowance), **including text over glows, the ambient light, the blurred header, the gradient button and gradient text**. The `/design` page computes the token pairs for both themes live in the browser. The real check is pixel-based: in a real browser, all text is made transparent, the page is screenshotted, and each text node's colour is compared with every pixel behind it (for gradient text: every point along the gradient against every pixel behind it; for buttons also the hovered, brightened state; for the phone menu the text inside the open dialog). The measured numbers are in PROGRESS.md. After changing any colour in `tokens.css`, re-run that measurement.
