# HCM Lite — Architecture

**Status:** 🟢 **All 12 phases are built and tested** — 16 test suites / 210 tests, plus a full browser
walk-through against a live API and a verified production same-origin build.
This document describes *what exists*. Where a rule was planned but not implemented it says so
explicitly. Read alongside `docs/PROGRESS.md`.

**Last updated:** 2026-10-30 (session 6)

---

## 1. What actually exists

```text
Development  http://localhost:5173
  └─ Vite dev server (proxy /api → :4000, so the session cookie stays first-party)
        └─ hcm-lite/web   React 18 + TS + Tailwind 3
              ├─ 14 screens behind a hand-written history router
              ├─ SessionProvider (GET /auth/me → user + permissions)
              └─ one `api` client — every screen is wired to the real API

Production  one origin
  └─ hcm-lite/api   Express 4 + TS + Mongoose 8
        ├─ 16 route modules (see §2)
        ├─ services: attendance policy, leave balances, payroll, working days, audit, notify
        ├─ static handler: web/dist + SPA fallback for anything outside /api/v1
        └─ MongoDB
              ├─ persistent: MONGODB_URI from api/.env (Atlas, or any reachable server)
              ├─ `npm run demo`: throwaway mongodb-memory-server instance, seeded on boot
              └─ serverless:  api/src/vercel-handler.ts exports the same app (see §7)
```

There is no mock data path left in the frontend: `web/src/features/announcements/*` (the old static
prototype) was deleted in session 4.

### Backend topology

| Layer | Files | Responsibility |
| --- | --- | --- |
| Entry | `src/server.ts` | Connect DB, env bootstrap, `listen`, graceful shutdown |
| Demo entry | `src/scripts/dev.ts` | In-memory MongoDB → seed → `import('../server.js')` |
| App factory | `src/app.ts` | Builds the app **without** binding a port (tests reuse it) |
| Config | `config/env.ts`, `config/db.ts` | Zod-validated env (fail-fast, loads `.env` via `process.loadEnvFile`), Mongoose lifecycle |
| Lib | `lib/logger.ts`, `http-error.ts`, `response.ts`, `async-handler.ts`, `fixed-window-limiter.ts`, `dates.ts`, `working-days.ts`, `pagination.ts`, `crud-router.ts`, `csv.ts`, `pdf.ts`, `audit.ts`, `notify.ts` | Cross-cutting helpers |
| Middleware | `middleware/auth.ts`, `error-handler.ts`, `validate.ts`, `login-rate-limit.ts` | Session, authorization, validation, throttling |
| Modules | `modules/{health,setup,auth,users,organization,employees,attendance,leave,payroll,analytics,announcements,notifications,audit,ai,settings}` | Route + service + model per domain |
| Scripts | `scripts/seed.ts`, `scripts/dev.ts` | Deterministic demo data; one-command demo server |

### Frontend topology

| Layer | Files | Responsibility |
| --- | --- | --- |
| Entry | `src/main.tsx` | Mounts `<App/>` |
| Shell | `src/App.tsx` | Route table + guard chain (setup → login → forced password change → app) |
| Chrome | `components/Layout.tsx`, `Sidebar.tsx`, `Header.tsx`, `nav.ts` | Shell, permission-filtered navigation |
| UI kit | `components/ui.tsx`, `components/icons.tsx` | Button, Field, Input, Select, Checkbox, Banner, EmptyState, Loading, Badge, `statusTone`, Table, Modal, Tabs, Stat, Panel, Avatar, BarRow; ~40 inline SVG icons |
| Screens | `src/screens/*.tsx` | 14 screens, each owning its own data fetching |
| Plumbing | `lib/router.tsx`, `lib/session.tsx`, `lib/api.ts`, `lib/hooks.ts`, `lib/format.ts`, `lib/types.ts` | History router, session context, fetch client, `useAsync`/`useAction`, formatters, wire types |
| Tokens | `tailwind.config.js`, `styles/globals.css` | Colour, radius, shadow, sizing tokens |

### Middleware order

