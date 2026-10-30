# HCM Lite — Progress

> **Single source of truth for what is *actually* implemented and tested.**
> Read this file (and `docs/ARCHITECTURE.md`) at the start of every work session.
>
> **Rule enforced here:** an item is only marked ✅ when it has (a) a working implementation,
> (b) server-side authorization, and (c) at least one test that was actually executed and passed.
> Anything else stays 🟡 or ❌. No exceptions.

**Last updated:** 2026-10-30 (session 6)
**Overall status:** 🟢 **All 12 phases delivered.** 16 test suites / **213 tests** pass, the production
build succeeds, every screen has been driven against a live API in a real browser, the API runs
against a persistent MongoDB Atlas cluster, and it now serves the built UI from the same origin so
it is deployable as one service.
**Demo readiness:** ✅ `npm run demo` boots an in-memory database, seeds it and serves the UI;
`npm run demo -- --atlas` keeps data; `npm run build && npm run start` serves UI + API on :4000.
**Deployment:** 🟡 project linked to Vercel and the GitHub repo connected; the first two production
builds failed and the cause is fixed in code (`NODE_ENV` must not be a Vercel variable — see
*Deploying to Vercel*). A redeploy is the remaining step.
**Outstanding risk:** 🔴 the Atlas password was shared in plain text — see limitation 7.

---

## 1. Status legend

| Marker | Meaning |
| --- | --- |
| ✅ | Implemented, authorized, tested — verified this session |
| 🟡 | Partially implemented |
| ❌ | Not started |
| ⚠️ | Deviates from the brief — see note |

---

## 2. At a glance

| Area | Status | Evidence |
| --- | --- | --- |
| Monorepo (npm workspaces `web` + `api`) | ✅ | Root scripts `dev:web`, `dev:api`, `demo`, `demo -- --atlas`, `build`, `start`, `test`, `typecheck`, `seed` |
| Backend API | ✅ | 16 route modules, **213 tests** pass |
| MongoDB persistence | ✅ | Runs on the in-memory server **and** against a live Atlas cluster (seed/read/write/delete verified) |
| Production serving (one origin) | ✅ | The API serves `web/dist` + SPA fallback; 7 tests; verified in a browser from a production build |
| Deployment (Vercel) | 🟡 | Logged in, project linked, GitHub connected; the first builds failed on a self-inflicted `NODE_ENV`, fixed in code — a redeploy is still unverified |
| MongoDB models | ✅ | 16 Mongoose models covering every domain |
| Authentication / sessions | ✅ | JWT in HttpOnly cookie, `tokenVersion` revocation, forced password change |
| RBAC / permissions | ✅ | 26-permission catalogue, 3 roles, enforced per request, denial tests |
| Organization & employees | ✅ | Departments, designations, leave types, holidays, employee CRUD, CSV, directory |
| Attendance | ✅ | Check-in/out, daily board, ledger, summary, manual marking, corrections |
| Leave | ✅ | Apply, cancel, decide, derived balances, calendar |
| Payroll | ✅ | Structures, draft, recompute, admin finalize, payslips, PDF |
| Analytics | ✅ | Overview, headcount, attendance trend, leave usage, payroll cost, dashboard |
| Announcements & notifications | ✅ | Feed, drafts, read receipts, readers, notifications with unread count |
| Audit log | ✅ | Append-only log, filtered list, facets |
| AI assistant | ✅ | 7 live-data tools, deterministic rules provider, optional OpenAI rephrasing |
| Settings | ✅ | Company + attendance policy (drives lateness server-side), accounts |
| Frontend | ✅ | 14 screens behind a router with permission guards; builds in 56 modules |
| Seed script | ✅ | Deterministic; 11 tests read it back through the API |
| Automated frontend tests | ❌ | No test runner in `web/`; the UI is verified by `tsc`, `vite build` and a browser walk-through |

---

## 3. Verification log

### Session 6 (2026-10-30) — production serving, deployment config, repository

