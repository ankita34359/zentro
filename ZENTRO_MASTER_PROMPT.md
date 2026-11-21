# ZENTRO SHOWCASE OVERRIDES (READ THIS FIRST)

**These overrides win over everything written below. If a later section conflicts with this one, follow this one.**

Zentro (formerly named PerformAI) is a **showcase project**. The goal is to demo ALL the features end to end on a live link, not to run at 300-employee production scale.

It is built and deployed the same way as the Curevia app (repo `ankita34359/Curevia`) and HireDrive (deploy runbook: `ankita34359/Automation_Embed` -> `EMBARKO-DEPLOY-RUNBOOK.md`). **When unsure, copy what worked in Curevia.**

The person using this has no code editor. Everything is built by Claude Code, pushed to GitHub, deployed to Embarko, and tested on the live Embarko link.

## 1. Name
The product is **Zentro**. Use that name everywhere (UI, package names, docs, repo, emails).

## 2. Database: SQLite, not Postgres
- Use **SQLite via `better-sqlite3`**, using the version range that worked on Embarko's Node 20 in Curevia (`^12.x`). The database file lives under `DATA_DIR`.
- **No Postgres, no Supabase, no Prisma** for now. This replaces the Prisma/PostgreSQL parts of sections 16, 17 and 25.
- The schema is plain SQL migration files in `database/migrations/`, applied automatically at server start and tracked in a `schema_migrations` table. No `schema.prisma`.
- Keep the schema **portable to Postgres later**: text UUID primary keys, `organization_id` on every organization-owned table, `created_at` / `updated_at`, soft delete or archive where appropriate, no SQLite-only tricks.
- Every entity listed in section 16 is still required. Refine them in `docs/database-design.md` with a Mermaid ER diagram.

## 3. Tenant isolation without Row Level Security
SQLite has no RLS. Instead:
- One data-access layer. Every query takes `organization_id` from the **authenticated session on the server**, never from the request body or URL.
- Automated tests that prove one organization cannot read or write another organization's records.
- Record "no RLS in SQLite" in `docs/risks.md`.

## 4. Authentication
- Own email + password login (like Curevia): signed JWT in an httpOnly cookie. Hash passwords with Node's built-in `crypto.scrypt` so there is no native dependency.
- Registration, login, logout, password reset, organization creation, invitations (invite code / link), session expiry.
- Roles and permissions stay **database-driven and configurable** (section 15). Do not hardcode them.

## 5. Hosting on Embarko: ONE app
- A single Express server app serves the built React frontend and the `/api` routes (as in Curevia). Do NOT split into two Embarko apps.
- The start script must listen on `process.env.PORT` and `0.0.0.0`. The build must work on **Node 20** (test with a real Node 20 binary). If the backend is TypeScript, it must be compiled at build time in a way that is proven on Embarko; check the runbook.
- Embarko has **no background workers, no multiple processes, no WebSockets**. Everything asynchronous (outbox dispatch, retries, reminders, overdue checks, risk scans, KPI threshold checks) runs from **scheduled routes** called by Embarko via the `embarko.json` schedule (about every 5 minutes), protected by a secret header.
- Secrets go only on Embarko's secrets page. Never in the repo, never in chat.

## 6. AI
- Use a **provider-agnostic AI wrapper**. The default provider is the **viaSocket AI API** (as in Curevia). Switching to the Claude API later must need only environment variables.
- Scores, permissions and calculations are deterministic code. The AI only explains and recommends.
- Agents never get raw database access. They call permission-checked tool functions that run as the asking user and the user's organization.
- Agent outputs are structured JSON validated with Zod. Every run is logged in `agent_runs`.
- If no AI provider is configured, AI screens say "AI is not configured". **Never show fake AI output.**

## 7. viaSocket embed
- Follow the method that worked in HireDrive/Curevia: embed script plus a JWT embed token generated **on the backend**.
- Section 14 names `ViaSocketActionEmbed` and `useGetViaSocketEmbedToken`. These names could NOT be found in viaSocket's public docs. Verify against the actual current docs/SDK before Milestone 8. If they don't exist, use the proven script-embed method and tell me.

## 8. Demo data (showcase exception to "no fake numbers")
- Dashboards must read **real database rows**, never hardcoded numbers in the UI.
- For the showcase, add an **admin-only "Load demo data" button** that seeds a fictional company (departments, teams, people, objectives, key results, KPI history, tasks, evidence, mentorship) as real rows flagged `is_demo`. Label it "Demo data" in the UI and add a "Remove demo data" button.
- An empty organization still shows the onboarding empty states from section 18.

## 9. Scope and honesty
- All feature areas in this document must exist in the showcase. Where full scale is impractical, build a simple but real version and list the gap in `docs/known-limitations.md`. **Do not silently skip anything.**
- The frontend stack in section 17 stays: React, TypeScript, Vite, Tailwind, shadcn/ui, React Router, TanStack Query, Recharts, React Hook Form, Zod.

## 10. How to work (Curevia method)
- Plan first. No application code until I approve the blueprint.
- Small stages. Stop after each milestone and tell me exactly what to click to test it on the **live Embarko link**.
- Keep `PROGRESS.md` updated after every stage so a fresh session can resume. Sessions get long.
- Work on a branch. Ask me before pushing to `main` and before deploying. Each deployed milestone must work on its own.
- Never print or commit secrets, tokens, webhook URLs, `.env`, `node_modules`, `dist` or `data/`.

---

# MASTER PROJECT PROMPT: ZENTRO
## AI-Powered Organization-Wide Performance Management and Intelligence Platform

---

# 1. YOUR ROLE AND RESPONSIBILITIES

Act as a senior software architect, product manager, UI/UX designer, full-stack engineer, database architect, AI engineer, and DevOps engineer.

You are responsible for designing and building a production-oriented SaaS application named **Zentro**.

You must think like an experienced startup engineering team building a scalable enterprise product, not like a developer creating a college project or a simple CRUD application.

Your responsibilities include:

