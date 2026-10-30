import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'
import { runSeed } from '../src/scripts/seed.js'
import { CompanyModel } from '../src/modules/organization/company.model.js'
import { UserModel } from '../src/modules/auth/user.model.js'
import { EmployeeModel } from '../src/modules/employees/employee.model.js'
import { DepartmentModel } from '../src/modules/organization/department.model.js'
import { DesignationModel } from '../src/modules/organization/designation.model.js'
import { LeaveTypeModel } from '../src/modules/organization/leave-type.model.js'
import { HolidayModel } from '../src/modules/organization/holiday.model.js'
import { AttendanceModel } from '../src/modules/attendance/attendance.model.js'
import { LeaveRequestModel } from '../src/modules/leave/leave.model.js'
import { SalaryStructureModel, PayrollRunModel } from '../src/modules/payroll/payroll.model.js'
import { AnnouncementModel } from '../src/modules/announcements/announcement.model.js'
import { NotificationModel } from '../src/modules/notifications/notification.model.js'
import { AuditLogModel } from '../src/modules/audit/audit.model.js'

/**
 * The seed is the demo: if it drifts from the models, every screen is wrong.
 * These tests run it against a real (in-memory) MongoDB and then read the
 * result back through the HTTP API, so both the writes and the read models are
 * verified by the same assertions.
 */