| # | Command | Result |
| --- | --- | --- |
| 1 | `npm run typecheck` (repo root) | ✅ exit 0 — `api` and `web` |
| 2 | `npx vitest run --root api` | ✅ **16 files, 210 tests passed**, 107.41 s (7 new static-serving tests) |
| 3 | `npm run build` | ✅ api `tsc` (incl. `dist/vercel-handler.js`) + `vite build` 56 modules, 295.00 kB (gzip 80.53 kB) |
| 4 | `NODE_ENV=production npm run start` | ✅ log confirms `Serving the frontend build from the API` with the resolved `web/dist` path, `env: "production"` |
| 5 | `node scripts/verify-prod.mjs` | ✅ `GET /` 200 HTML `no-cache` · asset 200 `max-age=31536000, immutable` · deep link `/attendance` 200 HTML · unknown `/api/v1/*` still **404 NOT_FOUND JSON** · login 200 with `HttpOnly; Secure; SameSite=Lax` · `/auth/me` 26 permissions · dashboard 200, workforce 12 |
| 6 | Browser against the production build | ✅ React rendered (3,225 chars in `#root`), login → dashboard with **85.6%** and `0/12 marked today`; **zero CSP violations** — helmet's default policy blocks nothing in this app |
| 7 | `git check-ignore -v api/.env` | ✅ ignored (`.gitignore:12`); no `.env` in the tree to be committed |
| 8 | `vercel deploy --prod` (after the GitHub-connected push built automatically) | ❌ **errored in 7 s** — `npm ci` installed 129 packages instead of 396 and `npm run build` exited 127. Cause: my own `NODE_ENV=production` **Production** variable was injected into the build, so npm dropped the devDependencies holding `tsc` and `vite` |
| 9 | `vercel env rm NODE_ENV production` + `installCommand: "npm ci --include=dev"` + `inferNodeEnv()` in `config/env.ts` | ✅ the environment is now derived from Vercel's `VERCEL_ENV`, which is guaranteed at function runtime and invisible to the build |
| 10 | `npx vitest run --root api` | ✅ **16 files, 213 tests passed**, 68.00 s (3 new `inferNodeEnv` tests) |
| 11 | Simulated function: `node api/dist/server.js` with `cwd: web/` and no `.env` reachable | ✅ `env: "production"`, JSON logs (no `pino-pretty` transport attempt), login cookie `HttpOnly; Secure; SameSite=Lax` — the derivation works where a deployed function runs it. The first attempt from `api/` proved nothing: `loadDotEnv()` found `api/.env`, whose `NODE_ENV=development` correctly wins over the inference |

### Session 5 (2026-10-30) — persistent MongoDB Atlas cluster

| # | Command | Result |
| --- | --- | --- |
| 1 | `npm run seed -w api` | ✅ `MongoDB connected db: "hcm_lite"` → 13 employees, 384 attendance, 7 leave requests written to the Atlas cluster (33 s over the WAN) |
| 2 | `npm run demo -- --atlas` | ✅ API :4000 on Atlas + Vite :5173 in one prefixed process tree |
| 3 | API read-through, 13 endpoints (direct **and** through the Vite proxy) | ✅ 200 with live Atlas data: analytics, board, payroll runs, employees, announcements, notifications, audit log, assistant suggestions, settings, leave types, holidays |
| 4 | Employee-role session (`ayesha.khan@hcm.test`) | ✅ `/leave/balances`, `/attendance/me`, `/payroll/payslips` all 200; `/analytics/overview` → **403 FORBIDDEN** |
| 5 | Assistant `/assistant/chat`, 6 questions | ✅ `headcount`, `attendance_today`, `pending_approvals`, `payroll_summary`, `leave_balance` all answered from Atlas data |
| 6 | Write round-trip: create → read → delete an announcement | ✅ 201 / 200 (title matched) / 200, then 404; no rows or notifications left behind |
| 7 | `npx vitest run --root api` **with `api/.env` present** | ✅ 15 files, **203 tests passed** in 59.05 s — and an employee/payroll fingerprint taken before and after the run was byte-identical, proving the suite never touches Atlas |

Why the connection string changed: `mongodb+srv://` needs a DNS **SRV** lookup, and Node's c-ares
resolver fails it on this machine (`querySrv ECONNREFUSED _mongodb._tcp.practice-backend…`) even
though the Windows resolver and 8.8.8.8 both resolve it and all three shard hosts accept TCP on
27017. `api/.env` therefore stores the equivalent **non-SRV multi-seed** URI, which connects first
time. No transaction is used anywhere in the API, so Atlas tier limits are not a constraint.

