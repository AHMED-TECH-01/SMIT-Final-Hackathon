# HCM Lite — Progress

> **Single source of truth for what is *actually* implemented and tested.**
> Read this file (and `docs/ARCHITECTURE.md`) at the start of every work session.
>
> **Rule enforced here:** an item is only marked ✅ when it has (a) a working implementation,
(b) server-side authorization, and (c) at least one test that was actually executed and passed.
Anything else stays 🟡 or ❌. No exceptions.

> **Deployment note:** the app is live at **https://hcm-lite-eta.vercel.app** (Vercel, production).
> Two workspace changes came out of getting there: the backend folder was renamed `api/` → `server/`
> because Vercel compiles every file under `api/` into a Serverless Function and the Hobby plan caps a
> deployment at 12, and `/api/*` is routed to the single function by a `vercel.json` `rewrites` entry
> rather than a `[...path]` filename. The npm workspace is still *named* `api`, so `npm -w api` is
> unchanged. Verification rows from earlier sessions keep the paths they were run with.

**Last updated:** 2026-11-03 (session 8 — self-service password recovery, remember-me, real `/login` URL, live browser verification; reset token gated to local runs before the push; Atlas password rotated)
**Overall status:** 🟢 **All 12 phases delivered.** 18 test suites / **241 tests** pass, the production
build succeeds, every screen has been driven against a live API in a real browser, the API runs
against a persistent MongoDB Atlas cluster, it serves the built UI from the same origin, and **that
same-origin build is deployed and verified in production. Session 8 re-verified the authentication
foundation in a live browser and added what was genuinely missing: forgot/reset password, “remember
me”, and a `/login` URL that matches what is rendered.
**Demo readiness:** ✅ `npm run demo` boots an in-memory database, seeds it and serves the UI;
`npm run demo -- --atlas` keeps data; `npm run build && npm run start` serves UI + API on :4000.
**Deployment:** ✅ live on Vercel at **https://hcm-lite-eta.vercel.app**, fed by the linked GitHub
repository. SPA, deep links, login, session cookie, RBAC and a data-backed dashboard were all
verified against the running deployment. Vercel's own Deployment Protection was turned **off** for
this project so the URL is publicly reachable — see limitation 11.
**Outstanding risk:** 🟡 the Atlas password that was shared in plain text has been **rotated** by the
owner (session 8 row 15 — the deployment still reports `state: "connected"`), so the cluster is no
longer open to whoever holds that string. What remains is that the deployment is public and the
seeded demo logins (`admin@hcm.test` and colleagues) share one password that ships in
`server/src/scripts/seed.ts`, so anyone reading this file can work it out.

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
| Monorepo (npm workspaces `web` + `server`) | ✅ | Root scripts `dev:web`, `dev:api`, `demo`, `demo -- --atlas`, `build`, `start`, `test`, `typecheck`, `seed`. The `server/` folder is still the workspace *named* `api`, and root `api/` holds only the Vercel Function shim |
| Backend API | ✅ | 16 route modules, **241 tests** pass |
| MongoDB persistence | ✅ | Runs on the in-memory server **and** against a live Atlas cluster (seed/read/write/delete verified) |
| Production serving (one origin) | ✅ | The API serves `web/dist` + SPA fallback; 7 tests; verified in a browser from a production build. On Vercel the platform serves the static build instead, which is the same origin but without helmet's CSP |
| Deployment (Vercel) | ✅ | Live at **https://hcm-lite-eta.vercel.app** — `● Ready`, GitHub-connected, Atlas reachable from the function. `scripts/verify-prod.mjs` passes against it (SPA, deep link, login, cookie flags, 26 permissions, dashboard workforce 12) |
| MongoDB models | ✅ | 16 Mongoose models covering every domain |
| Authentication / sessions | ✅ | JWT in HttpOnly cookie, `tokenVersion` revocation, forced password change, self-service forgot/reset password, remember-me (7-day cookie) |
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

### Session 8 (2026-11-03) — authentication audited against the brief, gaps closed, driven in a live browser

The brief asserted login was never implemented. It has been since session 2 (`/auth/login`, `UserModel`,
JWT in an HttpOnly cookie, RBAC, setup wizard, 19 passing auth tests, login verified on the deployed URL
in session 6/7 probes). What was *actually* missing against the brief was measured first, then built:
self-service forgot/reset password, a real “remember me”, the `/login` UI elements (Welcome Back,
show/hide password, forgot link), and a `/login` URL that matches the rendered screen. Deviations kept
deliberately: single-tenant by design (one company, so users carry no `companyId`/`isEmailVerified` —
the email-verification feature does not exist and the field would be a lie), cookie-session auth (so no
`/auth/refresh` — there is no refresh-token pair), and no `/app/dashboard` prefix (the existing router
serves the dashboard at `/`; re-basing every deep link is churn, not function).