- Understanding the complete product requirements before writing code.
- Designing a scalable technical architecture.
- Creating a well-structured relational database.
- Developing a modern, professional, responsive frontend.
- Developing a secure and scalable backend.
- Implementing AI agents that analyze actual organizational data.
- Integrating viaSocket for automation and third-party application connectivity.
- Implementing organization-level and role-based access control.
- Building meaningful dashboards with real database data.
- Ensuring that all modules work together.
- Writing maintainable, reusable, well-documented code.
- Testing functionality, security, permissions, and business logic.

Do not make assumptions that conflict with the requirements below.

If an important technical decision is unclear, explain the available approaches and recommend the most appropriate one before implementation.

---

# 2. PRODUCT OVERVIEW

## Product Name

Zentro – Organization Performance Intelligence

## Product Vision

Build an AI-powered organization-wide performance management platform that provides complete visibility, transparency, accountability, and measurability across an entire company.

Zentro should help organizations understand:

1. What the company wants to achieve.
2. What each department is responsible for.
3. What each team needs to accomplish.
4. What every employee is working on.
5. Whether the work being performed contributes to organizational goals.
6. Whether employees, teams, managers, and leaders are achieving their objectives.
7. Where performance is improving or declining.
8. What is preventing the organization from achieving its goals.
9. What actions should be taken to improve performance.

The platform must support the entire organizational hierarchy, starting from the CEO and senior management and extending to department heads, managers, team leads, mentors, employees, and interns.

The system must not be limited to employee task tracking or traditional HR performance reviews.

It must connect organizational strategy, objectives, key results, KPIs, daily work, evidence, performance analysis, and business outcomes.

## Core Philosophy

Zentro must measure outcomes, not merely activity.

For example:

Completing 100 tasks does not automatically mean an employee has performed better than someone who completed 20 tasks.

The platform must consider:

- The importance of the work.
- The expected outcome.
- The actual result.
- The quality of the result.
- The business impact.
- The time taken.
- The contribution to organizational objectives.
- Supporting evidence.

AI should help understand performance, identify gaps, explain results, and recommend improvements.

Actual performance calculations must be performed using transparent, deterministic business logic rather than allowing an LLM to invent scores.

---

# 3. ORGANIZATIONAL STRUCTURE

One of the most important requirements is that the organization structure must be completely dynamic.

Do not hardcode a fixed hierarchy.

Different organizations may have different structures.

For example:

Organization
- CEO
- Senior Management
- Departments
  - Engineering
    - Engineering Manager
      - Team Lead
        - Mentor
          - Employee
          - Intern
  - Marketing
    - Marketing Head
      - Marketing Manager
        - Team Members
  - Sales
    - Sales Head
      - Sales Manager
        - Sales Representatives
  - Human Resources
  - Finance
  - Operations

This is only an example. The application must allow organizations to create their own structure.

## Required functionality

An organization administrator or authorized user must be able to:

- Create departments.
- Rename departments.
- Delete or archive departments.
- Create teams inside departments.
- Create subteams.
- Add employees to departments and teams.
- Assign managers and reporting managers.
- Assign team leads.
- Assign mentors or TLCs.
- Change reporting relationships.
- Move employees between teams or departments.
- Assign multiple organizational responsibilities where appropriate.
- Define custom designations and roles.
- Create new levels in the hierarchy.
- View the complete organizational hierarchy visually.

The hierarchy must not assume that every employee has exactly one manager or that every department has the same number of levels.

Support flexible reporting relationships and preserve historical organizational assignments.

## Organization Hierarchy Visualization

Build an interactive organization chart.

Users with the appropriate permissions should be able to:

- Expand and collapse departments.
- View teams and subteams.
- View reporting relationships.
- Open an employee profile.
- View the objectives and KPIs of each level.
- Navigate from the CEO to an individual employee.
- View performance at each level.

---

# 4. ORGANIZATION-WIDE OBJECTIVE AND OKR MANAGEMENT

The platform must support objectives at every organizational level.

## Objective hierarchy

Company Objectives
→ Department Objectives
→ Team Objectives
→ Individual Objectives
→ Key Results
→ Tasks and Deliverables

Example:

Company Objective:
Increase company revenue by 30% this quarter.

Department Objective:
Increase qualified leads by 40%.

Team Objective:
Improve lead conversion from 15% to 22%.

Individual Objective:
Generate 100 qualified leads this month.

Key Results:
- Generate 100 qualified leads.
- Maintain a minimum lead quality score of 80%.
- Achieve a 22% conversion rate.

Tasks:
- Research potential customers.
- Contact qualified prospects.
- Schedule product demonstrations.
- Follow up with leads.
- Update CRM records.

## Required functionality

Users with appropriate permissions must be able to:

- Create objectives.
- Assign objectives to departments, teams, or individuals.
- Create measurable key results.
- Define target values.
- Record actual values.
- Set deadlines.
- Define priorities.
- Assign objective owners.
- Link child objectives to parent objectives.
- Link tasks to objectives and key results.
- Update progress.
- Upload supporting evidence.
- View objective history.
- Identify objectives that are on track, at risk, delayed, or completed.

Objectives must support different measurement types, including:
- Percentage.
- Numeric values.
- Currency.
- Counts.
- Boolean completion.
- Custom measurable values.

Support configurable progress calculations depending on the objective type.

An objective must not be considered successful merely because all associated tasks are marked complete.

The actual key result must be evaluated against its target.

## Goal Alignment Agent

Build an AI agent that:

- Checks alignment between company, department, team, and individual objectives.
- Identifies objectives that are disconnected from company strategy.
- Detects duplicate or conflicting objectives.
- Identifies departments that are not contributing to important company objectives.
- Suggests measurable key results.
- Recommends ways to break larger objectives into smaller objectives.
- Identifies tasks that are not connected to meaningful objectives.

AI recommendations must be based on actual records and must not automatically modify important objectives without permission.

---

# 5. KPI MANAGEMENT

Build a flexible KPI management system.

Different roles must have different KPIs.

Do not assign the same KPIs to every employee.

Examples:

Engineering:
- Features delivered.
- Deployment success rate.
- Bug resolution time.
- Code quality.
- Delivery reliability.

Sales:
- Revenue generated.
- Qualified leads.
- Conversion rate.
- Sales target achievement.
- Customer retention.