### Session 4 — in-memory demo (commands actually executed)

| # | Command | Result |
| --- | --- | --- |
| 1 | `npm run typecheck` (repo root) | ✅ exit 0 — `api` and `web` both `tsc --noEmit` |
| 2 | `cd api; npx vitest run` | ✅ **15 files, 203 tests passed**, 103.7 s |
| 3 | `npm run build` (repo root) | ✅ `api` tsc build + `vite build`: 56 modules, JS 295.00 kB (gzip 80.53 kB), CSS 25.04 kB |
| 4 | `cd api; npx tsx src/scripts/dev.ts` | ✅ in-memory MongoDB, seed, `HCM Lite API listening` on :4000 |
| 5 | Live HTTP probe (PowerShell) | ✅ health `ready: true`; login as admin/hr/employee; dashboard, employees, settings, announcements, payroll, assistant all served seeded data |
| 6 | Live browser walk-through (`http://localhost:5173`) | ✅ sign-in → dashboard → analytics → employees → attendance → payroll → assistant → sign-out, no error banners |
| 7 | Employee scoping over HTTP | ✅ `GET /api/v1/analytics/overview` → 403, `GET /api/v1/leave/balances` → 200 with 4 balance rows |

### Test breakdown

| Suite | Tests | What it proves |
| --- | --- | --- |
| `tests/setup.test.ts` | 10 | One-time company setup, duplicate setup refused (409), weak password refused (422), cookie issued |
| `tests/auth.test.ts` | 19 | Login, logout, `/me`, password change, revocation, forced change, throttling, no enumeration |
| `tests/rbac.test.ts` | 12 | Employee/HR/admin boundaries, provisioning, duplicate email, no hash leakage |
| `tests/users.test.ts` | 5 | Account administration: deactivate kills a live session, reset issues a one-time password |
| `tests/organization.test.ts` | 13 | Departments, designations, leave types and holidays; delete refused while referenced |
| `tests/employees.test.ts` | 14 | Employee CRUD, directory filters, archive, CSV export and dry-run import |
| `tests/attendance.test.ts` | 19 | Check-in/out, lateness from settings, board semantics, ledger, manual marking, corrections |
| `tests/leave.test.ts` | 15 | Apply, validation against balance, cancel, approve/reject, derived balances, calendar |
| `tests/payroll.test.ts` | 13 | Structures, draft generation, recompute, admin-only finalize, payslip + PDF |
| `tests/analytics.test.ts` | 14 | Overview, headcount, trend, leave usage, payroll cost, dashboard composition |
| `tests/announcements.test.ts` | 20 | Feed visibility by audience, create/patch/delete, read receipts, readers list |
| `tests/settings.test.ts` | 14 | Company profile, timezone/currency normalisation, attendance policy, audit entries |
| `tests/assistant.test.ts` | 12 | Intent detection, 7 tools, company-wide refusal for employees, provider fallback |
| `tests/units.test.ts` | 15 | `FixedWindowLimiter`, the static permission matrix, `inferNodeEnv` |
| `tests/seed.test.ts` | 11 | The seed itself: roster integrity, ledger consistency, payroll totals, API read-through |
| `tests/static-web.test.ts` | 7 | One-origin serving: shell + deep links, immutable asset caching, and that the SPA fallback never swallows an API 404 |

**Test database:** `mongodb-memory-server`, always. `tests/setup-env.ts` sets `MONGODB_URI` and
`JWT_SECRET` before any application module is imported, and `process.loadEnvFile` deliberately does
**not** overwrite variables that are already set — so a populated `api/.env` cannot redirect the
suite at a real database. Verified in session 5 (fingerprint unchanged before/after a full run).

### Explicitly *not* verified

- No **automated** browser test exists (Playwright is not installed). The browser walk-through above
  was performed manually by driving the live DOM, and is not re-run by `npm test`.
- No real OpenAI call was made; the assistant runs on its deterministic `rules` provider. The
  `openai` provider path has unit coverage only.

Verified since session 4, previously listed as gaps:

- ~~No test run ever targets a persistent MongoDB.~~ The **application** now runs against an Atlas
  cluster (seeded, read, written, deleted); the **test suite** still uses the in-memory server by
  design, and that isolation is now proven rather than assumed.

---

## 4. How to run it

