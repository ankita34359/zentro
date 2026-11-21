# Zentro: API Documentation

REST API under `/api`, organized by module, served by the same Express process as the web app. This is the **planned** contract (Milestone 0); it includes every endpoint suggested in master section 19 plus the ones the features need. Individual stages (see [milestones](milestones.md)) implement subsets, and this file is updated as each stage ships.

Related: [permission-model](permission-model.md) (permission keys and scope), [database-design](database-design.md), [scoring-architecture](scoring-architecture.md), [agent-specifications](agent-specifications.md), [viasocket-integration](viasocket-integration.md).

---

## 1. Conventions

| Topic | Rule |
| --- | --- |
| Format | JSON in and out (`Content-Type: application/json`). Dates `YYYY-MM-DD`; timestamps ISO-8601 UTC. Unknown request fields are **rejected** (Zod `.strict()`). |
| Auth | httpOnly cookie `zentro_session` (JWT carrying a session id). Non-GET requests must pass the same-origin check. No bearer tokens for browsers. |
| Tenant | The organization is the **session's active organization**. No endpoint takes an organization id to decide access. Where a path contains `:id` for an organization (master compatibility), it must equal the active organization or the answer is 404. |
| Permission | Each route declares one permission key. "(scope)" means the record's subject (person, team or department) must be in the caller's scope set for that key. Baseline self-service rights apply where noted. |
| Success | `{ "data": <payload>, "meta": { "requestId": "…", "page": { "limit": 25, "nextCursor": "…" } } }` (`page` only on lists). |
| Error | `{ "error": { "code": "validation_failed", "message": "…", "details": [ { "path": "key_results.0.target_value", "message": "Required" } ] }, "meta": { "requestId": "…" } }`. Messages never contain stack traces, SQL, secrets or other tenants' data. |
| Pagination | Cursor based: `?limit=25&cursor=…` (max 100). Sorting `?sort=field:desc` from a per-endpoint allow-list. |
| Filtering by time | `?from=YYYY-MM-DD&to=YYYY-MM-DD` or `?periodId=…`. |
| Async work | Long operations answer `202 { runId | jobId }` and are polled with the matching `GET`. |
| Idempotency | Natural keys, not headers: one daily update per person per date; measurements correct by supersede; events deduped by key. |
| Versioning | No version prefix; changes are additive. |

### Status codes and error codes

| Status | `error.code` examples | Meaning |
| --- | --- | --- |
| 400 | `validation_failed`, `invalid_json` | Body, query or params failed validation |
| 401 | `unauthenticated`, `session_expired` | No or expired session |
| 403 | `permission_denied` | Authenticated, permission missing (or action not allowed for this role even if the record is visible) |
| 404 | `not_found` | Missing, **in another organization, or out of scope** (indistinguishable by design) |
| 409 | `conflict`, `cycle_detected`, `already_exists`, `immutable`, `last_admin` | State conflict |
| 410 | `invitation_expired` | |
| 413 | `file_too_large` | Evidence file over cap |
| 422 | `cohort_mismatch`, `weights_invalid`, `insufficient_data` | Valid request, business rule refuses |
| 429 | `rate_limited` | Retry later (`Retry-After`) |
| 500 | `internal_error` | Logged with `requestId`; message is generic |
| 503 | `ai_not_configured`, `viasocket_not_configured`, `server_missing_settings`, `ai_credits_exhausted` | Optional capability not set up (names of missing settings only) |

Rate limits (per IP or session): login/register/reset 10 per 15 minutes; token endpoint 20 per minute; AI runs 10 per minute per user and the organization daily cap; everything else 300 per minute per session.

---

## 2. Authentication

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | public, subject to `REGISTRATION_MODE` | `{email, password, name, registrationCode?}` creates a user only |
| POST | `/api/auth/login` | public | `{email, password}` → sets cookie, returns `me` |
| POST | `/api/auth/logout` | session | Revokes the session row |
| GET | `/api/auth/me` | session | User, memberships, active organization, **capabilities** (permission keys with scope modes), flags (`aiConfigured`, `viasocketConfigured`, `demoLoaded`) |
| POST | `/api/auth/switch-organization` | session | `{membershipId}` (must belong to the caller) |
| POST | `/api/auth/forgot-password` | public | Always `202` (no account enumeration) |
| POST | `/api/auth/reset-password` | token | `{token, password}`; revokes all sessions |
| POST | `/api/auth/verify-email` | token | When the platform email flow exists |
| POST | `/api/auth/accept-invitation` | session or register | `{code}` binds the invited membership to the caller |
| POST | `/api/auth/change-password` | session | `{currentPassword, newPassword}` |