Marketing:
- Qualified leads generated.
- Campaign ROI.
- Website conversion.
- Engagement.
- Customer acquisition cost.

Project Manager:
- Projects delivered.
- On-time delivery.
- Budget adherence.
- Stakeholder satisfaction.
- Project quality.

Team Lead:
- Team objective achievement.
- Team delivery reliability.
- Employee development.
- Quality of team output.
- Blocker resolution.

Department Head:
- Department objectives.
- Budget efficiency.
- Team performance.
- Department productivity.
- Strategic contribution.

CEO:
- Company revenue growth.
- Profitability.
- Strategic objective achievement.
- Customer growth and retention.
- Organizational health.
- Long-term business growth.

## KPI functionality

- Create custom KPIs.
- Assign KPIs to roles, departments, teams, and individuals.
- Define targets and thresholds.
- Define measurement frequency.
- Record actual measurements.
- Maintain measurement history.
- Calculate achievement percentages.
- Display KPI trends.
- Set warning thresholds.
- Identify declining KPIs.
- Link KPIs to objectives.
- Compare equivalent roles.
- View KPI history and supporting evidence.

Support daily, weekly, monthly, quarterly, and annual measurement periods.

Do not treat missing KPI data as zero performance.

Show missing or insufficient data separately.

---

# 6. TASK AND DAILY WORK MANAGEMENT

Build a task management system that connects everyday work to organizational goals.

The application must support the flow:

Company Objective
→ Department Objective
→ Team Objective
→ Individual Objective
→ Task
→ Actual Result
→ Evidence
→ Performance Measurement

## Task functionality

- Create tasks.
- Assign tasks to employees.
- Assign tasks to teams.
- Define start dates and deadlines.
- Set priorities.
- Define task status.
- Add descriptions.
- Add comments and updates.
- Add dependencies.
- Add attachments and evidence.
- Link tasks to objectives, key results, and KPIs.
- Record actual outcomes.
- Track estimated versus actual completion time.
- View overdue tasks.
- Track blocked tasks.
- View task history.

Task statuses should include:
- Not Started.
- In Progress.
- Blocked.
- Under Review.
- Completed.
- Cancelled.

## Daily Work Dashboard

Every employee should have a personalized daily workspace displaying:

- Today's tasks.
- Pending tasks.
- Overdue tasks.
- Upcoming deadlines.
- Important priorities.
- Linked objectives.
- KPI progress.
- Recent achievements.
- AI-generated daily priorities.

## AI Daily Planner

Build an AI assistant that:

- Reviews the employee's objectives.
- Reviews assigned tasks.
- Checks deadlines.
- Identifies high-priority work.
- Detects overdue work.
- Identifies dependencies and blockers.
- Recommends a practical daily plan.
- Explains why each task is important.
- Shows which organizational objective each task supports.

The AI should not invent tasks or deadlines.

Any newly proposed task or reassignment must be approved by an authorized user before being created.

---

# 7. PERFORMANCE MEASUREMENT AND SCORING ENGINE

Build a transparent performance measurement engine.

The system must calculate performance based on measurable outcomes.

## Illustrative performance score

Use a configurable weighted scoring model.

Example:

- OKR Achievement: 40%
- KPI Achievement: 30%
- Delivery and Reliability: 15%
- Quality and Business Impact: 15%

Example calculation:

OKR Achievement = 85
KPI Achievement = 90
Delivery and Reliability = 80
Quality and Business Impact = 90

Final Score:

(85 × 0.40) + (90 × 0.30) + (80 × 0.15) + (90 × 0.15)

Final Score = 86.5

This is an illustrative default, not a universal scoring rule.

## Important scoring rules

1. Scoring weights must be configurable by organization and role.
2. Different roles must support different scoring models.
3. The CEO must not be evaluated using daily task completion.
4. A mentor must be evaluated partly on measurable team development.
5. A manager must be evaluated on team outcomes and management responsibilities.
6. An employee must be evaluated against their assigned responsibilities and targets.
7. Task quantity alone must not determine performance.
8. Missing evidence must not automatically result in a zero score.
9. Scores must have a complete audit trail.
10. Every score must be explainable.
11. Users must be able to see which metrics contributed to their scores.
12. AI must explain scores, but deterministic backend logic must calculate them.

The system must also support configurable minimum-data requirements and mark scores as provisional or insufficiently supported when necessary.

Never make automatic hiring, firing, promotion, compensation, or other employment decisions based on AI-generated scores.

---

# 8. PEER-LEVEL COMPARISON AND ORGANIZATIONAL ACCOUNTABILITY

This is a critical differentiating feature of Zentro.

The platform must support both horizontal and vertical performance measurement.

## A. Horizontal comparison

Compare people or groups performing equivalent responsibilities.

Examples:

- Intern vs Intern.
- Employee vs Employee in equivalent roles.
- Software Engineer vs Software Engineer.
- Project Manager vs Project Manager.
- Team Lead vs Team Lead.
- Department Head vs Department Head.
- Mentor vs Mentor.
- TLC vs TLC.

Comparisons must consider role, responsibility, seniority, measurement period, and relevant context.

Do not compare unrelated roles using the same score without an appropriate normalization model.

## B. Vertical accountability

Evaluate how each organizational level contributes to the success of the next level and the organization.

Examples:

- Mentor: How much have the assigned employees improved?
- Team Lead: How effectively has the team achieved its goals?
- Manager: How effectively are projects and teams performing?
- Department Head: How much has the department contributed to company objectives?
- Senior Management: How effectively are strategic priorities being executed?
- CEO: How effectively is the company progressing toward its strategic objectives?

## C. Mentorship and TLC effectiveness

Build a dedicated mentorship measurement system.

Track:

- Employees assigned to each mentor.
- Employee development over time.
- Skill improvement.
- Goal achievement.
- Task quality.
- Delivery improvement.
- Blocker resolution.
- Feedback and mentoring activities.
- Team member progression.

Mentors and TLCs should be compared with other mentors and TLCs using relevant metrics.

Do not attribute all employee outcomes to a mentor. Consider assignment duration, workload, available evidence, and other contributing factors.