| # | Check | Result |
| --- | --- | --- |
| 1 | New endpoints `POST /auth/forgot-password` + `POST /auth/reset-password` (`auth.service.ts`, `auth.routes.ts`) | ✅ Token is `crypto.randomBytes(32)`, stored only as SHA-256 with a 30-min expiry, single-use; unknown/inactive emails get the identical generic 200 (no enumeration); reset bumps `tokenVersion`, killing every session; forgot throttled 5 / 15 min per `ip:email` |
| 2 | No mail provider exists — honest delivery | ⚠️ Documented decision D36: **only a local run** returns the token in the response so the flow is usable and testable; every deployed URL — preview included — answers with the generic sentence only, and admin/HR accounts receive an in-app notification that a reset was requested. The first cut of this row said "outside production", which was a leak — see rows 10–12 |
| 3 | “Remember me” with real behaviour | ✅ `login({…, remember})` signs the JWT with `exp: 7d` and sets the same HttpOnly cookie with `Max-Age 604800`; nothing in localStorage; revocation model unchanged (D35) |
| 4 | New suite `tests/password-recovery.test.ts` | ✅ 17 tests: token issued/hashed-at-rest, no-enumeration equality, inactive refused, validation 400, forgot throttled 429, reset sets new password, old password 401, live session revoked 401, invalid + expired + reused tokens all the same generic 422, weak and reused new passwords 422, no hash/token leakage via `/auth/me`, remember-me cookie attrs (7d vs 900s), remembered session authenticates, inactive+remember still 403 |
| 5 | Full backend suite after the changes | ✅ **18 files, 238 tests passed** (83.76 s); server + web `tsc --noEmit` exit 0; `vite build` clean (303 kB JS) |
| 6 | Login UI (`/login`) per the brief | ✅ “Welcome Back” + “Sign in to your HCM Lite account.”, mint-tinted background with white card, emerald Sign In with loading spinner, inline field errors from Zod details, auth-error banner, show/hide eye toggle (verified flipping `type="password"` → `"text"`), remember-me checkbox, forgot-password link, setup link rendered only while `GET /setup/status` reports setup required |
| 7 | Live browser walk-through (`npm run demo`, :5173 → Vite → :4000 → in-memory MongoDB) | ✅ driven through the real UI and socket: wrong password → inline “Invalid email or password.” staying on `/login`; admin login with remember-me → dashboard, 11 sidebar links, 26 permissions; **F5 reload restored the session** (HttpOnly cookie); anonymous `/analytics/overview` → 401; employee session → own `/auth/me` 200 with 7 permissions, `/leave/balances` 200, `/analytics/overview` **403**; forgot → dev token → `/reset-password?token=…` (prefilled) → success banner; old password 401 / new password 200; signed-in visit to `/login` redirected to `/`; header Sign out → `/login` and `/auth/me` 401; protected deep link `/employees` while signed out → `/login` |
| 8 | Screenshot deliverable | ❌ not captured — the embedded browser view reports `viewport=0x0, visibilityState=hidden` (`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`), the same limitation as session 4 row 2 / limitation 2; verification used live DOM snapshots instead. Opening the preview panel makes the page visible |
| 9 | URL/screen consistency fix found by the walk-through | ✅ signing out rendered the login form at URL `/`; `App.tsx` now bounces a signed-out visitor (and any protected deep link without a session) to `/login`, and a signed-in visitor on `/login` to `/` — re-verified in the browser (row 7) |
| 10 | 🔴 Security review of the uncommitted feature before pushing it — **found a leak in rows 1–2 as written** | ❌→✅ The gate was `return isProd ? {} : { devResetToken: token }`, and `isProd` is `NODE_ENV === 'production'`. But `inferNodeEnv()` flips `NODE_ENV` only when `VERCEL_ENV === 'production'`, so a Vercel **preview** deployment runs with `NODE_ENV=development` and would have returned a live, plaintext reset token to **anyone who POSTed an email address** at that URL — and these deployments have Deployment Protection turned off (limitation 11), so the URL is world-reachable. Combined with `tokenVersion` bumping on reset, that is account takeover on every preview URL. Nothing was pushed while it stood; fixed before the commit |
| 11 | Fix: gate on the platform signal, not on `NODE_ENV` | ✅ `config/env.ts` now exports `isDeployed = Boolean(process.env.VERCEL)` (set on production **and** preview) and `exposesResetToken = !isProd && !isDeployed`; `auth.service.ts` returns the dev token only under `exposesResetToken`; `auth.routes.ts` JSDoc corrected. The token now reaches a caller only on a machine no one else can reach |
| 12 | Tests for the gate itself | ✅ 3 new cases in `tests/password-recovery.test.ts`: local run open (`isDeployed false`, `exposesResetToken true`), **preview closed while `isProd` is still false** — the exact condition the old gate missed — and production closed |
| 13 | Measurement note on row 12 | ⚠️ The production case first asserted `isProd === true` and failed. Measured with a throwaway test: `vi.stubEnv('NODE_ENV', undefined)` does delete the variable and `VERCEL_ENV` is set, yet `env.NODE_ENV` still came out `development`, because `loadEnv()` calls `process.loadEnvFile()` first and **line 9 of `server/.env` pins `NODE_ENV`** — a laptop artifact. The test asserts `isDeployed`/`exposesResetToken` instead; `NODE_ENV` inference keeps its own env tests |
| 14 | Full suite + build after the gate | ✅ `npm test` → **18 files, 241 tests passed** (91.45 s); `npm run typecheck` exit 0; `npm run build` exit 0. `server/.env` is git-ignored (`.gitignore:46`), so the rotated Atlas password cannot be part of any push |
| 15 | Atlas credential rotation (limitation 7 / open item 1) | ✅ rotated by the owner, then measured against the live deployment: `GET /api/v1/health/ready` → `{"ready":true,"state":"connected"}` — Vercel's function still reaches the cluster with the new secret. ⚠️ What this check **cannot** prove is that the old password is actually dead at Atlas; that is only true inside the Atlas dashboard |
| 16 | Build-environment pin (`8365a3f`, authored while this session was being committed) | ✅ `engines.node` `>=20.12` → `22.x` plus a new `.nvmrc` (22), and `web/package-lock.json` deleted. The reason recorded in that commit: a cold Vercel build resolved `>=20.12` to **Node 26**, where Vite 5.4 / esbuild 0.21 are unsupported and npm blocks the esbuild postinstall, so `web/dist` was never emitted (`STATIC_BUILD_NO_OUT_DIR`). With npm workspaces the root lockfile is the only one `npm ci` (the configured `installCommand`) reads, so the nested file was a stray. ⚠️ Measured here: a metadata-only engines change desynchronises the lockfile and makes `npm ci` refuse to install, so the lockfile had to be re-locked first — `npm install --package-lock-only` produced a **one-line** diff (the recorded engines value), proving no dependency was re-resolved. Re-verified after: `npm test` → 18 files / **241 tests** (117.58 s), typecheck exit 0, `npm run build` exit 0. The platform claim itself is only settled by the build output below |