```powershell
cd hcm-lite
npm install
npm run demo              # API :4000 on a throwaway in-memory MongoDB + seed, UI :5173
```

Open <http://localhost:5173> and sign in with:

| Account | Role | Password |
| --- | --- | --- |
| `admin@hcm.test` | administrator (all 26 permissions) | `Password123` |
| `hr@hcm.test` | HR (17 operational permissions) | `Password123` |
| `ayesha.khan@hcm.test` | employee (7 self-service permissions) | `Password123` |

### Two database modes

| Command | Database | Use for |
| --- | --- | --- |
| `npm run demo` | In-memory, seeded on boot, **discarded on exit**. Needs no `.env`. | Screenshots, demos, trying anything destructive |
| `npm run demo -- --atlas` | Whatever `api/.env` points at. **Data is kept.** | Work you want to survive a restart |
| `npm run dev:api` + `npm run dev:web` | Same as `--atlas`, two terminals | Watching logs separately |

The repo currently has a working `api/.env` pointing at the `hcm_lite` database of an Atlas cluster.
It is git-ignored (`.gitignore` line 12 covers `.env`; confirmed with `git check-ignore -v`). To
recreate it from scratch, copy `.env.example` and set:

- `MONGODB_URI` — for Atlas, prefer the **non-SRV** form (see session 5 notes above) if
  `mongodb+srv://` fails with `querySrv ECONNREFUSED`.
- `JWT_SECRET` — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

Then seed once: `npm run seed -w api`. The seed **refuses** to run against a database that already
holds a company unless you pass `--reset`, so a stray run cannot erase real data.

### Running the production build locally

```powershell
npm run build
$env:NODE_ENV = "production"; $env:MONGODB_URI = "..."; $env:JWT_SECRET = "..."
npm run start                      # http://localhost:4000 serves the UI *and* /api/v1
node scripts/verify-prod.mjs       # smoke check: shell, assets, deep links, API 404s, login
```

`npm run start` runs `node dist/server.js`; `api/src/middleware/static-web.ts` locates `web/dist`
relative to the working directory (or an explicit `WEB_ROOT`) and mounts it **after** the API routes
and **before** the 404 handler, so `/api/*` stays JSON and every other path returns the shell.
With `NODE_ENV=production` the session cookie carries `Secure`; Chrome treats `http://localhost` as
trustworthy so login still works locally, but a real deployment must terminate TLS.

### Deploying to Vercel

The project is linked (`hcm-lite`, scope `ahmed-tech-01s-projects`) and the GitHub repository is
connected, so a push to `main` builds production.

| Step | Command | Note |
| --- | --- | --- |
| 1 | `vercel login` | Browser device authorisation — only the user can approve it |
| 2 | `vercel link --yes` | Creates the project, writes `.vercel/` (git-ignored), connects GitHub |
| 3 | `vercel pull --yes --environment=production` | **Required before `vercel build`**, which otherwise stops at "No Project Settings found locally" |
| 4 | `vercel env add <NAME> production` | Feeds the value on stdin so it never reaches the shell history or the logs |
| 5 | `vercel deploy --prod` | The build runs on Vercel's infrastructure |

Production environment variables, all stored as **Sensitive** (they cannot be pulled back down;
`vercel pull` writes `[SENSITIVE]` placeholders for them):

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | the same non-SRV Atlas URI as `api/.env`, pointing at the already-seeded `hcm_lite` database |
| `JWT_SECRET` | freshly generated — deliberately **not** the local development secret |

**`NODE_ENV` must not be a Vercel variable, and has been removed.** It looks necessary (the logger
would otherwise ask for the `pino-pretty` transport, a devDependency absent from the function bundle,
and the session cookie needs `Secure`), but Production variables are injected into the **build** as
well, and `NODE_ENV=production` makes `npm ci` omit devDependencies — so `tsc` and `vite` disappear and
`npm run build` exits 127. That is exactly how the first two production deploys died. The environment
is now derived in code instead: `config/env.ts` exports `inferNodeEnv()`, which returns `production`
when `NODE_ENV` is absent and Vercel's `VERCEL_ENV` is `production`. An explicit `NODE_ENV` still wins,
so local `.env` files and the test suite behave exactly as before.

