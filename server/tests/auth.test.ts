import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { UserModel } from '../src/modules/auth/user.model.js'

describe('Functionality 02 — authentication lifecycle', () => {
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

  describe('sign in', () => {
    it('accepts correct credentials and returns the user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })

      expect(res.status).toBe(200)
      expect(res.body.data.user.email).toBe(ADMIN.email)
      expect(res.body.data.user.role).toBe('admin')
    })

    it('is case-insensitive and trims the email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: '  ADMIN@Saylani.TEST ', password: ADMIN.password })

      expect(res.status).toBe(200)
    })

    it('rejects a wrong password with 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: 'Wr0ngPassw0rd!' })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHENTICATED')
    })

    it('rejects an unknown email with the same generic 401', async () => {
      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: 'Wr0ngPassw0rd!' })
      const unknownEmail = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@saylani.test', password: ADMIN.password })

      // Identical responses: no account enumeration.
      expect(unknownEmail.status).toBe(wrongPassword.status)
      expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message)
    })

    it('records the last login time', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })

      const user = await UserModel.findOne({ email: ADMIN.email })
      expect(user?.lastLoginAt).toBeInstanceOf(Date)
    })

    it('blocks a deactivated account with 403', async () => {
      await UserModel.updateOne({ email: ADMIN.email }, { $set: { status: 'inactive' } })

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ACCOUNT_INACTIVE')
    })
  })

  describe('session handling', () => {
    it('rejects /auth/me without a cookie', async () => {
      const res = await request(app).get('/api/v1/auth/me')
      expect(res.status).toBe(401)
    })

    it('rejects a tampered cookie', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', 'hcm_session=not.a.real.token')

      expect(res.status).toBe(401)
    })

    it('returns identity and effective permissions', async () => {
      const agent = await loginAs(app, ADMIN.email)
      const res = await agent.get('/api/v1/auth/me')

      expect(res.status).toBe(200)
      expect(res.body.data.permissions).toContain('user.read')
      expect(res.body.data.permissions).toContain('audit.read')
    })

    it('signs out and invalidates the cookie', async () => {
      const agent = await loginAs(app, ADMIN.email)
      expect((await agent.get('/api/v1/auth/me')).status).toBe(200)

      await agent.post('/api/v1/auth/logout').expect(200)

      expect((await agent.get('/api/v1/auth/me')).status).toBe(401)
    })

    it('rejects a live session once the account is deactivated', async () => {
      const agent = await loginAs(app, ADMIN.email)
      await UserModel.updateOne({ email: ADMIN.email }, { $set: { status: 'inactive' } })

      const res = await agent.get('/api/v1/auth/me')
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ACCOUNT_INACTIVE')
    })
  })

  describe('password change', () => {
    const NEW_PASSWORD = 'N3wSecurePass!'

    it('rejects an incorrect current password with 422', async () => {
      const agent = await loginAs(app, ADMIN.email)

      const res = await agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: 'Wr0ngPassw0rd!', newPassword: NEW_PASSWORD })

      expect(res.status).toBe(422)
    })

    it('rejects a weak new password with 422', async () => {
      const agent = await loginAs(app, ADMIN.email)

      const res = await agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: ADMIN.password, newPassword: 'weak' })

      expect(res.status).toBe(422)
    })

    it('rejects reusing the current password with 422', async () => {
      const agent = await loginAs(app, ADMIN.email)

      const res = await agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: ADMIN.password, newPassword: ADMIN.password })

      expect(res.status).toBe(422)
    })

    it('updates the password and the new one works', async () => {
      const agent = await loginAs(app, ADMIN.email)

      const res = await agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: ADMIN.password, newPassword: NEW_PASSWORD })

      expect(res.status).toBe(200)
      expect(res.body.data.message).toBe('Password updated.')

      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: NEW_PASSWORD })
        .expect(200)

      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(401)
    })

    it('revokes other sessions but keeps the current one signed in', async () => {
      const firstSession = await loginAs(app, ADMIN.email)
      const secondSession = await loginAs(app, ADMIN.email)

      await firstSession
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: ADMIN.password, newPassword: NEW_PASSWORD })
        .expect(200)

      // Changing password bumps tokenVersion, so the other session dies.
      expect((await secondSession.get('/api/v1/auth/me')).status).toBe(401)
      // The session that performed the change received a fresh token.
      expect((await firstSession.get('/api/v1/auth/me')).status).toBe(200)
    })
  })

  describe('forced password change', () => {
    it('blocks protected routes until the temporary password is replaced', async () => {
      await createUser({
        email: 'hr@saylani.test',
        role: 'hr',
        mustChangePassword: true,
      })
      const agent = await loginAs(app, 'hr@saylani.test')

      const blocked = await agent.get('/api/v1/auth/me')
      expect(blocked.status).toBe(200) // identity is still readable

      const beforeChange = await agent.get('/api/v1/users')
      expect(beforeChange.status).toBe(403)
      expect(beforeChange.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')

      await agent
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: ADMIN.password, newPassword: 'FreshPassw0rd!' })
        .expect(200)

      const user = await UserModel.findOne({ email: 'hr@saylani.test' })
      expect(user?.mustChangePassword).toBe(false)

      // HR still lacks user.read, so 403 — but for permission, not the flag.
      const afterChange = await agent.get('/api/v1/users')
      expect(afterChange.status).toBe(403)
      expect(afterChange.body.error.code).toBe('FORBIDDEN')
    })
  })

  describe('login rate limiting', () => {
    it('throttles repeated failures for the same account with 429', async () => {
      const attempt = () =>
        request(app)
          .post('/api/v1/auth/login')
          .send({ email: ADMIN.email, password: 'Wr0ngPassw0rd!' })

      // The limiter allows 10 attempts per window.
      for (let i = 0; i < 10; i += 1) {
        const res = await attempt()
        expect(res.status).toBe(401)
      }

      const throttled = await attempt()
      expect(throttled.status).toBe(429)
      expect(throttled.body.error.code).toBe('RATE_LIMITED')
      expect(throttled.headers['retry-after']).toBeDefined()
    })

    it('does not throttle an unrelated account from the same IP', async () => {
      for (let i = 0; i < 11; i += 1) {
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: ADMIN.email, password: 'Wr0ngPassw0rd!' })
      }

      const other = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'someone-else@saylani.test', password: 'Wr0ngPassw0rd!' })

      expect(other.status).toBe(401)
    })
  })
})