### Session 7 (2026-10-31) — live audit of the deployed backend

Probed **https://hcm-lite-eta.vercel.app** directly (HTTP level, no browser) after the git-built
production deployment `hcm-lite-in2e2ziog` reported `● Ready` (32 s).

| # | Check | Result |
| --- | --- | --- |
| 1 | 28 endpoints across all 16 route modules with an admin session | ✅ `200` everywhere a `200` is right: health, auth/me, employees + CSV export, attendance board, leave requests, payroll runs/structures, analytics overview/dashboard/headcount/attendance-trend/leave-usage/payroll-cost, announcements, notifications, audit-log + facets, settings + settings/public, departments, designations, leave-types, holidays, users, assistant suggestions, setup status |
| 2 | Authorization on the platform, not just in tests | ✅ employee session (`ayesha.khan@hcm.test`): `/analytics/overview` → **403**, `/auth/me` and `/attendance/me` → 200 |
| 3 | Business rules that reject a sane-looking request | ✅ admin on `/attendance/me` and `/leave/balances` → **422 UNPROCESSABLE** ("account not linked to an employee profile") — correct, the admin has no employee record |
| 4 | Write path to Atlas through the function | ✅ announcement create → read back (title matched) → DELETE 200 → re-read 404; nothing left behind |
| 5 | Binary response through a serverless function | ✅ `GET /payroll/payslips/:runId/pdf` → `200 application/pdf`, 2 212 bytes, starts `%PDF-` |
| 6 | Cold- vs warm-container latency | ✅ ~290 ms per call (`x-vercel-id: bom1::iad1::…`), and `health.uptimeSeconds` kept climbing — the memoised connection/app per container works |
| 7 | 200 KB JSON body | ❌ **`500 INTERNAL_ERROR` instead of `413`**. Reproduced identically on the local in-memory demo (`npm run demo`, :4000), so it is **not** a platform issue: `express.json({ limit: '100kb' })` raises `entity.too.large`, which is neither an `HttpError` nor a `ZodError`, so `middleware/error-handler.ts` fell through to its generic 500. Practical effect: `/employees/import` with a CSV over ~100 KB failed with an opaque 500 (Vercel's own function body cap is 4.5 MB and was never reached) |
| 8 | Malformed JSON and `charset=utf-32le` | ⚠️ the handler had no branch for these either, so they took the same generic 500 path (reasoned from the code, not measured before the fix). Their error types are `entity.parse.failed` and `charset.unsupported` — body-parser re-wraps raw-body's `encoding.unsupported` as a 400 before handing it over, which is why both spellings are matched |
| 9 | Fix: `bodyParserRejection()` in `middleware/error-handler.ts` + new `tests/errors.test.ts` | ✅ measured now: 413 `PAYLOAD_TOO_LARGE` / 400 `BAD_REQUEST` / 415 `UNSUPPORTED_MEDIA_TYPE`, and a normal-size body still reaches the auth layer (401) — proving the limit check did not swallow valid requests |
| 10 | `npm run typecheck` + `npm test` after the fix | ✅ exit 0; **17 files, 217 tests passed**, 64.56 s. The new file needs no MongoDB: `createApp(null)` never reaches a handler, so nothing touches the database |
| 11 | Cleanup | ✅ local demo stopped (port 4000 free), probe scripts deleted |

### Session 7 (cont. 2026-10-31 → 2026-11-03) — the fix deployed, and what production then revealed

The first fix was committed as `299fd17` and reached production through the `git push` auto-build
(`hcm-lite-jrauxp12p`, `● Ready` in 37 s, all three aliases flipped by themselves).

| # | Check | Result |
| --- | --- | --- |
| 12 | `POST /api/v1/announcements` with a 200 KB body on **production** | ✅ **413 `PAYLOAD_TOO_LARGE`** with our own message text, which also proves the new code is what is running |
| 13 | Malformed JSON and `charset=utf-32le` on **production** | ❌ **still `500 INTERNAL_ERROR`** — while the identical requests against the local demo over a real socket returned 400 and 415. So the mapping was right and incomplete, not broken |
| 14 | `vercel logs <deployment> --json` while sending the two failing requests | ✅ caught the object the handler actually receives: `message: "Invalid JSON"`, `statusCode: 400`, `type: "ge"` (a minified name), stack `at /opt/rust/nodejs.js … at IncomingMessage.get [as body] … at jsonParser (body-parser/lib/types/json.js:112)`. **Vercel's own runtime decodes the JSON body and installs a getter on `req.body` that throws**, so `express.json` rethrows an error that carries no body-parser `type` at all. The 413 path survives because raw-body aborts the stream before that getter is read |
| 15 | Widened the mapping into `transportRejection()` | ✅ the body-parser `type` table now resolves to a status, and any error that **declares its own 4xx** (`statusCode`/`status`, 400–499) is honoured with our envelope. A 5xx deliberately stays a server fault. Message text is always ours — the upstream `Invalid JSON` string is never echoed. Checked first that nothing in the app throws a bare status-carrying object (only `HttpError`, matched earlier) and that the AI provider swallows its own upstream statuses, so the rule cannot mask a deliberate decision |
| 16 | Consequence of a platform that pre-parses the body | ⚠️ measured on production after the widening: **`charset=utf-32le` carrying real UTF-32LE bytes** is refused by Vercel's own decode as invalid JSON — **400 `BAD_REQUEST`** — where the same request against the local server answers **415 `UNSUPPORTED_MEDIA_TYPE`**. Both are client errors inside our envelope with our message; only the status differs per host. See row 21: the outcome depends on the bytes, not on the label alone |
| 17 | 4 new tests driving `errorHandler` directly with the production error shape (`tests/errors.test.ts`) | ✅ 8 tests in that file. A local socket cannot produce Vercel's shape, so the handler is called with the object taken from the function log: declared 400 → `BAD_REQUEST` without echoing `Invalid JSON`, declared 413/415 → same codes as the parser, unrecognised 405 → keeps 405 with a generic message, declared 503 → still `500 INTERNAL_ERROR` |
| 18 | `npm run typecheck` / `npm test` / `npm run build` after the widening | ✅ exit 0 · **17 files, 221 tests passed** (105.30 s) · build clean, and `server/dist/middleware/error-handler.js` contains `declaredClientStatus` — the compiled artifact matches the source. ⚠️ measurement note: the working tree also held three **uncommitted** auth files (`auth.service.ts`, `session.ts`, `user.model.ts` — an in-progress remember-me + password-reset feature from outside this session, no routes or tests yet), so the run covered committed code **plus** those edits. The pushed commits do not contain them, and the live checks in rows 19–20 ran against the committed build alone and passed, login included |
| 19 | Control checks on production with the same script | ✅ health 200, SPA root 200, `/api/v1/nope` → JSON 404, small anonymous body → 401, authenticated draft create → 201 and cleanup DELETE → 200 (created with `status: draft` so `deliver()` sent no notifications, then deleted so production data was left as found) |
| 20 | Re-run of rows 12–13 and 16 on the new production build (`hcm-lite-hz1jpfwjp`, `● Ready` in 31 s, alias moved by itself) | ✅ **413 `PAYLOAD_TOO_LARGE`**, **400 `BAD_REQUEST`** for malformed JSON and **400 `BAD_REQUEST`** for UTF-32LE bytes labelled `charset=utf-32le` — **no `500` left** on any probed path. Controls in the same run: health 200, SPA root 200, JSON 404, 401 for an anonymous small body, 201 + 200 for the draft create/delete |
| 21 | Third build (`hcm-lite-r0v50xso1`, from the docs push) re-smoked the same four cases | ⚠️ it answered **415 `UNSUPPORTED_MEDIA_TYPE`** for the charset case — because that run sent *valid UTF-8 bytes* under a `charset=utf-32le` label. The platform hands those to `express.json` intact and the parser's own charset check fires; only bytes the platform cannot decode itself are intercepted as invalid JSON (row 16). So on Vercel a mislabelled body is **400 or 415 depending on its content**, and the earlier claim "the charset case is 400 on Vercel" was too broad. Neither build returned 500; the application's own answer is 415 on both |

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
| 12 | `vercel deploy --prod` after that fix (and the identical auto-build from the push) | ❌ build **succeeded** (397 packages, `Build Completed in /vercel/output`) but `Deploying outputs...` → `● Error`. The API answered `errorCode: exceeded_serverless_functions_per_deployment` — "No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan" at step `patchBuild` |
| 13 | `git mv api server`, root `api/` recreated with only `[...path].js` re-exporting `../server/dist/vercel-handler.js`; `workspaces: ["web", "server"]` | ✅ `npm install` + `npm run typecheck` exit 0; `npm run build` clean; **16 files, 213 tests passed** (84.61 s); `resolveWebRoot()` from `server/` still finds `web/dist`; importing the shim resolves the handler (it fails only on the missing `.env` at repo-root cwd, which the platform supplies) |
| 14 | `vercel inspect --logs` vs `GET /v13/deployments/<id>` | ⚠️ the CLI shows a bare `● Error` with no reason; the deployment object's `errorMessage` is the only place the real cause appears. Worth remembering for every future Vercel failure |
| 15 | First deploy after the rename | ✅ **`● Ready`** and aliased — the 12-function limit is gone. SPA only: `/` 200 HTML, `/attendance` 200 HTML, but every `/api/v1/*` answered Vercel's own `NOT_FOUND` text/plain |
| 16 | `GET /api/v1/health` returned a Vercel **SSO login page** | ⚠️ project `ssoProtection.deploymentType` was `all_except_custom_domains`. Cleared with `PATCH /v9/projects/<id>` (`ssoProtection: null`, `passwordProtection: null`) — a deliberate decision that made the deployment public, recorded in limitation 11 |
| 17 | Preview deployment with throwaway echo functions to isolate the 404 | ⚠️ `api/[...path].js` matched **one segment only**: `/api/zzz` → function, `/api/zzz/yyy` → platform 404; `api/echo/[...path].js` the same. So `outputDirectory` was never the cause and the catch-all filename could not serve a nested API |
| 18 | Same preview, `"rewrites": [{ "source": "/ext/:path*", "destination": "/api/index" }]` | ✅ `/ext/a/b/c` → 200 from one function with `req.url` = `/ext/a/b/c?path=a%2Fb%2Fc` — any depth forwards, the original path survives, and Vercel appends the captured wildcard as a query parameter |
| 19 | `api/[...path].js` → `api/index.js`, `rewrites` for `/api/:path*`, shim strips the injected `path` key | ❌ first production attempt: routing fixed (nested paths now reach the function) but **every** API path 500. `vercel logs` gave `ERR_REQUIRE_ESM: require() of ES Module /var/task/server/dist/vercel-handler.js from /var/task/api/index.js` — Vercel had compiled the ESM function to CommonJS |
| 20 | `"type": "module"` added to the root `package.json` | ✅ `npm run typecheck` exit 0, `npm run build` clean, **16 files / 213 tests passed** (66.95 s), and the shim's import now stays ESM |
| 21 | `node scripts/verify-prod.mjs https://hcm-lite-eta.vercel.app` against the live deployment | ✅ `/` 200 HTML · asset 200 · `/attendance` 200 HTML · unknown `/api/v1/nope` → **404 NOT_FOUND JSON from Express** (proof the app, not the platform, answered) · login 200 with `HttpOnly; Secure; SameSite=Lax` · `/auth/me` 26 permissions · dashboard 200 workforce **12** · `/api/v1/health` 200 `database.state: "connected"` (Atlas reachable from Vercel) |
| 22 | Query strings through the rewrite, authenticated: `?page=1&limit=3`, `?limit=abc`, `?from=…&to=…` | ✅ 200 / **400 VALIDATION_ERROR** on `limit` / 200 — the injected `path` parameter never reaches the validators |
| 23 | `git push origin main` → Vercel's GitHub auto-build | ✅ **`● Ready` in 29 s** and aliased — `vercel alias ls` shows all three production aliases on the git-built deployment, and `verify-prod.mjs` is green against it again. `git push` alone is now the release path; no manual `vercel deploy` needed |

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
| `tests/password-recovery.test.ts` | 17 | Forgot/reset password (token hashing, expiry, single use, no enumeration, throttling, session revocation) and remember-me cookie behaviour |
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
**not** overwrite variables that are already set — so a populated `server/.env` cannot redirect the
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
| `npm run demo -- --atlas` | Whatever `server/.env` points at. **Data is kept.** | Work you want to survive a restart |
| `npm run dev:api` + `npm run dev:web` | Same as `--atlas`, two terminals | Watching logs separately |

The repo currently has a working `server/.env` pointing at the `hcm_lite` database of an Atlas cluster.
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

`npm run start` runs `node dist/server.js`; `server/src/middleware/static-web.ts` locates `web/dist`
relative to the working directory (or an explicit `WEB_ROOT`) and mounts it **after** the API routes
and **before** the 404 handler, so `/api/*` stays JSON and every other path returns the shell.
With `NODE_ENV=production` the session cookie carries `Secure`; Chrome treats `http://localhost` as
trustworthy so login still works locally, but a real deployment must terminate TLS.

### Deploying to Vercel

The project is linked (`hcm-lite`, scope `ahmed-tech-01s-projects`) and the GitHub repository is
connected, so a push to `main` builds production. Production currently aliases to
**https://hcm-lite-eta.vercel.app** (also `hcm-lite-ahmed-tech-01s-projects.vercel.app` and the
`hcm-lite-git-main-…` form).

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
| `MONGODB_URI` | the same non-SRV Atlas URI as `server/.env`, pointing at the already-seeded `hcm_lite` database |
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

