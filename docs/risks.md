# Zentro: Technical and Product Risks

Covers master section 28 item 12 ("major technical risks and how to address them") and showcase override 3 (record "no RLS in SQLite"). Likelihood and impact are my honest estimates (L low, M medium, H high). "Proved in" names the stage where the mitigation is verified, so a risk is never closed by assertion alone.

Related: [known-limitations](known-limitations.md) (what the showcase deliberately does not do), [architecture](architecture.md) section 3 and 4 (facts and discrepancies).

---

## 1. Risk register

### Platform and build

| ID | Risk | L | I | Mitigation | Proved in |
| --- | --- | --- | --- | --- | --- |
| **R-01** | **No Row Level Security in SQLite.** Tenant isolation is application-level; one missed `organization_id` predicate is a cross-tenant leak that RLS would have contained. | M | H | One data-access layer (SQL only in repositories); organization id from the server session only; SQL-lint test rejecting any statement on an organization-owned table without the predicate; strict mode asserting every returned row's `organization_id`; generated tenancy matrix (org B against org A ids → 404); cross-reference test. **Production path remains Postgres + RLS.** | 1.2, 2.3, 9.2 |
| **R-02** | **A TypeScript backend compiled at build time has never run on Embarko.** Curevia and HireDrive are plain JavaScript. | M | H | Stage 1.1 is a dedicated deploy spike before any feature. `tsc` pinned to 5.9 (pure JS), output to `build/`. Fallback order: `tsx` at runtime, then plain JS for the backend. | 1.1 |
| **R-03** | **Node 20 dependency drift.** Found already: `better-sqlite3@13` and `vitest@5` need Node 22+; Vite 8 needs `^20.19`. Embarko's Node comes from `engines.node` (">=20" gave 20.20.2, never stated in docs). | M | H | Pins (`better-sqlite3 ^12.11`, `vitest ^3.2`, `typescript ~5.9`); `check:node20` scans the lockfile; build and tests run on a real Node 20.20.2 binary; stage 1.1 prints `node -v` on the live page; renovate-style manual review before any major bump. | 1.1, every stage |
| **R-04** | **256 MB memory cap** (not raisable): SQLite page cache, JSON in memory, AI prompts, Recharts SSR not applicable but large responses, 300-person recursive queries. | M | M | Pagination everywhere; bounded tool results; `cache_size` limited; streaming JSON avoided for big exports (chunked); memory logged in `/healthz` and the System panel; load test with 300 people. | 9.3 |
| **R-05** | **One process, no workers.** Deploys and crashes drop in-flight work; Embarko does not document that work after a response is guaranteed to continue. | M | M | Every async job is a durable row (`agent_runs`, outbox, `scheduled_job_runs`) and idempotent; the tick recovers stuck rows; UI polls state rather than trusting a live process. | 1.2, 7.2, 8.3 |
| **R-06** | **Scheduler limits:** at most 5 schedules, never more often than every 5 minutes, 5 minutes per call, missed times not replayed, overlap is skipped, needs a kept (claimed) app (a temporary app ignores schedules and is deleted after 24 h). Everything asynchronous therefore has up to ~5 minutes of latency. | H | M | One tick with a job registry (leaves 4 spare schedules); 202-immediately pattern (Curevia); state-based jobs, so a missed run only delays work; post-commit "kick" for the outbox; the app is claimed in 1.1; latency stated in the UI ("checked every 5 minutes"). | 1.1 |
| **R-07** | **SQLite schema limits and Embarko's bookkeeping tables.** SQLite cannot alter CHECK constraints; a table rebuild is risky; a schema-diff tool would try to drop `_litestream_*`; single writer. | M | M | Append-only SQL migrations with checksums; no CHECK on growing enums (Zod validates); pre-migration DB copy when a rebuild is unavoidable; never touch `_litestream_*`; WAL + busy timeout; destructive changes split across two deploys. | 1.2, 9.4 |
| **R-08** | **Embarko file storage is public by link** (anyone with the URL can open it; limited extensions). Master requires confidential evidence with secure file access. | H | H | Do **not** use it for evidence. Evidence files live as capped SQLite BLOBs behind an authenticated route that re-checks scope and confidentiality; otherwise evidence is a link. | 4.3 |
| **R-09** | **No backups on Embarko** (docs: "Data is not backed up"). A lost volume or bad migration loses everything. | M | H | Admin data export (JSON); nightly consistent snapshot copy under `DATA_DIR` (last 3) protects against bad migrations and deletions but **not** volume loss; the UI states this plainly; demo data can always be reloaded; you are told to export periodically. Real fix is a managed Postgres with backups. | 9.4 |
| **R-10** | **Express 5, Vite 8, Tailwind 4, React 19, shadcn/ui:** a young combination; version churn, subtle breaking changes (Express 5 route syntax). | M | L | HireDrive proved Express 5, Vite 8 and Tailwind 4 on Embarko; exact lockfile; small upgrade steps only with the Node 20 gate. | 1.1, 1.3 |
| **R-20** | **Embarko platform assumptions:** region not selectable or guaranteed; CSP injected and not controllable; Integrations/AI capabilities need a workspace **Owner** to enable "pay as you use"; app names are globally unique. | M | M | Documented in architecture section 3; open question 4 covers the Integrations choice; region/residency pointed to Embarko's DPA before real data is used. | 1.1, 8.1 |

