# Zentro: Known Limitations (Showcase)

Zentro is a **showcase**: every feature area exists end to end on a live Embarko link, but where the full-scale version is impractical, a simpler real version is built and the gap is listed here (showcase override 9: "do not silently skip anything"). This file is updated at the end of every stage; nothing here is hidden from the UI where it affects results.

Related: [risks](risks.md) (what could go wrong), [milestones](milestones.md).

---

## 1. Scale and availability

| Limitation | Detail |
| --- | --- |
| Target size | Built and tested for **up to about 300 people in one organization** on 256 MB (verified in stage 9.3 with a seeded load), not for large multi-tenant production traffic. Beyond that: Postgres, more memory, background workers. |
| One process, no high availability | Embarko runs one process. Deploys and crashes cause a short outage and drop in-flight requests; durable rows and the tick recover queued work. |
| Asynchronous latency | Anything done in the background (outbox sends, overdue checks, risk scans, score recalculation, reminders) happens on the 5-minute tick, so notifications can lag up to about 5 minutes (the first send attempt after a change is immediate when the process is healthy). |
| No real-time push | No WebSockets on Embarko, so screens **poll** (AI runs every 2 seconds while running) instead of live updates. |
| SQLite | Single writer; one file under `DATA_DIR`; no replicas. |
| Platform | A temporary Embarko app is deleted after 24 hours unless claimed (schedules need a claimed app); region not guaranteed; Embarko controls the CSP. |

| Unknown web addresses answer HTTP 200 | The server returns the app shell for any non-`/api` GET (so deep links work) and the app shows its own "Page not found" page. The browser sees a 404 page; crawlers and monitors see status 200. Unknown `/api/*` paths do return a real 404. |

## 2. Data protection and operations

| Limitation | Detail |
| --- | --- |
| **No backups** | Embarko does not back up data. The app offers JSON export and nightly snapshots **on the same volume**, which do not protect against losing the volume. Export regularly. |
| No Row Level Security | Tenant isolation is application-level and test-proven, not enforced by the database ([risks](risks.md) R-01). |
| Audit log is append-only by code, not tamper-evident | No hash chain or external write-once store. |
| Retention | Only tokens, expired sessions and old AI step arguments are purged automatically. No configurable retention policy, no data-subject request tooling beyond export and archive. Privacy-law compliance (GDPR and others) is **not** claimed. |
| Rate limits are per process | Counters live in memory and reset on restart. |
| Uploads | Evidence files are capped (2 MB each, 100 MB per organization; png, jpg, pdf, txt, csv, md), stored as database BLOBs, **not virus scanned**. |
| Logs | Embarko exposes only the most recent output (about 8 KB per stream), so logs are terse by design. |

## 3. Security and accounts

| Limitation | Detail |
| --- | --- |
| No MFA, SSO, SAML or SCIM | Email and password only. |
| Email verification and self-serve password reset | Only when a platform email flow is configured; otherwise an administrator copies links. |
| Registration | Controlled by `REGISTRATION_MODE`; `open` on a public link invites abuse. |
| Super Admin | Master section 15 lists a "Super Admin". The showcase has no platform operator console; the Organization Owner is the highest role in an organization. |
| Key rotation | Rotating `SESSION_SECRET` signs everyone out; rotating `ENCRYPTION_KEY` requires re-binding viaSocket slots (no re-encryption tool). |

## 4. Product features: what the showcase version does

