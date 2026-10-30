import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'
import { AttendanceModel } from '../src/modules/attendance/attendance.model.js'

/** Mon 3 Jun – Fri 7 Jun 2024: five consecutive working days. */
const MON = '2024-06-03'
const TUE = '2024-06-04'
const WED = '2024-06-05'
const THU = '2024-06-06'
const FRI = '2024-06-07'

/** Approved leave can only be cancelled before it starts, so this must be ahead of "today". */
const FUTURE_WED = '2027-01-06'
const FUTURE_THU = '2027-01-07'

describe('Leave', () => {
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

  async function seed(options: { quota?: number; smallQuota?: number } = {}) {
    const admin = await loginAs(app, ADMIN.email)

    const annual = await admin
      .post('/api/v1/leave-types')
      .send({ name: 'Annual Leave', code: 'ANNUAL', annualQuota: options.quota ?? 20 })
    const casual = await admin
      .post('/api/v1/leave-types')
      .send({ name: 'Casual Leave', code: 'CASUAL', annualQuota: options.smallQuota ?? 2 })

    const user = await createUser({ email: 'ayesha@saylani.test', fullName: 'Ayesha Khan', role: 'employee' })
    const employee = await admin.post('/api/v1/employees').send({
      fullName: 'Ayesha Khan',
      email: 'ayesha@saylani.test',
      joinDate: '2024-01-15',
      userId: String(user._id),
    })
    expect(employee.status).toBe(201)

    await createUser({ email: 'hr@saylani.test', fullName: 'Hina Rahman', role: 'hr' })

    return {
      admin,
      annualId: annual.body.data.id as string,
      casualId: casual.body.data.id as string,
      employeeId: employee.body.data.id as string,
      employeeAgent: await loginAs(app, 'ayesha@saylani.test'),
      hrAgent: await loginAs(app, 'hr@saylani.test'),
    }
  }

  const apply = (
    agent: Awaited<ReturnType<typeof loginAs>>,
    body: Record<string, unknown>,
  ) => agent.post('/api/v1/leave/requests').send(body)

  describe('applying', () => {
    it('counts only working days across a range that includes a weekend', async () => {
      const { employeeAgent, annualId } = await seed()

      // Mon 3 Jun -> Sun 9 Jun spans five weekdays and one weekend.
      const res = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: MON,
        endDate: '2024-06-09',
        reason: 'Family trip out of town.',
      })

      expect(res.status).toBe(201)
      expect(res.body.data.days).toBe(5)
      expect(res.body.data.status).toBe('pending')
      expect(res.body.data.leaveTypeName).toBe('Annual Leave')
      expect(res.body.data.employeeName).toBe('Ayesha Khan')
    })

    it('records a half day as 0.5 days', async () => {
      const { employeeAgent, annualId } = await seed()

      const res = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: TUE,
        endDate: TUE,
        halfDay: true,
        reason: 'Medical appointment in the morning.',
      })

      expect(res.status).toBe(201)
      expect(res.body.data.days).toBe(0.5)
      expect(res.body.data.halfDay).toBe(true)
    })

    it('refuses a half day that spans more than one date', async () => {
      const { employeeAgent, annualId } = await seed()

      const res = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: TUE,
        endDate: WED,
        halfDay: true,
        reason: 'Two half days in a row.',
      })

      expect(res.status).toBe(422)
    })

    it('refuses a range with no working days', async () => {
      const { employeeAgent, annualId } = await seed()

      const res = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: '2024-06-08',
        endDate: '2024-06-09',
        reason: 'Weekend only.',
      })

      expect(res.status).toBe(422)
      expect(res.body.error.message).toContain('working days')
    })

    it('refuses an end date before the start date and an unknown leave type', async () => {
      const { employeeAgent, annualId } = await seed()

      const reversed = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: THU,
        endDate: WED,
        reason: 'Dates entered the wrong way around.',
      })
      expect(reversed.status).toBe(422)

      const unknown = await apply(employeeAgent, {
        leaveTypeId: '64b7f1c2a9d3e4f5a6b7c8d9',
        startDate: THU,
        endDate: FRI,
        reason: 'Unknown leave type on purpose.',
      })
      expect(unknown.status).toBe(422)
    })

    it('refuses a request that exceeds the remaining quota', async () => {
      const { employeeAgent, casualId } = await seed({ smallQuota: 2 })

      const res = await apply(employeeAgent, {
        leaveTypeId: casualId,
        startDate: MON,
        endDate: FRI,
        reason: 'Five days against a two day quota.',
      })

      expect(res.status).toBe(422)
      expect(res.body.error.message).toContain('Only 2 of 2 Casual Leave')
    })

    it('refuses overlapping requests', async () => {
      const { employeeAgent, annualId } = await seed()

      await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: WED,
        endDate: THU,
        reason: 'First request covering two days.',
      }).expect(201)

      const overlap = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: THU,
        endDate: FRI,
        reason: 'Second request overlapping the first.',
      })

      expect(overlap.status).toBe(409)
      expect(overlap.body.error.code).toBe('CONFLICT')
    })
  })
  describe('approval, balances and cancellation', () => {
    it('approves a request and mirrors it onto the attendance ledger', async () => {
      const { employeeAgent, hrAgent, annualId, employeeId } = await seed()

      const created = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: MON,
        endDate: WED,
        reason: 'Wedding in the family.',
      })
      const id = created.body.data.id as string

      const approved = await hrAgent
        .patch(`/api/v1/leave/requests/${id}/decision`)
        .send({ decision: 'approved', decisionNote: 'Approved, enjoy.' })

      expect(approved.status).toBe(200)
      expect(approved.body.data.status).toBe('approved')
      expect(approved.body.data.decisionNote).toBe('Approved, enjoy.')

      const rows = await AttendanceModel.find({ employeeId }).sort({ date: 1 })
      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.status === 'leave')).toBe(true)
      expect(rows.every((row) => row.source === 'system')).toBe(true)
      expect(rows[0]?.date.toISOString().slice(0, 10)).toBe(MON)

      const again = await hrAgent
        .patch(`/api/v1/leave/requests/${id}/decision`)
        .send({ decision: 'rejected' })
      expect(again.status).toBe(409)
    })

    it('keeps a rejection out of the attendance ledger', async () => {
      const { employeeAgent, hrAgent, annualId, employeeId } = await seed()

      const created = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: THU,
        endDate: THU,
        reason: 'Personal errand.',
      })

      const rejected = await hrAgent
        .patch(`/api/v1/leave/requests/${created.body.data.id}/decision`)
        .send({ decision: 'rejected', decisionNote: 'Blackout week.' })

      expect(rejected.status).toBe(200)
      expect(rejected.body.data.status).toBe('rejected')
      expect(await AttendanceModel.countDocuments({ employeeId })).toBe(0)
    })

    it('reports entitled, used, pending and available days', async () => {
      const { employeeAgent, hrAgent, annualId } = await seed()

      const pending = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: MON,
        endDate: TUE,
        reason: 'Two days pending approval.',
      })

      const pendingBalances = await employeeAgent.get('/api/v1/leave/balances?year=2024')
      expect(pendingBalances.status).toBe(200)

      const annual = pendingBalances.body.data.balances.find(
        (entry: { name: string }) => entry.name === 'Annual Leave',
      )
      expect(annual).toEqual({
        leaveTypeId: annualId,
        name: 'Annual Leave',
        code: 'ANNUAL',
        entitled: 20,
        used: 0,
        pending: 2,
        remaining: 20,
        available: 18,
      })

      await hrAgent
        .patch(`/api/v1/leave/requests/${pending.body.data.id}/decision`)
        .send({ decision: 'approved' })
        .expect(200)

      const approvedBalances = await employeeAgent.get('/api/v1/leave/balances?year=2024')
      const after = approvedBalances.body.data.balances.find(
        (entry: { name: string }) => entry.name === 'Annual Leave',
      )
      expect(after.used).toBe(2)
      expect(after.pending).toBe(0)
      expect(after.remaining).toBe(18)
      expect(after.available).toBe(18)
    })

    it('cancels a pending request and removes attendance for an approved one', async () => {
      const { employeeAgent, hrAgent, annualId, employeeId } = await seed()

      const pending = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: MON,
        endDate: MON,
        reason: 'Appointment on Monday.',
      })
      const cancelled = await employeeAgent.patch(
        `/api/v1/leave/requests/${pending.body.data.id}/cancel`,
      )
      expect(cancelled.status).toBe(200)
      expect(cancelled.body.data.status).toBe('cancelled')

      const approved = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: FUTURE_WED,
        endDate: FUTURE_THU,
        reason: 'Two days later that autumn.',
      })
      await hrAgent
        .patch(`/api/v1/leave/requests/${approved.body.data.id}/decision`)
        .send({ decision: 'approved' })
        .expect(200)
      expect(await AttendanceModel.countDocuments({ employeeId })).toBe(2)

      const undo = await employeeAgent.patch(
        `/api/v1/leave/requests/${approved.body.data.id}/cancel`,
      )
      expect(undo.status).toBe(200)
      expect(undo.body.data.status).toBe('cancelled')
      expect(await AttendanceModel.countDocuments({ employeeId })).toBe(0)

      const twice = await employeeAgent.patch(
        `/api/v1/leave/requests/${approved.body.data.id}/cancel`,
      )
      expect(twice.status).toBe(409)
    })
  })

  describe('authorization', () => {
    it('scopes the list to the caller and lets HR see everything', async () => {
      const { employeeAgent, hrAgent, admin, annualId } = await seed()

      await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: MON,
        endDate: MON,
        reason: 'Monday off.',
      }).expect(201)

      // A second employee with no requests of their own.
      await createUser({ email: 'bilal@saylani.test', fullName: 'Bilal Ahmed', role: 'employee' })
      const bilal = await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Bilal Ahmed', joinDate: '2024-02-01' })
        .expect(201)
      expect(bilal.status).toBe(201)

      const bilalAgent = await loginAs(app, 'bilal@saylani.test')
      // No linked record, so the self-service list cannot be resolved.
      expect((await bilalAgent.get('/api/v1/leave/requests')).status).toBe(422)

      const own = await employeeAgent.get('/api/v1/leave/requests')
      expect(own.status).toBe(200)
      expect(own.body.data).toHaveLength(1)
      expect(own.body.meta.total).toBe(1)

      const all = await hrAgent.get('/api/v1/leave/requests')
      expect(all.status).toBe(200)
      expect(all.body.data).toHaveLength(1)
    })

    it('blocks employees from approving leave', async () => {
      const { employeeAgent, annualId } = await seed()

      const created = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: FRI,
        endDate: FRI,
        reason: 'Friday off.',
      })

      const res = await employeeAgent
        .patch(`/api/v1/leave/requests/${created.body.data.id}/decision`)
        .send({ decision: 'approved' })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('returns approved leave on the calendar', async () => {
      const { employeeAgent, hrAgent, annualId } = await seed()

      const created = await apply(employeeAgent, {
        leaveTypeId: annualId,
        startDate: MON,
        endDate: TUE,
        reason: 'Two days for a family event.',
      })
      await hrAgent
        .patch(`/api/v1/leave/requests/${created.body.data.id}/decision`)
        .send({ decision: 'approved' })
        .expect(200)

      const calendar = await hrAgent.get('/api/v1/leave/calendar?from=2024-06-01&to=2024-06-30')

      expect(calendar.status).toBe(200)
      expect(calendar.body.data.entries).toHaveLength(1)
      expect(calendar.body.data.entries[0].status).toBe('approved')
    })

    it('returns 404 for an unknown request identifier', async () => {
      const { hrAgent } = await seed()

      const res = await hrAgent
        .patch('/api/v1/leave/requests/64b7f1c2a9d3e4f5a6b7c8d9/decision')
        .send({ decision: 'approved' })

      expect(res.status).toBe(404)
    })
  })
})