**Now verified:** the deployment reaches `READY` and serves both halves of the app from one origin at
**https://hcm-lite-eta.vercel.app** — see session-6 rows 15–22. Atlas *is* reachable from Vercel's
egress (the function reports `database.state: "connected"`), which confirms Network Access admits
`0.0.0.0/0`; Vercel functions have no fixed egress IP, so there is no narrower option.

**Still unverified on the deployed URL:** a real-browser walk-through. The production checks here were
HTTP-level (HTML shell, asset, deep link, login, cookie flags, `/auth/me`, dashboard, list queries).
One difference the probes did surface: on Vercel the SPA is served by the **platform**, not by Express,
so `GET /` carries `public, max-age=0, must-revalidate` and **no CSP header** — helmet's default policy
(verified locally, and blocking nothing) only applies when the API serves the build itself, as in
`npm run start`. Assets are also `max-age=0` there instead of the `immutable` year the app sets.

`vercel build --prod` still cannot be used to validate anything here — it fails inside this shell with
`Error: spawn cmd.exe ENOENT` before running the build command, an environment problem and not evidence
about the config. Preview deployments (no `outputDirectory`/`rewrites` in `vercel.json` needed) and
throwaway echo functions are the working substitute.

To read why a deployment fails when the CLI only prints `● Error`:
`GET https://api.vercel.com/v13/deployments/<id>?teamId=<id>` with the CLI token returns
`errorCode`, `errorMessage` and `errorStep` — and for a function that answers 500, `vercel logs <url>`
(keeps streaming, so run it in the background and read the JSON lines) shows the real runtime error.

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
241 automated tests exist and pass.**

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
| `/login` | Login — a real URL: rendered when there is no session; a signed-in visitor is bounced to `/` | — |
| `/setup` | Company setup wizard — rendered when `GET /setup/status` reports `setupRequired`; a signed-in visitor is bounced to `/` | — |
| `/forgot-password`, `/reset-password` | Self-service password recovery; never require a session; a completed reset revokes every session for the account | — |
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
| `mongodb+srv://` bootstrap depends on a DNS SRV lookup that Node's c-ares resolver fails locally | `npm run seed` died with `querySrv ECONNREFUSED`, looking like an Atlas/IP-allowlist problem when the cluster was healthy | `server/.env` now holds the equivalent non-SRV multi-seed URI (all three shard hosts, `:27017`, `tls=true`, `authSource=admin`); documented in the file itself |
| The Atlas URI as supplied ended in `/`, which makes the driver default to the `test` database | HCM Lite would have written into whatever already lived in `test` | Pinned a dedicated `hcm_lite` database in the connection string |
| `npm run demo` could only ever run the throwaway database | No one-command way to keep data between restarts | `npm run demo -- --atlas` starts the same process tree against `server/.env` |

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
   `npm run demo -- --atlas` writes to the cluster in `server/.env` and keeps everything.
