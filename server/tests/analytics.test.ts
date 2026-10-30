import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'

/** The same zone the bootstrap writes into the company document. */
const TIMEZONE = 'Asia/Karachi'

/** Today in the company zone, as 'YYYY-MM-DD'. */
function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

describe('Analytics', () => {
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

  /**
   * Three-person workforce plus one leaver, two departments, one leave type.
   * Dates are fixed in the past so attendance and leave totals are stable.
   */
  async function seed() {
    const admin = await loginAs(app, ADMIN.email)
    const ayeshaUser = await createUser({
      email: 'ayesha@saylani.test',
      fullName: 'Ayesha Khan',
      role: 'employee',
    })
    const bilalUser = await createUser({
      email: 'bilal@saylani.test',
      fullName: 'Bilal Ahmed',
      role: 'employee',
    })

    const engineering = await admin.post('/api/v1/departments').send({ name: 'Engineering' })
    const marketing = await admin.post('/api/v1/departments').send({ name: 'Marketing' })
    const leaveType = await admin
      .post('/api/v1/leave-types')
      .send({ name: 'Annual', code: 'ANN', annualQuota: 20 })

    const ayesha = await admin.post('/api/v1/employees').send({
      fullName: 'Ayesha Khan',
      email: 'ayesha@saylani.test',
      joinDate: '2015-01-01',
      departmentId: engineering.body.data.id,
      employmentType: 'full-time',
      userId: String(ayeshaUser._id),
    })
    const bilal = await admin.post('/api/v1/employees').send({
      fullName: 'Bilal Ahmed',
      email: 'bilal@saylani.test',
      joinDate: '2024-03-01',
      departmentId: engineering.body.data.id,
      employmentType: 'contract',
      userId: String(bilalUser._id),
    })
    await admin.post('/api/v1/employees').send({
      fullName: 'Sana Iqbal',
      joinDate: todayKey(),
      departmentId: marketing.body.data.id,
      employmentType: 'part-time',
      status: 'probation',
    })
    await admin.post('/api/v1/employees').send({
      fullName: 'Usman Tariq',
      joinDate: '2019-05-05',
      departmentId: marketing.body.data.id,
      status: 'resigned',
    })

    return {
      admin,
      ayeshaId: ayesha.body.data.id as string,
      bilalId: bilal.body.data.id as string,
      leaveTypeId: leaveType.body.data.id as string,
      ayeshaAgent: await loginAs(app, 'ayesha@saylani.test'),
      bilalAgent: await loginAs(app, 'bilal@saylani.test'),
    }
  }

  describe('access control', () => {
    it('keeps dashboards behind the analytics permission', async () => {
      const { ayeshaAgent } = await seed()

      expect((await ayeshaAgent.get('/api/v1/analytics/overview')).status).toBe(403)
      expect((await ayeshaAgent.get('/api/v1/analytics/dashboard')).status).toBe(403)
    })

    it('requires a session at all', async () => {
      const anonymous = request(app)

      expect((await anonymous.get('/api/v1/analytics/overview')).status).toBe(401)
    })
  })

  describe('overview', () => {
    it('counts the current workforce and ignores leavers', async () => {
      const { admin } = await seed()

      const res = await admin.get('/api/v1/analytics/overview')
      expect(res.status).toBe(200)

      expect(res.body.data.workforce.total).toBe(3)
      expect(res.body.data.workforce.byEmploymentType).toEqual([
        { type: 'contract', count: 1 },
        { type: 'full-time', count: 1 },
        { type: 'part-time', count: 1 },
      ])

      // Expected attendance is the workforce times the working days in the window.
      expect(res.body.data.attendance.expected).toBe(3 * res.body.data.attendance.workingDays)
      expect(res.body.data.attendance.recorded).toBe(0)
      expect(res.body.data.attendance.rate).toBe(0)

      expect(res.body.data.today.marked).toBe(0)
      expect(res.body.data.today.notMarked).toBe(3)
      expect(res.body.data.payroll.latestFinalized).toBeNull()
    })

    it('reports today as it fills up', async () => {
      const { admin, ayeshaId } = await seed()

      await admin
        .post('/api/v1/attendance/mark')
        .send({ employeeId: ayeshaId, date: todayKey(), status: 'present' })
        .expect(200)

      const res = await admin.get('/api/v1/analytics/overview')

      expect(res.body.data.today.present).toBe(1)
      expect(res.body.data.today.marked).toBe(1)
      expect(res.body.data.today.notMarked).toBe(2)
    })

    it('surfaces the pending approval queues', async () => {
      const { admin, ayeshaAgent, leaveTypeId } = await seed()

      await ayeshaAgent.post('/api/v1/leave/requests').send({
        leaveTypeId,
        startDate: '2024-06-10',
        endDate: '2024-06-12',
        reason: 'Family wedding in Lahore',
      })

      const res = await admin.get('/api/v1/analytics/overview')
      expect(res.body.data.pending.leaveRequests).toBe(1)
      expect(res.body.data.pending.corrections).toBe(0)
    })
  })

  describe('attendance trend', () => {
    it('breaks a fixed week down by day and status', async () => {
      const { admin, ayeshaId, bilalId } = await seed()

      await admin
        .post('/api/v1/attendance/mark')
        .send({ employeeId: ayeshaId, date: '2024-06-03', status: 'present' })
        .expect(200)
      await admin
        .post('/api/v1/attendance/mark')
        .send({ employeeId: bilalId, date: '2024-06-04', status: 'absent' })
        .expect(200)
      await admin
        .post('/api/v1/attendance/mark')
        .send({ employeeId: ayeshaId, date: '2024-06-05', status: 'late' })
        .expect(200)

      const res = await admin.get('/api/v1/analytics/attendance-trend?from=2024-06-03&to=2024-06-07')
      expect(res.status).toBe(200)
      expect(res.body.data.from).toBe('2024-06-03')
      expect(res.body.data.to).toBe('2024-06-07')
      expect(res.body.data.headcount).toBe(3)

      const points = res.body.data.points as Array<Record<string, number | string | boolean>>
      expect(points).toHaveLength(5)
      expect(points.map((point) => point.date)).toEqual([
        '2024-06-03',
        '2024-06-04',
        '2024-06-05',
        '2024-06-06',
        '2024-06-07',
      ])
      expect(points.every((point) => point.isWorkingDay === true)).toBe(true)

      expect(points[0]).toMatchObject({ present: 1, marked: 1, rate: 33.3 })
      expect(points[1]).toMatchObject({ absent: 1, marked: 1, rate: 0 })
      expect(points[2]).toMatchObject({ late: 1, marked: 1, rate: 33.3 })
      expect(points[3]).toMatchObject({ marked: 0, rate: 0 })
    })

    it('flags weekends as non-working', async () => {
      const { admin } = await seed()

      const res = await admin.get(
        '/api/v1/analytics/attendance-trend?from=2024-06-08&to=2024-06-09',
      )
      const points = res.body.data.points as Array<{ isWorkingDay: boolean }>

      expect(points).toHaveLength(2)
      expect(points.every((point) => point.isWorkingDay === false)).toBe(true)
    })

    it('defaults to the last thirty days', async () => {
      const { admin } = await seed()

      const res = await admin.get('/api/v1/analytics/attendance-trend')
      expect(res.status).toBe(200)
      expect(res.body.data.points).toHaveLength(30)
      expect(res.body.data.to).toBe(todayKey())
    })

    it('rejects an inverted range', async () => {
      const { admin } = await seed()

      const res = await admin.get('/api/v1/analytics/attendance-trend?from=2024-06-10&to=2024-06-01')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('BAD_REQUEST')
    })
  })

  describe('headcount', () => {
    it('groups the workforce by department, type and tenure', async () => {
      const { admin } = await seed()

      const res = await admin.get('/api/v1/analytics/headcount')
      expect(res.status).toBe(200)

      const data = res.body.data
      expect(data.total).toBe(3)
      expect(data.byDepartment[0]).toMatchObject({ departmentName: 'Engineering', count: 2 })
      expect(data.byDepartment[1]).toMatchObject({ departmentName: 'Marketing', count: 1 })

      // The leaver stays visible in the status breakdown but not in the workforce.
      expect(data.byStatus).toEqual([
        { status: 'active', count: 2 },
        { status: 'probation', count: 1 },
        { status: 'resigned', count: 1 },
      ])

      const tenureTotal = (data.tenure as Array<{ count: number }>).reduce(
        (total, band) => total + band.count,
        0,
      )
      expect(tenureTotal).toBe(3)
      expect(data.tenure[3]).toEqual({ band: '5-plus-years', count: 1 })

      expect(data.joiners.thisMonth).toBeGreaterThanOrEqual(1)
    })
  })

  describe('leave usage', () => {
    it('splits approved and pending days by type and department', async () => {
      const { admin, ayeshaAgent, bilalAgent, leaveTypeId } = await seed()

      const applied = await ayeshaAgent.post('/api/v1/leave/requests').send({
        leaveTypeId,
        startDate: '2024-06-10',
        endDate: '2024-06-12',
        reason: 'Family wedding in Lahore',
      })
      expect(applied.status).toBe(201)

      await admin
        .patch(`/api/v1/leave/requests/${applied.body.data.id}/decision`)
        .send({ decision: 'approved' })
        .expect(200)

      await bilalAgent
        .post('/api/v1/leave/requests')
        .send({
          leaveTypeId,
          startDate: '2024-07-01',
          endDate: '2024-07-02',
          reason: 'Moving house this week',
        })
        .expect(201)

      const res = await admin.get('/api/v1/analytics/leave-usage?year=2024')
      expect(res.status).toBe(200)

      const data = res.body.data
      expect(data.year).toBe(2024)
      expect(data.totals).toEqual({ requests: 2, approvedDays: 3, pendingDays: 2 })
      expect(data.byStatus).toEqual([
        { status: 'pending', count: 1 },
        { status: 'approved', count: 1 },
        { status: 'rejected', count: 0 },
        { status: 'cancelled', count: 0 },
      ])
      expect(data.byType).toHaveLength(1)
      expect(data.byType[0]).toMatchObject({ name: 'Annual', approvedDays: 3, requests: 2 })
      expect(data.byDepartment[0]).toMatchObject({ departmentName: 'Engineering', days: 3 })
      expect(data.topAbsentees[0]).toMatchObject({ employeeName: 'Ayesha Khan', days: 3 })
    })

    it('defaults to the current year', async () => {
      const { admin } = await seed()

      const res = await admin.get('/api/v1/analytics/leave-usage')
      expect(res.status).toBe(200)
      expect(res.body.data.year).toBe(Number(todayKey().slice(0, 4)))
      expect(res.body.data.totals.requests).toBe(0)
    })
  })

  describe('payroll cost', () => {
    it('only reports finalized runs', async () => {
      const { admin, ayeshaId } = await seed()

      await admin
        .put(`/api/v1/payroll/structures/${ayeshaId}`)
        .send({ baseSalary: 100_000, taxPercent: 10 })
        .expect(200)

      const empty = await admin.get('/api/v1/analytics/payroll-cost')
      expect(empty.body.data.points).toEqual([])
      expect(empty.body.data.latest).toBeNull()
      expect(empty.body.data.averageNet).toBe(0)

      const run = await admin.post('/api/v1/payroll/runs').send({ year: 2024, month: 6 })
      expect((await admin.get('/api/v1/analytics/payroll-cost')).body.data.points).toEqual([])

      await admin.post(`/api/v1/payroll/runs/${run.body.data.id}/finalize`).expect(200)

      const res = await admin.get('/api/v1/analytics/payroll-cost')
      expect(res.body.data.points).toHaveLength(1)
      expect(res.body.data.points[0]).toMatchObject({
        periodKey: '2024-06',
        headcount: 1,
        gross: 100_000,
        net: 90_000,
      })
      expect(res.body.data.latest.periodKey).toBe('2024-06')
      expect(res.body.data.averageNet).toBe(90_000)
    })
  })

  describe('dashboard', () => {
    it('composes the landing payload in one call', async () => {
      const { admin, ayeshaAgent, leaveTypeId } = await seed()

      const applied = await ayeshaAgent.post('/api/v1/leave/requests').send({
        leaveTypeId,
        startDate: '2024-06-10',
        endDate: '2024-06-12',
        reason: 'Family wedding in Lahore',
      })

      const res = await admin.get('/api/v1/analytics/dashboard')
      expect(res.status).toBe(200)
      expect(res.body.data.generatedAt).toBeTruthy()

      expect(res.body.data.overview.workforce.total).toBe(3)
      expect(res.body.data.breakdown.total).toBe(3)
      expect(res.body.data.trend).toHaveLength(14)

      expect(res.body.data.queues.leaveRequests).toHaveLength(1)
      expect(res.body.data.queues.leaveRequests[0]).toMatchObject({
        id: applied.body.data.id,
        employeeName: 'Ayesha Khan',
        status: 'pending',
      })
      expect(res.body.data.queues.corrections).toEqual([])
    })
  })
})