## 3. Organizations and settings

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | `/api/organizations` | any signed-in user | Creates the organization, seeds roles/designations/scoring models, makes the caller Owner |
| GET | `/api/organizations` | session | The caller's organizations (via memberships) |
| GET | `/api/organizations/:id` | membership | Must be the active organization |
| PATCH | `/api/organizations/:id` | `org.settings` | name, timezone, fiscal start |
| GET / PUT | `/api/organizations/:id/settings/:key` | `org.settings` | Keys: `review_cadence`, `quiet_hours`, `reporting_scope`, `data_sufficiency`, `ai`, `registration`… |
| GET / POST | `/api/invitations` | `invitations.manage` | POST `{membershipId, email, initialRoleId?}`; the **code/link is returned once** |
| POST | `/api/invitations/:id/revoke` / `/regenerate` | `invitations.manage` | |

## 4. People, hierarchy, roles

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/employees` | `people.view` (scope) | `?search&departmentId&teamId&status&designationId` |
| POST | `/api/employees` | `people.manage` | Creates a membership (with optional invitation) |
| GET | `/api/employees/:id` | `people.view` (scope), own always | Sensitive fields need `people.view_sensitive` |
| PATCH | `/api/employees/:id` | `people.manage` (scope) | |
| POST | `/api/employees/:id/designation` | `people.manage` | New `designation_assignments` row (history kept) |
| POST | `/api/employees/:id/archive` / `/restore` | `people.manage` | |
| GET | `/api/employees/:id/history` | `people.view` (scope) | Designations, teams, departments, managers, roles over time |
| GET | `/api/hierarchy/tree` | `org.view` | `?view=reporting\|organization&root&depth=2&asOf=` |
| GET | `/api/hierarchy/reporting` | `org.view` (scope) | `?membershipId` current and past |
| POST | `/api/hierarchy/reporting` | `hierarchy.manage` (scope) | `{subordinateId, managerId, type, startDate, reason}`; cycle check |
| PATCH | `/api/hierarchy/reporting/:id` | `hierarchy.manage` | End or adjust (never delete) |
| POST | `/api/hierarchy/move` | `hierarchy.manage` | Atomic move between teams/departments with effective date |
| GET / POST | `/api/departments` | `org.view` / `org.manage` | |
| GET / PATCH / DELETE | `/api/departments/:id` | `org.view` / `org.manage` | DELETE archives |
| GET / POST | `/api/teams` | `org.view` / `org.manage` | `departmentId`, `parentTeamId?` |
| GET / PATCH / DELETE | `/api/teams/:id` | `org.view` / `org.manage` | DELETE archives |
| POST | `/api/teams/:id/members` | `hierarchy.manage` | `{membershipId, type, allocationPct, startDate}` |
| PATCH | `/api/teams/:id/members/:mid` | `hierarchy.manage` | End membership, change type |
| POST / PATCH | `/api/departments/:id/members[/:mid]` | `hierarchy.manage` | head, deputy, member |
| CRUD | `/api/designations`, `/api/role-families` | `org.view` / `org.manage` | |
| GET | `/api/permissions` | `roles.view` | The catalog |
| GET / POST | `/api/roles` | `roles.view` / `roles.manage` | |
| GET / PATCH | `/api/roles/:id` | `roles.view` / `roles.manage` | |
| PUT | `/api/roles/:id/permissions` | `roles.manage` | Array of `{permissionKey, scopeMode}`; cannot grant beyond own |
| GET / POST | `/api/role-assignments` | `roles.view` / `roles.manage` | `{membershipId, roleId, scopeType, scopeId, validFrom, validTo}` |
| POST | `/api/role-assignments/:id/revoke` | `roles.manage` | Last-admin guard |

## 5. Objectives and OKRs

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/objectives` | `okr.view` (scope) + published leadership objectives | `?level&status&health&ownerId&teamId&departmentId&periodId` |
| POST | `/api/objectives` | `okr.create` (scope) | Level-specific validation; optional parent link and first key results |
| GET | `/api/objectives/:id` | `okr.view` (scope) | Key results with attainment, health and reason, relationships, assignments |
| PATCH | `/api/objectives/:id` | `okr.edit` (scope) | Audited with before/after |
| POST | `/api/objectives/:id/archive` | `okr.archive` | |
| POST | `/api/objectives/:id/publish` | `okr.publish` | Sets `visibility=organization`, `published_at` |
| POST | `/api/objectives/:id/key-results` | `okr.edit` | measurement type, start/target, direction, weight, owner |
| PATCH | `/api/key-results/:id` | `okr.edit` | Changing target creates a history entry |
| POST | `/api/key-results/:id/progress` | `okr.update_progress` (scope) | `{value, note?, evidenceIds?}`; appends history, recomputes progress and objective health, may raise events |
| GET | `/api/objectives/:id/history` | `okr.view` | Progress history incl. supersedes |
| GET / POST / DELETE | `/api/objectives/:id/relationships` | `okr.view` / `okr.assign` | parent/child/conflict/duplicate/dependency; cycle check |
| GET / POST | `/api/objectives/:id/assignments` | `okr.view` / `okr.assign` | |
| GET | `/api/objectives/tree` | `okr.view` | `?rootId&depth` alignment tree with weights and attainment |
| GET | `/api/objectives/alignment-gaps` | `okr.view` | Deterministic orphan/unmeasurable/unaligned-work report |