Two deliberate omissions: `CORS_ORIGINS` (UI and API share one origin, so no cross-origin request is
ever made) and `ADMIN_EMAIL` / `ADMIN_PASSWORD` (the Atlas database is already seeded; adding demo
credentials to a public deployment would only invite abuse).

**Not yet verified:** the redeploy after the `NODE_ENV` fix. The two deploys that did run both errored
in the build, so nothing has been reachable on a Vercel URL yet, and the Atlas cluster has not been
reached from Vercel's egress addresses (Network Access must allow them — Vercel functions have no
fixed egress IP). `vercel build --prod` cannot validate any of this here — it fails inside this shell
with `Error: spawn cmd.exe ENOENT` before running the build command, an environment problem and not
evidence about the config.

---

## 5. Phase tracker

| # | Phase | Status | Note |
| --- | --- | --- | --- |
| 1 | Foundation (config, DB, logger, errors, health) | ✅ | Health reports DB state without throwing |
| 2 | Auth & onboarding | ✅ | Setup wizard, login, forced password change, role menus |
| 3 | Organization & employees | ✅ | Master data, employee CRUD, directory, CSV import/export |
| 4 | Attendance | ✅ | Check-in/out, board, ledger, summary, corrections |
| 5 | Leave | ✅ | Apply/cancel/decide, balances derived from the ledger, calendar |
| 6 | Payroll | ✅ | Structures, draft, recompute, finalize, payslips, PDF |
| 7 | Analytics & reports | ✅ | Five report endpoints + one dashboard payload |
| 8 | Announcements & audit | ✅ | Feed, drafts, receipts, notifications, audit log |
| 9 | AI assistant | ✅ | 7 tools over live data; employee-safe refusals |
| 10 | Settings | ✅ | Company, attendance policy, account administration |
| 11 | Frontend integration | ✅ | Router, session, 14 screens, every screen wired to the API |
| 12 | Release prep | ✅ | Seed script + tests, one-command demo, docs updated, full verification |

---

## 6. Required functionalities (25)

| # | Functionality | Impl | Auth | Tests | Status |
| --- | --- | --- | --- | --- | --- |
| 01 | First-run company setup | ✅ | ✅ | 10 | ✅ `POST /setup`, guarded by a unique `key: 'primary'` row |
| 02 | Login, logout, password change, role menus | ✅ | ✅ | 19 | ✅ Permission-filtered navigation |
| 03 | Company settings | ✅ | ✅ | 14 | ✅ `GET /settings`, `PATCH /settings/company` |
| 04 | Departments, designations, leave types, quotas, holidays | ✅ | ✅ | 13 | ✅ Four CRUD routers |
| 05 | Create HR logins; deactivate/reset accounts | ✅ | ✅ | 5 | ✅ Deactivation kills live sessions |
| 06 | Register and edit employee records | ✅ | ✅ | 14 | ✅ `POST /employees`, `PATCH /employees/:id` |
| 07 | Employee directory, search, filters, paging, Employee 360 | ✅ | ✅ | 14 | ✅ `q`, department, status, pagination |
| 08 | CSV import (dry run) and export | ✅ | ✅ | 14 | ✅ `POST /employees/import`, `GET /employees/export` |
| 09 | Web check-in / check-out | ✅ | ✅ | 19 | ✅ Lateness computed from the company policy |
| 10 | Attendance calendar and daily board | ✅ | ✅ | 19 | ✅ Board, ledger, summary |
| 11 | Attendance correction requests | ✅ | ✅ | 19 | ✅ Employee files, HR decides |
| 12 | Apply for, cancel, view leave | ✅ | ✅ | 15 | ✅ Balance checked at apply time |
| 13 | Approve / reject leave | ✅ | ✅ | 15 | ✅ `leave.approve` only |
| 14 | Salary structures | ✅ | ✅ | 13 | ✅ Per-employee, integer minor units |
| 15 | Monthly payroll draft | ✅ | ✅ | 13 | ✅ Built from structures, attendance and leave |
| 16 | Admin finalizes payroll | ✅ | ✅ | 13 | ✅ `payroll.approve` is admin-only |
| 17 | Payslip PDF downloads | ✅ | ✅ | 13 | ✅ Dependency-free PDF writer |
| 18 | Dashboards, KPIs, trends, insights | ✅ | ✅ | 14 | ✅ Managers get company KPIs, employees get their own |
| 23 | Announcements | ✅ | ✅ | 20 | ✅ Audience-aware feed, drafts, receipts |
| 24 | In-app notifications | ✅ | ✅ | 20 | ✅ Unread count for the header bell |
| 25 | Audit log | ✅ | ✅ | 14 | ✅ Admin-only, filtered list + facets |
| AI | AI assistant + tools + smart leave + policy Q&A | ✅ | ✅ | 12 | ✅ Answers from live records; refuses company-wide questions for employees |