| Area | Exists in the showcase | Not in the showcase |
| --- | --- | --- |
| **Organization** | Dynamic departments, sub-teams, designations, role families, effective-dated reporting and memberships, org chart, history | Bulk CSV import and HRIS sync, org chart export/print, "what-if" reorganizations |
| **OKRs** | Four levels, parents with weights, five measurement types, health, history, publishing | A task contributes to one objective and one key result (not many); milestone key results use a manually recorded percentage; no automatic cascading or check-in cadence rules |
| **KPIs** | Definitions, assignments to person/team/department/designation/role family, thresholds, append-only history, coverage | No automatic ingestion from external systems except through the inbound evidence endpoint and manual or imported entry; no formula (derived) KPIs |
| **Tasks** | Statuses, assignment, dependencies, updates, comments, estimates, outcomes, evidence | No recurring tasks, subtask rollups beyond a parent link, time tracking timers, Gantt or calendar views |
| **Evidence** | Typed evidence with verification and confidentiality, links and small files | No native GitHub/CRM connectors (integration evidence arrives through viaSocket flows and is **unverified** until a person verifies it); no OCR or document preview |
| **Scoring** | Configurable weighted models per role, provisional/insufficient states, confidence, explanations, immutable runs, verification | No automatic adjustment for workload or objective difficulty (shown as context only); simple percentile/z-score normalization; no calibration sessions or forced distributions |
| **Peer comparison** | Cohorts by role family as of the period, caveats, saved snapshots | No cross-role "universal" score (refused by design); small cohorts are not ranked |
| **Mentorship** | Assignments, activities, computed development index with disclosed factors | The attribution is a transparent heuristic (duration, credit split, scale factor `k`), not causal inference; no skills matrix beyond simple rated metrics |
| **Reviews** | Manager/self/peer/calibration reviews with private notes and visibility | No multi-rater 360 survey flows, performance improvement plans, or review-cycle automation beyond reminders |
| **Leadership** | Contribution chain, strategic execution with pace, organizational health from configured KPIs and department scores | Financial metrics are entered or posted as KPIs; there is no accounting integration |
| **Predictions** | Linear projection with prediction interval, only with at least 4 points over 21 days | No seasonality, no machine-learning forecasts |
| **Dashboards** | Capability-adaptive widgets, charts from real rows, date presets, drill-down | No user-built custom dashboards, no scheduled PDF reports |
| **Notifications** | In-app plus external through viaSocket slots, quiet hours, preferences | No mobile push, no per-channel digests beyond configured rules |

## 5. AI

| Limitation | Detail |
| --- | --- |
| Quality depends on the configured model | Outputs are validated and grounded, but wording and judgement vary by model. |
| English only; no voice, no image input, no web browsing | The prompts forbid browsing; viaSocket's assistant has browsing built in that cannot be switched off, which is why prompts say not to use it. |
| No cross-session memory | Each run sees only the tool results for the current question and the last six chat messages. |
| Agents cannot act | They propose; humans approve; applied actions run as the approver. An approved automation policy can auto-approve only low-risk notifications. |
| Predictions and rankings are not decisions | There is no hiring, firing, promotion or compensation output by design. |
| Run caps | A daily run cap per organization (default 200) and a 6-step limit per run. |
| Data to a third party | Prompts go to the model provider behind viaSocket (or Anthropic if switched); aliasing reduces but does not remove this ([risks](risks.md) R-13). |
| Credits | If the viaSocket plan has no AI credits, AI screens say so; deterministic features continue. |

## 6. viaSocket integration

| Limitation | Detail |
| --- | --- |
| Organization-level identity | One viaSocket identity per Zentro organization (`unique_identifier`), under **one viaSocket embed project for the whole deployment**. No per-user personal connections and no per-tenant viaSocket projects. |
| At-least-once delivery | A lost response can cause a duplicate flow run; flows can dedupe on the idempotency key, but not every target app can. |
| Flow behavior is the administrator's | Zentro sends what rules and approvals allow; what a flow does with it is configured in viaSocket. |
| One-way by default | Outbound events and an authenticated inbound evidence endpoint; no two-way record sync with external systems. |
| Needs your sign-ins | Creating embed keys, connecting Slack/Gmail and setting alert addresses require your viaSocket and app logins ([viasocket-integration](viasocket-integration.md) section 9). |
| SDK drift | viaSocket changes quickly; Zentro pins the SDK and re-verifies at each stage-8 step. |

## 7. User interface

| Limitation | Detail |
| --- | --- |
| English only, no internationalization | |
| Accessibility | Built to WCAG 2.1 AA practice (Radix primitives, labelled charts, keyboard-operable tree), checked by tests, an axe pass and a manual keyboard pass; not formally audited or certified. |
| Browsers | Current evergreen browsers; no legacy support. |
| No offline mode, no native mobile apps | Responsive web only. |
| Org chart | Lazily loads deeper levels; very wide levels fall back to a list view on small screens. |

