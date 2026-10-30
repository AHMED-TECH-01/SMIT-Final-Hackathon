import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, COMPANY, companyCount, userCount } from './helpers/factory.js'

function setCookies(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []
}

describe('Functionality 01 — first-run company setup', () => {
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
  })

  it('reports setup as required on an empty database', async () => {
    const res = await request(app).get('/api/v1/setup/status')

    expect(res.status).toBe(200)
    expect(res.body.data.setupRequired).toBe(true)
  })

  it('creates the company, the admin, and signs them in', async () => {
    const res = await request(app)
      .post('/api/v1/setup')
      .send({ ...COMPANY, admin: ADMIN })

    expect(res.status).toBe(201)
    expect(res.body.data.user.email).toBe(ADMIN.email)
    expect(res.body.data.user.role).toBe('admin')
    expect(res.body.data.company.name).toBe(COMPANY.companyName)
    expect(res.body.data.setupRequired).toBe(false)
  })

  it('issues a HttpOnly session cookie', async () => {
    const res = await request(app)
      .post('/api/v1/setup')
      .send({ ...COMPANY, admin: ADMIN })

    const cookies = setCookies(res)
    expect(cookies.some((c) => c.startsWith('hcm_session='))).toBe(true)
    expect(cookies.join(';')).toMatch(/HttpOnly/i)
    expect(cookies.join(';')).toMatch(/SameSite=Lax/i)
  })

  it('never returns the password hash', async () => {
    const res = await request(app)
      .post('/api/v1/setup')
      .send({ ...COMPANY, admin: ADMIN })

    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain('passwordHash')
    expect(serialized).not.toContain(ADMIN.password)
    expect(serialized).not.toContain('tokenVersion')
  })

  it('persists exactly one company and one user', async () => {
    await request(app)
      .post('/api/v1/setup')
      .send({ ...COMPANY, admin: ADMIN })

    expect(await companyCount()).toBe(1)
    expect(await userCount()).toBe(1)
  })

  it('reports setup as complete afterwards', async () => {
    await request(app)
      .post('/api/v1/setup')
      .send({ ...COMPANY, admin: ADMIN })

    const res = await request(app).get('/api/v1/setup/status')
    expect(res.body.data.setupRequired).toBe(false)
  })

  it('refuses a second setup attempt with 409 (no second admin)', async () => {
    await request(app)
      .post('/api/v1/setup')
      .send({ ...COMPANY, admin: ADMIN })

    const res = await request(app)
      .post('/api/v1/setup')
      .send({
        ...COMPANY,
        admin: { fullName: 'Attacker', email: 'attacker@evil.test', password: 'An0therPassw0rd!' },
      })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(await userCount()).toBe(1)
  })

  it('rejects a weak admin password with 422 and creates nothing', async () => {
    const res = await request(app)
      .post('/api/v1/setup')
      .send({ ...COMPANY, admin: { ...ADMIN, password: 'weak' } })

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('UNPROCESSABLE')
    expect(await companyCount()).toBe(0)
  })

  it('rejects invalid input with 400 and field details', async () => {
    const res = await request(app)
      .post('/api/v1/setup')
      .send({ companyName: 'X', contactEmail: 'not-an-email', admin: {} })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(res.body.error.details)).toBe(true)
    expect(await companyCount()).toBe(0)
  })

  it('leaves the new admin able to use their session immediately', async () => {
    const agent = request.agent(app)
    await agent.post('/api/v1/setup').send({ ...COMPANY, admin: ADMIN })

    const me = await agent.get('/api/v1/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.data.user.email).toBe(ADMIN.email)
  })
})