```text
request
  → helmet                        (security headers)
  → cors                          (credentials: true, allow-list from CORS_ORIGINS)
  → express.json / urlencoded     (100kb limit)
  → cookieParser
  → /api/v1/<module> route
        → validate({ body | query | params })     (Zod → 400 VALIDATION_ERROR)
        → requireAuth                             (cookie → JWT → DB row)
        → requirePasswordChanged                  (403 PASSWORD_CHANGE_REQUIRED)
        → requirePermission('<permission>')       (403 FORBIDDEN)
        → asyncHandler(handler)
  → notFoundHandler               (404 NOT_FOUND)
  → errorHandler                  (HttpError | ZodError | Mongo 11000 | 500)
```

`requireAuth` re-reads the user row on every request: the database, not the token, decides whether a
session is still valid.

---

## 2. Endpoints that exist

All paths are relative to `/api/v1`. "session" means any signed-in user; every other row names the
permission it requires.

| Module | Endpoint | Access | Behaviour |
| --- | --- | --- | --- |
| health | `GET /health` | public | `{ database: { ready, state } }`, never throws |
| health | `GET /health/ready` | public | Readiness probe |
| setup | `GET /setup/status` | public | `{ setupRequired }` |
| setup | `POST /setup` | public, one-time | Creates company + first admin, sets the cookie; `409` if already set up |
| auth | `POST /auth/login` | public | Throttled 10 / 15 min per `ip:email`; sets cookie |
| auth | `POST /auth/logout` | public | Clears the cookie, idempotent |
| auth | `GET /auth/me` | session | Identity + effective permission list |
| auth | `POST /auth/change-password` | session | Verifies current password and strength, bumps `tokenVersion`, re-issues the cookie |
| users | `GET /users` | `user.read` | Account list with `meta.total` |
| users | `POST /users` | `user.create` | Creates an account with a temporary password (`mustChangePassword`) |
| users | `PATCH /users/:id/status` | `user.manage` | Activate/deactivate; deactivation kills live sessions |
| users | `POST /users/:id/reset-password` | `user.manage` | Returns a one-time password |
| departments / designations / leave-types / holidays | `GET / POST / PATCH /:id / DELETE /:id` | `organization.read` / `organization.manage` | Shared CRUD router; delete is refused while referenced |
| employees | `GET /employees` | `employee.read` | Directory: `q`, department, status, pagination |
| employees | `GET /employees/:id` | `employee.read` | Employee 360 payload |
| employees | `POST /employees` | `employee.create` | Creates the record, optionally linked to a login |
| employees | `PATCH /employees/:id` | `employee.update` | Edit personal and job fields |
| employees | `PATCH /employees/:id/status` | `employee.update` | Change employment status |
| employees | `POST /employees/:id/archive` | `employee.archive` | Archive / offboard |
| employees | `POST /employees/import` | `employee.create` | CSV import with a dry-run mode |
| employees | `GET /employees/export` | `report.export` | CSV export of the filtered directory |
| attendance | `POST /attendance/check-in` | `attendance.read` | Self-service; lateness from the company policy |
| attendance | `POST /attendance/check-out` | `attendance.read` | Sets check-out and minutes worked |
| attendance | `GET /attendance/today` | `attendance.read` | The caller's own state for today |
| attendance | `GET /attendance/me` | `attendance.read` | Own ledger over a date range |
| attendance | `GET /attendance/board` | staff | Daily board: per-employee status for one date |
| attendance | `GET /attendance` | staff | Ledger with filters + pagination |
| attendance | `GET /attendance/summary` | staff | Aggregates for a range |
| attendance | `POST /attendance/mark` | `attendance.manage` | Manual marking (`source: 'manual'`) |
| attendance | `POST /attendance/corrections` | `attendance.read` | Employee files a correction |
| attendance | `GET /attendance/corrections` | staff | Correction queue |
| attendance | `PATCH /attendance/corrections/:id` | `attendance.manage` | Approve/reject; approval rewrites the record |
| leave | `POST /leave/requests` | `leave.apply` | Validates against the derived balance |
| leave | `GET /leave/requests` | `leave.read.own` / `leave.approve` | Own requests, or the approval queue |
| leave | `GET /leave/requests/:id` | owner or approver | Single request |
| leave | `PATCH /leave/requests/:id/cancel` | owner | Cancels a pending/approved request |
| leave | `PATCH /leave/requests/:id/decision` | `leave.approve` | Approve/reject (never own request) |
| leave | `GET /leave/balances` | `leave.read.own` | Entitlement − approved − pending, per type |
| leave | `GET /leave/calendar` | staff | Requests overlapping a month |
| payroll | `GET /payroll/structures` | `payroll.read.company` | All structures |
| payroll | `GET /payroll/structures/:employeeId` | company or owner | One structure |
| payroll | `PUT /payroll/structures/:employeeId` | `payroll.process` | Create/replace base, allowances, deductions, tax percent |
| payroll | `DELETE /payroll/structures/:employeeId` | `payroll.process` | Remove a structure |
| payroll | `POST /payroll/runs` | `payroll.process` | Create the draft run for a period |
| payroll | `GET /payroll/runs` | `payroll.read.company` | Run history |
| payroll | `GET /payroll/runs/:id` | `payroll.read.company` | Run with its lines |
| payroll | `POST /payroll/runs/:id/recompute` | `payroll.process` | Rebuild lines from today's data (draft only) |
| payroll | `POST /payroll/runs/:id/finalize` | `payroll.approve` | Admin-only; freezes the run |
| payroll | `GET /payroll/payslips` | `payroll.read.own` | Own payslips across runs |
| payroll | `GET /payroll/payslips/:runId` | company or owner | Payslip detail |
| payroll | `GET /payroll/payslips/:runId/pdf` | company or owner | Own payslip as PDF |
| payroll | `GET /payroll/runs/:id/payslips/:employeeId/pdf` | `payroll.read.company` | Any payslip as PDF |
| analytics | `GET /analytics/overview` | `analytics.read` | Workforce, attendance, pending approvals |
| analytics | `GET /analytics/headcount` | `analytics.read` | By department, type, tenure |
| analytics | `GET /analytics/attendance-trend` | `analytics.read` | Daily present/late/absent series |
| analytics | `GET /analytics/leave-usage` | `analytics.read` | By status, by type, top absentees |
| analytics | `GET /analytics/payroll-cost` | `analytics.read` | Per-run gross/deductions/net |
| analytics | `GET /analytics/dashboard` | `analytics.read` | One payload for the manager dashboard |
| announcements | `GET /announcements` | `announcement.read` | Audience-filtered feed with unread meta |
| announcements | `GET /announcements/:id` | `announcement.read` | Single item |
| announcements | `POST /announcements` | `announcement.publish` | Publish now or save a draft |
| announcements | `PATCH /announcements/:id` | `announcement.manage` | Edit, publish a draft, archive |
| announcements | `DELETE /announcements/:id` | `announcement.manage` | Delete |
| announcements | `POST /announcements/:id/read` | `announcement.read` | Records a read receipt |
| announcements | `GET /announcements/:id/readers` | `announcement.manage` | Who has read it |
| notifications | `GET /notifications` | session | Own notifications |
| notifications | `GET /notifications/unread-count` | session | Badge count for the header |
| notifications | `POST /notifications/:id/read` | session | Mark one read |
| notifications | `POST /notifications/read-all` | session | Mark all read |
| notifications | `DELETE /notifications/:id` | session | Dismiss |
| audit-log | `GET /audit-log` | `audit.read` | Filtered, paginated log |
| audit-log | `GET /audit-log/facets` | `audit.read` | Distinct actions/entities/actors for the filters |
| assistant | `POST /assistant/chat` | `ai.query` | Intent → tool → answer, with the facts used |
| assistant | `GET /assistant/suggestions` | `ai.query` | Role-appropriate starter questions |
| settings | `GET /settings/public` | session | `{ name, timezone, currency }` for the shell |
| settings | `GET /settings` | `settings.manage` | Full payload incl. roster counts |
| settings | `PATCH /settings/company` | `settings.manage` | Profile, timezone, currency (validated, normalised) |
| settings | `PATCH /settings/attendance` | `settings.manage` | Work start `HH:MM` → minutes, grace, thresholds |