## 8. Demo data

- The demo company is **fictional**; its numbers are real database rows, so dashboards behave exactly as with real data, but they describe no real people.
- Loading demo data is blocked while it is already loaded; removal refuses if real rows reference demo rows and lists the blockers.
- "View as demo persona" is read-only and limited to demo people.

## Added in stage 2.1 (auth core)

- **Rate limits are kept in memory** in the single server process. A restart (a deploy, or Embarko restarting the app) forgets the counts, so an attacker who can trigger restarts gets a fresh allowance. Acceptable for a showcase; a database-backed limiter is a small change if needed.
- **One organization per person for now.** Onboarding refuses a second organization (`409`); switching organizations arrives later. The schema already allows several memberships per login.
- **Registering with an email that already exists is silent by design** (the same answer as a new one, so nobody can learn which emails exist). The person simply cannot sign in with the new password; password reset arrives in stage 2.2.
- **No password reset, invitations or email verification yet** (stage 2.2). The Owner role exists but holds no permission rows until the RBAC engine (2.3); until then there are no permission-gated screens, so nothing depends on it.
- **No audit log yet** (stage 2.4): sign-ins and organization creation are not audited.
- **Forms are plain controlled React forms**, not React Hook Form, because there are only three small ones.

## Added in stage 2.2 (reset and invitations)

- **No email is sent.** Invitation and password-reset links are shown once to the administrator, who copies and sends them. "Forgot password" cannot send anything: it tells the person to ask their administrator. Email arrives with the outbox in stage 8 through one marked hook (`modules/auth/delivery.ts`).
- *(Resolved in 2.3: the permission engine now decides; see below.)*
- **A link shown once cannot be shown again.** If an administrator loses it they use "New link" (invitations) or generate another reset link; the old one then stops working.
- **Nobody can join two organizations yet.** A person who already belongs to an organization cannot accept another invitation (`409`); organization switching comes later. A reset link can only be created for a login that belongs to the administrator's own organization.
- **An invitee's email address is not verified** beyond possession of the link (no email flow yet): whoever holds the link and types the invited address can join. Treat an invitation link like a password and send it privately.
- Rate limits are in memory (see stage 2.1). The administrator's list of people (`/api/organization/members`) is a temporary view that the people API (2.6) replaces.

## Added in stage 2.3 (RBAC engine)

- **Teams, departments and reporting lines do not exist yet** (stages 2.5 and 2.6). Until then the resolver knows nobody belongs to a team and nobody reports to anyone: a grant in `reports` mode reaches only the person themselves, and `my_teams` and department/team-limited assignments reach nobody. Owner, CEO and other organization-wide grants work fully; manager and team-lead grants become useful when the hierarchy arrives. The resolver itself is tested with a full fake hierarchy.
- **Invitation management is organization-wide only.** An assignment limited to a department or team cannot invite people (an invitation has no subject until it is accepted); revisit with 2.5.
- **Roles are read only** (`/settings/roles`). Creating and editing roles, assigning roles with a scope and dates, the "last administrator" guard for role changes, and the audit log are stage 2.4. Until then a person gets a role only by being invited into one (the new organization's creator is the Owner).
- **No way to remove another person yet.** "Delete my account" is the only way someone leaves; an administrator removing a person comes with people management (2.4 to 2.6).
- **Delete my account keeps an empty tombstone** for a login that created an organization that continues (the organization needs its creator reference); no email, name or password remains. When an organization is deleted with its last member, nothing of it is kept. Every later stage that adds an organization-owned table must add it to `erasure.ts` (a test enforces this).
- **Restoring from the automatic backup needs file access.** The backup (`<data folder>/backups/pre-<migration>-<time>.db`, the newest three kept, same disk as the database) was rehearsed locally, but Embarko gives no shell or file download, so on the live app a restore cannot be done by hand today. A one-time "restore this backup at start-up" setting is a possible small addition; it is not built.