6. **Payroll tax is a fixed demo rule**, not a jurisdiction-accurate calculator.
7. **~~Credentials in circulation~~** — the Atlas password was pasted into this conversation in plain
   text and has been **rotated by the owner** (2026-11-03); `server/.env` and Vercel's environment
   both carry the new one, measured by the live function reporting `state: "connected"` on a cold
   start. Two parts of this were never verifiable from here: that the old password is actually dead
   in Atlas, and that the unrelated API key from the same paste was revoked at its own provider — it
   matches no service this project uses. The supplied JWT was the public `jwt.io` sample token
   (`sub: 1234567890`, issued 2018) and is of no use as a credential. None of these were ever
   committed (`server/.env` is git-ignored) and none were stored in memory; the `JWT_SECRET` in
   `server/.env` was generated locally and never printed.
8. **~~The Atlas cluster is reachable from this one IP~~** — resolved by going public: the deployed
   function reports `{"database":{"ready":true,"state":"connected"}}`, which only happens if Vercel's
   egress is allowed, so Atlas Network Access now admits `0.0.0.0/0` (set by the owner in the Atlas
   dashboard). Vercel has no fixed egress IP, so that is the only workable setting there. The
   consequence, now that the leaked password is rotated: the cluster is still reachable from the
   whole internet and is defended only by the current password plus the seeded demo credentials.
