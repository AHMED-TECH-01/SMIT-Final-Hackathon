import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'

const TIMEZONE = 'Asia/Karachi'

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

describe('AI assistant', () => {
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

  /** Two employees with logins, one HR account, plus an unlinked login. */
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
    await createUser({ email: 'hr@saylani.test', fullName: 'Hina Rahman', role: 'hr' })
    await createUser({ email: 'ghost@saylani.test', fullName: 'Ghost User', role: 'employee' })

    const engineering = await admin.post('/api/v1/departments').send({ name: 'Engineering' })
    const marketing = await admin.post('/api/v1/departments').send({ name: 'Marketing' })
    const leaveType = await admin
      .post('/api/v1/leave-types')
      .send({ name: 'Annual', code: 'ANN', annualQuota: 20 })

    const ayesha = await admin.post('/api/v1/employees').send({
      fullName: 'Ayesha Khan',
      email: 'ayesha@saylani.test',
      joinDate: '2024-01-15',
      departmentId: engineering.body.data.id,
      userId: String(ayeshaUser._id),
    })
    const bilal = await admin.post('/api/v1/employees').send({
      fullName: 'Bilal Ahmed',
      email: 'bilal@saylani.test',
      joinDate: '2024-02-01',
      departmentId: marketing.body.data.id,
      userId: String(bilalUser._id),
    })

    return {
      admin,
      ayeshaId: ayesha.body.data.id as string,
      bilalId: bilal.body.data.id as string,
      leaveTypeId: leaveType.body.data.id as string,
      ayeshaAgent: await loginAs(app, 'ayesha@saylani.test'),
      hrAgent: await loginAs(app, 'hr@saylani.test'),
      ghostAgent: await loginAs(app, 'ghost@saylani.test'),
    }
  }

  async function ask(agent: ReturnType<typeof request.agent>, message: string) {
    return agent.post('/api/v1/assistant/chat').send({ message })
  }

  describe('access', () => {
    it('requires a session and a question', async () => {
      expect((await request(app).post('/api/v1/assistant/chat').send({ message: 'hi' })).status).toBe(401)

      const { admin } = await seed()
      const empty = await agentEmptyMessage(admin)
      expect(empty.status).toBe(400)
      expect(empty.body.error.code).toBe('VALIDATION_ERROR')
    })

    async function agentEmptyMessage(agent: ReturnType<typeof request.agent>) {
      return agent.post('/api/v1/assistant/chat').send({ message: '' })
    }

    it('offers role-specific prompts', async () => {
      const { admin, ayeshaAgent } = await seed()

      const adminPrompts = await admin.get('/api/v1/assistant/suggestions')
      expect(adminPrompts.status).toBe(200)
      expect(adminPrompts.body.data.suggestions.length).toBeGreaterThan(0)

      const employeePrompts = await ayeshaAgent.get('/api/v1/assistant/suggestions')
      expect(employeePrompts.body.data.suggestions).toContain('How many leave days do I have left?')
    })
  })

  describe('company questions', () => {
    it('counts the workforce by department', async () => {
      const { admin } = await seed()

      const res = await ask(admin, 'How many employees do we have?')
      expect(res.status).toBe(200)
      expect(res.body.data.intent).toBe('headcount')
      expect(res.body.data.provider).toBe('rules')
      expect(res.body.data.answer).toContain('2 active employee(s)')
      expect(res.body.data.tools[0].data.total).toBe(2)
    })

    it('reports today\'s attendance', async () => {
      const { admin, ayeshaId } = await seed()
      await admin
        .post('/api/v1/attendance/mark')
        .send({ employeeId: ayeshaId, date: todayKey(), status: 'absent' })

      const res = await ask(admin, 'Who is absent today?')
      expect(res.body.data.intent).toBe('attendance_today')
      expect(res.body.data.answer).toContain('Ayesha Khan')
      expect(res.body.data.tools[0].data.absent).toBe(1)
      expect(res.body.data.tools[0].data.notMarked).toBe(1)
    })

    it('summarises the approval queue', async () => {
      const { admin, ayeshaAgent, leaveTypeId } = await seed()
      const year = todayKey().slice(0, 4)

      await ayeshaAgent.post('/api/v1/leave/requests').send({
        leaveTypeId,
        startDate: `${year}-09-07`,
        endDate: `${year}-09-08`,
        reason: 'Family commitment out of town',
      })

      const res = await ask(admin, 'What is pending for approval?')
      expect(res.body.data.intent).toBe('pending_approvals')
      expect(res.body.data.answer).toContain('1 leave request(s)')
      expect(res.body.data.tools[0].data.leaveRequests).toBe(1)
    })

    it('reports payroll once a run is finalized', async () => {
      const { admin, ayeshaId } = await seed()

      await admin
        .put(`/api/v1/payroll/structures/${ayeshaId}`)
        .send({ baseSalary: 100_000, taxPercent: 10 })
      const run = await admin.post('/api/v1/payroll/runs').send({ year: 2024, month: 6 })
      await admin.post(`/api/v1/payroll/runs/${run.body.data.id}/finalize`).expect(200)

      const res = await ask(admin, 'What did payroll cost last month?')
      expect(res.body.data.intent).toBe('payroll')
      expect(res.body.data.answer).toContain('June 2024')
      expect(res.body.data.answer).toContain('PKR 90,000')
      expect(res.body.data.tools[0].data.latestFinalized.periodKey).toBe('2024-06')
    })

    it('looks a person up in the directory', async () => {
      const { admin } = await seed()

      const res = await ask(admin, 'Find Ayesha in the directory')
      expect(res.body.data.intent).toBe('employee_lookup')
      expect(res.body.data.tools[0].data.matches).toHaveLength(1)

      const match = res.body.data.tools[0].data.matches[0]
      expect(match.fullName).toBe('Ayesha Khan')
      expect(match.departmentName).toBe('Engineering')
      expect(res.body.data.answer).toContain('Ayesha Khan')
    })

    it('says so when nobody matches', async () => {
      const { admin } = await seed()

      const res = await ask(admin, 'Find Zainab in the directory')
      expect(res.body.data.tools[0].data.matches).toHaveLength(0)
      expect(res.body.data.answer).toContain('could not find')
    })
  })

  describe('self-service questions', () => {
    it('reads the caller\'s own leave balance', async () => {
      const { admin, ayeshaAgent, leaveTypeId } = await seed()
      const year = todayKey().slice(0, 4)

      const applied = await ayeshaAgent.post('/api/v1/leave/requests').send({
        leaveTypeId,
        startDate: `${year}-03-02`,
        endDate: `${year}-03-08`,
        reason: 'Annual family holiday',
      })
      expect(applied.status).toBe(201)

      await admin
        .patch(`/api/v1/leave/requests/${applied.body.data.id}/decision`)
        .send({ decision: 'approved' })
        .expect(200)

      const res = await ask(ayeshaAgent, 'How many leave days do I have left?')
      expect(res.body.data.intent).toBe('leave_balance')

      const balance = res.body.data.tools[0].data.balances[0]
      expect(balance.name).toBe('Annual')
      expect(balance.entitled).toBe(20)
      expect(balance.used).toBeGreaterThan(0)
      expect(balance.available).toBeLessThan(20)
      expect(res.body.data.answer).toContain('Annual')
    })

    it('tells an unlinked account why there is no balance', async () => {
      const { ghostAgent } = await seed()

      const res = await ask(ghostAgent, 'What is my leave balance?')
      expect(res.status).toBe(200)
      expect(res.body.data.tools).toHaveLength(0)
      expect(res.body.data.answer).toContain('not linked to an employee record')
    })

    it('keeps company-wide figures away from employees', async () => {
      const { ayeshaAgent } = await seed()

      const res = await ask(ayeshaAgent, 'How many employees do we have?')
      expect(res.status).toBe(200)
      expect(res.body.data.tools).toHaveLength(0)
      expect(res.body.data.answer).toContain('HR and admin')
    })
  })

  describe('fallback', () => {
    it('admits what it cannot do instead of inventing an answer', async () => {
      const { admin } = await seed()

      const res = await ask(admin, 'What is the weather in Karachi?')
      expect(res.status).toBe(200)
      expect(res.body.data.intent).toBe('help')
      expect(res.body.data.tools).toHaveLength(0)
      expect(res.body.data.answer).toContain('I can answer questions')
    })
  })
})