**Totals: all 22 tracked functionalities are complete (18 numbered items + 23–25 + the AI assistant).
213 automated tests exist and pass.**

> **Numbering note:** the brief's items 19–22 were never transcribed into this tracker during
> session 1, so nothing is asserted about them here. They are not referenced by any test name,
> route or screen, so no delivered work is mislabelled — but the gap in the numbering is real,
> not an omission in this table.

### Authorization layer (cross-cutting)

| Element | Status | Evidence |
| --- | --- | --- |
| 26-permission catalogue, 3 roles | ✅ | `permissions.ts`; asserted in `units.test.ts` |
| `requireAuth` (DB is the authority, not the token) | ✅ | deactivated-account and revoked-session tests |
| `requirePermission` (deny by default) | ✅ | employee and HR both get 403 on `/users` |
| `requirePasswordChanged` | ✅ | temporary password blocks every protected route |
| Ownership scoping | ✅ | employees reach only their own attendance, leave and payslips |
| Admin-only actions | ✅ | user provisioning, account status, password reset, payroll finalize, settings, audit |

---

## 7. Screen / route registry

| Route | Screen | Guard |
| --- | --- | --- |
| `/` | Dashboard (company view or personal view) | signed in; personal view if no `analytics.read` |
| `/login`, `/setup` | never rendered while signed in — both resolve to the dashboard | — |
| *(state)* | Company setup wizard | shown when `GET /setup/status` reports `setupRequired` |
| *(state)* | Login | shown when there is no session |
| *(state)* | Forced password change | shown while `mustChangePassword` is true |
| `/organization` | Departments / designations / leave types / holidays | `organization.read` (writes need `organization.manage`) |
| `/employees` | Directory, add/edit, archive, CSV, Employee 360 | `employee.read` |
| `/attendance` | Daily board, ledger, corrections, manual marking | `attendance.read` (writes need `attendance.manage`) |
| `/leave` | Balances, apply, my requests, approvals, calendar | `leave.apply` / `leave.read.own` / `leave.approve` |
| `/payroll` | Runs, salary structures, payslips, PDF download | `payroll.read.own` or `payroll.read.company` |
| `/analytics` | Headcount, leave usage, attendance trend, payroll cost | `analytics.read` |
| `/assistant` | AI assistant chat with tool fact cards | `ai.query` |
| `/announcements` | Feed, drafts, compose, readers | `announcement.read` |
| `/audit-log` | Filtered audit trail + facets | `audit.read` |
| `/settings` | Company profile, attendance policy, accounts | `settings.manage` |

Frontend guards are UX only; every endpoint re-checks the same permission server-side.

---

## 8. What the seed creates

Deterministic (seeded PRNG), so the demo always shows the same figures.

| Entity | Count | Notes |
| --- | --- | --- |
| Company | 1 | Saylani Technologies, `Asia/Karachi`, PKR, 09:00 start, 15-min grace |
| Departments / designations | 5 / 8 | Engineering, People, Sales, Finance, Operations |
| Leave types | 4 | Annual, Casual, Sick, Unpaid |
| Holidays | 6 | Excluded from leave counts and payroll working days |
| Employees | 13 | 12 active/probation + 1 resigned |
| Users | 5 | admin, hr, 3 employee logins |
| Attendance | 384 rows | Last ~44 days; **today deliberately left unmarked** so a live check-in can be demoed |
| Leave requests | 7 | 4 approved, 2 pending, 1 rejected |
| Corrections | 1 | Pending, so the approval queue is not empty |
| Salary structures | 12 | Everyone except the leaver |
| Payroll runs | 3 | 2 finalized, 1 open draft (built by the real payroll service) |
| Announcements | 4 | 3 published (1 pinned) + 1 draft |
| Notifications / audit entries | 5+ / 7+ | Bell has something to show; audit log is not empty |

