# HCM Lite — UI Registry

> The single inventory of every screen, route and shared UI piece in `hcm-lite/web`, and of **how
> each one is actually verified**. `docs/PROGRESS.md` §7 points here rather than repeating it, so
> there is exactly one registry to keep honest.
>
> Counts in this file were measured on 2026-11-03 by reading the tree (line count of every file in
> `web/src/screens`, `web/src/components` and `web/src/lib`, an endpoint scan of every screen, and the
> export lists of `components/ui.tsx` / `components/icons.tsx`). Nothing here claims a screen works
> unless the verification column says what proved it.

---

## 1. How routing works

- A hand-written 91-line history router (`lib/router.tsx`). No routing library, no nested routes,
  no route params — screens fetch their own sub-state (e.g. the Employee 360 panel is local state,
  not `/employees/:id`).
- `navigate()` scrolls to the top of the document. In-page anchors therefore use
  `scrollIntoView` + a real `href="#id"` with `preventDefault`, never `navigate` (see
  `SectionLink` in `LandingScreen.tsx`).
- `App.tsx` holds two things: the `ROUTES` table (guarded by permissions) and the `Shell()` guard
  chain, which decides what an *unauthenticated* visitor may see at all:

```text
loading splash
  → /forgot-password | /reset-password      (never require a session)
  → no session:  /            → LandingScreen
                 /signup       → SignupScreen
                 /setup        → SetupScreen     (only while GET /setup/status says setupRequired)
                 anything else → LoginScreen     (and the URL is rewritten to /login)
  → session + mustChangePassword → ChangePasswordScreen
  → session, no visible nav items → warning banner inside the shell
  → otherwise → Layout + the guarded ROUTES entry (a signed-in visitor on /login or /signup is
                sent to /)
```

- Frontend guards are UX only. `visibleNavItems()` hides links, `ROUTES[].permissions` renders
  `Forbidden`, and every endpoint re-checks the same permission server-side.

---

## 2. Public surface (no session required)

| Route | Screen | Size | What it touches | Verified by |
| --- | --- | --- | --- | --- |
| `/` | `LandingScreen.tsx` | 965 lines | **Zero API calls.** Reads the session context only to decide Login/Get Started vs "Continue in your workspace" | HTTP: `GET /` returns the shell, and the built bundle contains the hero/feature/CTA/footer strings (`static-web.test.ts`, 7 tests, covers shell + deep links + fallback). The sign-up it links to has its own 35-test suite. **Not** driven in a browser this session — see §6 |
| `/signup` | `SignupScreen.tsx` | 709 lines | `registerCompany()` → `POST /auth/register` then `GET /auth/me` (both via `lib/session.tsx`) | `tests/registration.test.ts` (35) + live HTTP run against an empty database: validation 400 with field paths, weak password 422, 201 + HttpOnly cookie + 26 permissions + audit entry + 409 on the second attempt |
| `/login` | `LoginScreen.tsx` | 203 lines | `signIn()` → `POST /auth/login` | `tests/auth.test.ts` (19), `tests/password-recovery.test.ts` (20); driven in a real browser in session 8 |
| `/setup` | `SetupScreen.tsx` | 194 lines | `POST /setup` directly | `tests/setup.test.ts` (10) |
| `/forgot-password` | `ForgotPasswordScreen.tsx` | 121 lines | `POST /auth/forgot-password` | `tests/password-recovery.test.ts`; verified on the **production** URL in session 8 (200, no token in the body) |
| `/reset-password` | `ResetPasswordScreen.tsx` | 143 lines | `POST /auth/reset-password`; accepts `?token=` to prefill | same suite; production probe returns the generic 422 for a garbage token |

The landing page and the sign-up page are the only places a stranger can reach. Neither renders
application data: the dashboard panel on `/` is labelled an illustrative preview with placeholder
figures, and feature cards open static product copy in a `Modal`.

---

## 3. Signed-in surface

