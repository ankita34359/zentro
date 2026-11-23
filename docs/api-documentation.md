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
| 404 | `invitation_not_found`, `reset_link_invalid` | A link whose code or token is unknown or malformed (nothing else is revealed) |
| 410 | `invitation_expired`, `invitation_used`, `invitation_revoked`, `reset_link_expired`, `reset_link_used`, `reset_link_revoked` | A link that was real but can no longer be used. The message says which (**2.2**) |
| 413 | `file_too_large` | Evidence file over cap |
| 422 | `cohort_mismatch`, `weights_invalid`, `insufficient_data` | Valid request, business rule refuses |
| 429 | `rate_limited` | Retry later (`Retry-After`) |
| 500 | `internal_error` | Logged with `requestId`; message is generic |
| 503 | `ai_not_configured`, `viasocket_not_configured`, `server_missing_settings`, `ai_credits_exhausted` | Optional capability not set up (names of missing settings only) |

Rate limits (per IP or session): login/register/reset 10 per 15 minutes; token endpoint 20 per minute; AI runs 10 per minute per user and the organization daily cap; everything else 300 per minute per session.

---

## 2. Authentication

**Built in stage 2.1** (marked **2.1**): register, login, logout, me, create organization and `GET /api/organization`. Everything else in this table arrives in 2.2 or later. Details of the built routes are in section 2.1 below.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` **2.1** | public, subject to `REGISTRATION_MODE` | `{email, password, name, registrationCode}` creates a user only (nobody is signed in by it) |
| POST | `/api/auth/login` **2.1** | public | `{email, password}` → sets cookie, returns `me` |
| POST | `/api/auth/logout` **2.1** | public (always clears the cookie; only revokes the caller's own session) | Revokes the session row |
| GET | `/api/auth/me` **2.1** | session | User, organization (or `null` before onboarding), membership, `roles` (`[{key, name}]`), **`capabilities` (2.3: `{ "okr.view": ["own", "my_teams"], … }`, only permissions with a non-empty scope)**, `baseline` (the rights everyone has), `needsOnboarding`. Later: flags (`aiConfigured`, `viasocketConfigured`, `demoLoaded`) |
| GET | `/api/auth/delete-account/preview` **2.3** | session | What Delete my account would do: `{mode: account_only \| account_and_organization \| blocked, organizationName, others, pendingInvitations, reason}` |
| POST | `/api/auth/delete-account` **2.3** | session | `{password, confirmEmail, confirmOrganizationName?}`. Erases the login; if the caller is the only member and nothing is pending, the organization too (its exact name must be typed). Always signs out |
| POST | `/api/organizations` **2.1** | session | `{name, timezone?}` onboarding: creates the organization, the caller's membership, the Owner role and the Owner @ organization assignment. Unknown fields (an organization id) are rejected |
| GET | `/api/organization` **2.1** | session with an organization | The caller's current organization (from the session, never from the request) and its member count |
| POST | `/api/auth/switch-organization` | session | `{membershipId}` (must belong to the caller) |
| POST | `/api/auth/forgot-password` **2.2** | public | `{email}`. Always `202` with the same body (no account enumeration). Nothing is emailed yet: the answer tells the person to ask their administrator |
| POST | `/api/auth/reset-password` **2.2** | public (the token is the credential) | `{token, password}`; revokes **all** of that person's sessions; single use; does not sign anyone in |
| POST | `/api/auth/verify-email` | token | When the platform email flow exists |
| POST | `/api/auth/invitation-preview` **2.2** | public (the code is the credential) | `{code}` → `{organizationName, email, displayName, expiresAt}` or 404/410 |
| POST | `/api/auth/accept-invitation` **2.2** | public, soft session | `{code}` when signed in (the caller's email must be the invited one); `{code, name, email, password}` when not (creates the login, invited email only, **no registration code needed**, signs in) |
| POST | `/api/auth/change-password` **2.2** | session | `{currentPassword, newPassword}`; signs out the caller's other sessions |

### 2.2 Stage 2.2 details

**Links.** An invitation code is `<organization id>.<256-bit secret>` and a reset token is a 256-bit secret; the database stores only the SHA-256 of each, compared in constant time. The links the administrator copies keep the secret in the URL **fragment**: `/accept-invite#code=…` and `/reset-password#token=…` (the docs' earlier `/reset-password/:token` shape is replaced so the secret is never sent to a server, a proxy log or a Referer header). The server returns the secret once, in the `201`/`200` body, with `Cache-Control: no-store`; the browser composes the link from `window.location.origin`.

**Who may do what (the permission engine, stage 2.3).** The administration routes carry their real keys (`invitations.manage`, `people.manage`, `roles.view`) and the guard checks them against the caller's role grants (section 2.3). The temporary Owner-only check of stage 2.2 is gone.

**Tenancy.** Administration routes resolve ids inside the caller's organization (from the session): another organization's invitation or person looks like `404 not_found`. No request field can name an organization. The public link routes find the invitation by the hash inside the organization named by the code, and bind only the membership that invitation was issued for.

**Rules.** An invitation is valid 7 days and works once; one open invitation per address per organization (an expired one is replaced); an invited person without a login can accept without the registration code but only with the invited address; a person who already belongs to an organization cannot accept another (`409 already_in_organization`; switching organizations arrives later). A reset link is valid 1 hour, works once, and a newer link replaces older unused ones; resetting revokes every session of that login and clears its sign-in lockout; changing your own password signs out your other sessions and cancels unused reset links. Administrators cannot reset their own password (use change password) or the password of a login that belongs to another organization.