### viaSocket and AI

| ID | Risk | L | I | Mitigation | Proved in |
| --- | --- | --- | --- | --- | --- |
| **R-11** | **viaSocket embed component names do not exist** (`ViaSocketActionEmbed`, `useGetViaSocketEmbedToken` not found anywhere I could read), SDK API moved between 0.7 (Curevia) and 0.21, docs change quickly. | H (names) / M (drift) | M | Use the proven script embed behind our own component and hook; pin the SDK exactly; all viaSocket code isolated in `integrations/viasocket/`; each stage-8 sub-stage re-reads the docs and runs `check:viasocket`; live embed spike first. | 8.1 |
| **R-12** | **Delivery semantics of viaSocket flows.** HTTP 200 can hide a failed step; delivery is at-least-once (a timeout can cause a duplicate run); a paused flow answers 400; the flow run URL is a credential; alerts are sent once with no retry. | H | M | Read response bodies for errors (Curevia's `replyProblem`); idempotency key in every payload and instructions to dedupe inside flows; paused → slot paused; URL encrypted at rest and never sent to browsers; hourly sync and a signed alerts endpoint. **Duplicates remain possible** in the lost-response window (documented). | 8.2, 8.3 |
| **R-13** | **Confidential performance data sent to a third-party model** (via viaSocket's AI API). Free-text task descriptions and comments can contain names or sensitive details. viaSocket's assistant also has web search and a browser that cannot be turned off. | M | H | `AI_REDACTION=refs` by default (aliases, re-hydrated server-side); never send emails, phones, employee codes, private review notes, file contents or secrets; free text truncated and excludable; prompts forbid browsing; the AI settings page names the third party; the organization can run with AI off. | 7.1, 7.7 |
| **R-14** | **Hallucinated or wrong numbers and claims.** | M | H | Deterministic engine owns every number; agents receive `explanation_json`; reference-integrity check; supporting values filled by code; number guard with visible badge; false-action-claim stripping; agents cannot write. | 7.2 |
| **R-15** | **AI service behavior churn:** model ids change (Curevia's list is already older than viaSocket's current guide), some models ignore `json_schema` (`claude-opus-5-5`), latency 4 to 30 s, credits can run out (HTTP 402), cost. | H | M | Model ids are environment variables verified at 7.1; wrapper validates every output with Zod and repairs once; timeouts, retries, daily run cap; clear "credits exhausted" state; runs are async. | 7.1 |
| **R-16** | **Prompt injection through stored text** (task titles, comments, evidence descriptions). | M | M | Data wrapped and labelled untrusted; agents have no write tools, only proposals that need human approval executed as the approver; output guards; tools never expose secrets. | 7.2, 7.5 |

### Product, people and correctness

| ID | Risk | L | I | Mitigation | Proved in |
| --- | --- | --- | --- | --- | --- |
| **R-17** | **Misuse of scores** for employment decisions; unfairness; gaming (Goodhart's law); legal exposure (privacy law, labour law, works councils vary by country). | M | H | Scores are explainable, provisional/insufficient states, confidence, no cross-role scoring, context factors shown; **no hiring/firing/promotion/compensation output anywhere** (filter on AI text, no such endpoints, standing UI notice); evidence affects confidence not value; showcase uses fictional data. **Not legal advice**: before real use you need legal review. | 5.2, 7.2 |
| **R-18** | **Scoring correctness and reproducibility** (float rounding, renormalization, model misconfiguration). | M | H | Pure engine; golden vectors and property tests; half-up rounding via integers; immutable runs with inputs and hash; **verify** action recomputes from stored inputs; weights must sum to 100; what-if preview before activation. | 5.1, 5.2 |
| **R-19** | **Scope resolver correctness and speed** (recursive hierarchy, effective dating, stale cache). | M | H | Table-driven tests (depth 3, moved person, dotted lines, expiry); per-request memo plus in-memory cache keyed by hierarchy version bumped in the same transaction; EXPLAIN review at 300 people. | 2.3, 9.3 |
| **R-21** | **Authentication weaknesses:** brute force; open registration on a public showcase link inviting abuse; scrypt blocking the event loop; password reset without an email flow; JWT without revocation. | M | M | Rate limits per IP and account with backoff; `REGISTRATION_MODE` (`open`, `invite_only`, `code`); async scrypt with moderate cost; admin-copied reset link fallback; JWT carries only a session id checked against a revocable `sessions` row; reset revokes all sessions. Rate-limit counters are in memory and reset on restart (listed in known-limitations). | 2.1, 2.2, 9.1 |
| **R-22** | **Demo data contamination:** real rows referencing demo rows, removal leaving orphans; "view as persona" misused to see real data or write. | M | M | `is_demo` on every seeded row; removal refuses and lists blockers; view-as only to `is_demo` users, forced read-only, bannered and audited; tests assert load then remove leaves zero demo rows. | 2.8 |
| **R-23** | **Time zones and period boundaries** (DST, fiscal quarters, "as of period end" membership). | M | M | Organization timezone stored; calendar dates as plain `YYYY-MM-DD`; timestamps UTC; boundary tests around DST and quarter edges. | 5.3 |
| **R-24** | **Alert fatigue and duplicate notifications.** | M | M | Dedupe keys on every producer; quiet hours; severity gating; per-user preferences; digest rules. | 4.5, 8.4 |
| **R-25** | **Hidden coupling between aggregate UI numbers and permissions** (a dashboard total that counts rows the viewer cannot see). | M | H | Dashboards compute from scope-compiled queries (not fetch-then-filter); permission matrix runs against dashboard endpoints; confidential-field tests. | 6.1, 9.2 |
| **R-26** | **Accessibility and bundle size** drift as the UI grows. | M | L | Route-level code splitting, chart table alternatives, axe pass and keyboard pass in 9.3 and 9.5. | 9.3 |

### Delivery

| ID | Risk | L | I | Mitigation | Proved in |
| --- | --- | --- | --- | --- | --- |
| **R-27** | **Scope and session length.** 51 stages across many long sessions; context loss between sessions. | H | M | `PROGRESS.md` updated after every stage so a fresh session can resume; small stages; docs are the source of truth; each stage self-contained and deployable. | every stage |
| **R-28** | **Tests passing on the sandbox's Node 22 but failing on Embarko's Node 20.** | M | H | Every build and test run on a real Node 20.20.2 binary; the lockfile engine scan. | every stage |
| **R-29** | **I cannot reach everything from this cloud session** (viaSocket sign-in needs a browser; Embarko dashboard actions; deploy token). | H | L | Listed in [viasocket-integration](viasocket-integration.md) section 9 and in each stage's "Needs from you"; secrets are typed by you on Embarko's page. | 1.1, 8.1 |

---

## 2. Requirements that needed a technical decision before development

Master section 28 asks for these to be identified. All are answered with a recommendation in the architecture decision log; the ones that need **your** confirmation are in the open questions at the end of my report.

| Requirement | Decision | Confirm with you? |
| --- | --- | --- |
| Backend in TypeScript on a platform that has only run JavaScript for you | Compile with `tsc` at build (D3), proven in 1.1 | Yes (question 1) |
| JWT cookie vs revocation | JWT carrying a session id, backed by a `sessions` row (D6) | Yes (question 2) |
| Public registration on a public demo link | `REGISTRATION_MODE` | Yes (question 3) |
| viaSocket credentials route (own keys vs Embarko Integrations capability) | Support both; recommend your own keys as in Curevia | Yes (question 4) |
| Evidence "file upload" with confidentiality | Capped BLOBs + authenticated route; links otherwise (D11) | Yes (question 5) |
| Admin "view as demo persona" | Read-only, demo users only | Yes (question 6) |
| What data the AI sees | Aliases by default, names optional (D, section 2 of agent specs) | Yes (question 7) |
| Platform email flow for reset and invitations | Optional; admin-copied links as fallback | Yes (question 8) |
| Embed component names in master section 14 | Use the proven script embed behind our own component | Informational; tell me if you saw those names somewhere |
| Hierarchy history, peer cohorts as of a period | Effective-dated assignments incl. `designation_assignments` | No |
| Scoring normalization across roles | No cross-role scoring; cohorts by role family | No |