## D. Organization-wide transparency

Authorized users should be able to navigate the organization and understand:

- What each department is working on.
- What teams are achieving.
- How individual employees are progressing.
- How mentors contribute to development.
- How team leads contribute to team performance.
- How department heads contribute to department outcomes.
- How management contributes to company objectives.
- How the CEO is moving the organization forward.

Employees should have appropriate visibility into leadership objectives and progress, including CEO-level strategic goals.

However, confidential HR information, private review notes, and restricted personal information must remain protected.

The platform must support horizontal peer comparison and vertical leadership accountability without exposing confidential information.

---

# 9. LEADERSHIP AND CEO PERFORMANCE DASHBOARD

The CEO and senior management must have a dedicated dashboard.

The dashboard must show:

- Overall company performance.
- Company objectives and key results.
- Revenue and growth metrics.
- Department performance.
- Team performance.
- Organizational health.
- KPI achievement.
- Strategic risks.
- Objective completion.
- Delayed initiatives.
- Department-level contribution.
- Performance trends.
- Historical comparisons.
- AI-generated strategic insights.

The CEO must have measurable objectives, KPIs, and key results like other organizational roles, but the measurement model must be appropriate for executive responsibilities.

The CEO dashboard must allow drill-down:

Company
→ Department
→ Team
→ Individual

It must answer questions such as:

- Which departments are contributing most to company objectives?
- Which departments are falling behind?
- Which company objectives are at risk?
- What is preventing strategic progress?
- Which teams need additional resources?
- How has company performance changed over the last quarter?
- What measurable progress has the CEO and leadership team made?

---

# 10. SPECIALIZED AI AGENTS

Build an AI-powered intelligence system using a central orchestrator and specialized agents.

Do not build six disconnected chatbots.

Use a backend-controlled orchestrator that routes tasks to the appropriate agents and provides permission-controlled tools.

## Agent 1: Goal Alignment Agent

Responsibilities:

- Analyze company and department objectives.
- Check parent-child alignment.
- Identify disconnected goals.
- Identify conflicting goals.
- Suggest measurable key results.
- Recommend objective breakdowns.

## Agent 2: Performance Analysis Agent

Responsibilities:

- Analyze actual KPI measurements.
- Analyze OKR progress.
- Evaluate task outcomes.
- Review supporting evidence.
- Explain performance scores.
- Identify performance improvements and declines.
- Generate evidence-backed performance summaries.

## Agent 3: Risk Detection Agent

Responsibilities:

- Detect overdue objectives.
- Detect delayed projects.
- Identify declining KPI trends.
- Detect repeated blockers.
- Identify teams at risk of missing targets.
- Predict possible delays when sufficient historical data exists.
- Recommend corrective actions.

Predictions must include uncertainty and supporting evidence.

## Agent 4: AI Daily Planner and Employee Copilot

Responsibilities:

- Generate daily work plans.
- Prioritize tasks.
- Explain task relevance.
- Summarize completed work.
- Identify upcoming deadlines.
- Suggest ways to improve productivity.
- Help employees understand their objectives and performance.

## Agent 5: Performance Comparison Agent

Responsibilities:

- Compare equivalent employees.
- Compare mentors and TLCs.
- Compare team leads.
- Compare managers.
- Compare departments.
- Identify high-performing practices.
- Explain differences in performance.
- Identify improvement opportunities.

Comparisons must be fair and context-aware.

## Agent 6: Leadership Intelligence Agent

Responsibilities:

- Analyze company-wide performance.
- Evaluate department contributions.
- Analyze leadership accountability.
- Track strategic objectives.
- Identify organizational weaknesses.
- Generate executive summaries.
- Recommend strategic improvements.

## Agent orchestration requirements

Implement:

- A central AI orchestrator.
- Specialized agent modules.
- Structured input and output schemas.
- Tool calling.
- Permission-aware data retrieval.
- Agent execution history.
- Error handling.
- Audit logs.
- Human approval for sensitive actions.

Every AI-generated insight must include, where applicable:

- The insight.
- The reason.
- The supporting data.
- The affected objective or KPI.
- The severity.
- The recommended action.
- The confidence or uncertainty.
- The relevant time period.

AI must never fabricate organizational data or claim to have completed an action it did not execute.

---

# 11. AI INTELLIGENCE CENTER

Build a centralized AI Intelligence Center.

It should allow authorized users to ask natural-language questions.

Example questions:

- How is the company performing this month?
- Which department is falling behind?
- Which objectives are at risk?
- Compare the performance of our project managers.
- Which teams have improved the most?
- What is causing delays in Engineering?
- How has the Marketing department contributed to company growth?
- What are the biggest organizational risks?
- Which employees have improved their KPI achievement?
- What should I prioritize today?
- What is the progress of our CEO's strategic objectives?

The AI must answer using actual database records and permitted information.

The system must enforce access permissions before retrieving data, not merely hide unauthorized information after an answer is generated.

Provide references to the relevant objectives, KPIs, tasks, and records supporting the response.

---

# 12. PERFORMANCE EVIDENCE SYSTEM

Performance must be supported by actual evidence.

Build an evidence management module.

Evidence may include:

- Completed tasks.
- Project milestones.
- GitHub pull requests.
- Code deployments.
- Sales records.
- CRM updates.
- Customer feedback.
- Documents.
- Reports.
- Meeting outcomes.
- Project delivery records.
- KPI measurements.
- Manager feedback.

Evidence records should include:

- Evidence type.
- Source.
- Related user.
- Related task or objective.
- Date.
- Description.
- External reference where available.
- Verification status.
- Organization ownership.

AI should use evidence to explain performance.

Do not assume that an external event or integration record proves a business outcome without appropriate validation.

---

# 13. DASHBOARDS AND APPLICATION MODULES

Build the following major application modules.

## 1. Overview Dashboard

Display:

- Organization performance.
- Overall objective achievement.
- KPI health.
- Pending tasks.
- Delayed objectives.
- Department performance.
- Recent achievements.
- AI insights.

The dashboard must adapt to the logged-in user's role and permissions.

## 2. Organization