**Rate limits** (in memory). Forgot password: 10 an hour per address and 5 an hour per email; reset: 10 wrong tokens per 15 minutes per address (and 30 calls); invitation preview and accept: 10 wrong codes per 15 minutes and 60 calls per address; change password: 5 wrong current passwords per 15 minutes per person. `429 rate_limited` with `details.retryAfterSeconds`.

### 2.4 Stage 2.4 details

**Guardrails on every change.** One transaction does the change, writes its audit row and re-checks the last administrator, so a change that would leave the organization without anyone who holds `roles.manage` and `org.settings` (all_in_scope, organization-wide) is rolled back whole and answers `409 last_admin` (no audit row remains). You cannot add a permission you do not hold (`403 cannot_grant_permission`), assign or revoke a role carrying more than you hold (`403 cannot_grant_role`), or edit/archive a **protected** role (`403 role_protected`: the Owner role is view only; it can still be assigned, revoked and copied). Every grid cell must be a mode the catalogue allows (`400`). Adding a sensitive permission needs `confirmSensitive: true` (`400 sensitive_confirmation_required`, with the list in `details.permissions`). Archiving a role people hold is refused (`409 role_in_use`, `details.holders`). Role definitions need an organization-wide `roles.manage`; assignments and removals are checked against the caller's scope (a person outside it looks like `404`).

**Assignments.** Only people who have **joined** can be given a role (`404` for an invited person). `scopeType` may only be `organization` for now (`400 scope_not_available` for department or team: stage 2.5). `validTo` must be in the future and after `validFrom`; the same role cannot be assigned twice while open (`409 already_assigned`). Their capabilities change on their very next request. `GET /api/role-assignments` shows each assignment's `state`: active, scheduled, ended or revoked.

**Removing a person.** Their roles end, their membership becomes "left" (their name stays for history, detached from the login so they can be invited again), their sessions and default organization stop pointing at it, and their login stays: `me` then says `needsOnboarding` so they can create an organization. Not yourself (`409 use_delete_account`), not someone who has not joined, not the last administrator.

**Audit log.** `audit_logs`: `action` (for example `role.permissions.update`), entity, a one-sentence `summary`, and changed-fields-only `before`/`after`; never a link, code, token or password; **no IP addresses** (owner decision; whether to add them, or a separate permission to view logs, is a later decision). Written for: organization creation, invitation create/regenerate/revoke/accept, reset-link generation, role create/update/permissions/archive, assignment create/revoke, person removal and leaving. Owner only (`audit.view` is in the Owner template only). Append-only: no code updates or deletes rows (a test greps for it); the one deletion is an organization leaving with its last member.

`GET /api/organization`'s `memberCount` counts only people who have joined and still belong (not invited, not left).

### 2.7 Stages 4.1, 4.4 and 4.5 details

