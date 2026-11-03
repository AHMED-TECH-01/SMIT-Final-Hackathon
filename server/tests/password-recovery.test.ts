import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { REMEMBER_ME } from '../src/modules/auth/session.js'
import { UserModel } from '../src/modules/auth/user.model.js'

/**
 * The two auth additions of this session:
 *  • self-service password recovery (forgot → reset with a one-time token)
 *  • "remember me", which is a longer HttpOnly cookie — nothing else.
 */
describe('Password recovery and remember-me sessions', () => {
  let app: Express

  beforeAll(async () => {
    await startTestDb()
    app = createApp()
  })
  afterAll(async () => {
    await stopTestDb()
  })
  beforeEach(async () => {
    await clearTestDb()
    resetLoginRateLimit()
    await bootstrapCompany(app)
  })

  const forgot = (email: string) =>
    request(app).post('/api/v1/auth/forgot-password').send({ email })

  describe('forgot-password', () => {
    it('issues a reset token for a known active account (dev mode)', async () => {
      const res = await forgot(ADMIN.email)

      expect(res.status).toBe(200)
      expect(res.body.data.devResetToken).toBeTruthy()
      expect(res.body.data.devResetToken.length).toBeGreaterThanOrEqual(32)

      const user = await UserModel.findOne({ email: ADMIN.email }).select('+resetTokenHash')
      expect(user?.resetTokenHash).toBeTruthy()
      // The stored value is a hash, never the token itself.
      expect(user?.resetTokenHash).not.toBe(res.body.data.devResetToken)
    })

    it('gives the same generic response for an unknown email — no enumeration', async () => {
      const known = await forgot(ADMIN.email)
      const unknown = await forgot('nobody@saylani.test')

      expect(unknown.status).toBe(200)
      expect(unknown.body.data.message).toBe(known.body.data.message)
      expect(unknown.body.data.devResetToken).toBeUndefined()
    })

    it('does not issue a token for a deactivated account', async () => {
      await UserModel.updateOne({ email: ADMIN.email }, { $set: { status: 'inactive' } })

      const res = await forgot(ADMIN.email)

      expect(res.status).toBe(200)
      expect(res.body.data.devResetToken).toBeUndefined()
    })

    it('rejects a malformed email with 400', async () => {
      const res = await forgot('not-an-email')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('throttles repeated requests for the same account with 429', async () => {
      // The limiter allows 5 per window.
      for (let i = 0; i < 5; i += 1) {
        expect((await forgot(ADMIN.email)).status).toBe(200)
      }

      const throttled = await forgot(ADMIN.email)
      expect(throttled.status).toBe(429)
      expect(throttled.body.error.code).toBe('RATE_LIMITED')
      expect(throttled.headers['retry-after']).toBeDefined()
    })
  })

  describe('reset-password', () => {
    const NEW_PASSWORD = 'N3wRecoveryPass!'

    const requestToken = async (email: string = ADMIN.email) => {
      const res = await forgot(email)
      const token = res.body.data.devResetToken as string
      if (!token) throw new Error('Expected a dev reset token in the response')
      return token
    }

    it('sets the new password and signs the old password out', async () => {
      const token = await requestToken()

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })

      expect(res.status).toBe(200)

      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: NEW_PASSWORD })
        .expect(200)

      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(401)
    })

    it('revokes every existing session for the account', async () => {
      const agent = await loginAs(app, ADMIN.email)
      expect((await agent.get('/api/v1/auth/me')).status).toBe(200)

      const token = await requestToken()
      await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200)

      expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
    })

    it('rejects an invalid token with the generic 422', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'x'.repeat(40), newPassword: NEW_PASSWORD })

      expect(res.status).toBe(422)
      expect(res.body.error.message).toMatch(/invalid or has expired/)
    })

    it('rejects an expired token with the same generic 422', async () => {
      const token = await requestToken()
      await UserModel.updateOne(
        { email: ADMIN.email },
        { $set: { resetTokenExpiresAt: new Date(Date.now() - 60_000) } },
      )

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })

      expect(res.status).toBe(422)
      expect(res.body.error.message).toMatch(/invalid or has expired/)
    })

    it('accepts the token only once', async () => {
      const token = await requestToken()

      await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(200)

      const reused = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'An0therPassw0rd!' })

      expect(reused.status).toBe(422)
    })

    it('rejects a weak new password with 422 and leaves the old one working', async () => {
      const token = await requestToken()

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'weak' })

      expect(res.status).toBe(422)

      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200)
    })

    it('rejects reusing the current password with 422', async () => {
      const token = await requestToken()

      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: ADMIN.password })

      expect(res.status).toBe(422)
    })

    it('never leaks the hash or the reset token through /auth/me', async () => {
      await requestToken()
      const agent = await loginAs(app, ADMIN.email)

      const res = await agent.get('/api/v1/auth/me')
      const body = JSON.stringify(res.body)

      expect(res.status).toBe(200)
      expect(body).not.toContain('passwordHash')
      expect(body).not.toContain('resetTokenHash')
      expect(body).not.toContain('tokenVersion')
    })
  })

  describe('remember me', () => {
    const cookieAttrs = (response: request.Response): string => {
      const raw = response.headers['set-cookie']
      const value = Array.isArray(raw) ? raw.join('; ') : String(raw ?? '')
      // Normalise so matching is independent of attribute order.
      return value.toLowerCase()
    }

    it('sets a 7-day HttpOnly cookie when remember is true', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password, remember: true })

      expect(res.status).toBe(200)
      const cookie = cookieAttrs(res)
      expect(cookie).toContain('httponly')
      expect(cookie).toContain(`max-age=${REMEMBER_ME.maxAgeMs / 1000}`)
    })

    it('keeps the 15-minute cookie when remember is absent or false', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })

      expect(res.status).toBe(200)
      expect(cookieAttrs(res)).toContain('max-age=900')
    })

    it('a remembered session is a normal authenticated session', async () => {
      const agent = request.agent(app)
      await agent
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password, remember: true })
        .expect(200)

      const res = await agent.get('/api/v1/auth/me')
      expect(res.status).toBe(200)
      expect(res.body.data.user.email).toBe(ADMIN.email)
    })

    it('still refuses a deactivated account with remember set', async () => {
      await createUser({ email: 'gone@saylani.test', role: 'employee', status: 'inactive' })

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'gone@saylani.test', password: ADMIN.password, remember: true })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ACCOUNT_INACTIVE')
    })
  })
})