### Session mechanics

- Cookie `hcm_session`: `HttpOnly`, `SameSite=Lax`, `Secure` only in production, 15-minute expiry.
- Payload: `{ sub, role, cv }` where `cv` is the user row's `tokenVersion`.
- Revocation: a password change or an admin reset increments `tokenVersion`, so every other session
  fails the `cv` comparison on its next request while the acting session receives a fresh cookie.
- Login verifies the **password before the account status**, so a deactivated account is
  indistinguishable from a wrong password until the credentials are proven correct.

### Error codes

| Code | Status | Source |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Zod (body/query/params), `details: [{ field, message }]` |
| `UNAUTHENTICATED` | 401 | missing/invalid cookie, revoked session, bad credentials |
| `ACCOUNT_INACTIVE` | 403 | deactivated user |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `mustChangePassword` still true |
| `FORBIDDEN` | 403 | permission or ownership check failed |
| `NOT_FOUND` | 404 | unmatched route or unknown id |
| `CONFLICT` | 409 | setup already complete; duplicate unique value; row still referenced |
| `UNPROCESSABLE` | 422 | weak/reused password, business rule violation (e.g. insufficient balance) |
| `RATE_LIMITED` | 429 | login throttling (sends `Retry-After`) |
| `INTERNAL_ERROR` | 500 | unexpected — logged server-side, never a stack trace in the body |