Display:

- Organization chart.
- Departments.
- Teams.
- Employees.
- Managers.
- Reporting relationships.
- Roles and designations.

## 3. OKRs and Goals

Display:

- Company objectives.
- Department objectives.
- Team objectives.
- Individual objectives.
- Key results.
- Progress.
- Deadlines.
- Alignment.

## 4. KPI Management

Display:

- KPI definitions.
- Targets.
- Actual measurements.
- Achievement percentages.
- Trends.
- Thresholds.
- Historical records.

## 5. My Work

Display:

- Daily tasks.
- Assigned tasks.
- Deadlines.
- Priorities.
- Blockers.
- Objective connections.
- Daily AI recommendations.

## 6. Team Performance

Display:

- Team objectives.
- Team KPIs.
- Team task progress.
- Team achievements.
- Member performance.
- Mentorship effectiveness.
- Team comparison.

## 7. Performance Intelligence

Display:

- Performance scorecards.
- Peer comparisons.
- Historical trends.
- Performance explanations.
- Evidence.
- Improvement recommendations.

## 8. AI Intelligence Center

Display:

- AI chat.
- AI-generated insights.
- Risk alerts.
- Recommendations.
- Agent execution history.
- Approval requests.

## 9. Leadership Dashboard

Display:

- Company performance.
- Strategic objectives.
- Department contribution.
- Executive KPIs.
- Company growth.
- Leadership accountability.

## 10. Integrations and Automations

Display:

- Connected applications.
- viaSocket embedded experience.
- Available automation workflows.
- Automation history.
- Trigger status.
- Integration settings.

## 11. Settings and Administration

Display:

- Organization settings.
- User management.
- Roles and permissions.
- Performance scoring configurations.
- KPI configurations.
- Notification preferences.
- Audit logs.
- AI settings.

---

# 14. viaSOCKET INTEGRATION

viaSocket must be an important part of the Zentro architecture.

It should support both embedded automation management and backend-triggered workflows.

## A. Embedded viaSocket experience

Integrate viaSocket into the application using its official embed SDK and documented authentication flow.

Use:

- ViaSocketActionEmbed component.
- useGetViaSocketEmbedToken hook, where supported by the current SDK.
- Server-generated embed token.
- The currently configured organization and project identifiers.

Before implementation, verify the latest official viaSocket embed documentation and SDK requirements.

Important security requirements:

- Generate embed tokens on the backend.
- Never expose signing secrets in frontend code.
- Associate the connected viaSocket user with the correct Zentro user and organization.
- Validate permissions before issuing tokens.
- Do not hardcode organization or project identifiers.
- Store configuration securely.

The embedded experience should allow authorized users to connect applications, manage workflows, and access automation functionality supported by the SDK.

## B. Backend-triggered automations

Zentro must generate automation events when important application events occur.

Examples:

1. A task is assigned → Notify the employee.
2. A task becomes overdue → Notify the employee and authorized manager.
3. A daily update is submitted → Generate a work summary.
4. A KPI falls below its threshold → Send an alert.
5. An objective becomes at risk → Notify the objective owner.
6. A weekly review is due → Send a reminder.
7. A performance report is generated → Distribute it to authorized recipients.
8. An employee completes a major milestone → Update relevant stakeholders.

## C. viaSocket and AI agents

Allow AI agents to use approved viaSocket-connected actions as tools.

Examples:

- Send a Slack notification.
- Send an email.
- Create a project task.
- Update an external project management record.
- Send a performance summary.
- Notify a manager about a risk.

The agent must only use actions permitted for the user and organization.

Require approval for sensitive external actions unless an authorized administrator has explicitly configured an approved automation policy.

## D. Automation reliability

Implement a transactional outbox pattern.

When an important event occurs:

1. Save the business change in PostgreSQL.
2. Save an automation event in the same transaction.
3. Process the event asynchronously.
4. Dispatch the event to viaSocket.
5. Track delivery status.
6. Prevent duplicate execution using event IDs or idempotency keys.
7. Retry failed events safely.
8. Maintain execution history.

viaSocket should act as the automation and integration layer, not the primary source of truth for Zentro data.

---

# 15. USER AUTHENTICATION AND ROLE-BASED ACCESS CONTROL

Zentro must be a multi-tenant SaaS application.

Multiple organizations must be able to register and use the platform independently.

## Authentication

Implement:

- User registration.
- Login.
- Logout.
- Password reset.
- Email verification where supported.
- Session management.
- Organization creation.
- Organization invitations.
- Secure authentication middleware.

Use Supabase Auth or another suitable managed authentication provider.

## Authorization

Implement flexible role-based and permission-based access control.

Example roles:

- Super Admin.
- Organization Owner.
- CEO.
- Senior Management.
- Department Head.
- Manager.
- Team Lead.
- Mentor/TLC.
- Employee.
- Intern.

These should be configurable organizational roles, not hardcoded assumptions.

Permissions should control actions such as:

- View organization data.
- View department data.
- View team data.
- View individual records.
- Create objectives.
- Edit objectives.
- Assign tasks.
- View performance scores.
- View evidence.
- Manage employees.
- Configure KPIs.
- View leadership reports.
- Manage integrations.
- Approve AI actions.

Support permissions based on organizational scope.

For example:

- An employee can access their own performance information and permitted team information.
- A manager can access assigned teams.
- A department head can access their department.
- The CEO can access authorized company-wide information.
- An organization administrator can manage organization settings.

Do not assume that every person with a particular job title automatically has unlimited access.

## Multi-tenant security

Every organization-owned record must be scoped to its organization.

Implement:

- Organization membership validation.
- Backend authorization middleware.
- Organization-aware database queries.
- PostgreSQL Row Level Security where appropriate.
- Secure file access.
- Audit logs.
- Cross-tenant access protection.

Never trust organization IDs provided by the frontend without validating membership and authorization.

---

# 16. DATABASE ARCHITECTURE

Use PostgreSQL as the primary database.

Use Prisma ORM.

Design the database for multiple organizations, dynamic hierarchies, historical records, and scalable performance.

The schema should include, at minimum, the following entities:

## Organization and identity