- **Visibility and writes.** See the table in section 7. In short: you see what you created, do or watch, plus the tasks of people or teams inside your `task.view` scope (a teammate's task for an employee, the tasks of their reports for a manager, everything for the Owner). A task you cannot see is 404. Who may update (status, progress, time, blockers): the people doing it (directly or through a team they are in), its creator, and `task.edit` over the people doing it. Routes that anyone with `task.view` may reach decide this inside the service (403 for someone who can see but not change).
- **Status workflow.** not_started → in_progress, blocked, cancelled · in_progress → not_started, blocked, under_review, completed, cancelled · blocked → not_started, in_progress, cancelled · under_review → in_progress, completed, cancelled · completed → in_progress (reopen) · cancelled → not_started (reopen). Completing sets progress to 100 and `completedAt`; reopening clears it. Progress on work not started starts it.
- **Dates** on tasks are whole days (`YYYY-MM-DD`) in the organization's time zone; "today", "overdue" and the reminders use that day.
- **Notifications and events.** Every change that notifies someone writes the notification, the audit row, the history row and the business event in one transaction. A person is never notified of their own action. `task.overdue` and `task.due_soon` are written by the `tasks.reminders` job (every 10 minutes on the 5-minute tick), once per person per task per due date.
- **Business events.** `automation_events` rows (`task.created`, `task.assigned`, `task.status_changed`, `task.completed`, `task.overdue`, `task.due_soon`, `daily_update.submitted`) have a unique dedupe key. Nothing reads them before the integrations stage.

### 2.6 Stage 2.6 and 2.7 details

- **Effective dating.** Team, department, reporting and designation rows have a `startDate` and an optional `endDate`. A row applies on day D when `start <= D` and (`end` is empty or `D < end`): an end date is the first day it no longer applies. A change ends the old row and starts a new one, so nothing is ever overwritten or deleted and "who headed Engineering in Q2" stays answerable. A row dated in the future is stored now and takes effect on that day (the profile lists current and scheduled rows; the chart's `asOf` shows any day).
- **Who is a person.** The directory (`/api/employees`) lists everyone who belongs: people with a login, people invited and not yet joined, and people added by an administrator with no login. Role assignment, password reset and removal are for people with a login and stay on the Users page.
- **Scope.** `my_teams` = the people in the caller's teams; `reports` = the caller plus everyone below them over primary and secondary lines (dotted and project lines are display only), plus the teams they lead and the departments they head; a role given for one department or team reaches that department's (with sub-departments) or team's (with sub-teams) people. The resolver reads the tables on each request, so a change applies on the next request. Writes need `hierarchy.manage` or `people.manage` over the person, and over the team or department for membership changes. Anything outside the scope is 404.
- **Sensitive fields.** Work email, employee code, employment type and dates are returned only to the person themselves, to people holding `people.view_sensitive` over them, and to people who manage them (`people.manage`).
- **Audit.** Every change is one transaction with its audit row: `person.create|update|designation|archive|restore|move`, `reporting.add|end`, `team_member.add|change|end`, `department_member.add|change|end`.
- **Chart.** `GET /api/hierarchy/tree` returns the first `depth` levels (default 2, at most 6, at most 400 nodes per call); deeper levels are fetched by asking again with a node as `root`. The reporting view follows primary lines only; the organization view is department → sub-department / team → sub-team → people, with heads and leads shown.

### 2.5 Stage 2.5 details

Structure endpoints (see the table in section 4): departments, teams, role families and designations, plus `PATCH /api/organization`. Rules that apply to all of them:

- **Names** are trimmed, single-spaced, 1 to 80 characters without control characters (400 `invalid_name`), and unique among **active siblings**, ignoring letter case (409 `name_taken`): the same name may exist under a different parent, and an archived item's name is free again. A restore that would collide is refused.
- **Depth:** departments nest at most 8 levels; teams (sub-teams) nest at most 8 levels inside a department. Moving a subtree is checked against the height of the subtree (400 `depth_exceeded`).
- **No cycles:** a department or team cannot move under itself or one of its own descendants (409 `would_create_cycle`).
- **Archive, never delete:** an item with active children cannot be archived (409 `has_active_children`); an archived item cannot be edited (409 `archived`) or receive new children (409 `parent_archived`) until restored. A department or team that still has people in it cannot be archived either (409 `has_active_members`, from stage 2.6).
- Every change is one transaction that also writes its audit row (`department.create|rename|update|move|archive|restore`, the same for `team`, `role_family`, `designation`, and `organization.rename`).
- Writing needs `org.manage` for the whole organization (`all_in_scope`); reading needs `org.view`, and a scoped viewer gets only their teams and the departments above them (`partial: true`). From stage 2.6 the scope comes from the real hierarchy: `my_teams` reaches the people in the caller's teams, `reports` the people below them, and a role given for one department or team reaches that department's or team's people.

### 2.3 Stage 2.3 details

**Roles (read only).** `GET /api/permissions` (key, module, description, the scope modes a role may give it, `sensitive`), `GET /api/roles` (the organization's roles with `permissionCount` and `holderCount`) and `GET /api/roles/:id` (one role with each permission and the modes it grants), all `roles.view`. Another organization's role id is `404`. Editing roles and assigning them is stage 2.4.

**Capabilities.** `me.capabilities` lists, for each permission the person holds with a non-empty scope set, the modes they hold it in. The browser uses it only to choose screens (sidebar, Settings, which buttons show); the server refuses everything it does not allow, whatever the browser sent. Rights everyone has whatever their roles (`me.baseline`: own profile and password, own work, own score and its inputs, own notifications, organization-wide published objectives) are not permissions and cannot be removed by editing a role.

**Scope.** A route key must be held with a non-empty scope set (`403 permission_denied` otherwise). Records are then checked against that scope: a person or invitation outside it (or in another organization, or missing) is `404`. Invitation management is organization-wide only for now (an assignment limited to a department or team cannot invite until stage 2.5 supplies departments). Until teams, departments and reporting lines exist (2.5, 2.6), `my_teams` and department/team scopes resolve to nobody and `reports` resolves to the caller alone.

**Delete my account.** Needs the password and the email typed again. A person with no organization, or a member of an organization that continues and who is not its last administrator, is erased (their login is deleted, or kept as an empty tombstone when it created an organization that continues: no email, name or password, never able to sign in, and the address is free to register again); their membership becomes "Former member" with no name or email, their roles end, every session and reset link is removed. `409 last_admin` if they are the last administrator and others remain; `409 pending_invitations` if they are the only member but invitations are pending; if they are the **only member and nothing is pending**, the whole organization (roles, grants, memberships, invitations) is deleted with them and `confirmOrganizationName` must equal its name (`400 organization_confirmation_required`, with the name in `details`). Wrong password: `403 current_password_incorrect`, rate-limited (5 per 15 minutes per person).

### 2.1 Stage 2.1 details

**Registration.** `REGISTRATION_MODE=code` plus `REGISTRATION_CODE` (at least 8 characters) on Embarko. Anything else (unset, too-short code, unknown mode) means **closed**: `POST /api/auth/register` answers `403 registration_unavailable` and nothing else in the site changes (no holding mode; existing logins work). A wrong code, a missing code and a closed registration all give the **same** message: "Registration is not available with those details. Check the registration code and try again." The code is compared in constant time. An email that already exists gets the same `202` as a new one (the first account and password are kept). `/healthz` shows `registration: "code" | "open" | "closed"` (never the code).

**Cookie and session.** `zentro_session` is an HS256 JWT `{sub, sid, iat, exp}` (`sid` is a random id; the database stores only its SHA-256 as `sessions.id`). `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` everywhere except plain http on the developer's own machine. Every request loads the session row: revoked, past the sliding 7 days or past the absolute 30 days means `401` and the stale cookie is cleared. The organization is the one the **session row** names, and the person must still hold an active membership in it.

**Same-origin check.** Every non-GET/HEAD/OPTIONS request under `/api` must carry an `Origin` (or, if absent, a `Referer`) naming this site: the address in `APP_URL` when set, otherwise the request's own `Host` / `X-Forwarded-Host`. Otherwise `403 cross_origin`. (`APP_URL` stays optional in 2.1 so the live site cannot be sent into holding mode by it.)

**Rate limits** (in memory, per process; a restart forgets them). Failed logins: 8 per account and 30 per address in 15 minutes. Registration: 20 attempts per address per hour; wrong codes: 5 per address in 15 minutes and 40 across everyone per hour. When a limit trips: `429 rate_limited` with `details.retryAfterSeconds`; each repeat doubles the block, up to a cap. A successful login clears that account's failures.

**Errors.** `401 invalid_credentials` ("Invalid email or password", the same for a wrong password, an unknown email and a disabled account); `403 registration_unavailable`; `403 cross_origin`; `403 no_organization` (signed in but not yet in an organization); `409 already_in_organization`; `429 rate_limited`; validation as in section 1. Responses that carry personal data send `Cache-Control: no-store`.

## 3. Organizations and settings

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | `/api/organizations` | any signed-in user | Creates the organization, seeds roles/designations/scoring models, makes the caller Owner |
| GET | `/api/organizations` | session | The caller's organizations (via memberships) |
| GET | `/api/organizations/:id` | membership | Must be the active organization |
| PATCH | `/api/organizations/:id` | `org.settings` | name, timezone, fiscal start |
| GET / PUT | `/api/organizations/:id/settings/:key` | `org.settings` | Keys: `review_cadence`, `quiet_hours`, `reporting_scope`, `data_sufficiency`, `ai`, `registration`… |
| GET / POST | `/api/invitations` **2.2** | `invitations.manage` (organization-wide) | POST `{email, name?, roleId?}` creates the (invited) membership and the invitation; the **code is returned once** and only its hash is stored. **2.3:** `roleId` (a role of this organization whose permissions the inviter holds: else `403 cannot_grant_role`; another organization's role is `404`) becomes the person's role when they join. GET lists state: pending, accepted, revoked, expired, and the role; never a code |
| POST | `/api/invitations/:id/revoke` / `/regenerate` **2.2** | `invitations.manage` | Revoke ends the link; regenerate returns a new code once and kills the old link (works for pending, expired and revoked; not accepted) |
| GET | `/api/organization/members` **2.2** | `people.manage` | The accounts list for the Users screen (people with a login or an invitation), limited to the caller's scope. **2.6:** each role assignment now carries `scopeType` and `scopeName`. The people directory (including people with no login) is `/api/employees` |
| POST | `/api/people/:membershipId/reset-link` **2.2** | `people.manage` (person must be in the caller's scope) | Administrator-generated reset link: `{token, expiresAt, displayName}` returned once; valid 1 hour; replaces older unused links; only for a person in the caller's own organization who has a login |

## 4. People, hierarchy, roles

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/employees` **2.6** | `people.view` (scope; always yourself) | `?search&departmentId&teamId&designationId&status&includeArchived&limit&offset` (default 200, at most 500). Returns `{people, total, limit, offset}`; `email` only when the caller may see that person's sensitive details |
| POST | `/api/employees` **2.6** | `people.manage` | `{name, workEmail?, employeeCode?, employmentType?, startDate?, designationId?, departmentId?, teamId?, managerId?}`: a person with no login, optionally placed with a primary manager, in one transaction. A holder whose scope is `reports` must give a manager from their reports, or a team or department they manage (403 `outside_scope`). 409 `employee_code_taken` |
| GET | `/api/employees/:id` **2.6** | `people.view` (scope; yourself always) | Profile: designation and role family, current departments, teams and managers (with row ids), direct reports, `employment` (only with `people.view_sensitive` or `people.manage` over the person, or for yourself), and `can` {edit, manageHierarchy, archive, restore}. Outside your scope or another organization: 404 |
| PATCH | `/api/employees/:id` **2.6** | `people.manage` (scope) | `{name?, workEmail?, employeeCode?, employmentType?, startDate?, endDate?}`; a person with a login keeps their own name (409 `has_login`); the audit row names fields, never values |
| POST | `/api/employees/:id/designation` **2.6** | `people.manage` | `{designationId, startDate?, reason?}`: the old row ends on the start day (history kept); today or earlier only (400 `future_date`, `before_current_start`); 409 `no_change` |
| POST | `/api/employees/:id/archive`, `/restore` **2.6** | `people.manage` | Only people with no login (409 `has_login`: use Remove on the Users page); refused while people report to them (409 `has_reports`); their placements and lines end today |
| GET | `/api/employees/:id/history` **2.6** | `people.view` (scope) | Designations, managers, teams, departments and reports over time, newest first |
| GET | `/api/hierarchy/tree` **2.7** | `org.view` (scope) | `?view=reporting\|organization&root&rootKind&depth=2&asOf=`. Nodes `{kind, id, name, subtitle, detail, childCount, children}`; `children: null` means not loaded: ask again with that node as `root`. A scoped viewer sees only their part (`partial: true`) |
| GET | `/api/hierarchy/reporting` **2.6** | `org.view` (scope) | `?membershipId` (default: you): current and past lines as subordinate and as manager, only people you may see |
| POST | `/api/hierarchy/reporting` **2.6** | `hierarchy.manage` (scope) | `{subordinateId, managerId, type?: primary\|secondary\|dotted\|project, startDate?, reason?}`. One primary manager at a time: a new primary ends the old one on the start day. 409 `would_create_cycle` (primary and secondary lines), `already_reporting`; 400 `self_report` |
| PATCH | `/api/hierarchy/reporting/:id` **2.6** | `hierarchy.manage` | `{endDate?, reason?}`: ends a line (never deleted); 409 `already_ended` |
| POST | `/api/hierarchy/move` **2.6** | `hierarchy.manage` | `{membershipId, toTeamId?, toDepartmentId?, effectiveDate?, reason?}`: open team and department rows end that day, the new ones start, in one transaction; 409 `no_change`; reporting lines untouched |
| GET / POST | `/api/departments` | `org.view` / `org.manage` | |
| GET / PATCH / DELETE | `/api/departments/:id` | `org.view` / `org.manage` | DELETE archives |
| GET / POST | `/api/teams` | `org.view` / `org.manage` | `departmentId`, `parentTeamId?` |
| GET / PATCH / DELETE | `/api/teams/:id` | `org.view` / `org.manage` | DELETE archives |
| POST | `/api/teams/:id/members` **2.6** | `hierarchy.manage` | `{membershipId, type?: lead\|deputy_lead\|member, allocationPct?, startDate?}`. A new lead replaces the old one (who stays as a member from that day); the department membership is added when missing; 409 `already_member` |
| PATCH | `/api/teams/:id/members/:mid` **2.6** | `hierarchy.manage` | `:mid` is the membership row id. `{endDate}` ends it; `{type}` ends the row and starts a new one with the new type from `effectiveDate`; `{allocationPct}` changes in place |
| POST / PATCH | `/api/departments/:id/members`, `/api/departments/:id/members/:mid` **2.6** | `hierarchy.manage` | head, deputy, member; a new head replaces the old one the same way |
| CRUD | `/api/designations`, `/api/role-families` | `org.view` / `org.manage` | |
| GET | `/api/permissions` | `roles.view` | The catalog |
| GET / POST | `/api/roles` **2.3 / 2.4** | `roles.view` / `roles.manage` | POST `{name, description?, copyFromRoleId?}` creates a custom role (unique name) |
| GET / PATCH | `/api/roles/:id` **2.3 / 2.4** | `roles.view` / `roles.manage` | PATCH `{name?, description?}`; 403 `role_protected` for the Owner role |
| PUT | `/api/roles/:id/permissions` **2.4** | `roles.manage` | `{grants: [{permission, mode}], confirmSensitive?}` replaces the grid; cannot add beyond what you hold; sensitive additions need confirmation; last-admin guard |
| POST | `/api/roles/:id/archive` **2.4** | `roles.manage` | 409 `role_in_use` while people hold it; 403 `role_protected` |
| GET / POST | `/api/role-assignments` **2.4** | `roles.view` / `roles.manage` | POST `{membershipId, roleId, scopeType?: organization\|department\|team, scopeId?, validFrom?, validTo?}` (**2.6**: a department or team needs `scopeId`; you can only give a role at a scope you manage, 403 `cannot_grant_scope`; the same role at two scopes is allowed) |
| POST | `/api/role-assignments/:id/revoke` **2.4** | `roles.manage` | Last-admin guard; you can only revoke a role you could assign |
| POST | `/api/people/:membershipId/remove` **2.4** | `people.manage` (in scope) | Removes a joined person from the organization; their login stays |
| GET | `/api/organization/structure` **2.5** | `org.view` (scoped) | The whole structure in one call: `departments`, `teams`, `roleFamilies`, `designations` (archived ones marked `archived: true`), `limits.maxDepth` (8) and `partial` (true when the caller's `org.view` is scoped: only their teams and the departments above them) |
| PATCH | `/api/organization` **2.5** | `org.settings` | `{name}`: rename the organization (the slug never changes); audited |
| POST / PATCH | `/api/departments`, `/api/departments/:id` **2.5** | `org.manage` | POST `{name, description?, parentId?}`; PATCH `{name?, description?, parentId?}` (`parentId: null` = top level). 400 `depth_exceeded` (more than 8 levels), 409 `name_taken`, `would_create_cycle`, `parent_archived`, `archived` |
| POST | `/api/departments/:id/archive`, `/restore` **2.5** | `org.manage` | Archive is refused while the department has active sub-departments or teams (409 `has_active_children`, with counts). Restore needs an active parent and a free name. Nothing is ever deleted |
| POST / PATCH | `/api/teams`, `/api/teams/:id` **2.5** | `org.manage` | POST `{name, description?, departmentId, parentTeamId?}`; PATCH `{name?, description?, departmentId?, parentTeamId?}`. A sub-team shares its parent's department (400 `wrong_department`); moving a team to another department takes its sub-teams along, and without `parentTeamId` it becomes top-level there |
| POST | `/api/teams/:id/archive`, `/restore` **2.5** | `org.manage` | Archive refused while it has active sub-teams |
| POST / PATCH | `/api/role-families`, `/api/role-families/:id` **2.5** | `org.manage` | `{name, description?}` |
| POST | `/api/role-families/:id/archive`, `/restore` **2.5** | `org.manage` | Archive refused while it has active designations |
| POST / PATCH | `/api/designations`, `/api/designations/:id` **2.5** | `org.manage` | `{name, description?, roleFamilyId?}` (`roleFamilyId: null` = no family) |
| POST | `/api/designations/:id/archive`, `/restore` **2.5** | `org.manage` | Restore needs an active role family if it has one |

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
| GET | `/api/objectives/:id/alignment` **3.2** | `okr.view` | Its parent (with weight), its children (only those the caller may see; `hiddenChildren` counts the rest), who else works on it, and `can.assign` |
| PUT / DELETE | `/api/objectives/:id/parent` **3.2** | `okr.assign` over the objective | `{parentId, weight?}`: a parent must sit at a higher level (400 `wrong_level`), no loops (409 `alignment_loop`), an earlier parent is ended (kept). DELETE takes it out of the alignment. Audited |
| POST / DELETE | `/api/objectives/:id/assignments[/:aid]` **3.2** | `okr.assign` over the objective and the assignee | `{assigneeId \| teamId \| departmentId, role?: contributor\|reviewer}`; assignees can then see the objective. DELETE ends it (row kept). 409 `already_assigned`, `already_ended`. Audited |
| GET | `/api/objectives/tree` **3.2** | `okr.view` | `?rootId&includeClosed`: company → department → team → personal, each node with health, attainment, weight among siblings and its contribution (weight share × attainment); objectives the caller cannot see are never named |
| GET | `/api/objectives/alignment-gaps` **3.2** | `okr.view` | `unaligned`, `notBrokenDown`, `unmeasurable`, `noData`, `behindPace`, `overdue`, and `unalignedTasks` (the caller's own visible open tasks that support no objective). Deterministic, each item says why it is listed |

Objectives also carry `health` (not_started, on_track, at_risk, delayed, completed, no_data; null when cancelled) and `healthReason` in plain words with the numbers used, computed by `okr/health.ts` (docs/scoring-architecture.md section 9: on track at a progress-to-time ratio of at least 0.90, at risk from 0.60, delayed below it or past the end). `GET /api/objectives` also takes `?health=`. The hourly job `okr.health` recomputes every objective; a move to at risk or delayed tells the owner and the creator once per status (`objective.at_risk`).

## 6. KPIs

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/kpis` **3.3** | `kpi.view` | Definitions (everyone with `kpi.view` sees them all); each has `assignmentCount`, the active assignments the caller may see. `?category&frequency&search&assignedToMe&includeArchived` |
| POST | `/api/kpis` **3.3** | `kpi.configure` (over everyone) | `{name, key?, description?, category?, unit?, valueType?, direction?: higher_is_better\|lower_is_better\|target_range, frequency?: daily\|weekly\|monthly\|quarterly\|annual, aggregation?: sum\|avg\|last\|min\|max, defaultTarget?, defaultTargetMax?}`; the key is made from the name (409 `key_taken`); a range needs both ends. Audited |
| GET / PATCH | `/api/kpis/:id` **3.3** | `kpi.view` / `kpi.configure` | Detail with the assignments the caller may see (target, weight, dates, how many people each covers today), thresholds and `can`. Audited by field name |
| POST | `/api/kpis/:id/archive` **3.3** | `kpi.configure` | 409 `has_active_assignments`, `already_archived` |
| POST | `/api/kpis/:id/assignments` **3.3** | `kpi.assign` over the subject | `{assigneeId \| teamId \| departmentId \| designationId \| roleFamilyId, targetValue?, targetMax?, weight?, effectiveFrom?, effectiveTo?}`. A designation or role family needs it over everyone and covers whoever holds it at calculation time. `effectiveTo` is the first day it no longer applies. 409 `already_assigned` |
| PATCH / DELETE | `/api/kpis/:id/assignments/:aid` **3.3** | `kpi.assign` over the subject | Change target, weight or end date; DELETE ends it today (kept). 409 `already_ended` |
| GET / PUT | `/api/kpis/:id/thresholds` **3.3** | `kpi.view` / `kpi.configure` | `{thresholds: [{level: excellent\|warning\|critical, comparator: lt\|lte\|gt\|gte, basis?: absolute\|percent_of_target, value, notify?}]}` at most one per level; the earlier list is kept in the audit entry |
| GET | `/api/kpis/overview` **3.4** | `kpi.view` | Series (one KPI for one person, team, department or the organization) the caller may see, counted by status (no_data, ok, excellent, warning, critical), missing periods, coverage per KPI, and an `attention` list |
| GET | `/api/kpis/:id/subjects` **3.4** | `kpi.view` | Who has values or a target for this KPI, within the caller's reach, with status, missing periods and `canRecord` |
| GET | `/api/kpis/:id/history` **3.4** | `kpi.view` over the subject | `?subject=person:<id>\|team:<id>\|department:<id>\|organization&from&to`. Period by period: `recorded`, `missing` (ended with no value: never zero), `open` or `not_expected`, each with its current value, attainment, threshold level and every row (corrections stay visible). Threshold lines in the KPI's unit, coverage, missing count. A subject the caller may not see: 404 |
| POST | `/api/kpis/:id/measurements` **3.4** | `kpi.record` over the subject | `{subject: {type, id?}, periodStart, value, valueStatus?, note?, supersedes?}`. `periodStart` is the first day of a period of the KPI's frequency (400 `invalid_period`, `future_period`). **Never overwrites**: a second value for a period is 409 `period_recorded` unless `supersedes` names the current row, and a correction needs a `note` (400 `reason_required`; 409 `not_current`). Evaluates the thresholds, writes `kpi.measurement_recorded`, tells the right people once about a warning or critical value, audited |

The hourly job `kpi.thresholds` looks at every series again and flags a period that ended with no value (`kpi.measurement_missed`, notice type `kpi.missing`). Notices and events carry a dedupe key (KPI, subject, period, level), so nothing repeats.

## 7. Tasks, daily work and evidence

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/api/tasks` **4.1** | `task.view` (scope), own always | `?assigneeId&teamId&status(comma list)&priority&overdue&blocked&mine&search&dueFrom&dueTo&objectiveId&keyResultId&unaligned&waiting&limit&offset` (default 100, at most 300). `{tasks, total, limit, offset}`. You always see tasks you created, do or watch; beyond that the tasks of people or teams in your scope |
| POST | `/api/tasks` **4.1** | `task.create` | `{title, description?, priority?, importanceWeight?, startDate?, dueAt?, estimatedMinutes?, teamId?, assigneeIds?, assigneeTeamId?}`. If no one is named the creator is the assignee. Without `task.assign` giving work to anyone else is 403 `outside_scope`; with it assignees must be in the caller's scope. Audited; writes `task.created` and `task.assigned` events and notifies a new assignee |
| GET | `/api/tasks/:id` **4.1** | `task.view` | Detail with `can` {edit, editEstimate, update, assign, comment} and `nextStatuses`; not visible, missing or another organization's: 404 |
| PATCH | `/api/tasks/:id` **4.1** | `task.view` + in-service check | The creator and `task.edit` over the people doing it change every field; an assignee only `estimatedMinutes` (else 403). A finished or cancelled task: 409 `task_closed`. Audited by field name |
| GET | `/api/objectives` **3.1** | `okr.view` (scope), own and published always | Objectives you may see (in your scope, owned or created by you, or published by `okr.publish`). `?level&lifecycle&ownerId&teamId&departmentId&mine&search&includeArchived`. Each carries `attainmentPct` (a whole number from the key results' recorded actual values, or **null** when nothing is recorded: never 0 for no data), `dataState` (ok, insufficient, none), `coveragePct`, `elapsedPct` |
| GET | `/api/objectives/linkable` **4.2** | `okr.view` | Open objectives with their key results, for the task link picker |
| POST | `/api/objectives` **3.1** | `okr.create` (scope: the level must be inside it) | `{level, title, description?, objectiveType?, startDate, endDate, priority?, weight?, departmentId?, teamId?, ownerId?, lifecycle?: draft\|active, keyResults?: [{title, measurementType?, unit?, direction?, method?, startValue?, targetValue, weight?, ownerId?, dueDate?}]}` (at most 12 key results). A target equal to the start is 400 `target_equals_start`; on the wrong side for the direction, 400 `wrong_direction`. Audited |
| GET | `/api/objectives/:id` **3.1** | `okr.view` | Detail with key results, `can` {edit, updateProgress, publish, archive, addKeyResults}, `nextLifecycles`, linked task counts. Not visible or another organization's: 404 |
| PATCH | `/api/objectives/:id` **3.1** | `okr.view` + `okr.edit` over it | `{title?, description?, objectiveType?, startDate?, endDate?, priority?, weight?, ownerId?, lifecycle?}`. Lifecycle moves: draft→active\|cancelled, active→draft\|completed\|cancelled, completed→active, cancelled→draft (409 `invalid_transition`). Audited |
| DELETE | `/api/objectives/:id` **3.1** | `okr.archive` over it | Archives (nothing is deleted). 409 `has_open_tasks`, `already_archived` |
| POST | `/api/objectives/:id/publish` **3.1** | `okr.publish` | `{published}`; everyone in the organization may then read it. A draft cannot be published (409) |
| GET | `/api/objectives/:id/history` **3.1** | `okr.view` | The append-only history of recorded values, target changes and task outcomes |
| POST | `/api/objectives/:id/key-results` **3.1** | `okr.edit` over the objective | Adds a key result (same body as in creation) |
| PATCH | `/api/key-results/:id` **3.1** | `okr.edit` over the objective | `{title?, description?, unit?, startValue?, targetValue?, weight?, ownerId?, dueDate?}`; a changed target is written to the history |
| POST | `/api/key-results/:id/progress` **3.1** | `okr.update_progress` over the objective, or the key result's or objective's owner | `{value, note?}`: records an ACTUAL value (appends history naming the value it replaces; never overwrites). Only on an active objective (409 `objective_not_active`). Yes/no results take 0 or 1, manual ones 0 to 100 |
| POST | `/api/tasks/:id/dependencies` **4.2** | creator or `task.edit` over the people doing it | `{dependsOnId}`; 400 `self_dependency`, 409 `dependency_loop`, `already_dependent`. The waiting task cannot be completed until the other is finished (409 `waiting_on_tasks`) |
| DELETE | `/api/tasks/:id/dependencies/:depId` **4.2** | same | Removes it; 404 if there is none |
| POST | `/api/tasks/:id/outcome` **4.2** | the people doing the task, its creator, `task.edit` over them | `{summary, value?, recordOnKeyResult?}` on a finished or under-review task; with `recordOnKeyResult` and a value it also records the key result's actual value in the same transaction (history source `task_outcome`). Finishing a task never moves an objective by itself |
| POST | `/api/tasks/:id/review` **4.2** | `task.review` over the people who did it | `{quality: 1..5, note?}` on a finished task; never by the only person who did the work (403). Notifies them |
| POST | `/api/tasks/:id/assignments` **4.1** | `task.assign` (scope over the person or team) | `{assigneeId \| teamId, role?}`; 409 `already_assigned`, `task_closed`; notifies a new assignee |
| POST | `/api/tasks/:id/assignments/:aid/end` **4.1** | `task.assign` | Takes a person or team off (the row is kept with its end time); 409 `already_ended` |
| POST | `/api/tasks/:id/updates` **4.1** | `task.view` + in-service check | `{type: status_change\|progress\|time_log\|blocker, toStatus?, progressPct?, minutesLogged?, note?}`. Allowed for the people doing the task (directly or through a team they belong to), its creator and `task.edit` over them. Status follows the workflow (409 `invalid_transition`); `blocked` needs a note (400 `reason_required`); progress 0 to 99 (400 `use_complete`); time 1 to 1440 minutes. Append-only; the creator is told of a blocker or completion |
| GET | `/api/tasks/:id/updates` **4.1** | `task.view` | The history, oldest first |
| GET / POST | `/api/tasks/:id/comments` **4.1** | `task.view` / `task.view` | Anyone who can see the task may comment; the others who work on it are notified |
| PATCH / DELETE | `/api/tasks/:id/comments/:cid` **4.1** | author only (403 otherwise) | DELETE is a soft delete |
| POST / DELETE | `/api/tasks/:id/dependencies` | `task.edit` | cycle check |
| POST | `/api/tasks/:id/review` | `task.review` (scope) | `{outcomeQuality 1-5, note}` |
| POST | `/api/tasks/:id/evidence` | `evidence.submit` | Link existing or create evidence |
| GET | `/api/tasks/unaligned` | `task.view` | Tasks without objective or key result |
| GET | `/api/my-work` **4.4** | baseline (own data) | `counts`, the groups `overdue`, `dueToday`, `upcoming` (next 7 days), `blocked`, `inProgress`, `unscheduled`, `suggested` (rule-based order, each with `reasons`), `achievements` (completed in the last 14 days) and today's `dailyUpdate`. Linked objectives and KPI progress join when those links exist (3.1, 4.2) |
| POST / GET | `/api/daily-updates` **4.4** | baseline (own) | POST `{summary, blockers?, date?}`: one per person per day (today or yesterday); sending again replaces it; writes `daily_update.submitted` once per day. GET `?from&to` lists your own only. Seeing other people's updates arrives with the team pages (6.2) |
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
| GET | `/api/notifications` **4.5** | baseline (own) | `?unread=true&limit&cursor`; `{notifications, unreadCount, nextCursor}`, newest first |
| POST | `/api/notifications/:id/read`, `/api/notifications/read-all` **4.5** | baseline (own) | Someone else's notification or another organization's is 404 |
| GET / PUT | `/api/preferences` **4.5** | baseline (own) | `{types: [{type, label, description, inApp}]}`; PUT `{types: [{type, inApp}]}` (400 `unknown_type`). A missing row means on. In-app only until the integrations stages add channels |
| GET | `/api/audit-logs` **2.4** | `audit.view` | `?actorId&entityType&entityId&action&from&to&limit&cursor`, newest first, read only, paged (`meta.page.nextCursor`) |
| GET | `/api/system/status` | `system.view` | Version, migrations, last tick, job table, outbox backlog, AI/viaSocket configured flags |
| POST | `/api/export` / GET `/api/export/:id/download` | `data.export` | Per-table JSON bundle; async |
| GET | `/api/demo/status` **2.8** | `demo.manage` | `{loaded, loadedAt, counts, realPeople}` |
| POST | `/api/demo/load` **2.8** | `demo.manage` | One transaction: about 64 fictional people (each a `users` row with no password and an address ending `@demo.invalid`), 6 departments, 12 teams (one a sub-team), designations, reporting lines, heads and leads, role assignments (CEO and Senior Management organization-wide, Department Head for one department, Team Lead for one team, Manager, Mentor, Employee), about 150 tasks with a believable history, daily updates and a few notifications; all flagged `is_demo`. 409 `demo_loaded`. Audited |
| POST | `/api/demo/remove` **2.8** | `demo.manage` | Deletes exactly the demo rows and what hangs off them, in one transaction. 409 `demo_blocked` with `details.blockers` (kind, count, plain message) when the organization's own rows still point at demo rows: a real task assigned to or created by a demo person or in a demo team, an open reporting line between a real and a demo person, a real person still in a demo team or department, a role limited to a demo department or team, a real person holding a demo designation. Nothing changes then. 409 `demo_not_loaded`. Audited |
| GET | `/api/demo/personas` **2.8** | `demo.manage` | The demo people to view as, with `group` (leadership, heads, managers, employees) taken from where they sit in the tree |
| POST | `/api/demo/view-as/:membershipId` **2.8** | `demo.manage` | A read-only session as a demo person, one hour at most. The administrator's own cookie is kept aside (`zentro_admin_session`) and the session cookie is replaced. Every write answers 403 `read_only_session` except stopping. A real person or another organization's person is 404. Returns `{viewingAs, me}`; `me.viewingAs` is set. Audited (`demo.view_as`) |
| POST | `/api/demo/stop-viewing` **2.8** | baseline | Ends the demo session (revoked), restores the administrator's own cookie and returns their `me`; 409 `not_viewing` for anyone else. Audited (`demo.view_as_stop`) |
| GET | `/api/overview` **6.1** | baseline (the page adapts to the caller's permissions) | `{today, preset: personal\|team\|executive, personal, team, organization, checklist, flags}`. `personal` always (own tasks and unread notifications); `team` when the caller's `task.view` scope reaches other people; `organization` only when both `task.view` and `org.view` reach everyone; `checklist` ticks from real rows; `flags.canSetUp`, `demoLoaded`, `canManageDemo`. A person with no role gets their own (empty) numbers only |

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

- Registered today: `GET /healthz` (public) and `GET /api/cron/tick` (cron). The two stage 1.1 spike routes (`/api/spike`, `/api/spike/visit`) were **removed in stage 1.3**.
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