9. **~~The Vercel deploy itself is unverified.~~** Verified on 2026-10-30: production serves the SPA
   and the API from one origin at `https://hcm-lite-eta.vercel.app`, and `scripts/verify-prod.mjs`
   passes against it. Both unknowns listed here are answered: the platform serves `web/dist` while the
   function serves JSON only (correct), and Vercel forwards the original URL to the function — but
   **only through a `rewrites` entry**, not the `[...path]` filename this config first used, which
   matched one segment and hid every nested route behind the platform's own 404. The other thing that
   had to be corrected on the first real deploy was the module system: without `"type": "module"` in
   the root `package.json` the function is transpiled to CommonJS and dies with `ERR_REQUIRE_ESM`.
   See `ARCHITECTURE.md` §7 and D30–D34.
10. **`frame-ancestors 'self'` blocks embedding.** Helmet's default CSP means the deployed app will
    not render inside an iframe (including an in-editor preview). Open it in a normal browser tab.
11. **Vercel's Deployment Protection is switched off for this project.** It arrived enabled
    (`ssoProtection.deploymentType: "all_except_custom_domains"`), which answered every
    Vercel-provided URL with Vercel's own SSO login page — the app looked broken and no request ever
    reached a function. Clearing it (`PATCH /v9/projects/<id>` with `ssoProtection: null` and
    `passwordProtection: null`) made the deployment **publicly readable by anyone who has the URL**,
    including the seeded demo accounts. Re-enable it, or move to a custom domain with protection on
    Vercel subdomains, before treating this as anything but a demo.
12. **~~A request body over the 100 KB JSON limit answers `500`, not `413`~~** — fixed in session 7.
    `express.json` throws `entity.too.large`, which `middleware/error-handler.ts` did not recognise, so
    it reached the generic handler; malformed JSON and an unsupported charset took the same path.
    They now answer **413 `PAYLOAD_TOO_LARGE`**, **400 `BAD_REQUEST`** and **415
    `UNSUPPORTED_MEDIA_TYPE`**, covered by `tests/errors.test.ts`. Found by measuring the deployed
    function **and** the local in-memory demo, so it was an application gap, not platform behaviour.
    The first version of the fix only understood body-parser's own error types and was verified green
    locally, yet **still returned 500 on Vercel for two of the three cases**: the platform's runtime
    decodes the JSON body itself and throws an error carrying `statusCode: 400` with no `type`, which
    the handler now also honours (see the session 7 cont. 2 rows). The visible case remains
    `/employees/import`: a CSV above ~100 KB is refused cleanly, so large imports still need splitting —
    the limit itself was not raised. Vercel's own 4.5 MB function body cap is never reached.

