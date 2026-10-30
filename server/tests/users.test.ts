import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { UserModel } from '../src/modules/auth/user.model.js'

describe('Account administration', () => {
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

  it('deactivates an account and kills its live session immediately', async () => {
    const hr = await createUser({ email: 'hr@saylani.test', role: 'hr' })
    const hrAgent = await loginAs(app, 'hr@saylani.test')
    const admin = await loginAs(app, ADMIN.email)

    const res = await admin.patch(`/api/v1/users/${hr._id}/status`).send({ status: 'inactive' })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('inactive')

    const afterDeactivation = await hrAgent.get('/api/v1/auth/me')
    expect(afterDeactivation.status).toBe(403)
    expect(afterDeactivation.body.error.code).toBe('ACCOUNT_INACTIVE')
  })

  it('refuses to let an admin deactivate themselves', async () => {
    const admin = await loginAs(app, ADMIN.email)
    const self = await UserModel.findOne({ email: ADMIN.email })

    const res = await admin.patch(`/api/v1/users/${self?._id}/status`).send({ status: 'inactive' })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('UNPROCESSABLE')
  })

  it('refuses deactivation by an HR account', async () => {
    const adminUser = await UserModel.findOne({ email: ADMIN.email })
    await createUser({ email: 'hr@saylani.test', role: 'hr' })
    const hr = await loginAs(app, 'hr@saylani.test')

    const res = await hr.patch(`/api/v1/users/${adminUser?._id}/status`).send({ status: 'inactive' })

    expect(res.status).toBe(403)
  })

  it('resets a password, forcing a change and revoking old sessions', async () => {
    const hr = await createUser({ email: 'hr@saylani.test', role: 'hr' })
    const oldSession = await loginAs(app, 'hr@saylani.test')
    const admin = await loginAs(app, ADMIN.email)

    const res = await admin.post(`/api/v1/users/${hr._id}/reset-password`)
    expect(res.status).toBe(200)

    const temporaryPassword = res.body.data.temporaryPassword as string
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(10)
    expect(res.body.data.user.mustChangePassword).toBe(true)

    // The session that existed before the reset is dead.
    expect((await oldSession.get('/api/v1/auth/me')).status).toBe(401)

    // The new password works and still demands a change.
    const renewed = await loginAs(app, 'hr@saylani.test', temporaryPassword)
    const me = await renewed.get('/api/v1/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.user.mustChangePassword).toBe(true)
  })

  it('returns 404 when resetting an unknown account', async () => {
    const admin = await loginAs(app, ADMIN.email)

    const res = await admin.post('/api/v1/users/64b7f9f2f1f1f1f1f1f1f1f1/reset-password')
    expect(res.status).toBe(404)
  })
})