## 6. KPIs

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET / POST | `/api/kpis` | `kpi.view` / `kpi.configure` | |
| GET / PATCH | `/api/kpis/:id` | `kpi.view` / `kpi.configure` | |
| POST | `/api/kpis/:id/archive` | `kpi.configure` | |
| GET / POST | `/api/kpis/:id/assignments` | `kpi.view` / `kpi.assign` | To person, team, department, designation or role family |
| PATCH / DELETE | `/api/kpis/:id/assignments/:aid` | `kpi.assign` | End-dates rather than deleting |
| GET / PUT | `/api/kpis/:id/thresholds` | `kpi.view` / `kpi.configure` | |
| POST | `/api/kpis/:id/measurements` | `kpi.record` (scope) | `{subject, periodStart, periodEnd, value, source?, supersedes?}`; **never overwrites**; evaluates thresholds |
| GET | `/api/kpis/:id/history` | `kpi.view` (scope) | `?subject&from&to`; shows superseded rows on request; reports coverage and missing periods |
| GET | `/api/kpis/overview` | `kpi.view` | KPI health by status, missing-data counts |

## 7. Tasks, daily work and evidence

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/tasks` | `task.view` (scope), own always | `?assigneeId&teamId&status&priority&overdue&blocked&objectiveId&dueFrom&dueTo` |
| POST | `/api/tasks` | `task.create` | Links to objective/key result/KPIs; may assign |
| GET | `/api/tasks/:id` | `task.view` (scope) | |
| PATCH | `/api/tasks/:id` | `task.edit` (scope) or assignee for own fields | status, dates, priority, estimate |
| POST | `/api/tasks/:id/assignments` | `task.assign` (scope) | Raises `task.assigned` |
| POST | `/api/tasks/:id/updates` | assignee or `task.edit` | progress/status/time log/blocker/outcome; append-only |
| GET | `/api/tasks/:id/updates` | `task.view` | |
| GET / POST | `/api/tasks/:id/comments` | `task.view` / `task.view` | |
| PATCH / DELETE | `/api/tasks/:id/comments/:cid` | author | soft delete |
| POST / DELETE | `/api/tasks/:id/dependencies` | `task.edit` | cycle check |
| POST | `/api/tasks/:id/review` | `task.review` (scope) | `{outcomeQuality 1-5, note}` |
| POST | `/api/tasks/:id/evidence` | `evidence.submit` | Link existing or create evidence |
| GET | `/api/tasks/unaligned` | `task.view` | Tasks without objective or key result |
| GET | `/api/my-work` | baseline | Today, pending, overdue, upcoming, priorities, linked objectives, KPI progress, recent achievements, rule-based order |
| POST / GET | `/api/daily-updates` | baseline (own) / `task.view` (scope) | One per person per date; raises `daily_update.submitted` |
| GET / POST | `/api/evidence` | `evidence.view` / `evidence.submit` | `?type&status&relatedId&targetType&targetId` |
| GET / PATCH | `/api/evidence/:id` | `evidence.view` (scope, confidentiality) | |
| POST | `/api/evidence/:id/verify` | `evidence.verify` (scope) | `{status, note}` |
| POST / DELETE | `/api/evidence/:id/links` | `evidence.submit` | Link to objective, key result, KPI measurement, review… |
| PUT | `/api/evidence/:id/file` | `evidence.submit` | Raw body, size and type capped |
| GET | `/api/evidence/:id/file` | `evidence.view` (+ restricted rule) | Authenticated download, re-checks confidentiality |

## 8. Performance, mentorship, reviews

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET / POST / PATCH | `/api/performance/periods[/:id]` | `performance.view_scores` / `performance.manage_periods` | |
| POST | `/api/performance/periods/:id/close` | `performance.manage_periods` | Triggers final recalculation |
| GET | `/api/performance/scorecards` | own always; others `performance.view_scores` (scope) | `?subjectType&subjectId&periodId&status` |
| GET | `/api/performance/scorecards/:id` | same | Latest run plus run history |
| GET | `/api/performance/scores/:id` | same; components need `performance.view_components` for others | Components, contributing records (permission-filtered), `explanation_json` |
| POST | `/api/performance/scores/:id/verify` | `performance.view_components` | Recompute from stored inputs; `{matches, expected, actual}` |
| POST | `/api/performance/scorecards/recalculate` | `performance.recalculate` (scope) | One subject sync; many → `202 {jobId}` |
| GET | `/api/performance/compare` | `performance.compare` (scope) | `?roleFamilyId&periodId&subjectType`; `422 cohort_mismatch` across families |
| POST / GET | `/api/performance/comparisons[/:id]` | `performance.compare` | Saved snapshots |
| GET | `/api/performance/trends` | own or scope | `?subject&periodIds` per-component deltas across periods |
| GET / POST | `/api/performance/models` | `performance.view_components` / `performance.configure` | Scoring models |
| PATCH | `/api/performance/models/:id` | `performance.configure` | Creates a new version |
| POST | `/api/performance/models/:id/activate` | `performance.configure` | Validates weights sum to 100 |
| POST | `/api/performance/models/preview` | `performance.configure` | What-if dry run, stores nothing |
| GET / POST | `/api/performance/reviews` | `reviews.read_shared` / `reviews.write` | Private notes only with `reviews.read_private` |
| PATCH | `/api/performance/reviews/:id` | author | submit, acknowledge |
| GET / POST | `/api/mentorship/assignments` | `mentorship.view` / `mentorship.manage` | |
| PATCH | `/api/mentorship/assignments/:id` | `mentorship.manage` | pause/end |
| GET / POST | `/api/mentorship/assignments/:id/activities` | `mentorship.view` / `mentorship.log` | |
| GET | `/api/mentorship/assignments/:id/progress` | `mentorship.view` | |
| GET | `/api/mentorship/effectiveness` | `mentorship.view` (scope) | `?mentorId&periodId`; factors disclosed |

## 9. Dashboards and leadership

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/dashboard/overview` | baseline | Widgets chosen by the caller's capabilities; every figure from stored rows |
| GET | `/api/team-performance/:teamId` | team in scope | Objectives, KPIs, task progress, members (as permitted), mentorship, comparison |
| GET | `/api/leadership/overview` | `leadership.view` | `?periodId` company performance, strategic objectives, executive KPIs, department contribution, risks, trends |
| GET | `/api/leadership/drilldown` | `leadership.view` | `?level=department\|team\|individual&id` |
| GET | `/api/leadership/contribution-chain` | `leadership.view` | Company → department → team → individual with weights |

