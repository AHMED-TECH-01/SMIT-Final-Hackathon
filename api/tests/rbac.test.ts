import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs, userCount } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { UserModel } from '../src/modules/auth/user.model.js'

describe('Authorization - RBAC and HR account provisioning', () => {
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

  describe('unauthenticated access', () => {
    it('rejects GET /users with 401', async () => {
      const res = await request(app).get('/api/v1/users')
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHENTICATED')
    })

    it('rejects POST /users with 401', async () => {
      const res = await request(app).post('/api/v1/users').send({
        email: 'x@y.test',
        fullName: 'X Y',
        role: 'hr',
        temporaryPassword: 'Str0ngPassw0rd!',
      })

      expect(res.status).toBe(401)
    })
  })

  describe('role boundaries', () => {
    it('denies an employee GET /users with 403 FORBIDDEN', async () => {
      await createUser({ email: 'employee@saylani.test', role: 'employee' })
      const agent = await loginAs(app, 'employee@saylani.test')

      const res = await agent.get('/api/v1/users')

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('denies HR GET /users with 403 - HR deliberately lacks user.read', async () => {
      await createUser({ email: 'hr@saylani.test', role: 'hr' })
      const agent = await loginAs(app, 'hr@saylani.test')

      const res = await agent.get('/api/v1/users')

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('denies HR POST /users with 403', async () => {
      await createUser({ email: 'hr@saylani.test', role: 'hr' })
      const agent = await loginAs(app, 'hr@saylani.test')

      const res = await agent.post('/api/v1/users').send({
        email: 'sneaky@saylani.test',
        fullName: 'Sneaky Hire',
        role: 'admin',
        temporaryPassword: 'Str0ngPassw0rd!',
      })

      expect(res.status).toBe(403)
      expect(await userCount()).toBe(2)
    })

    it('allows an admin GET /users and returns the total', async () => {
      await createUser({ email: 'hr@saylani.test', role: 'hr' })
      const agent = await loginAs(app, ADMIN.email)

      const res = await agent.get('/api/v1/users')

      expect(res.status).toBe(200)
      expect(res.body.meta.total).toBe(2)
      expect(res.body.data).toHaveLength(2)
    })

    it('never leaks password hashes or token versions through the user list', async () => {
      await createUser({ email: 'hr@saylani.test', role: 'hr' })
      const agent = await loginAs(app, ADMIN.email)

      const res = await agent.get('/api/v1/users')
      const serialized = JSON.stringify(res.body)

      expect(serialized).not.toContain('passwordHash')
      expect(serialized).not.toContain('tokenVersion')
      expect(serialized).not.toContain(ADMIN.password)
    })
  })

  describe('admin user provisioning', () => {
    const NEW_HR = {
      email: 'newhr@saylani.test',
      fullName: 'Fatima Noor',
      role: 'hr' as const,
      temporaryPassword: 'T4mpPassw0rd!',
    }

    it('creates the account, forces a password change, and reports permissions', async () => {
      const admin = await loginAs(app, ADMIN.email)

      const res = await admin.post('/api/v1/users').send(NEW_HR)

      expect(res.status).toBe(201)
      expect(res.body.data.user.email).toBe(NEW_HR.email)
      expect(res.body.data.user.role).toBe('hr')
      expect(res.body.data.permissions).toContain('employee.read')
      expect(res.body.data.permissions).not.toContain('audit.read')

      const stored = await UserModel.findOne({ email: NEW_HR.email })
      expect(stored?.mustChangePassword).toBe(true)
    })

    it('keeps the new account blocked until the password is replaced', async () => {
      const admin = await loginAs(app, ADMIN.email)
      await admin.post('/api/v1/users').send(NEW_HR).expect(201)

      const hr = await loginAs(app, NEW_HR.email, NEW_HR.temporaryPassword)

      const blocked = await hr.get('/api/v1/users')
      expect(blocked.status).toBe(403)
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')

      await hr
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: NEW_HR.temporaryPassword, newPassword: 'SettledPassw0rd!' })
        .expect(200)

      // The flag is cleared; what remains is a permission denial.
      const afterChange = await hr.get('/api/v1/users')
      expect(afterChange.status).toBe(403)
      expect(afterChange.body.error.code).toBe('FORBIDDEN')
    })

    it('rejects a duplicate email with 409, including a different casing', async () => {
      const admin = await loginAs(app, ADMIN.email)
      await admin.post('/api/v1/users').send(NEW_HR).expect(201)

      const duplicate = await admin
        .post('/api/v1/users')
        .send({ ...NEW_HR, email: 'NewHR@Saylani.TEST' })

      expect(duplicate.status).toBe(409)
      expect(duplicate.body.error.code).toBe('CONFLICT')
      expect(await userCount()).toBe(2)
    })

    it('rejects an unknown role with 400', async () => {
      const admin = await loginAs(app, ADMIN.email)

      const res = await admin.post('/api/v1/users').send({ ...NEW_HR, role: 'superuser' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects a malformed payload with field-level details', async () => {
      const admin = await loginAs(app, ADMIN.email)

      const res = await admin.post('/api/v1/users').send({ email: 'not-an-email' })

      expect(res.status).toBe(400)
      expect(Array.isArray(res.body.error.details)).toBe(true)
      expect(await userCount()).toBe(1)
    })
  })
})