---

## 3. Data model

16 Mongoose models. Calendar days (attendance, holidays, leave dates) are stored as **UTC midnight of
the calendar day**, never as a local timestamp.

| Collection | Purpose | Notable constraints |
| --- | --- | --- |
| `companies` | The single tenant | `key` unique + immutable, always `'primary'` — this is what makes one-time setup safe under concurrency |
| `users` | Logins | `email` unique and lower-cased; `passwordHash` is `select: false` and never serialised; `tokenVersion` drives revocation |
| `employees` | People records | `employeeCode` unique; optional `userId` link to a login; department/designation refs |
| `departments`, `designations`, `leave_types`, `holidays` | Master data | Unique name/code; holidays carry a date plus an optional recurring flag |
| `attendance` | One row per employee per day | Unique `(employeeId, date)`; status `present/late/absent/remote/leave/holiday`; `source` is `self`, `manual` or `correction` |
| `attendance_corrections` | Requested changes | `pending/approved/rejected`, with the requested times and the HR decision |
| `leave_requests` | Leave ledger | Half-day support; `pending/approved/rejected/cancelled`; balances are **derived from this table**, never stored |
| `salary_structures` | Per-employee pay | Unique `employeeId`; base, allowances, fixed deductions, `taxPercent` |
| `payroll_runs` | One period | Unique `(year, month)`; `draft`/`finalized`; totals snapshot so history never drifts |
| `payroll_lines` | Per-employee result | Base, allowances, tax, unpaid deduction, net, absent days, working days |
| `announcements` | Noticeboard | Audience (`all`/department/role), `published/draft/archived`, pinned, embedded read receipts |
| `notifications` | In-app inbox | Per-user, typed, with a link target and read flag |
| `audit_logs` | Append-only trail | Actor, action, entity, entity id, meta, timestamp |

Every model exposes a `toPublic*()` mapper; documents never leave the process raw (no hash, no
`tokenVersion`, no internal refs).

---

## 4. Business rules (one implementation each)

| Rule | Where | What it says |
| --- | --- | --- |
| Working days | `lib/working-days.ts` | Days in range minus weekends and holidays; used by leave, payroll and analytics |
| Lateness | `modules/attendance` | `zonedMinutesOfDay(now, tz) − (workStartMinutes + graceMinutes)`, both read from settings at request time |
| Daily board | `modules/attendance` | A recorded row wins; unmarked on a weekend/holiday is `holiday`; unmarked on a past working day is `absent`; unmarked **today or later** is `not-marked`, a view-only status |
| Leave balances | `modules/leave` | `entitlement − approved − pending`, computed per type from the request ledger |
| Payroll amounts | `modules/payroll/payroll.service.ts` | `gross = base + allowances`; `tax = round(gross × taxPercent / 100)`; `unpaid = round(gross / workingDays × absentDays)`; `net = gross − (tax + unpaid + fixed deductions)` |
| Finalization | `modules/payroll` | Admin-only; a finalized run is immutable and keeps its totals |
| CSV | `lib/csv.ts` | Import supports a dry run that reports what *would* change |
| PDF | `lib/pdf.ts` | Minimal dependency-free writer — payslips need no headless browser |

**Money:** payroll amounts are integers in the company currency (PKR by default), rounded at each step
of the formula above rather than stored as minor units.

---

## 5. Authorization

Authorization is **permission-based**, never a scattered `if (role === 'admin')`.

- 26 permissions in one catalogue (`modules/auth/permissions.ts`).
- `admin` holds all 26; `hr` holds 17 operational ones; `employee` holds 7 self-service ones.
- Deliberate restrictions: HR cannot read the user list, read the audit log, manage settings, or
  finalize payroll; employees reach only their own records.