## 10. AI

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/ai/status` | session | `{configured, provider, models, missing:[names], caps}` |
| POST | `/api/ai/chat` | `ai.use` | `{conversationId?, message}` → `202 {runId, conversationId}`; `503 ai_not_configured` |
| GET | `/api/ai/conversations[/:id]` | own | |
| POST | `/api/ai/agents/:agentKey/run` | agent's required permission | `{input}` → `202 {runId}` |
| GET | `/api/ai/runs` | own; `ai.configure` for all | `?agent&status` |
| GET | `/api/ai/runs/:id` | requester or `ai.configure` | Status, output, **step log**, error code, usage |
| POST | `/api/ai/runs/:id/cancel` | requester | |
| GET / PATCH | `/api/ai/insights[/:id]` | `ai.view_insights` (subject scope) | PATCH: acknowledge, dismiss |
| GET | `/api/ai/recommendations` | `ai.view_insights` | |
| GET | `/api/ai/approvals` | `ai.approve` or requester | `?status=pending` |
| POST | `/api/ai/approvals/:id/approve` / `/reject` | `ai.approve` + underlying action permission | Executes **as the approver**; high risk needs a different person |
| GET / PUT | `/api/ai/settings` | `ai.configure` | redaction mode, enabled agents, caps, approved automation policy |
| GET / PATCH | `/api/ai/agents[/:key]` | `ai.configure` | agent definitions |

## 11. Integrations and automations

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | `/api/integrations/viasocket/token` | `integrations.manage` | `{token, expiresInSeconds, embed}`; identity derived from session |
| POST | `/api/integrations/viasocket/flow-events` | `integrations.manage` | `{slotKey, flowId, action}`; server reads the flow back from viaSocket |
| POST | `/api/integrations/viasocket/alerts` | public, signature verified | viaSocket alerts (expired connection, failed flows) |
| GET | `/api/integrations` | `integrations.view` | Configured flag, slots with status and 7-day counts, connected accounts |
| PUT / DELETE | `/api/integrations/slots/:slotKey` | `integrations.manage` | bind/unbind flow |
| POST | `/api/integrations/slots/:slotKey/test` | `integrations.manage` | Sends a labelled test to the caller only |
| POST | `/api/integrations/sync` | `integrations.manage` | Manual `viasocket.sync` |
| POST | `/api/integrations/inbound/token` | `integrations.manage` | Creates or rotates the organization's inbound token (shown **once**; only its hash is stored) |
| POST | `/api/integrations/inbound/evidence` | inbound token in `X-Zentro-Inbound-Token` (organization derived from the token, never from the body) | Creates **unverified** evidence from an external event; strict schema, size capped, dedupe by `externalRef`; rate limited |
| GET | `/api/automations/event-types` | `integrations.view` | Catalog and default rules |
| GET / POST | `/api/automations/rules` | `integrations.view` / `integrations.manage` | |
| PATCH / DELETE | `/api/automations/rules/:id` | `integrations.manage` | |
| GET | `/api/automations/history` | `integrations.view` | `?status&eventType&slot&from&to` events with outbox status |
| GET | `/api/automations/outbox/:id` | `integrations.view` | Payload (redacted) and execution attempts |
| POST | `/api/automations/outbox/:id/retry` / `/cancel` | `automations.retry` | retry only `failed`/`dead` |

## 12. Notifications, audit, system, data, demo

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/notifications` | own | `?unread` |
| POST | `/api/notifications/:id/read` / `/read-all` | own | |
| GET / PUT | `/api/preferences` | own | Notification channels per event, theme, quiet hours display |
| GET | `/api/audit-logs` | `audit.view` | `?actorId&entityType&entityId&action&from&to`, read only |
| GET | `/api/system/status` | `system.view` | Version, migrations, last tick, job table, outbox backlog, AI/viaSocket configured flags |
| POST | `/api/export` / GET `/api/export/:id/download` | `data.export` | Per-table JSON bundle; async |
| GET | `/api/demo/status` | `demo.manage` | |
| POST | `/api/demo/load` | `demo.manage` | One transaction; refuses if already loaded |
| POST | `/api/demo/remove` | `demo.manage` | Refuses and lists blockers if real rows reference demo rows |
| POST | `/api/demo/view-as/:membershipId` / `/stop` | `demo.manage` | Read-only session as an `is_demo` person; audited |

