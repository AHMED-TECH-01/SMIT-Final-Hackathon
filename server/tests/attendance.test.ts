import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, COMPANY, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'
import { AttendanceModel } from '../src/modules/attendance/attendance.model.js'
import { dateKeyToUtcMidnight, zonedDateKey } from '../src/lib/dates.js'

/** A Monday, used wherever a test needs a working day in the past. */
const MONDAY = '2024-06-03'
const TUESDAY = '2024-06-04'

describe('Attendance', () => {
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
    invalidateCompanySettings()
    resetLoginRateLimit()
    await bootstrapCompany(app)
  })

  /** An employee record linked to a working login, plus an HR login. */
  async function seedPeople(options: { linked?: boolean } = {}) {
    const admin = await loginAs(app, ADMIN.email)

    const email = 'ayesha@saylani.test'
    const user = await createUser({ email, fullName: 'Ayesha Khan', role: 'employee' })

    const employee = await admin.post('/api/v1/employees').send({
      fullName: 'Ayesha Khan',
      email,
      joinDate: '2024-01-15',
      ...(options.linked === false ? {} : { userId: String(user._id) }),
    })

    if (employee.status !== 201) {
      throw new Error(`Could not seed employee: ${employee.status} ${JSON.stringify(employee.body)}`)
    }

    await createUser({ email: 'hr@saylani.test', fullName: 'Hina Rahman', role: 'hr' })

    return {
      admin,
      user,
      employeeId: employee.body.data.id as string,
      employeeAgent: await loginAs(app, email),
      hrAgent: await loginAs(app, 'hr@saylani.test'),
    }
  }

  describe('self-service check-in and check-out', () => {
    it('records a check-in for the signed-in employee', async () => {
      const { employeeAgent, employeeId } = await seedPeople()

      const res = await employeeAgent.post('/api/v1/attendance/check-in').send({})

      expect(res.status).toBe(201)
      expect(res.body.data.employeeId).toBe(employeeId)
      expect(res.body.data.employeeName).toBe('Ayesha Khan')
      expect(res.body.data.checkInAt).not.toBeNull()
      expect(['present', 'late']).toContain(res.body.data.status)
      expect(res.body.data.minutesWorked).toBe(0)
    })

    it('refuses a second check-in on the same day with 409', async () => {
      const { employeeAgent } = await seedPeople()

      await employeeAgent.post('/api/v1/attendance/check-in').send({}).expect(201)
      const again = await employeeAgent.post('/api/v1/attendance/check-in').send({})

      expect(again.status).toBe(409)
      expect(again.body.error.code).toBe('CONFLICT')
    })

    it('refuses a check-out before the employee has checked in', async () => {
      const { employeeAgent } = await seedPeople()

      const res = await employeeAgent.post('/api/v1/attendance/check-out').send({})

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('UNPROCESSABLE')
    })

    it('records a check-out and refuses a duplicate', async () => {
      const { employeeAgent } = await seedPeople()
      await employeeAgent.post('/api/v1/attendance/check-in').send({}).expect(201)

      const out = await employeeAgent.post('/api/v1/attendance/check-out').send({})
      expect(out.status).toBe(200)
      expect(out.body.data.checkOutAt).not.toBeNull()
      expect(out.body.data.minutesWorked).toBeGreaterThanOrEqual(0)

      const again = await employeeAgent.post('/api/v1/attendance/check-out').send({})
      expect(again.status).toBe(409)
    })

    it('reports today state on /today and refuses unlinked accounts', async () => {
      const { admin, employeeAgent } = await seedPeople()

      const before = await employeeAgent.get('/api/v1/attendance/today')
      expect(before.status).toBe(200)
      expect(before.body.data.checkedIn).toBe(false)

      await employeeAgent.post('/api/v1/attendance/check-in').send({}).expect(201)

      const after = await employeeAgent.get('/api/v1/attendance/today')
      expect(after.body.data.checkedIn).toBe(true)
      expect(after.body.data.attendance.status).toMatch(/present|late/)

      // A login with no employee record cannot record attendance at all.
      await createUser({ email: 'ghost@saylani.test', fullName: 'Ghost User', role: 'employee' })
      await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Ghost User', joinDate: '2024-01-15' })
        .expect(201)

      const ghost = await loginAs(app, 'ghost@saylani.test')
        .then((agent) => agent.post('/api/v1/attendance/check-in').send({}))

      expect(ghost.status).toBe(422)
      expect(ghost.body.error.message).toContain('not linked to an employee record')
    })
  })
  describe('daily board, ledger and summary', () => {
    it('shows unmarked employees as absent on a working day', async () => {
      const { hrAgent, employeeId } = await seedPeople()

      const res = await hrAgent.get(`/api/v1/attendance/board?date=${MONDAY}`)

      expect(res.status).toBe(200)
      expect(res.body.data.date).toBe(MONDAY)
      expect(res.body.data.weekend).toBe(false)
      expect(res.body.data.headcount).toBe(1)
      expect(res.body.data.rows[0].employeeId).toBe(employeeId)
      expect(res.body.data.rows[0].status).toBe('absent')
      expect(res.body.data.rows[0].recorded).toBe(false)
      expect(res.body.data.totals.absent).toBe(1)
    })

    it('leaves today\'s unmarked employees undecided instead of absent', async () => {
      const { hrAgent } = await seedPeople()

      // The next working day: today if it is a weekday, otherwise the coming
      // Monday. Either way the day has not finished, so nobody is absent yet.
      const start = dateKeyToUtcMidnight(zonedDateKey(new Date(), COMPANY.timezone))
      let key = ''
      for (let offset = 0; offset < 7; offset += 1) {
        const candidate = new Date(start.getTime() + offset * 86_400_000)
        const weekday = candidate.getUTCDay()
        if (weekday !== 0 && weekday !== 6) {
          key = candidate.toISOString().slice(0, 10)
          break
        }
      }

      const res = await hrAgent.get(`/api/v1/attendance/board?date=${key}`)

      expect(res.status).toBe(200)
      expect(res.body.data.rows[0].status).toBe('not-marked')
      expect(res.body.data.rows[0].recorded).toBe(false)
      expect(res.body.data.totals['not-marked']).toBe(1)
      expect(res.body.data.totals.absent).toBeUndefined()
    })

    it('marks a weekend as holiday instead of absent', async () => {
      const { hrAgent } = await seedPeople()

      const res = await hrAgent.get('/api/v1/attendance/board?date=2024-06-08')

      expect(res.status).toBe(200)
      expect(res.body.data.weekend).toBe(true)
      expect(res.body.data.rows[0].status).toBe('holiday')
      expect(res.body.data.totals.holiday).toBe(1)
    })

    it('lets HR mark a day manually and blocks employees from doing so', async () => {
      const { hrAgent, employeeAgent, employeeId } = await seedPeople()

      const marked = await hrAgent
        .post('/api/v1/attendance/mark')
        .send({ employeeId, date: MONDAY, status: 'present', note: 'Kiosk was offline' })

      expect(marked.status).toBe(200)
      expect(marked.body.data.status).toBe('present')
      expect(marked.body.data.source).toBe('manual')
      expect(marked.body.data.employeeCode).toBe('EMP-0001')

      const board = await hrAgent.get(`/api/v1/attendance/board?date=${MONDAY}`)
      expect(board.body.data.rows[0].status).toBe('present')
      expect(board.body.data.rows[0].recorded).toBe(true)

      const forbidden = await employeeAgent
        .post('/api/v1/attendance/mark')
        .send({ employeeId, date: MONDAY, status: 'present' })
      expect(forbidden.status).toBe(403)
      expect(forbidden.body.error.code).toBe('FORBIDDEN')
    })

    it('keeps the full ledger away from employees', async () => {
      const { employeeAgent, hrAgent } = await seedPeople()

      const denied = await employeeAgent.get('/api/v1/attendance')
      expect(denied.status).toBe(403)

      const allowed = await hrAgent.get(`/api/v1/attendance?from=${MONDAY}&to=${MONDAY}`)
      expect(allowed.status).toBe(200)
      expect(Array.isArray(allowed.body.data)).toBe(true)
      expect(allowed.body.meta.from).toBe(MONDAY)
    })

    it('computes the working-day denominator for the summary', async () => {
      const { hrAgent, employeeId } = await seedPeople()

      await hrAgent
        .post('/api/v1/attendance/mark')
        .send({ employeeId, date: MONDAY, status: 'present' })
        .expect(200)

      // Mon 3 Jun 2024 through Fri 7 Jun 2024: five working days, no holidays.
      const res = await hrAgent.get(`/api/v1/attendance/summary?from=${MONDAY}&to=2024-06-07`)

      expect(res.status).toBe(200)
      expect(res.body.data.workingDays).toBe(5)
      expect(res.body.data.rows).toHaveLength(1)
      expect(res.body.data.rows[0].byStatus.present).toBe(1)
      expect(res.body.data.rows[0].attendanceRate).toBe(0.2)
    })

    it('scopes /me to the signed-in employee only', async () => {
      const { hrAgent, employeeId, employeeAgent } = await seedPeople()

      await hrAgent.post('/api/v1/attendance/mark').send({ employeeId, date: MONDAY, status: 'present' })

      const res = await employeeAgent.get(`/api/v1/attendance/me?from=${MONDAY}&to=${TUESDAY}`)

      expect(res.status).toBe(200)
      expect(res.body.data.records).toHaveLength(1)
      expect(res.body.data.records[0].employeeId).toBe(employeeId)
      expect(res.body.data.summary.byStatus.present).toBe(1)
    })

    it('rejects a malformed date with a validation error', async () => {
      const { employeeAgent } = await seedPeople()

      const res = await employeeAgent.get('/api/v1/attendance/me?from=2024-13-01')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('correction requests', () => {
    async function requestCorrection(agent: Awaited<ReturnType<typeof loginAs>>) {
      return agent.post('/api/v1/attendance/corrections').send({
        date: TUESDAY,
        requestedStatus: 'present',
        requestedCheckInAt: '2024-06-04T04:00:00.000Z',
        requestedCheckOutAt: '2024-06-04T12:00:00.000Z',
        reason: 'Forgot to check in while visiting a client site.',
      })
    }

    it('accepts a correction request and refuses a duplicate pending one', async () => {
      const { employeeAgent } = await seedPeople()

      const created = await requestCorrection(employeeAgent)
      expect(created.status).toBe(201)
      expect(created.body.data.status).toBe('pending')
      expect(created.body.data.employeeName).toBe('Ayesha Khan')

      const duplicate = await requestCorrection(employeeAgent)
      expect(duplicate.status).toBe(409)
    })

    it('rejects a check-out that precedes the check-in', async () => {
      const { employeeAgent } = await seedPeople()

      const res = await employeeAgent.post('/api/v1/attendance/corrections').send({
        date: TUESDAY,
        requestedStatus: 'present',
        requestedCheckInAt: '2024-06-04T12:00:00.000Z',
        requestedCheckOutAt: '2024-06-04T04:00:00.000Z',
        reason: 'Timestamps entered the wrong way around.',
      })

      expect(res.status).toBe(422)
    })

    it('approving a correction writes the hours onto the ledger', async () => {
      const { employeeAgent, hrAgent, employeeId } = await seedPeople()

      const created = await requestCorrection(employeeAgent)
      const id = created.body.data.id as string

      const queue = await hrAgent.get('/api/v1/attendance/corrections?status=pending')
      expect(queue.status).toBe(200)
      expect(queue.body.data).toHaveLength(1)

      const approved = await hrAgent
        .patch(`/api/v1/attendance/corrections/${id}`)
        .send({ decision: 'approved', decisionNote: 'Verified with the site log.' })

      expect(approved.status).toBe(200)
      expect(approved.body.data.status).toBe('approved')
      expect(approved.body.data.decisionNote).toBe('Verified with the site log.')

      const record = await AttendanceModel.findOne({
        employeeId,
        date: new Date(Date.UTC(2024, 5, 4)),
      })
      expect(record).not.toBeNull()
      expect(record?.status).toBe('present')
      expect(record?.source).toBe('correction')
      expect(record?.minutesWorked).toBe(480)

      const again = await hrAgent
        .patch(`/api/v1/attendance/corrections/${id}`)
        .send({ decision: 'rejected' })
      expect(again.status).toBe(409)
    })

    it('keeps employees inside their own correction queue', async () => {
      const { employeeAgent, admin } = await seedPeople()

      await requestCorrection(employeeAgent)

      // A second employee gets their own login and must not see the first request.
      await createUser({ email: 'bilal@saylani.test', fullName: 'Bilal Ahmed', role: 'employee' })
      const other = await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Bilal Ahmed', joinDate: '2024-02-01' })
        .expect(201)
      expect(other.status).toBe(201)

      const otherAgent = await loginAs(app, 'bilal@saylani.test')
      // Not linked to a record: the queue cannot be resolved, so access is refused.
      const res = await otherAgent.get('/api/v1/attendance/corrections')
      expect(res.status).toBe(422)
    })

    it('blocks employees from deciding on a correction', async () => {
      const { employeeAgent } = await seedPeople()

      const created = await requestCorrection(employeeAgent)
      const id = created.body.data.id as string

      const res = await employeeAgent
        .patch(`/api/v1/attendance/corrections/${id}`)
        .send({ decision: 'approved' })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('returns 404 for an unknown correction identifier', async () => {
      const { hrAgent } = await seedPeople()

      const res = await hrAgent
        .patch('/api/v1/attendance/corrections/64b7f1c2a9d3e4f5a6b7c8d9')
        .send({ decision: 'approved' })

      expect(res.status).toBe(404)
    })
  })
})