/**
 * A plaintext reset token may only ever leave a process nobody else can reach.
 *
 * The trap: a Vercel *preview* deployment keeps `NODE_ENV` at its development
 * default, because only `VERCEL_ENV=production` flips it — so gating on `isProd`
 * alone would answer a stranger at a preview URL with a live token that resets
 * anyone's password. The gate is therefore the host marker. This is checked at
 * the module boundary because a unit test cannot reach a real preview URL.
 */
describe('A deployment never receives the plaintext reset token', () => {
  // `loadEnv()` writes the inferred NODE_ENV back into process.env, so the
  // simulated production case would otherwise leave the worker marked
  // production for whatever file runs next in it.
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env.NODE_ENV = originalNodeEnv
    vi.resetModules()
  })

  it('stays open on a local run', async () => {
    vi.resetModules()
    vi.stubEnv('VERCEL', '')

    const local = await import('../src/config/env.js')
    expect(local.isDeployed).toBe(false)
    expect(local.exposesResetToken).toBe(true)
  })

  it('closes on a preview deployment, where NODE_ENV still says development', async () => {
    vi.resetModules()
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'preview')

    const preview = await import('../src/config/env.js')
    expect(preview.isProd).toBe(false) // the condition a `isProd` gate would miss
    expect(preview.isDeployed).toBe(true)
    expect(preview.exposesResetToken).toBe(false)
  })

  it('closes on production as well', async () => {
    vi.resetModules()
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('VERCEL_ENV', 'production')

    // Asserted through the deployment marker rather than `isProd`, because
    // `loadEnv()` reads `server/.env` first and that file pins NODE_ENV on a
    // developer machine — an artifact of the laptop, not of any deployment.
    // The production inference itself has its own tests in the env suite.
    const production = await import('../src/config/env.js')
    expect(production.isDeployed).toBe(true)
    expect(production.exposesResetToken).toBe(false)
  })
})