| Route | Screen | Size | Nav label | Permission that reveals it | Endpoints called |
| --- | --- | --- | --- | --- | --- |
| `/` | `DashboardScreen.tsx` | 447 | Dashboard | none (every role) | `/analytics/dashboard`, `/attendance/today`, `/leave/balances`, `/announcements` |
| `/organization` | `OrganizationScreen.tsx` | 983 | Organization | `organization.read` | `/departments`, `/designations`, `/leave-types`, `/holidays` |
| `/employees` | `EmployeesScreen.tsx` | 526 | Employees | `employee.read` | `/employees`, `/departments`, `/designations` |
| `/attendance` | `AttendanceScreen.tsx` | 904 | Attendance | `attendance.read` | `/attendance`, `/attendance/board`, `/attendance/corrections`, `/attendance/mark`, `/attendance/today`, `/employees` |
| `/leave` | `LeaveScreen.tsx` | 452 | Leave | `leave.read.own` / `leave.apply` / `leave.approve` | `/leave/balances`, `/leave/requests`, `/leave-types` |
| `/payroll` | `PayrollScreen.tsx` | 711 | Payroll | `payroll.read.own` / `payroll.read.company` | `/payroll/runs`, `/payroll/structures`, `/payroll/payslips`, `/employees` |
| `/analytics` | `AnalyticsScreen.tsx` | 484 | Analytics | `analytics.read` | `/analytics/overview`, `/headcount`, `/attendance-trend`, `/leave-usage`, `/payroll-cost` |
| `/assistant` | `AssistantScreen.tsx` | 176 | AI Assistant | `ai.query` | `/assistant/chat`, `/assistant/suggestions` |
| `/announcements` | `AnnouncementsScreen.tsx` | 603 | Announcements | `announcement.read` | `/announcements`, `/departments` |
| `/audit-log` | `AuditScreen.tsx` | 256 | Audit Log | `audit.read` | `/audit-log`, `/audit-log/facets` |
| `/settings` | `SettingsScreen.tsx` | 664 | Settings | `settings.manage` | `/settings`, `/settings/company`, `/settings/attendance`, `/users` |

State-only screen (no URL of its own):

| Screen | Size | Shown when | Endpoints |
| --- | --- | --- | --- |
| `ChangePasswordScreen.tsx` | 111 | `session.user.mustChangePassword` is true — it replaces the whole app until the password changes | `/auth/change-password` |

18 screen components, 16 URL routes (`/` and `/login` each resolve to two screens depending on the
session), one state-only screen.

---

## 4. Shared UI

| Module | Exports | Notes |
| --- | --- | --- |
| `components/ui.tsx` (536 lines) | `Button`, `Spinner`, `LeafBrand`, `PageHeader`, `Panel`, `Stat`, `Field`, `TextInput`, `Textarea`, `Select`, `Checkbox`, `Banner`, `EmptyState`, `Loading`, `Badge`, `statusTone`, `Table`, `Th`, `Td`, `Avatar`, `BarRow`, `Modal`, `Tabs` | 23 exports. `Button` owns the loading/disabled state; `Field` renders label + hint + error so server field errors and client errors look identical |
| `components/icons.tsx` (333 lines) | 41 exports: `LeafLogo` + 40 inline SVG icons | Hand-drawn Lucide-style paths. No icon library dependency |
| `components/Layout.tsx` (16) | `Layout` | Sidebar + Header + canvas; only the signed-in shell |
| `components/Sidebar.tsx` (61), `components/Header.tsx` (186), `components/nav.ts` (67) | — | `NAV_ITEMS` (11 entries) filtered by `visibleNavItems()`; the header carries the company name (from `/settings/public`), the notification bell and Sign out |
| `lib/api.ts` (162) | `api`, `ApiError`, `setUnauthorizedHandler` | Relative `/api/v1` base, `credentials: 'include'`, `AUTH_PATHS` (6 entries incl. `/auth/register`) never trigger the 401 handler |
| `lib/session.tsx` (170) | `SessionProvider`, `useSession`, `useCan`, `RegisterDetails` | `signIn`, `registerCompany`, `signOut`, `refresh`, `markSetupComplete`, `can`. Nothing about the session is ever stored in localStorage |
| `lib/hooks.ts` (73) | `useAsync`, `useAction` | `useAction` gives `run / busy / error / fieldErrors / setError` — every form's submit state |
| `lib/format.ts` (81), `lib/types.ts` (430) | formatters, wire types | Types mirror the server's `toPublic*` shapes |

