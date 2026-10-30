import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'
import { computeAmounts } from '../src/modules/payroll/payroll.service.js'

/** June 2024 has 20 working days (30 days minus 5 Saturdays and 5 Sundays). */
const YEAR = 2024
const MONTH = 6

/** Supertest has no built-in binary parser, so collect the raw bytes ourselves. */
type BinaryStream = { on: (event: string, listener: (chunk: Buffer) => void) => unknown }

function collectBinary(res: BinaryStream, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = []
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
  res.on('end', () => callback(null, Buffer.concat(chunks)))
  res.on('error', (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), Buffer.alloc(0)))
}

describe('Payroll', () => {
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

  async function seed() {
    const admin = await loginAs(app, ADMIN.email)
    await createUser({ email: 'hr@saylani.test', fullName: 'Hina Rahman', role: 'hr' })

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

    const ayesha = await admin.post('/api/v1/employees').send({
      fullName: 'Ayesha Khan',
      email: 'ayesha@saylani.test',
      joinDate: '2024-01-15',
      userId: String(ayeshaUser._id),
    })
    const bilal = await admin.post('/api/v1/employees').send({
      fullName: 'Bilal Ahmed',
      email: 'bilal@saylani.test',
      joinDate: '2024-02-01',
      userId: String(bilalUser._id),
    })
    expect(ayesha.status).toBe(201)
    expect(bilal.status).toBe(201)

    const ayeshaId = ayesha.body.data.id as string
    const bilalId = bilal.body.data.id as string

    await admin
      .put(`/api/v1/payroll/structures/${ayeshaId}`)
      .send({
        baseSalary: 100_000,
        allowances: [{ label: 'House rent', amount: 20_000 }],
        deductions: [{ label: 'EOBI', amount: 500 }],
        taxPercent: 10,
        effectiveFrom: '2024-01-01',
      })
      .expect(200)

    await admin
      .put(`/api/v1/payroll/structures/${bilalId}`)
      .send({ baseSalary: 50_000, effectiveFrom: '2024-02-01' })
      .expect(200)

    return {
      admin,
      ayeshaId,
      bilalId,
      hrAgent: await loginAs(app, 'hr@saylani.test'),
      ayeshaAgent: await loginAs(app, 'ayesha@saylani.test'),
    }
  }

  describe('money arithmetic', () => {
    it('derives gross, tax, unpaid absence and net in one place', () => {
      const pay = computeAmounts(
        {
          baseSalary: 100_000,
          allowances: [{ label: 'House rent', amount: 20_000 }],
          deductions: [{ label: 'EOBI', amount: 500 }],
          taxPercent: 10,
        },
        2,
        20,
      )

      // gross 120,000 | tax 12,000 | unpaid 120,000 / 20 * 2 = 12,000
      expect(pay).toEqual({
        gross: 120_000,
        tax: 12_000,
        unpaidDeduction: 12_000,
        totalDeductions: 24_500,
        net: 95_500,
      })
    })

    it('never lets an absent-free month be penalised', () => {
      const pay = computeAmounts(
        { baseSalary: 50_000, allowances: [], deductions: [], taxPercent: 0 },
        0,
        20,
      )
      expect(pay.net).toBe(50_000)
    })
  })

  describe('salary structures', () => {
    it('stores one structure per employee and replaces it on repeat', async () => {
      const { admin, ayeshaId } = await seed()

      const list = await admin.get('/api/v1/payroll/structures')
      expect(list.status).toBe(200)
      expect(list.body.data).toHaveLength(2)

      const ayesha = list.body.data.find(
        (entry: { employeeId: string }) => entry.employeeId === ayeshaId,
      )
      expect(ayesha.grossSalary).toBe(120_000)
      expect(ayesha.employeeName).toBe('Ayesha Khan')

      const replaced = await admin
        .put(`/api/v1/payroll/structures/${ayeshaId}`)
        .send({ baseSalary: 110_000, taxPercent: 10, effectiveFrom: '2024-06-01' })

      expect(replaced.status).toBe(200)
      expect(replaced.body.data.baseSalary).toBe(110_000)
      expect(replaced.body.data.grossSalary).toBe(110_000)
      expect(await admin.get('/api/v1/payroll/structures')).toHaveProperty('body.data.length', 2)
    })

    it('refuses a structure for an unknown employee and blocks employees entirely', async () => {
      const { admin, ayeshaAgent, ayeshaId } = await seed()

      const unknown = await admin
        .put('/api/v1/payroll/structures/64b7f1c2a9d3e4f5a6b7c8d9')
        .send({ baseSalary: 1000 })
      expect(unknown.status).toBe(404)

      const denied = await ayeshaAgent
        .put(`/api/v1/payroll/structures/${ayeshaId}`)
        .send({ baseSalary: 999_999 })
      expect(denied.status).toBe(403)
      expect(denied.body.error.code).toBe('FORBIDDEN')
    })
  })
  describe('draft runs', () => {
    it('drafts a period from the stored structures', async () => {
      const { admin } = await seed()

      const res = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })

      expect(res.status).toBe(201)
      expect(res.body.data.periodKey).toBe('2024-06')
      expect(res.body.data.status).toBe('draft')
      expect(res.body.data.workingDays).toBe(20)
      expect(res.body.data.totals).toEqual({
        headcount: 2,
        gross: 170_000,
        deductions: 12_500,
        tax: 12_000,
        net: 157_500,
      })
    })

    it('is idempotent for the same period while the run is a draft', async () => {
      const { admin } = await seed()

      const first = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })
      const second = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })

      expect(first.status).toBe(201)
      expect(second.status).toBe(200)
      expect(second.body.data.id).toBe(first.body.data.id)
      expect(await admin.get(`/api/v1/payroll/runs/${first.body.data.id}`)).toHaveProperty(
        'body.data.lines.length',
        2,
      )
    })

    it('deducts pro-rata pay for recorded absences on recompute', async () => {
      const { admin, ayeshaId } = await seed()

      const run = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })
      const runId = run.body.data.id as string

      // Two unexplained absences in June 2024 for the employee on 120,000 gross.
      for (const date of ['2024-06-03', '2024-06-04']) {
        await admin
          .post('/api/v1/attendance/mark')
          .send({ employeeId: ayeshaId, date, status: 'absent' })
          .expect(200)
      }

      const recomputed = await admin.post(`/api/v1/payroll/runs/${runId}/recompute`)
      expect(recomputed.status).toBe(200)

      const detail = await admin.get(`/api/v1/payroll/runs/${runId}`)
      const line = detail.body.data.lines.find(
        (entry: { employeeId: string }) => entry.employeeId === ayeshaId,
      )

      expect(line.absentDays).toBe(2)
      expect(line.gross).toBe(120_000)
      expect(line.tax).toBe(12_000)
      expect(line.unpaidDeduction).toBe(12_000)
      expect(line.totalDeductions).toBe(24_500)
      expect(line.net).toBe(95_500)

      expect(recomputed.body.data.totals.gross).toBe(170_000)
      expect(recomputed.body.data.totals.net).toBe(145_500)
    })
  })

  describe('finalization', () => {
    it('allows only an admin to finalize, and makes the run immutable', async () => {
      const { admin, hrAgent } = await seed()

      const run = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })
      const runId = run.body.data.id as string

      const hrAttempt = await hrAgent.post(`/api/v1/payroll/runs/${runId}/finalize`)
      expect(hrAttempt.status).toBe(403)
      expect(hrAttempt.body.error.code).toBe('FORBIDDEN')

      const finalized = await admin.post(`/api/v1/payroll/runs/${runId}/finalize`)
      expect(finalized.status).toBe(200)
      expect(finalized.body.data.status).toBe('finalized')
      expect(finalized.body.data.finalizedAt).not.toBeNull()

      const recompute = await admin.post(`/api/v1/payroll/runs/${runId}/recompute`)
      expect(recompute.status).toBe(409)

      const redraft = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })
      expect(redraft.status).toBe(409)
      expect(redraft.body.error.message).toContain('already been finalized')
    })

    it('refuses to finalize a period with no salary structures', async () => {
      const { admin } = await seed()

      // Removing both structures leaves nothing to pay.
      await admin.delete('/api/v1/payroll/structures/64b7f1c2a9d3e4f5a6b7c8d9').expect(404)
      const detail = await admin.get('/api/v1/payroll/structures')
      for (const structure of detail.body.data) {
        await admin.delete(`/api/v1/payroll/structures/${structure.employeeId}`).expect(200)
      }

      const run = await admin.post('/api/v1/payroll/runs').send({ year: 2024, month: 7 })
      expect(run.body.data.totals.headcount).toBe(0)

      const finalize = await admin.post(`/api/v1/payroll/runs/${run.body.data.id}/finalize`)
      expect(finalize.status).toBe(422)
      expect(finalize.body.error.message).toContain('no employee has a salary structure')
    })
  })

  describe('payslips', () => {
    it('publishes a payslip to the employee only after finalization', async () => {
      const { admin, ayeshaAgent } = await seed()

      const run = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })
      const runId = run.body.data.id as string

      expect((await ayeshaAgent.get('/api/v1/payroll/payslips')).body.data).toHaveLength(0)

      await admin.post(`/api/v1/payroll/runs/${runId}/finalize`).expect(200)

      const slips = await ayeshaAgent.get('/api/v1/payroll/payslips')
      expect(slips.status).toBe(200)
      expect(slips.body.data).toHaveLength(1)
      expect(slips.body.data[0].periodLabel).toBe('June 2024')
      expect(slips.body.data[0].net).toBe(107_500)

      const one = await ayeshaAgent.get(`/api/v1/payroll/payslips/${runId}`)
      expect(one.status).toBe(200)
      expect(one.body.data.line.fullName).toBe('Ayesha Khan')
      expect(one.body.data.periodLabel).toBe('June 2024')
    })

    it('serves the payslip as a real PDF file', async () => {
      const { admin, ayeshaAgent, ayeshaId } = await seed()

      const run = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })
      const runId = run.body.data.id as string
      await admin.post(`/api/v1/payroll/runs/${runId}/finalize`).expect(200)

      const own = await ayeshaAgent
        .get(`/api/v1/payroll/payslips/${runId}/pdf`)
        .buffer(true)
        .parse(collectBinary)
      expect(own.status).toBe(200)
      expect(own.headers['content-type']).toContain('application/pdf')
      expect(own.headers['content-disposition']).toContain('attachment')

      const pdf = own.body as Buffer
      expect(Buffer.isBuffer(pdf)).toBe(true)
      expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
      expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF')
      const pdfText = pdf.toString('latin1')
      expect(pdfText).toContain('PAYSLIP')
      expect(pdfText).toContain('Ayesha Khan')
      expect(pdfText).toContain('NET PAY')
      expect(pdf.length).toBeGreaterThan(1_000)

      const viaHr = await admin
        .get(`/api/v1/payroll/runs/${runId}/payslips/${ayeshaId}/pdf`)
        .buffer(true)
        .parse(collectBinary)
      expect(viaHr.status).toBe(200)
      expect(viaHr.headers['content-type']).toContain('application/pdf')
      expect((viaHr.body as Buffer).subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
    })

    it('keeps the payroll register away from employees', async () => {
      const { admin, hrAgent, ayeshaAgent } = await seed()

      const run = await admin.post('/api/v1/payroll/runs').send({ year: YEAR, month: MONTH })

      expect((await ayeshaAgent.get('/api/v1/payroll/runs')).status).toBe(403)
      expect((await ayeshaAgent.get('/api/v1/payroll/structures')).status).toBe(403)

      const register = await hrAgent.get('/api/v1/payroll/runs')
      expect(register.status).toBe(200)
      expect(register.body.data).toHaveLength(1)

      expect((await hrAgent.get(`/api/v1/payroll/runs/${run.body.data.id}`)).status).toBe(200)
    })

    it('returns 404 for an unknown run', async () => {
      const { admin } = await seed()

      expect((await admin.get('/api/v1/payroll/runs/64b7f1c2a9d3e4f5a6b7c8d9')).status).toBe(404)
      expect((await admin.post('/api/v1/payroll/runs/64b7f1c2a9d3e4f5a6b7c8d9/finalize')).status).toBe(
        404,
      )
    })
  })
})