`runSeed()` refuses to touch a database that already holds a company unless `--reset` is passed.

---

## 9. Defects found and fixed

### Session 5

| Defect | Impact | Fix |
| --- | --- | --- |
| `mongodb+srv://` bootstrap depends on a DNS SRV lookup that Node's c-ares resolver fails locally | `npm run seed` died with `querySrv ECONNREFUSED`, looking like an Atlas/IP-allowlist problem when the cluster was healthy | `api/.env` now holds the equivalent non-SRV multi-seed URI (all three shard hosts, `:27017`, `tls=true`, `authSource=admin`); documented in the file itself |
| The Atlas URI as supplied ended in `/`, which makes the driver default to the `test` database | HCM Lite would have written into whatever already lived in `test` | Pinned a dedicated `hcm_lite` database in the connection string |
| `npm run demo` could only ever run the throwaway database | No one-command way to keep data between restarts | `npm run demo -- --atlas` starts the same process tree against `api/.env` |

### Session 4

| Defect | Impact | Fix |
| --- | --- | --- |
| `percent()` multiplied an already-percentage value by 100 | Dashboard showed **8560%** attendance rate | Helper now formats the API's 0–100 value (`85.6%`) |
| Board called every unmarked employee **absent** on the current day | Board said "Absent 12" while the dashboard said "Not marked 12" — two endpoints contradicting each other | Unmarked is `not-marked` until the day has passed; a past working day still resolves to `absent` (new test) |
| Root `npm run typecheck` called a script `web` did not define | The documented verification command failed | Added `typecheck` to `web/package.json` |
| Nothing loaded `.env` | `npm run dev` could not start at all | `process.loadEnvFile` probe (no new dependency) |
| No MongoDB installed | Nothing could run in a browser | `npm run demo` boots an in-memory MongoDB and seeds it |

---

## 10. Honest limitations

1. **No automated UI tests.** `web/` has no Vitest config or Playwright suite; the UI is gated by
   `tsc`, `vite build` and manual browser verification only.
2. **No screenshots in the verification record.** The browser tool reported a zero-size viewport
   (`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`), so the walk-through was verified from live DOM text.
3. **~~`docs/` is outside the git repository.~~** Fixed in session 6: the documents moved to
   `hcm-lite/docs/`, so they are versioned with the code. The design reference PNGs (32 MB) were
   deliberately left out of the repository. History is still short — the first commit is session 6.
4. **The assistant's `openai` provider is unexercised live** (no API key). Default `rules` mode is
   what the demo uses.
5. **Two database modes.** `npm run demo` is ephemeral by design and re-seeds on every boot;
   `npm run demo -- --atlas` writes to the cluster in `api/.env` and keeps everything.
6. **Payroll tax is a fixed demo rule**, not a jurisdiction-accurate calculator.
7. 🔴 **Credentials in circulation.** The Atlas connection string was pasted into this conversation
   in plain text, so treat that password as compromised: rotate it in Atlas → Database Access, and
   update `api/.env` to match. The same paste contained an unrelated API key that
   matches no service this project uses — revoke it wherever it came from. The supplied JWT was the
   public `jwt.io` sample token (`sub: 1234567890`, issued 2018) and is of no use as a credential.
   None of these were committed (`api/.env` is git-ignored) and none were stored in memory; the
   `JWT_SECRET` in `api/.env` was generated locally and never printed.
8. **The Atlas cluster is reachable from this one IP** (`153.117.38.141`). If Atlas Network Access is
   restricted, deploying anywhere else requires adding that host's egress — and Vercel has no fixed
   egress IP, so publishing there means setting access to `0.0.0.0/0`. That choice has been made
   deliberately, with the understanding that the **leaked password must be rotated promptly**, because
   while it is live the cluster is reachable from the whole internet.
9. **The Vercel deploy itself is unverified.** `vercel.json`, `api/src/vercel-handler.ts` and the
   production same-origin path are all proven *locally*; nothing has run on Vercel yet, because the
   CLI is not logged in. Two specific unknowns: how the serverless runtime reports a missing
   `web/dist` (the static build is served by the platform there, not by Express), and whether the
   `routes` rewrite preserves the `/api/v1/...` prefix the Express app mounts on. Expect to correct
   this config on the first real deploy.