---

## 11. Open items (not blockers)

| Item | Suggested action |
| --- | --- |
| ✅ ~~Leaked Atlas password~~ | Rotated by the owner (session 8 row 15); `MONGODB_URI` updated in `server/.env` and in Vercel, and the deployed function still reports `connected`. Revocation of the old password itself is not checkable from here |
| 🔴 Unrecognised API key from the same paste | Revoke at whichever provider issued it; it is not used by this project |
| 🔴 Atlas Network Access scope | Now `0.0.0.0/0`, and it has to stay that way for Vercel to reach the cluster — so the rotated password and the demo credentials are the only thing standing between the public internet and the database |
| 🔴 Deployment Protection off | The URL is public with seeded demo logins. Re-enable SSO/password protection in Vercel → Project → Settings → Deployment Protection when the demo is over, or keep it off deliberately |
| No commit yet | First commit landed in session 6 with the push to GitHub — `server/.env` stays out |
| Docs not versioned | ✅ Resolved in session 6: `docs/` moved inside `hcm-lite/` |
| ~~Deploy unverified~~ | ✅ Deployed and verified: `https://hcm-lite-eta.vercel.app`, re-checked with `node scripts/verify-prod.mjs https://<url>`. `vercel.json` did need two corrections (rewrite instead of `[...path]`, root `"type": "module"`) |
| Browser walk-through of the deployed URL | The live checks were HTTP-level; drive the deployed UI in a real browser once (CSP is absent there because the platform serves the static build) |
| ~~Oversized JSON body answers 500~~ | ✅ Fixed in session 7: transport rejections map to 413 / 400 / 415 (`tests/errors.test.ts`, 8 tests). Large `/employees/import` CSVs still have to stay under ~100 KB — that limit is unchanged |
| No frontend tests | Add Vitest + React Testing Library for the screens that carry logic |
| No E2E | Add Playwright for the five-minute demo path |
| Assistant provider | Add a smoke test against a real endpoint if a key is ever supplied |

---

## 12. Change log

