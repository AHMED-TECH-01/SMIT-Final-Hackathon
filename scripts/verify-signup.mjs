#!/usr/bin/env node
/**
 * Drives the public sign-up story end to end against a running server: the landing page, the
 * sign-up page, `POST /api/v1/auth/register`, the session it establishes, and the closed door
 * afterwards.
 *
 *   npm run demo -- --empty          # in-memory MongoDB, no company, API on :4000 serving web/dist
 *   node scripts/verify-signup.mjs   # or: npm run verify:signup
 *
 * Two shapes of run, decided by `GET /setup/status`:
 *
 *  - `setupRequired: true`  → the whole walk, including a real registration. This is the only
 *    mode that creates anything, so point it at a throwaway database (`--empty`), never at a
 *    deployment with real data.
 *  - `setupRequired: false` → the read-only walk. It still POSTs once to prove the route exists,
 *    but on a database that already holds a company the unique `key: 'primary'` index makes a 201
 *    impossible: the request can only answer 404 (not deployed), 400 (validation) or 409 (closed).
 *    A 201 here is reported as a failure, because it would mean the tenancy guard is broken.
 *
 * The base URL is the first argument, or `CHECK_BASE`, and defaults to http://localhost:4000 —
 * the API serves the built frontend, so one origin is enough and the cookie stays first-party.
 */

const BASE = (process.argv[2] ?? process.env.CHECK_BASE ?? 'http://localhost:4000').replace(/\/$/, '')
const API = `${BASE}/api/v1`

/** Fixture data. Nothing here is a real account; the run only ever works on a disposable database. */
const REGISTRATION = {
  admin: {
    name: 'Verification Admin',
    email: 'signup.verify@example.com',
    phone: '+92 300 1234567',
    password: 'VerifyPassw0rd!',
    confirmPassword: 'VerifyPassw0rd!',
  },
  company: {
    name: 'Signup Verify Co',
    industry: 'Information Technology',
    companySize: '51-200',
    country: 'Pakistan',
    city: 'Karachi',
    email: 'it@signup-verify.example',
    phone: '+92 21 3456789',
  },
  acceptedTerms: true,
  acceptedPrivacyPolicy: true,
}

/** Strings the brief specifies. If the build dropped one, the pages are not the pages that were asked for. */
const REQUIRED_BUNDLE_TEXT = [
  'Smart HR Management for a Better Tomorrow',
  'Build a Better Workplace with HCM Lite',
  'Create Your Account',
  'Ready to Simplify Your HR Operations',
  '© 2026 HCM Lite',
]

let jar = ''
const results = []