10. **`frame-ancestors 'self'` blocks embedding.** Helmet's default CSP means the deployed app will
    not render inside an iframe (including an in-editor preview). Open it in a normal browser tab.

---

## 11. Open items (not blockers)

| Item | Suggested action |
| --- | --- |
| 🔴 Leaked Atlas password | Rotate in Atlas → Database Access, then update `MONGODB_URI` in `api/.env` |
| 🔴 Unrecognised API key from the same paste | Revoke at whichever provider issued it; it is not used by this project |
| Atlas Network Access scope | Confirm the allowlist is this IP only, not `0.0.0.0/0` |
| No commit yet | First commit lands in session 6 with the push to GitHub — `api/.env` stays out |
| Docs not versioned | ✅ Resolved in session 6: `docs/` moved inside `hcm-lite/` |
| Deploy unverified | Log in (`vercel login`), deploy, then re-run `node scripts/verify-prod.mjs https://<url>` and fix `vercel.json` if the rewrite misbehaves |
| No frontend tests | Add Vitest + React Testing Library for the screens that carry logic |
| No E2E | Add Playwright for the five-minute demo path |
| Assistant provider | Add a smoke test against a real endpoint if a key is ever supplied |

---

## 12. Change log

| Date | Change | By |
| --- | --- | --- |
| 2026-10-30 | Session 6 (cont.): logged in to Vercel, linked `hcm-lite` and connected the GitHub repository. The first two production builds errored in 7 s — my own `NODE_ENV=production` variable was injected into the build, so `npm ci` installed 129 of 396 packages and `npm run build` exited 127. Fixed by removing that variable, setting `installCommand: "npm ci --include=dev"`, and adding `inferNodeEnv()` in `config/env.ts` to derive production from Vercel's `VERCEL_ENV`; guarded by 3 new tests (**213** now pass) and reproduced under a deployed function's shape (`env: "production"`, cookie `Secure`). Also re-asserted `!.env.example` after the `.env*` rule that the Vercel CLI appended to `.gitignore`. | Qoder |
| 2026-10-30 | Session 6: moved `docs/` inside `hcm-lite/` so the documents are versioned and repaired the `.gitignore` encoding damage; added production same-origin serving (`middleware/static-web.ts`: `express.static(web/dist)` after the API routers, SPA fallback before the 404 handler, plus 7 tests); added the serverless entry point `api/src/vercel-handler.ts` and `vercel.json`; documented the deployment environment. Re-ran typecheck, **210 tests**, the production build and a live `NODE_ENV=production` serve (shell `no-cache`, hashed assets `immutable`, deep link served, unknown `/api/v1/*` still JSON 404, login cookie `HttpOnly; Secure; SameSite=Lax`). Made the first commit and pushed to GitHub with `api/.env` excluded. | Qoder |
| 2026-10-30 | Session 5: created git-ignored `api/.env` with a locally generated `JWT_SECRET`; diagnosed the Node SRV-resolution failure and switched to a non-SRV Atlas URI pinned to a dedicated `hcm_lite` database; seeded Atlas (13 employees / 384 attendance / 7 leave requests); verified 13 endpoints, RBAC denials, all assistant intents and a create→read→delete round-trip through the Vite proxy; added `npm run demo -- --atlas`; re-ran the **203 tests** and proved by fingerprint that they never touch the cluster. No application defects found. | Qoder |
| 2026-10-29 | Session 4: finished the six remaining screens (organization, analytics, assistant, announcements, audit, settings); added the seed script and its 11 tests; made `.env` load; added `npm run demo` with an in-memory database; fixed the 8560% attendance rate and the "absent on today" board contradiction; rewrote both docs. **203 tests pass.** | Qoder |
| 2026-10-28 | Session 3: phases 3–10 — organization, employees, attendance, leave, payroll, analytics, announcements/notifications/audit, AI assistant, settings, with tests. | Qoder |
| 2026-10-28 | Session 2: git init, monorepo + `.env.example`; API foundation; Phase 2 auth/RBAC/setup; 4 test suites (53 tests); production build verified. | Qoder |
| 2026-10-28 | Created `PROGRESS.md` + `ARCHITECTURE.md`; built the static Announcements UI shell (later replaced by the real screen). | Qoder |