- Unknown roles resolve to an empty permission list, so access is **denied by default**.
- Enforcement point: `requirePermission(permission)` per request, plus ownership checks inside the
  services (an employee's `employeeId` is resolved from the session, never from the request body).
- The frontend mirrors the same rules to hide what would be refused anyway (`can()`, `visibleNavItems`).

---

## 6. The assistant

```text
POST /assistant/chat { message }
  → identity from the session (never the body)
  → intent detected deterministically (headcount, attendance, leave, payroll, employee lookup,
    policy question, small talk)
  → the matching tool reads the live database with the caller's scope
      ├─ employee asking a company-wide question → polite 200 refusal, no data
      └─ employee asking about themselves → their own records only
  → answer composed from the tool's facts, plus the facts themselves in `tools[]`
  → optional: if AI_PROVIDER=openai, the same answer is rephrased by a chat model
     (the model never sees the database and never produces numbers)
```

`GET /assistant/suggestions` returns role-appropriate starter questions. The default `rules` provider
needs no API key, so the demo works offline and cannot hallucinate a figure.

---

## 7. The seed and the demo server

`api/src/scripts/seed.ts` builds the demo dataset with a deterministic PRNG (mulberry32), so the same
figures appear on every run:

- 1 company, 5 departments, 8 designations, 4 leave types, 6 holidays
- 13 employees (12 active/probation + 1 resigned), 5 logins
- about 44 days of attendance (384 rows) — **today is deliberately excluded** so a live check-in can be demoed
- 7 leave requests, 1 pending correction, 12 salary structures
- 3 payroll runs built by the real `createDraftRun` + `buildRunLines` service (2 finalized, 1 draft)
- 4 announcements, notifications, audit entries

`runSeed({ reset })` refuses to touch a database that already holds a company. `api/tests/seed.test.ts`
runs the seed against an in-memory MongoDB and reads the result back through the HTTP API.

`api/src/scripts/dev.ts` (`npm run dev:mem`) starts a `mongodb-memory-server` instance, sets
`MONGODB_URI` before `config/env.ts` is imported, seeds with `reset: true`, then imports `server.ts`.
Root `scripts/demo.mjs` (`npm run demo`) runs that plus Vite, prefixes the output, and stops both on Ctrl+C.

### Two ways to point the API at a database

| Path | Where `MONGODB_URI` comes from | Lifecycle |
| --- | --- | --- |
| `npm run demo` | `dev.ts` sets it to an in-memory server | Seeded with `reset: true`, destroyed on exit; no `.env` needed |
| `npm run demo -- --atlas`, `npm run dev:api` | `api/.env`, loaded by `config/env.ts` via `process.loadEnvFile` | Persistent; seed once by hand |

`config/env.ts` validates and freezes the environment at import time, which is why nothing that
transitively imports it (the logger included) may run before `MONGODB_URI` exists. `loadEnvFile`
**does not overwrite** a variable that is already set — the property both the in-memory demo and the
test suite rely on to stay off any real database.

The Atlas instance lives in a dedicated `hcm_lite` database, so no other database in that cluster is
read or written. Its URI is stored in the **non-SRV multi-seed** form (`mongodb://host1:27017,host2:27017,host3:27017/...?tls=true&authSource=admin`)
because Node's c-ares resolver fails the `_mongodb._tcp` SRV lookup this SRV bootstrap needs on this
machine, while the operating system resolver succeeds. Nothing in the API opens a transaction, so
Atlas tier restrictions on multi-document transactions do not apply.

### Deployment shapes

There is exactly one application — `createApp()` — and three entry points that differ only in how the
process is started:

| Entry point | Used by | What it adds |
| --- | --- | --- |
| `src/server.ts` | `npm run dev`, `npm run start` | Connects, bootstraps an admin from env if the DB is empty, `listen`, SIGINT/SIGTERM shutdown |
| `src/scripts/dev.ts` | `npm run demo` | In-memory MongoDB, `reset: true` seed, then imports `server.ts` |
| `src/vercel-handler.ts` | `vercel.json` → `@vercel/node` | Exports the app as a request handler; memoises the connection and the app per warm container, because a function is reused across invocations but torn down without a signal |

`middleware/static-web.ts` is what makes a single host possible: the frontend calls the relative path
`/api/v1`, so UI and API must share an origin. In development Vite's proxy provides that; in
production `createApp()` mounts `express.static(web/dist)` **after** the API routers and **before**
the 404 handler, then a `GET *` fallback returns `index.html` for anything that is not under
`/api/v1`. Assets are cached `max-age=31536000, immutable` (Vite fingerprints them) while the shell is
`no-cache`, so a deploy cannot be masked by a stale bundle list. `WEB_ROOT` overrides the search when
the layout is unusual.

`helmet()` runs with its default CSP. Verified against the built app in a browser: nothing is
blocked, because the bundle is same-origin, there are no inline scripts, and Google Fonts falls under
`style-src`/`font-src https:`. `upgrade-insecure-requests` is removed outside production so a local
`http://` build is not rewritten to a scheme it cannot reach.

---

## 8. Testing

| Concern | Decision |
| --- | --- |
| Framework | Vitest + Supertest — `createApp()` returns the app, so no port is bound |
| Database | `mongodb-memory-server`; unique indexes are created with `Model.init()` before assertions |
| Determinism | `fileParallelism: false`, sequential tests, `clearTestDb()` + `resetLoginRateLimit()` + `invalidateCompanySettings()` in `beforeEach` |
| Isolation from `.env` | `tests/setup-env.ts` sets `MONGODB_URI` and `JWT_SECRET` before any import, so a populated `api/.env` cannot redirect the suite at a live cluster — verified by fingerprinting Atlas before and after a full run |
| Static serving | `createApp(webRoot)` takes the root as a parameter, so the middleware is testable even though the default under `NODE_ENV=test` is deliberately off |
| Speed | `BCRYPT_ROUNDS=4` in tests (12 in production); the suite runs in 60–110 s |
| Scope | 16 files / 210 tests: setup, auth, RBAC, users, organization, employees, attendance, leave, payroll, analytics, announcements, settings, assistant, units, seed, static-web |
| Frontend | `tsc --noEmit` and `vite build` only. No unit or E2E runner is installed |

---

## 9. Design system

Tokens live in `tailwind.config.js` and are the single source of truth for all screens.

| Token | Value | Use |
| --- | --- | --- |
| `primary` | `#078b51` | Primary buttons, active nav, links |
| `primary.dark` | `#087548` | Hover, active text |
| `primary.light` | `#e7f7ee` | Mint surfaces, active nav pill, published badge |
| `ink` | `#172d27` | Headings, primary text |
| `ink.secondary` | `#71817a` | Secondary/muted text |
| `line` | `#dce9e1` | Borders, dividers |
| `app` | `#f8fbf9` | Page background |
| `surface.muted` | `#f2f7f4` | Table headers, inert chips |
| `success` / `warning` / `danger` / `info` | `#15965a` / `#e6a23c` / `#dc5555` / `#4388d6` | Status semantics |
| radius | `card 10px`, `ctrl 7px` | Cards vs controls |
| sidebar / header | `220px` / `58px` | Shell metrics |
| font | Inter 400–800 | All text |

**Semantic colour rules:** green = primary action, present, approved, finalized; blue = info, holiday;
orange = late, pending, draft, probation; red = absent, rejected, destructive only; grey = not marked,
draft, inert.

---

## 10. Important decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | KPI numbers derive from data, never from literals | No fabricated metrics; every figure is an aggregation |
| D2 | Session is a JWT in an HttpOnly cookie, not localStorage | XSS cannot read the token; `SameSite=Lax` covers CSRF for top-level navigation |
| D3 | `tokenVersion` in the JWT instead of a session table | Instant revocation with no extra store |
| D4 | `requireAuth` re-reads the user row on every request | A disabled account or bumped token version takes effect immediately |
| D5 | Password strength enforced in the service, not only in Zod | The same rule guards setup, change-password and admin provisioning |
| D6 | Login verifies password **before** account status | Prevents account enumeration |
| D7 | Rate-limit key is `ip:email`, not `ip` | 10 attempts per 15 min per account; one user cannot lock out a shared office IP |
| D8 | Custom `FixedWindowLimiter` with an injected clock | Deterministic and unit-testable; no middleware internals |
| D9 | One-time setup guarded by a unique `key: 'primary'` row | Two concurrent setups cannot both succeed; no transaction needed |
| D10 | Compensating delete instead of a MongoDB transaction for setup | Works on standalone MongoDB (no replica set for the demo) |
| D11 | Tests run against `mongodb-memory-server` | Real Mongoose behaviour (unique indexes, validation) with nothing installed |
| D12 | `tsconfig.json` has no `rootDir`; `tsconfig.build.json` does | Tests typecheck without being emitted into `dist/` |
| D13 | Responses always `{ success, data, meta? }` / `{ success, error }` | One parsing path in the frontend; `meta` carries pagination |
| D14 | Zero frontend dependencies beyond React | Hand-written router, fetch client, hooks and icon set — smaller surface, no upgrade churn |
| D15 | Vite proxies `/api` in development | One origin, so the HttpOnly cookie stays first-party and CORS is not in the demo path |
| D16 | Balances derived from the request ledger | No materialised balance that can drift out of sync |
| D17 | Payroll computed by a pure function, finalized by the admin | Recomputable while a draft; immutable once final |
| D18 | Dependency-free PDF writer | Payslips need no headless browser or native binary |
| D19 | Attendance policy lives in company settings and is read per request | Changing the work start time changes lateness immediately, with no redeploy |
| D20 | `not-marked` is a board-only status | A day in progress must not accuse anyone of absence; the stored statuses stay honest |
| D21 | The assistant's default mode needs no API key | The demo runs offline, and an LLM only rephrases facts it was given |
| D22 | The demo database is in-memory by default | `npm run demo` works with no MongoDB installed and leaves nothing behind; `-- --atlas` opts into persistence |
| D23 | Seed data is deterministic | Screenshots and walkthroughs reproduce exactly |
| D24 | Persistent connections use a non-SRV multi-seed URI | Node's SRV bootstrap fails on this machine while the OS resolver succeeds; the driver discovers the replica set from the seed list anyway |
| D25 | A named database is pinned in the URI (`/hcm_lite`) | A trailing `/` would silently fall back to the driver's `test` database and mix demo data with someone else's |
| D26 | The API serves the built frontend in production | The client calls a relative `/api/v1`; one origin keeps the HttpOnly cookie first-party and needs no second host or CORS rules |
| D27 | `web/dist` is located by search, not hard-coded | The same build must work from `api/`, from the repo root, and from a serverless working directory; `WEB_ROOT` wins when the guess is wrong |
| D28 | One `createApp()`, several entry points | Serverless, long-running and in-memory demo differ only in process lifecycle, so no behaviour is duplicated — and therefore cannot drift |
| D29 | Helmet's default CSP is kept, not loosened | Verified to block nothing in this app; a permissive CSP chosen to make a demo work is the one thing that would have to be reversed later |

---

## 11. Known architectural debt

1. **No automated UI tests.** `web/` is gated by `tsc` and `vite build` only; regressions in rendering
   or interaction are caught by hand.
2. ~~**`docs/` sits outside the git repository**~~ — resolved in session 6: the documents live in
   `hcm-lite/docs/` and are versioned with the code. History is deliberately short: the first commit
   is the session 6 tree, because `api/.env` (Atlas credentials) could never be included in a
   published repository and a `.gitignore` entry does not remove a file from history.
3. **Screens own their data fetching.** Fine for 14 screens; a shared cache layer would remove
   duplicate requests (for example settings fetched per screen).
4. **Two database paths must be kept in step.** The in-memory demo seeds itself on boot, while the
   persistent mode needs a manual `npm run seed`; forgetting it leaves a running API with no data.
5. **Payroll tax is a single flat percentage** per structure — a demo rule, not a jurisdiction-aware
   calculator.
6. **The `openai` assistant provider is untested against a real endpoint.**
7. **Routes and services share a file** in the smaller modules (analytics, audit, notifications); the
   larger ones (payroll, leave, attendance) are already split.
8. 🔴 **The Atlas password was disclosed in plain text** and is live in `api/.env`. It must be
   rotated before this configuration is used for anything real. `api/.env` is git-ignored, so the
   exposure is the conversation and the file on disk, not the repository.
9. **The serverless path is unbuilt, not just untested.** `vercel-handler.ts` compiles and the local
   production build is proven, but no function has ever run on Vercel: cold-start latency against a
   WAN-round-trip Atlas cluster, the `routes` prefix behaviour, and the request-size limits on payslip
   PDFs are all still assumptions.
10. **Every cold start pays for a remote database.** In-memory development hides this; a deployed
    function opens a new connection pool per container, which is worth revisiting (or moving to a
    connection proxy) if the demo is ever exposed to real traffic.