## 13. Scheduled and health routes

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/cron/tick` | `Authorization: Bearer $CRON_SECRET` (constant-time), **401 otherwise, always 401 if unset** | **Built in 1.2.** `202 {accepted, started, skipped?}` immediately; work continues in the background; one run at a time. (GET only for now: Embarko calls GET.) |
| GET | `/healthz` | none | **Built in 1.2.** Plain JSON (not the envelope, for monitors): `{ok, ready, version, node, migrations:{applied,total}, lastTick:{startedAt,finishedAt,status}\|null, memoryMb}`. On the holding page: `{ok:true, ready:false, migrations:null, missing:[names]}`. Never contains paths or secrets. |

Embarko calls the tick with **GET** every 5 minutes (`embarko.json`), and it has 5 minutes to answer, hence the immediate `202`.

---

## 14. Examples

**Login**

```http
POST /api/auth/login
{ "email": "ceo@example.com", "password": "…" }

200
{ "data": { "user": { "id": "…", "name": "…" },
            "activeOrganization": { "id": "…", "name": "Acme" },
            "capabilities": { "okr.view": ["all_in_scope"], "leadership.view": ["all_in_scope"] },
            "flags": { "aiConfigured": false, "viasocketConfigured": true, "demoLoaded": true } },
  "meta": { "requestId": "req_8f2c…" } }