- organizations
- users
- organization_memberships
- invitations
- roles
- permissions
- role_permissions
- user_role_assignments

## Organization hierarchy

- departments
- teams
- team_memberships
- reporting_relationships
- designations

## Objectives and OKRs

- objectives
- key_results
- objective_relationships
- objective_assignments
- objective_progress_history

## KPI management

- kpis
- kpi_assignments
- kpi_measurements
- kpi_thresholds

## Task management

- tasks
- task_assignments
- task_updates
- task_comments
- task_dependencies
- task_evidence

## Performance management

- performance_scorecards
- performance_scores
- performance_score_components
- performance_periods
- performance_reviews
- performance_comparisons

## Mentorship

- mentorship_assignments
- mentorship_activities
- mentorship_progress

## AI

- agent_definitions
- agent_runs
- ai_insights
- ai_recommendations
- ai_approval_requests

## Integrations and automations

- connected_accounts
- integration_settings
- automation_events
- automation_executions
- automation_outbox

## Security and communication

- audit_logs
- notifications
- user_preferences

This list is a starting point. Refine the schema when necessary, but do not remove important business requirements.

## Database design rules

1. Use UUID primary keys where appropriate.
2. Use foreign keys and appropriate indexes.
3. Include created_at and updated_at fields.
4. Use organization_id on organization-owned records.
5. Preserve historical records.
6. Use soft deletion or archiving where appropriate.
7. Store KPI measurements over time instead of overwriting previous values.
8. Preserve historical reporting relationships.
9. Store performance score explanations and component breakdowns.
10. Use database transactions for related operations.
11. Avoid storing sensitive secrets in plain text.
12. Use appropriate JSON fields only where flexible structured data is genuinely needed.

Design the schema before implementing application modules.

---

# 17. TECHNICAL STACK

Use the following preferred stack unless a documented technical limitation requires a change.

## Frontend

- React.
- TypeScript.
- Vite.
- Tailwind CSS.
- shadcn/ui.
- React Router.
- TanStack Query for server state.
- Recharts for dashboards and visualizations.
- React Hook Form.
- Zod for validation.

## Backend

- Node.js.
- Express.js.
- TypeScript.
- Prisma ORM.
- PostgreSQL.
- Zod validation.
- Secure authentication middleware.
- Modular service architecture.

## AI

- Claude API or another configurable LLM provider.
- Tool calling.
- Structured outputs.
- Central AI orchestrator.
- Specialized agent modules.
- Permission-aware retrieval.
- Deterministic performance calculations.

Do not place API keys in frontend code.

## Automation

- viaSocket.
- Official viaSocket embed SDK.
- Backend-triggered automation events.
- Approved integration tools.

## Deployment

- GitHub for source control.
- Embarko for application hosting.
- Managed external PostgreSQL provider, such as Supabase PostgreSQL or another compatible managed PostgreSQL service.

Do not assume Embarko provides managed PostgreSQL.

Before deployment, verify the current Embarko runtime, environment variable, build, networking, and deployment requirements.

Deploy frontend and backend as separate applications if that is the most reliable supported architecture.

---

# 18. UI/UX DESIGN REQUIREMENTS

The application must look and feel like a professional modern SaaS product.

Do not create a generic admin template with random charts and placeholder cards.

Design a consistent product experience.

## Design direction

- Modern enterprise SaaS.
- Clean and minimal interface.
- Professional typography.
- Clear visual hierarchy.
- Consistent spacing.
- Carefully designed cards and tables.
- Responsive layouts.
- Accessible components.
- Consistent iconography.
- Useful empty states.
- Loading states.
- Error states.
- Confirmation dialogs for destructive operations.

Use a consistent design system with reusable components.

## Navigation

Create a left sidebar with:

- Overview
- Organization
- OKRs & Goals
- KPIs
- My Work
- Team Performance
- Performance Intelligence
- AI Intelligence
- Leadership
- Integrations
- Settings

Navigation should adapt to user permissions.

## Dashboard design

Use meaningful visualizations, such as:

- Objective progress bars.
- KPI trend charts.
- Department comparison charts.
- Performance trend lines.
- Task status distributions.
- Strategic goal progress.
- Risk indicators.
- Historical comparisons.

Every visualization must be backed by actual database data.

Do not use fabricated numbers or fake analytics in production views.

If the organization has no data, show helpful empty states and onboarding guidance.

---

# 19. BACKEND API DESIGN

Create a clean REST API organized by modules.

Suggested endpoint structure:

Authentication:
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me

Organizations:
- POST /api/organizations
- GET /api/organizations
- GET /api/organizations/:id
- PATCH /api/organizations/:id

Employees:
- GET /api/employees
- POST /api/employees
- GET /api/employees/:id
- PATCH /api/employees/:id

Hierarchy:
- GET /api/hierarchy/tree
- POST /api/hierarchy/reporting
- PATCH /api/hierarchy/reporting/:id

Departments and Teams:
- GET /api/departments
- POST /api/departments
- GET /api/teams
- POST /api/teams

Objectives:
- GET /api/objectives
- POST /api/objectives
- GET /api/objectives/:id
- PATCH /api/objectives/:id
- POST /api/objectives/:id/key-results

KPIs:
- GET /api/kpis
- POST /api/kpis
- POST /api/kpis/:id/measurements
- GET /api/kpis/:id/history

Tasks:
- GET /api/tasks
- POST /api/tasks
- GET /api/tasks/:id
- PATCH /api/tasks/:id
- POST /api/tasks/:id/updates

Performance:
- GET /api/performance/scorecards
- GET /api/performance/compare
- GET /api/performance/trends

AI:
- POST /api/ai/chat
- GET /api/ai/insights
- POST /api/ai/agents/:agentId/run
- GET /api/ai/agents/runs

Integrations:
- POST /api/integrations/viasocket/token
- GET /api/integrations
- GET /api/automations/history

These endpoints are suggestions. Create additional endpoints where needed.

Every endpoint must:

- Validate inputs.
- Authenticate the user.
- Check organization membership.
- Check relevant permissions.
- Validate ownership and scope.
- Return consistent response formats.
- Handle errors safely.
- Avoid exposing confidential information.