Design tokens (`primary #078b51`, `ink #172d27`, `line #dce9e1`, radius `card 10px` / `ctrl 7px`,
the semantic colour rules) are documented in `docs/ARCHITECTURE.md` §9 and are the single source of
truth. New pages use those tokens and the `globals.css` classes (`.card`, `.input`, `.kpi-value`,
`.btn-primary`, `.nav-item`); no page introduces its own palette.

---

## 5. Verification status — what each claim rests on

| Layer | Status | Evidence |
| --- | --- | --- |
| Types + build | ✅ | `npm run typecheck` (both workspaces) exit 0; `npm run build` exit 0 — 60 modules transformed, `dist/index.html` 1.07 kB, CSS 31.35 kB, JS 347.29 kB (92.22 kB gzip) |
| Backend behaviour behind every screen | ✅ | 19 suites / **276 tests** pass (`npm test`; 77.52 s on the final run of session 9) |
| Registration + landing pages against a live server | ✅ | `scripts/verify-signup.mjs` (`npm run verify:signup`) — HTTP-level walk of `npm run demo -- --empty` (unseeded in-memory MongoDB, real API serving `web/dist` on one origin): **21/21** — shell at `/` and deep link at `/signup`, product title in the shell, the specified copy present in the built bundle, 400 with 14 dotted field paths, 422 weak password, `X-RateLimit-Remaining`, 201 with `HttpOnly; SameSite=Lax` cookie, no secret fields, `/auth/me` 26 permissions, `/settings/public` showing the new company name without waiting out the cache, the `auth.register` audit row with actor + ip, 409 on the second company, 401 without the cookie, re-login, logout clearing the cookie. Re-running it against the same server takes the read-only branch: **6/6**. Against production it reports **3/6** — every failure there means "this build is not deployed yet" |
| Signed-in screens driven in a real browser | 🟡 | Done manually in sessions 4, 7, 8 (login, RBAC denial, reload restoring a session, forgot/reset round trip). **Not re-run for session 9** — the browser tool is disabled in this environment, so the landing/sign-up pages were verified at HTTP + bundle level and by the automated suite instead of by clicking |
| Automated frontend tests (unit or E2E) | ❌ | None exist. `web/` has no test runner; Playwright is not installed |
| Lint step | ❌ | No ESLint config or `lint` script exists in this repository; `tsc --noEmit` for both workspaces is the static gate |

---

## 6. Known UI gaps

1. **No automated UI test catches a rendering regression.** The two public pages are new and their
   behaviour is proven at the API boundary and in the built bundle, not by a headless browser.
2. `LandingScreen.tsx` is 965 lines: nav, hero, dashboard preview, features, modules, steps, about,
   CTA, contact and footer live in one file. It renders from the `FEATURES` / `MODULES` / `STEPS` /
   `REASONS` tables at the top, but splitting it into `components/landing/*` is the obvious next
   refactor before adding anything else.
3. The landing page's contact section deliberately shows **no address or phone number**, because no
   support inbox is configured for this deployment. A real product would replace it with configured
   details, not an invented one.
4. Sign-up collects country and city but does **not** infer time zone or currency from them; those
   stay at the deployment default until edited in Settings. This is deliberate (guessing a time zone
   from a country name is wrong often enough to corrupt attendance), and the form says so.
5. `/signup` renders even when the deployment already has a company. It shows an info banner and the
   server answers 409; there is no client-side route hiding, because the server's answer is the only
   authority worth trusting.