```

**Record a KPI measurement (append-only)**

```http
POST /api/kpis/6d1…/measurements
{ "subject": { "membershipId": "a41…" }, "periodStart": "2026-10-01", "periodEnd": "2026-10-31", "value": 18.5 }

201
{ "data": { "id": "9b0…", "attainment": 0.925, "thresholdsCrossed": [], "coverage": { "expected": 3, "recorded": 1 } },
  "meta": { "requestId": "…" } }
```

**Scorecard with explanation**

```http
GET /api/performance/scores/3c9…

200
{ "data": { "id": "3c9…", "status": "provisional", "totalScore": 85.0, "confidence": { "value": 0.71, "label": "medium" },
            "weightCoverage": 0.70, "modelVersion": 3, "engineVersion": "1.0.0", "inputsHash": "sha256:…",
            "components": [ { "key": "kpi", "state": "missing", "weight": 0.30, "effectiveWeight": 0, "note": "No measurements in period" } ],
            "explanation": { "formula": "(85.0 × 0.571) + …", "whatWouldChangeThis": [ "Record 'Lead quality score' for Oct 2026" ] } },
  "meta": { "requestId": "…" } }
```

**Cross-tenant attempt (org B user, org A id)**

```http
GET /api/objectives/<org A objective id>

404
{ "error": { "code": "not_found", "message": "Not found" }, "meta": { "requestId": "…" } }
```

**AI not configured**

```http
POST /api/ai/chat   { "message": "Which objectives are at risk?" }

503
{ "error": { "code": "ai_not_configured", "message": "AI is not configured", "details": { "missing": ["AI_PROVIDER"] } }, "meta": { "requestId": "…" } }
```

---

## 14a. Stage 1.2 notes

- Registered today: `GET /healthz` (public), `GET /api/cron/tick` (cron), and the two stage 1.1 spike routes `GET /api/spike`, `POST /api/spike/visit` (public, removed in stage 1.3). The spike routes now answer in the standard envelope.
- Every other `/api/*` path answers `404 not_found`. On the holding page every `/api/*` answers `503 server_missing_settings` (message `Server is missing: NAMES`).
- Added error codes: `payload_too_large` (413, bodies over 100 KB), `invalid_json` (400), `server_missing_settings` (503).
- Each response carries `X-Request-Id`; a caller-supplied `X-Request-Id` is echoed only if it is 8 to 64 characters of letters, digits, `_` or `-`.

---

## 15. Route registry and tests

Every route is registered through one helper that **requires** a permission key (or an explicit `public`/`baseline` marker), a Zod schema for params/query/body, and a flag for whether it takes an entity id. That registry drives:

- the boot-time check that no route is unprotected;
- the generated **tenancy matrix** (org B vs org A ids → 404) and **permission matrix** tests ([permission-model](permission-model.md) section 9);
- this document's tables (kept in sync by a script that lists registered routes and diffs them against the tables here: **not built yet**, planned with the first real module).

**Built in 1.2:** `RouteRegistry` (`backend/src/http/registry.ts`) with the markers `public` (must give a reason), `cron`, `baseline`, `permission(key)`; Zod validation (a bad request returns paths and messages, never the submitted values); `assertAllRegistered` runs at boot and in tests and throws if a route was mounted on Express without the registry. `tests/registry.test.ts` lists the registered routes with their markers, which is the base the 2.3 tenancy and permission matrices will be generated from.
