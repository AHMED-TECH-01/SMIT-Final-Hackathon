import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'
import { zonedMinutesOfDay } from '../src/lib/dates.js'

const TIMEZONE = 'Asia/Karachi'

describe('settings', () => {
  let app: Express
  let admin: Awaited<ReturnType<typeof loginAs>>

  beforeAll(async () => {
    await startTestDb()
    app = createApp()
  })
  afterAll(async () => {
    await stopTestDb()
  })
  beforeEach(async () => {
    await clearTestDb()
    invalidateCompanySettings()
    resetLoginRateLimit()
    await bootstrapCompany(app)
    admin = await loginAs(app, ADMIN.email)
  })

  /** An employee with a linked login, so self-service routes can be exercised. */
  async function seedEmployee(email: string, fullName: string) {
    const user = await createUser({ email, fullName, role: 'employee' })
    const created = await admin.post('/api/v1/employees').send({
      fullName,
      email,
      joinDate: '2024-01-15',
      userId: String(user._id),
    })
    expect(created.status).toBe(201)

    return { id: created.body.data.id as string, agent: await loginAs(app, email) }
  }

  describe('reading', () => {
    it('returns the full settings model to an administrator', async () => {
      await seedEmployee('ayesha@saylani.test', 'Ayesha Khan')

      const res = await admin.get('/api/v1/settings').expect(200)
      const body = res.body.data

      expect(body.company.name).toBe('Saylani Tech')
      expect(body.company.timezone).toBe(TIMEZONE)
      expect(body.company.currency).toBe('PKR')
      expect(body.attendance.workStart).toBe('09:00')
      expect(body.attendance.workStartMinutes).toBe(540)
      expect(body.attendance.graceMinutes).toBe(15)
      expect(body.roster).toEqual({ employees: 1, activeEmployees: 1, departments: 0, users: 2 })
      expect(body.system.apiVersion).toBe('v1')
      expect(body.system.setupComplete).toBe(true)
    })

    it('refuses the full settings to HR and employees', async () => {
      await createUser({ email: 'hr@saylani.test', fullName: 'Hina Rahman', role: 'hr' })
      const hr = await loginAs(app, 'hr@saylani.test')
      const employee = await seedEmployee('ayesha@saylani.test', 'Ayesha Khan')

      await hr.get('/api/v1/settings').expect(403)
      await employee.agent.get('/api/v1/settings').expect(403)
    })

    it('rejects anonymous callers', async () => {
      await request(app).get('/api/v1/settings').expect(401)
      await request(app).get('/api/v1/settings/public').expect(401)
    })

    it('exposes name, time zone and currency to every signed-in user', async () => {
      const employee = await seedEmployee('ayesha@saylani.test', 'Ayesha Khan')

      const res = await employee.agent.get('/api/v1/settings/public').expect(200)

      expect(res.body.data).toEqual({
        name: 'Saylani Tech',
        timezone: TIMEZONE,
        currency: 'PKR',
      })
    })
  })

  describe('company profile', () => {
    it('updates and persists the profile and records an audit entry', async () => {
      const res = await admin
        .patch('/api/v1/settings/company')
        .send({
          name: 'Saylani Tech (Pvt) Ltd',
          contactEmail: 'people@saylani.test',
          contactPhone: '+92 21 111 222 333',
          address: 'Karachi',
          timezone: 'Asia/Dubai',
          currency: 'usd',
        })
        .expect(200)

      expect(res.body.data.company.name).toBe('Saylani Tech (Pvt) Ltd')
      expect(res.body.data.company.timezone).toBe('Asia/Dubai')
      // Currency is normalised to the ISO presentation the UI expects.
      expect(res.body.data.company.currency).toBe('USD')

      const again = await admin.get('/api/v1/settings').expect(200)
      expect(again.body.data.company.contactPhone).toBe('+92 21 111 222 333')
      expect(again.body.data.company.address).toBe('Karachi')

      const audit = await admin.get('/api/v1/audit-log?entity=settings').expect(200)
      const entry = audit.body.data[0]
      expect(entry.action).toBe('update')
      expect(entry.meta.fields).toContain('timezone')
    })

    it('rejects an unknown time zone', async () => {
      const res = await admin
        .patch('/api/v1/settings/company')
        .send({ timezone: 'Mars/Olympus' })
        .expect(400)

      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      // Nothing was written.
      const again = await admin.get('/api/v1/settings').expect(200)
      expect(again.body.data.company.timezone).toBe(TIMEZONE)
    })

    it('rejects a name that is too short', async () => {
      await admin.patch('/api/v1/settings/company').send({ name: 'A' }).expect(400)
    })

    it('rejects an empty update', async () => {
      const res = await admin.patch('/api/v1/settings/company').send({}).expect(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('is closed to HR', async () => {
      await createUser({ email: 'hr@saylani.test', fullName: 'Hina Rahman', role: 'hr' })
      const hr = await loginAs(app, 'hr@saylani.test')

      await hr.patch('/api/v1/settings/company').send({ name: 'Hijacked Ltd' }).expect(403)
    })
  })

  describe('attendance policy', () => {
    it('stores the working day as minutes after midnight', async () => {
      const res = await admin
        .patch('/api/v1/settings/attendance')
        .send({ workStart: '10:30', graceMinutes: 5 })
        .expect(200)

      expect(res.body.data.attendance).toEqual({
        workStart: '10:30',
        workStartMinutes: 630,
        graceMinutes: 5,
      })

      const again = await admin.get('/api/v1/settings').expect(200)
      expect(again.body.data.attendance.workStart).toBe('10:30')
    })

    it('rejects a malformed time or an absurd grace period', async () => {
      await admin.patch('/api/v1/settings/attendance').send({ workStart: '9am' }).expect(400)
      await admin
        .patch('/api/v1/settings/attendance')
        .send({ graceMinutes: 500 })
        .expect(400)
    })

    it('makes a check-in late when the day starts at midnight', async () => {
      const employee = await seedEmployee('ayesha@saylani.test', 'Ayesha Khan')

      await admin
        .patch('/api/v1/settings/attendance')
        .send({ workStart: '00:00', graceMinutes: 0 })
        .expect(200)

      const res = await employee.agent.post('/api/v1/attendance/check-in').expect(201)
      const expectedLate = zonedMinutesOfDay(new Date(), TIMEZONE)

      // Lateness is measured from the configured start, not from a constant.
      expect(Math.abs(res.body.data.minutesLate - expectedLate)).toBeLessThanOrEqual(1)
      expect(res.body.data.status).toBe(expectedLate > 0 ? 'late' : 'present')
    })

    it('makes the same check-in on time when the day starts at 23:59', async () => {
      const employee = await seedEmployee('bilal@saylani.test', 'Bilal Ahmed')

      await admin
        .patch('/api/v1/settings/attendance')
        .send({ workStart: '23:59', graceMinutes: 0 })
        .expect(200)

      const res = await employee.agent.post('/api/v1/attendance/check-in').expect(201)

      expect(res.body.data.status).toBe('present')
      expect(res.body.data.minutesLate).toBe(0)
    })

    it('is closed to employees', async () => {
      const employee = await seedEmployee('ayesha@saylani.test', 'Ayesha Khan')
      await employee.agent
        .patch('/api/v1/settings/attendance')
        .send({ workStart: '00:00' })
        .expect(403)
    })
  })
})