describe('Demo seed', () => {
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
  })

  it('creates the company and refuses to overwrite it without --reset', async () => {
    await runSeed()

    const company = await CompanyModel.findOne({ key: 'primary' })
    expect(company).not.toBeNull()
    expect(company?.timezone).toBe('Asia/Karachi')
    expect(company?.currency).toBe('PKR')
    expect(company?.workStartMinutes).toBe(540)

    await expect(runSeed()).rejects.toThrow(/already contains a company/)
  })

  it('builds a roster whose parts agree with each other', async () => {
    const summary = await runSeed()

    expect(summary.employees).toBe(13)
    expect(summary.leaveRequests).toBe(7)
    expect(summary.attendance).toBeGreaterThan(0)

    const [employees, departments, designations, leaveTypes, holidays] = await Promise.all([
      EmployeeModel.countDocuments(),
      DepartmentModel.countDocuments(),
      DesignationModel.countDocuments(),
      LeaveTypeModel.countDocuments(),
      HolidayModel.countDocuments(),
    ])

    expect(employees).toBe(13)
    expect(departments).toBe(5)
    expect(designations).toBe(8)
    expect(leaveTypes).toBe(4)
    expect(holidays).toBe(6)

    // admin + hr + three employee logins
    expect(await UserModel.countDocuments()).toBe(5)

    // Every employee's department and designation exist.
    const roster = await EmployeeModel.find()
    for (const employee of roster) {
      if (employee.departmentId) {
        expect(await DepartmentModel.exists({ _id: employee.departmentId })).toBeTruthy()
      }
      if (employee.designationId) {
        expect(await DesignationModel.exists({ _id: employee.designationId })).toBeTruthy()
      }
    }
  })

  it('leaves a month of attendance, one pending correction and a consistent ledger', async () => {
    await runSeed()

    const attendance = await AttendanceModel.countDocuments()
    expect(attendance).toBeGreaterThan(100)

    // Approved leave shows up as 'leave' days, never as unexplained absence.
    const leaveDays = await AttendanceModel.countDocuments({ status: 'leave' })
    expect(leaveDays).toBeGreaterThan(0)

    // Nothing is recorded for today, so the demo can perform a live check-in.
    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const today = new Date(`${todayKey}T00:00:00.000Z`)
    expect(await AttendanceModel.countDocuments({ date: today })).toBe(0)

    const pendingLeave = await LeaveRequestModel.countDocuments({ status: 'pending' })
    expect(pendingLeave).toBeGreaterThan(0)
  })

  it('creates salary structures and payroll history it can actually compute', async () => {
    await runSeed()

    const structures = await SalaryStructureModel.countDocuments()
    expect(structures).toBe(12) // everyone except the leaver

    const runs = await PayrollRunModel.find().sort({ year: 1, month: 1 })
    expect(runs).toHaveLength(3)

    const finalized = runs.filter((run) => run.status === 'finalized')
    const drafts = runs.filter((run) => run.status === 'draft')
    expect(finalized).toHaveLength(2)
    expect(drafts).toHaveLength(1)

    // Finalized history must carry real totals, not zeros.
    for (const run of finalized) {
      expect(run.totals.headcount).toBe(12)
      expect(run.totals.gross).toBeGreaterThan(0)
      expect(run.totals.net).toBeGreaterThan(0)
      expect(run.totals.net).toBeLessThanOrEqual(run.totals.gross)
      expect(run.finalizedAt).toBeInstanceOf(Date)
    }

    const draft = drafts[0]!
    expect(draft.workingDays).toBeGreaterThan(0)
    expect(draft.totals.headcount).toBe(12)
  })

  it('publishes announcements and fills the notification bell', async () => {
    await runSeed()

    expect(await AnnouncementModel.countDocuments({ status: 'published' })).toBe(3)
    expect(await AnnouncementModel.countDocuments({ status: 'draft' })).toBe(1)
    expect(await AnnouncementModel.countDocuments({ pinned: true })).toBe(1)

    expect(await NotificationModel.countDocuments()).toBeGreaterThan(4)
    expect(await AuditLogModel.countDocuments()).toBeGreaterThan(0)
  })

  it('serves the seeded data through the API to the demo accounts', async () => {
    await runSeed()
    invalidateCompanySettings()

    const admin = await loginAs(app, 'admin@hcm.test', 'Password123')

    const me = await admin.get('/api/v1/auth/me').expect(200)
    expect(me.body.data.user.role).toBe('admin')
    expect(me.body.data.permissions).toContain('settings.manage')

    const dashboard = await admin.get('/api/v1/analytics/dashboard').expect(200)
    expect(dashboard.body.data.overview.workforce.total).toBe(12)
    expect(dashboard.body.data.breakdown.total).toBe(12)
    expect(dashboard.body.data.queues.leaveRequests.length).toBeGreaterThan(0)

    const employees = await admin.get('/api/v1/employees').expect(200)
    expect(employees.body.meta.total).toBe(13)

    const announcements = await admin.get('/api/v1/announcements').expect(200)
    expect(announcements.body.data.length).toBeGreaterThanOrEqual(3)

    const payroll = await admin.get('/api/v1/payroll/runs').expect(200)
    expect(payroll.body.data).toHaveLength(3)

    const settings = await admin.get('/api/v1/settings').expect(200)
    expect(settings.body.data.company.name).toBe('Saylani Technologies')
    expect(settings.body.data.attendance.workStart).toBe('09:00')
    expect(settings.body.data.roster.activeEmployees).toBe(12)
  })

  it('answers the assistant from the seeded records', async () => {
    await runSeed()
    invalidateCompanySettings()

    const admin = await loginAs(app, 'admin@hcm.test', 'Password123')
    const reply = await admin
      .post('/api/v1/assistant/chat')
      .send({ message: 'how many employees do we have?' })
      .expect(200)

    expect(reply.body.data.intent).toBe('headcount')
    expect(reply.body.data.answer).toContain('12')
    expect(reply.body.data.tools).toHaveLength(1)
  })

  it('gives the employee login a working session and a sealed-off view', async () => {
    await runSeed()
    invalidateCompanySettings()

    const employee = await loginAs(app, 'ayesha.khan@hcm.test', 'Password123')

    const me = await employee.get('/api/v1/auth/me').expect(200)
    expect(me.body.data.user.role).toBe('employee')

    // Company-wide analytics are refused, not merely hidden.
    await employee.get('/api/v1/analytics/overview').expect(403)

    const balances = await employee.get('/api/v1/leave/balances').expect(200)
    expect(balances.body.data.balances.length).toBe(4)
  })

  it('is repeatable: a reset run produces the same figures', async () => {
    const first = await runSeed()
    const firstRun = await PayrollRunModel.findOne({ status: 'finalized' }).sort({ year: -1 })

    const second = await runSeed({ reset: true })
    const secondRun = await PayrollRunModel.findOne({ status: 'finalized' }).sort({ year: -1 })

    expect(second.employees).toBe(first.employees)
    expect(second.leaveRequests).toBe(first.leaveRequests)
    expect(second.workingDays).toBe(first.workingDays)
    expect(secondRun?.totals.gross).toBe(firstRun?.totals.gross)
    expect(await CompanyModel.countDocuments()).toBe(1)
  })

  it('keeps the bootstrap credentials out of the seeded users', async () => {
    await runSeed()

    // The test admin must not exist; the seed owns its own accounts.
    expect(await UserModel.exists({ email: ADMIN.email })).toBeFalsy()
    expect(await UserModel.exists({ email: 'admin@hcm.test' })).toBeTruthy()
  })

  it('reports the seeded company on the public settings endpoint', async () => {
    await runSeed()
    invalidateCompanySettings()

    const response = await request(app)
      .get('/api/v1/settings/public')
      .expect(401)

    expect(response.body.success).toBe(false)

    const employee = await loginAs(app, 'ayesha.khan@hcm.test', 'Password123')
    const publicSettings = await employee.get('/api/v1/settings/public').expect(200)
    expect(publicSettings.body.data).toEqual({
      name: 'Saylani Technologies',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    })
  })
})