function record(name, passed, detail) {
  results.push({ name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Adopt every Set-Cookie header, so a logout's expired cookie really does leave the jar. */
function adopt(setCookies) {
  for (const line of setCookies) {
    const [pair] = line.split(';')
    const index = pair.indexOf('=')
    const name = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    const entries = jar.split('; ').filter((entry) => entry && !entry.startsWith(`${name}=`))
    if (value) entries.push(`${name}=${value}`)
    jar = entries.join('; ')
  }
}

async function call(method, url, { body, useJar = true } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(useJar && jar ? { cookie: jar } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const text = await response.text()
  adopt(response.headers.getSetCookie())
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* HTML shell or a plain-text body */
  }
  return { status: response.status, headers: response.headers, text, json, setCookie: response.headers.getSetCookie() }
}

async function main() {
  console.log(`Verifying the public sign-up story against ${BASE}\n`)

  const health = await call('GET', `${API}/health`, { useJar: false })
  record('API is healthy', health.status === 200 && health.json?.data?.database?.ready === true, `${health.status}`)

  const statusBefore = await call('GET', `${API}/setup/status`, { useJar: false })
  const open = statusBefore.json?.data?.setupRequired === true
  console.log(`Mode: ${open ? 'unregistered database — the full walk will create a company' : 'already set up — read-only walk'}\n`)

  // The pages themselves. These are served by the same origin, so this is the built bundle being
  // checked, not a dev-server render.
  const home = await call('GET', `${BASE}/`, { useJar: false })
  const assetPath = /src="(\/assets\/[^"]+\.js)"/.exec(home.text)?.[1]
  record('GET / serves the SPA shell and its bundle', home.status === 200 && Boolean(assetPath), assetPath ?? 'no asset tag')

  const deepLink = await call('GET', `${BASE}/signup`, { useJar: false })
  record('GET /signup serves the shell (deep link, no session)', deepLink.status === 200 && deepLink.text.includes('<div id="root"'), `${deepLink.status}`)

  record('the shell carries the product title', /<title>HCM Lite — Smart HR Management/.test(home.text), home.text.match(/<title>[^<]*/)?.[0] ?? 'no title')

  const bundle = assetPath ? await call('GET', `${BASE}${assetPath}`, { useJar: false }) : null
  const missing = REQUIRED_BUNDLE_TEXT.filter((text) => !(bundle?.text ?? '').includes(text))
  record('the built bundle contains the specified page copy', Boolean(bundle) && missing.length === 0, missing.length ? `missing: ${missing.join(' | ')}` : `${REQUIRED_BUNDLE_TEXT.length} strings found`)

  if (!open) {
    // Only a probe. The unique company key makes a 201 impossible here; if one ever arrived, the
    // guard is broken and this run must fail loudly. Note that the probe itself spends one slot of
    // the 5-per-hour sign-up budget, so a 429 here means "the route exists and the budget is spent",
    // not "the duplicate was refused" — the detail prints the code so the difference stays visible.
    const probe = await call('POST', `${API}/auth/register`, { body: REGISTRATION, useJar: false })
    const deployed = probe.status !== 404
    record(
      'POST /auth/register is deployed and does not accept a second company',
      deployed && probe.status !== 201 && [400, 409, 422, 429].includes(probe.status),
      `${probe.status} ${probe.json?.error?.code ?? ''} ${probe.json?.error?.message ?? probe.text.slice(0, 60)}`,
    )
    if (!deployed) console.log('\n(The route is 404 because this build is not deployed yet — not a defect.)')
    return report(false)
  }

  record('setup is required before the first registration', statusBefore.json?.data?.setupRequired === true, `${statusBefore.status}`)

  // The validation matrix, before anything is created. The nested objects are sent empty rather than
  // omitted, because that is what makes Zod report each leaf (`admin.name`, `company.city`, …) — which
  // is the shape the sign-up form maps onto its fields.
  const empty = await call('POST', `${API}/auth/register`, {
    body: { admin: {}, company: {}, acceptedTerms: false, acceptedPrivacyPolicy: false },
    useJar: false,
  })
  const fields = (empty.json?.error?.details ?? []).map((detail) => detail.field)
  const expected = ['admin.name', 'admin.email', 'admin.phone', 'admin.password', 'company.companySize', 'acceptedTerms', 'acceptedPrivacyPolicy']
  record(
    'an empty submission is refused with dotted field paths',
    empty.status === 400 && empty.json?.error?.code === 'VALIDATION_ERROR' && expected.every((field) => fields.includes(field)),
    `${empty.status} ${fields.length} paths`,
  )

  const weak = await call('POST', `${API}/auth/register`, {
    body: { ...REGISTRATION, admin: { ...REGISTRATION.admin, password: 'Ab1', confirmPassword: 'Ab1' } },
    useJar: false,
  })
  record('a weak password is refused and nothing is created', weak.status === 422, `${weak.status} ${weak.json?.error?.message ?? ''}`)

  const remaining = empty.headers.get('x-ratelimit-remaining')
  record('the sign-up throttle advertises its budget', Number(remaining) >= 0, `X-RateLimit-Remaining=${remaining}`)

  // The happy path.
  const created = await call('POST', `${API}/auth/register`, { body: REGISTRATION, useJar: false })
  const sessionCookie = created.setCookie.find((line) => line.startsWith('hcm_session=')) ?? ''
  record(
    'a valid registration creates the company and its first administrator',
    created.status === 201 && created.json?.data?.company?.name === REGISTRATION.company.name && created.json?.data?.setupRequired === false,
    `${created.status} company=${created.json?.data?.company?.name} size=${created.json?.data?.company?.companySize} country=${created.json?.data?.company?.country}`,
  )
  record(
    'the role is server-assigned and no forged key survives',
    created.json?.data?.user?.role === 'admin' && created.json?.data?.user?.status === 'active' && !('companyId' in (created.json?.data?.user ?? {})),
    `role=${created.json?.data?.user?.role} mustChange=${created.json?.data?.user?.mustChangePassword}`,
  )
  record('a HttpOnly SameSite session cookie is set', /HttpOnly/i.test(sessionCookie) && /SameSite=Lax/i.test(sessionCookie), sessionCookie.slice(0, 90))
  record(
    'the response leaks no hash, token version or plaintext password',
    !/passwordHash|tokenVersion|resetToken/i.test(created.text) && !created.text.includes(REGISTRATION.admin.password),
    'no secret fields present',
  )

  const me = await call('GET', `${API}/auth/me`)
  record(
    'registration establishes a working session',
    me.status === 200 && me.json?.data?.user?.email === REGISTRATION.admin.email && me.json?.data?.permissions?.length === 26,
    `${me.status} permissions=${me.json?.data?.permissions?.length}`,
  )

  const settings = await call('GET', `${API}/settings/public`)
  record(
    'the new company name is served immediately (settings cache invalidated)',
    settings.status === 200 && settings.json?.data?.name === REGISTRATION.company.name,
    `${settings.status} name=${settings.json?.data?.name}`,
  )

  const audit = await call('GET', `${API}/audit-log?action=auth.register`)
  const entry = audit.json?.data?.items?.[0] ?? audit.json?.data?.[0]
  record(
    'the registration is recorded in the audit trail, with its author',
    audit.status === 200 && entry?.action === 'auth.register' && entry?.entity === 'company' && Boolean(entry?.actorEmail) && Boolean(entry?.actorId) && Boolean(entry?.ip),
    entry ? `actor=${entry.actorEmail}` : 'no entry',
  )

  const second = await call('POST', `${API}/auth/register`, {
    body: { ...REGISTRATION, admin: { ...REGISTRATION.admin, email: 'second.admin@example.com' }, company: { ...REGISTRATION.company, name: 'Second Company' } },
  })
  record(
    'a second company is refused, and the answer tells the visitor to sign in',
    second.status === 409 && /sign in/i.test(second.json?.error?.message ?? ''),
    `${second.status} ${second.json?.error?.code}: ${second.json?.error?.message ?? ''}`,
  )

  const statusAfter = await call('GET', `${API}/setup/status`, { useJar: false })
  record('setup is no longer required', statusAfter.json?.data?.setupRequired === false, `${statusAfter.status}`)

  const anonymous = await call('GET', `${API}/auth/me`, { useJar: false })
  record('protected data is unreachable without the cookie', anonymous.status === 401, `${anonymous.status}`)

  const login = await call('POST', `${API}/auth/login`, {
    body: { email: REGISTRATION.admin.email, password: REGISTRATION.admin.password },
    useJar: false,
  })
  const again = await call('GET', `${API}/auth/me`)
  record('the registered administrator can sign in again', login.status === 200 && again.status === 200, `login=${login.status} me=${again.status}`)

  const logout = await call('POST', `${API}/auth/logout`)
  const afterLogout = await call('GET', `${API}/auth/me`)
  record(
    'logout clears the session',
    logout.status === 200 && afterLogout.status === 401 && logout.setCookie.some((line) => line.startsWith('hcm_session=;')),
    `logout=${logout.status} me=${afterLogout.status} cookie=${logout.setCookie.join(' | ').slice(0, 60)}`,
  )

  return report(true)
}

function report(createdData) {
  const failures = results.filter((result) => !result.passed)
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`)
  if (failures.length) {
    console.log('FAILED:')
    for (const failure of failures) console.log(` - ${failure.name}: ${failure.detail}`)
    process.exitCode = 1
  } else if (createdData) {
    console.log(`Note: this run created a company in ${BASE}'s database and left it there.`)
  }
}

main().catch((error) => {
  console.error(`\nCould not run the walk: ${error.message}`)
  console.error('Is the server up? Try: npm run demo -- --empty')
  process.exitCode = 1
})