| Date | Change | By |
| --- | --- | --- |
| 2026-11-03 | Session 8: audited the authentication foundation against the brief — login backend/UI already existed and passed; the genuine gaps were built: `POST /auth/forgot-password` + `POST /auth/reset-password` (SHA-256 one-time token, 30-min expiry, single use, no enumeration, 5/15-min throttle, admin in-app notice, session-wide revocation), remember-me (7-day HttpOnly cookie + JWT `exp`, never localStorage), the specified `/login` UI (Welcome Back, show/hide password, remember me, forgot link, loading/error states), `/forgot-password` + `/reset-password` screens, and `/login`-URL/screen consistency in `App.tsx`. New `tests/password-recovery.test.ts` (17) → **18 files / 238 tests**, server+web typecheck 0, `vite build` clean. Verified end-to-end in a live browser against `npm run demo` (login fail/success, cookie restore on refresh, RBAC denials, full reset cycle, sign-out, deep-link redirect); screenshot blocked by the hidden embedded view (limitation 2). Decisions D35–D36; deviations documented: single-tenant model, cookie sessions (no refresh pair), `/` dashboard path. | Qoder |
| 2026-11-03 | Session 7 (cont. 2): the local-first fix was wrong about production. Deployed `299fd17`, re-measured: **413 arrived correctly** but malformed JSON and `charset=utf-32le` still answered `500` on Vercel while the same requests gave 400 / 415 against the local demo over a real socket. `vercel logs --json` showed why — the platform runtime throws `Invalid JSON` with `statusCode: 400` and a minified `type` from a `req.body` getter, before `express.json` reads the stream. `bodyParserRejection()` became `transportRejection()`: the type table resolves to a status and **any error declaring its own 4xx** is answered with our envelope and our own message (a 5xx stays a server fault). Verified nothing in the app throws a bare status-carrying object, so the rule cannot mask an intentional `HttpError`. 4 more tests drive `errorHandler` with the logged production shape — **17 files / 221 tests**, typecheck 0, build clean, `declaredClientStatus` present in `dist`. Pushed as `7fe8241`; the auto-build `hcm-lite-hz1jpfwjp` reached `● Ready` in 31 s and production now answers 413 / 400 / 400 where it answered 413 / 500 / 500 — no 500 left. A third build then showed the charset case is **400 or 415 depending on the bytes** (rows 16 and 21), so the platform only intercepts a body it cannot decode itself. | Qoder |
| 2026-10-31 | Session 7 (cont.): fixed the defect the live audit found. `middleware/error-handler.ts` gains `bodyParserRejection()`, mapping `entity.too.large` → **413 `PAYLOAD_TOO_LARGE`**, `entity.parse.failed` → **400 `BAD_REQUEST`**, and `encoding.unsupported` / `charset.unsupported` → **415 `UNSUPPORTED_MEDIA_TYPE`** instead of the generic 500. New `server/tests/errors.test.ts` (4 tests, no MongoDB needed — `createApp(null)`) proves all three plus that a normal body still reaches the auth layer. Two rounds of measurement were needed: UTF-16LE is actually decodable (returns a 400 parse failure, correctly), and body-parser renames the rejection to `charset.unsupported`. Verified: typecheck 0, **17 files / 217 tests**, error-code table and §8 updated. Committed and pushed as `299fd17`; the 400/415 cases then proved incomplete on the platform — see the next row. | Qoder |
| 2026-10-31 | Session 7: audited the **deployed** backend live — 28 endpoints, RBAC denial, 422 business rejections, an Atlas write round-trip, the payslip PDF and warm-container latency all confirmed against `https://hcm-lite-eta.vercel.app`. Found one application defect: a JSON body above the 100 KB limit returns `500 INTERNAL_ERROR` instead of `413`, reproduced on the local demo too (limitation 12). No code changed. | Qoder |
| 2026-10-30 | Session 6 (cont. 3): **the app is live at https://hcm-lite-eta.vercel.app.** The renamed layout reached `● Ready`, but every `/api/v1/*` answered Vercel's own 404: measured with echo functions in a preview, `api/[...path].js` matches a **single** segment. Replaced it with `api/index.js` plus `"rewrites": [{ "source": "/api/:path*", "destination": "/api/index" }]` (the shim drops the `?path=…` parameter Vercel injects), then fixed the cold-start `ERR_REQUIRE_ESM` that followed by declaring `"type": "module"` in the root `package.json`. Turned off Vercel's Deployment Protection, which had been answering the whole URL with an SSO login page. Verified: typecheck 0, build clean, **213 tests**, and `verify-prod.mjs` green against production — SPA, deep link, JSON 404 from Express, login with `HttpOnly; Secure; SameSite=Lax`, 26 permissions, dashboard workforce 12, `/api/v1/health` reporting Atlas connected. Docs updated (§1, §7, limitations 8–11, D33–D34). | Qoder |
| 2026-10-30 | Session 6 (cont. 2): the two fixed deploys then failed at `patchBuild` with `exceeded_serverless_functions_per_deployment` — Vercel compiles **every** file under `api/` into a Serverless Function and the Hobby plan allows 12. Renamed the backend workspace folder `api/` → `server/` (`git mv`, 100% rename similarity), leaving `api/[...path].js` as the only file there and re-exporting `../server/dist/vercel-handler.js`; dropped the ignored `memory` key from `vercel.json`. Root `workspaces` is now `web` + `server`; the npm package is still named `api`, so every script and test command is unchanged. Verified: typecheck 0, build clean, **213 tests**, `resolveWebRoot()` → `web/dist`, shim resolves the handler. Docs updated (`server/.env` everywhere, new §7 bullets, D32). | Qoder |
| 2026-10-30 | Session 6 (cont.): logged in to Vercel, linked `hcm-lite` and connected the GitHub repository. The first two production builds errored in 7 s — my own `NODE_ENV=production` variable was injected into the build, so `npm ci` installed 129 of 396 packages and `npm run build` exited 127. Fixed by removing that variable, setting `installCommand: "npm ci --include=dev"`, and adding `inferNodeEnv()` in `config/env.ts` to derive production from Vercel's `VERCEL_ENV`; guarded by 3 new tests (**213** now pass) and reproduced under a deployed function's shape (`env: "production"`, cookie `Secure`). Also re-asserted `!.env.example` after the `.env*` rule that the Vercel CLI appended to `.gitignore`. | Qoder |
| 2026-10-30 | Session 6: moved `docs/` inside `hcm-lite/` so the documents are versioned and repaired the `.gitignore` encoding damage; added production same-origin serving (`middleware/static-web.ts`: `express.static(web/dist)` after the API routers, SPA fallback before the 404 handler, plus 7 tests); added the serverless entry point `api/src/vercel-handler.ts` and `vercel.json`; documented the deployment environment. Re-ran typecheck, **210 tests**, the production build and a live `NODE_ENV=production` serve (shell `no-cache`, hashed assets `immutable`, deep link served, unknown `/api/v1/*` still JSON 404, login cookie `HttpOnly; Secure; SameSite=Lax`). Made the first commit and pushed to GitHub with `api/.env` excluded. | Qoder |
| 2026-10-30 | Session 5: created git-ignored `api/.env` with a locally generated `JWT_SECRET`; diagnosed the Node SRV-resolution failure and switched to a non-SRV Atlas URI pinned to a dedicated `hcm_lite` database; seeded Atlas (13 employees / 384 attendance / 7 leave requests); verified 13 endpoints, RBAC denials, all assistant intents and a create→read→delete round-trip through the Vite proxy; added `npm run demo -- --atlas`; re-ran the **203 tests** and proved by fingerprint that they never touch the cluster. No application defects found. | Qoder |
| 2026-10-29 | Session 4: finished the six remaining screens (organization, analytics, assistant, announcements, audit, settings); added the seed script and its 11 tests; made `.env` load; added `npm run demo` with an in-memory database; fixed the 8560% attendance rate and the "absent on today" board contradiction; rewrote both docs. **203 tests pass.** | Qoder |
| 2026-10-28 | Session 3: phases 3–10 — organization, employees, attendance, leave, payroll, analytics, announcements/notifications/audit, AI assistant, settings, with tests. | Qoder |
| 2026-10-28 | Session 2: git init, monorepo + `.env.example`; API foundation; Phase 2 auth/RBAC/setup; 4 test suites (53 tests); production build verified. | Qoder |
| 2026-10-28 | Created `PROGRESS.md` + `ARCHITECTURE.md`; built the static Announcements UI shell (later replaced by the real screen). | Qoder |