---

# 20. IMPORTANT BUSINESS LOGIC

Implement the following rules carefully.

1. Objectives must support parent-child relationships.
2. Tasks should be linkable to objectives and key results.
3. KPI measurements must be historically preserved.
4. Performance scores must be reproducible from stored inputs and scoring rules.
5. Different roles require different performance models.
6. Peer comparisons must compare equivalent roles and responsibilities.
7. Missing data must be distinguished from poor performance.
8. AI recommendations must be evidence-backed.
9. Historical organizational assignments must be preserved.
10. Confidential review information must be access-controlled.
11. CEO and leadership performance must be measurable.
12. Mentorship effectiveness must be measurable.
13. AI must not fabricate task progress, KPI measurements, or business results.
14. External automation actions must be permission-controlled.
15. Sensitive actions must support human approval.
16. Every important change must be auditable.
17. Organization data must remain isolated between tenants.
18. The frontend must never be the authority for performance calculations or permissions.

---

# 21. NOTIFICATION SYSTEM

Implement in-app notifications and integration-based notifications.

Notification events include:

- Task assignment.
- Task deadline approaching.
- Task overdue.
- Objective update.
- KPI threshold crossed.
- Objective at risk.
- Performance report available.
- Review cycle approaching.
- AI recommendation generated.
- Approval requested.
- Automation failure.

Allow users to manage notification preferences.

Use viaSocket for external notifications such as Slack and email when configured.

---

# 22. HISTORICAL DATA AND ANALYTICS

Zentro must measure organizational progress over time.

Store historical data for:

- Objective progress.
- KPI measurements.
- Employee performance.
- Team performance.
- Department performance.
- Leadership performance.
- Mentorship effectiveness.
- Task outcomes.
- Performance score changes.
- Organizational reporting relationships.

Provide date-range filters:

- Last 7 days.
- Last 30 days.
- This month.
- Last month.
- This quarter.
- Last quarter.
- This year.
- Custom date range.

Users should be able to compare performance across periods.

Never overwrite historical measurements when new measurements are submitted.

---

# 23. TESTING AND QUALITY ASSURANCE

Do not consider the application complete merely because the frontend renders.

Implement tests for:

## Authentication

- Registration.
- Login.
- Logout.
- Invalid credentials.
- Session expiration.

## Multi-tenancy

- Users cannot access another organization's records.
- Organization membership is validated.
- Organization-specific data is isolated.

## Authorization

- Employees cannot access restricted management data.
- Managers can access only their authorized scope.
- Department heads can access their permitted department data.
- Unauthorized actions are rejected.

## Objectives and KPIs

- Objective creation.
- Parent-child relationships.
- Key result calculations.
- KPI measurement history.
- Progress calculations.

## Tasks

- Task assignment.
- Task updates.
- Deadlines.
- Objective connections.
- Evidence submission.

## Performance

- Weighted score calculation.
- Role-specific scoring.
- Missing-data handling.
- Historical comparisons.
- Score explanations.

## AI

- Correct agent routing.
- Structured responses.
- Evidence-backed insights.
- Permission-aware data access.
- No fabricated records.
- Human approval for restricted actions.

## viaSocket

- Embed token generation.
- Organization-specific configuration.
- Event dispatch.
- Retry behavior.
- Idempotency.
- Automation history.

---

# 24. IMPLEMENTATION STRATEGY FOR CLAUDE CODE

IMPORTANT: Do not attempt to implement the entire application in one step.

Build it in controlled milestones.

First, inspect the existing repository and understand its structure.

If the repository is empty, create the project structure.

If files already exist, inspect them before changing anything. Do not overwrite existing work without understanding its purpose.

## Milestone 1: Product architecture and foundation

Deliver:

- Technical architecture.
- Project folder structure.
- Database entity relationship design.
- Prisma schema.
- Environment configuration.
- Frontend foundation.
- Backend foundation.
- PostgreSQL connection.
- Health-check endpoint.

Do not proceed until the architecture and schema are reviewed.

## Milestone 2: Authentication and organization management

Deliver:

- Authentication.
- Organization registration.
- Organization membership.
- User invitations.
- Roles and permissions.
- Departments.
- Teams.
- Dynamic reporting hierarchy.
- Organization chart.

## Milestone 3: OKR and KPI engine

Deliver:

- Objective management.
- Key results.
- Parent-child objective alignment.
- KPI creation.
- KPI assignments.
- KPI measurement history.
- Progress calculations.

## Milestone 4: Task management

Deliver:

- Task creation.
- Assignment.
- Deadlines.
- Status updates.
- Objective connections.
- Evidence submission.
- Employee daily dashboard.

## Milestone 5: Performance engine

Deliver:

- Configurable scoring.
- Role-specific scorecards.
- Performance history.
- Peer comparisons.
- Department comparisons.
- Mentorship measurement.
- Leadership accountability.

## Milestone 6: Dashboards

Deliver:

- Organization dashboard.
- Employee dashboard.
- Manager dashboard.
- Department dashboard.
- CEO dashboard.
- Performance Intelligence dashboard.
- Historical analytics.

## Milestone 7: AI Intelligence

Deliver:

- AI orchestrator.
- Goal Alignment Agent.
- Performance Analysis Agent.
- Risk Detection Agent.
- Daily Planner Agent.
- Performance Comparison Agent.
- Leadership Intelligence Agent.
- AI chat interface.
- Agent history.
- Approval system.

## Milestone 8: viaSocket integration

Deliver:

- Server-side embed token generation.
- Embedded viaSocket experience.
- Connected application management.
- Automation event system.
- Transactional outbox.
- Backend-triggered workflows.
- AI-approved integration actions.

## Milestone 9: Production readiness

Deliver:

- Security review.
- Tenant isolation tests.
- Permission tests.
- Performance optimization.
- Error handling.
- Logging.
- Database migration verification.
- Backup strategy.
- Deployment configuration.
- Documentation.

At the end of every milestone:

1. Summarize what was implemented.
2. List the files created or modified.
3. Explain important architecture decisions.
4. Run relevant tests.
5. Fix errors before proceeding.
6. Identify incomplete requirements.
7. Provide exact instructions for the next milestone.

Do not silently skip requirements.

---

# 25. REQUIRED PROJECT STRUCTURE

Use a modular structure similar to:

zentro/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── layouts/
│   │   ├── pages/
│   │   │   ├── Dashboard/
│   │   │   ├── Organization/
│   │   │   ├── OKRs/
│   │   │   ├── KPIs/
│   │   │   ├── Tasks/
│   │   │   ├── Performance/
│   │   │   ├── AIIntelligence/
│   │   │   ├── Leadership/
│   │   │   └── Integrations/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── contexts/
│   │   ├── types/
│   │   └── App.tsx
│   │
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── organizations/
│   │   │   ├── employees/
│   │   │   ├── hierarchy/
│   │   │   ├── objectives/
│   │   │   ├── kpis/
│   │   │   ├── tasks/
│   │   │   ├── performance/
│   │   │   └── integrations/
│   │   │
│   │   ├── agents/
│   │   │   ├── orchestrator.ts
│   │   │   ├── goal-alignment.agent.ts
│   │   │   ├── performance-analysis.agent.ts
│   │   │   ├── risk-detection.agent.ts
│   │   │   ├── daily-planner.agent.ts
│   │   │   ├── comparison.agent.ts
│   │   │   └── leadership.agent.ts
│   │   │
│   │   ├── middleware/
│   │   ├── services/
│   │   ├── integrations/
│   │   │   └── viasocket/
│   │   ├── jobs/
│   │   ├── utils/
│   │   └── server.ts
│   │
│   └── package.json
│
├── database/
│   ├── schema.prisma
│   └── migrations/
│
├── docs/
│   ├── architecture.md
│   ├── database-design.md
│   ├── api-documentation.md
│   ├── agent-specifications.md
│   └── deployment.md
│
├── .env.example
├── .gitignore
└── README.md

You may improve this structure if needed, but maintain modularity and separation of concerns.

---

# 26. FINAL ACCEPTANCE CRITERIA

Zentro will be considered functionally successful when the following end-to-end scenarios work.

### Scenario 1: Organization onboarding

- A CEO creates an organization.
- The CEO or administrator creates departments.
- Department heads create teams.
- Employees are invited.
- Reporting relationships are assigned.
- The organization chart displays the complete structure.

### Scenario 2: Objective alignment

- The CEO creates a company objective.
- Department heads create aligned department objectives.
- Team leads create team objectives.
- Employees receive individual objectives.
- Key results and targets are defined.
- Tasks are connected to the appropriate objectives.

### Scenario 3: Daily execution

- An employee views daily tasks.
- The employee updates task progress.
- The employee submits actual results and evidence.
- The system updates relevant objective and KPI progress.
- The manager can view the authorized updates.

### Scenario 4: Performance measurement

- The performance engine calculates scores using configured rules.
- Users can see how their scores were calculated.
- Historical performance is preserved.
- Missing evidence is handled correctly.

### Scenario 5: Peer comparison

- Project managers can be compared with equivalent project managers.
- Team leads can be compared with other team leads.
- Mentors can be compared with other mentors.
- Comparisons explain differences using relevant metrics.

### Scenario 6: Leadership accountability

- The CEO has measurable strategic objectives.
- Leadership dashboards show actual progress.
- Department contributions can be examined.
- Employees have appropriate visibility into published leadership objectives.
- Confidential records remain restricted.

### Scenario 7: AI intelligence

- The AI can answer questions using real organizational data.
- The correct specialized agent is selected.
- Insights include supporting evidence.
- Risks are detected.
- Recommendations are generated.
- Sensitive actions require approval.

### Scenario 8: viaSocket automation

- Authorized users can access the embedded viaSocket experience.
- Connected applications can be used in approved workflows.
- Application events trigger backend automations.
- Failed events can be retried.
- Duplicate events do not cause duplicate actions.

### Scenario 9: Security

- Multiple organizations can use Zentro independently.
- Users cannot access unauthorized organization data.
- Role and scope permissions are enforced on the backend.
- Important actions are audited.

---

# 27. HOW YOU MUST WORK

Follow these instructions throughout development:

1. Understand the product before coding.
2. Do not reduce Zentro to a basic task management application.
3. Do not build only static UI screens.
4. Do not use hardcoded dashboard numbers as actual business data.
5. Do not create fake AI responses and present them as real analysis.
6. Do not hardcode the organizational hierarchy.
7. Do not hardcode permissions.
8. Do not hardcode scoring models for every role.
9. Do not expose secrets in frontend code.
10. Do not allow unrestricted AI access to the database.
11. Do not skip database migrations.
12. Do not ignore error handling.
13. Do not break existing working functionality.
14. Do not introduce unnecessary dependencies.
15. Do not make large unrelated changes during bug fixes.
16. Write reusable and maintainable components.
17. Keep frontend, backend, database, and AI responsibilities separate.
18. Validate every important operation.
19. Use real database records in dashboards.
20. Test each milestone before continuing.

If a requirement is technically difficult, explain the limitation and propose a practical implementation rather than silently removing the requirement.

Always prioritize security, correctness, scalability, usability, and maintainability.

---

# 28. YOUR FIRST TASK

Do not start building the entire application immediately.

Start by producing a detailed technical blueprint for Zentro.

Your first response must contain:

1. Your understanding of the product.
2. A proposed system architecture.
3. A complete database entity relationship design.
4. A detailed Prisma schema proposal.
5. The organization hierarchy and permission model.
6. The performance scoring architecture.
7. The AI agent architecture.
8. The viaSocket integration architecture.
9. The frontend page and component structure.
10. The backend module and API structure.
11. The milestone implementation plan.
12. Major technical risks and how to address them.

Clearly identify any requirements that need a technical decision before development.

Do not start writing the full application until the technical blueprint has been reviewed and approved.

The ultimate goal is to build Zentro as a reliable, scalable, organization-wide performance intelligence SaaS platform that can support companies with 100, 200, 300, or more employees and flexible organizational structures.

Build it as a real startup product, with production-quality engineering standards.