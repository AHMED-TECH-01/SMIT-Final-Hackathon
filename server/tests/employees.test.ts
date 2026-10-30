import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { EmployeeModel } from '../src/modules/employees/employee.model.js'

const CSV = [
  'fullName,email,department,designation,joinDate,employmentType',
  'Ayesha Khan,ayesha@saylani.test,Engineering,Engineer,2024-01-15,full-time',
  'Bilal Ahmed,bilal@saylani.test,Engineering,Engineer,2024-03-01,contract',
  'Broken Row,,Engineering,,not-a-date,full-time',
  'No Department,nobody@saylani.test,Marketing,,2024-05-05,full-time',
].join('\n')

describe('Employees', () => {
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

  async function seedOrg() {
    const admin = await loginAs(app, ADMIN.email)
    const department = await admin.post('/api/v1/departments').send({ name: 'Engineering' })
    const designation = await admin
      .post('/api/v1/designations')
      .send({ title: 'Engineer', departmentId: department.body.data.id })

    return {
      admin,
      departmentId: department.body.data.id as string,
      designationId: designation.body.data.id as string,
    }
  }

  describe('create and read', () => {
    it('assigns sequential employee codes when none is supplied', async () => {
      const { admin, departmentId } = await seedOrg()

      const first = await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Ayesha Khan', joinDate: '2024-01-15', departmentId })
      const second = await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Bilal Ahmed', joinDate: '2024-02-01' })

      expect(first.status).toBe(201)
      expect(first.body.data.employeeCode).toBe('EMP-0001')
      expect(first.body.data.departmentName).toBe('Engineering')
      expect(second.body.data.employeeCode).toBe('EMP-0002')
    })

    it('rejects a duplicate employee code with 409', async () => {
      const { admin } = await seedOrg()
      await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Ayesha Khan', employeeCode: 'EMP-001', joinDate: '2024-01-15' })
        .expect(201)

      const dup = await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Other Person', employeeCode: 'EMP-001', joinDate: '2024-02-01' })

      expect(dup.status).toBe(409)
      expect(dup.body.error.code).toBe('CONFLICT')
    })

    it('rejects an unknown department with 422', async () => {
      const { admin } = await seedOrg()

      const res = await admin.post('/api/v1/employees').send({
        fullName: 'Lost Person',
        joinDate: '2024-01-15',
        departmentId: '64b7f9f2f1f1f1f1f1f1f1f1',
      })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('UNPROCESSABLE')
    })

    it('refuses employees and allows HR to register people', async () => {
      await createUser({ email: 'hr@saylani.test', role: 'hr' })
      await createUser({ email: 'employee@saylani.test', role: 'employee' })
      const hr = await loginAs(app, 'hr@saylani.test')
      const employee = await loginAs(app, 'employee@saylani.test')

      await hr
        .post('/api/v1/employees')
        .send({ fullName: 'Hira Shah', joinDate: '2024-04-01' })
        .expect(201)

      const denied = await employee
        .post('/api/v1/employees')
        .send({ fullName: 'Should Fail', joinDate: '2024-04-01' })
      expect(denied.status).toBe(403)
    })

    it('returns Employee 360 with the manager and direct reports', async () => {
      const { admin } = await seedOrg()
      const manager = await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Manager One', joinDate: '2023-01-01' })
      const report = await admin.post('/api/v1/employees').send({
        fullName: 'Report One',
        joinDate: '2024-01-01',
        managerId: manager.body.data.id,
      })

      const res = await admin.get(`/api/v1/employees/${manager.body.data.id}`)

      expect(res.status).toBe(200)
      expect(res.body.data.employee.fullName).toBe('Manager One')
      expect(res.body.data.directReports).toBe(1)
      expect(report.body.data.managerId).toBe(manager.body.data.id)
    })
  })

  describe('directory', () => {
    it('searches by name, code and email', async () => {
      const { admin } = await seedOrg()
      await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Ayesha Khan', email: 'ayesha@saylani.test', joinDate: '2024-01-15' })
      await admin.post('/api/v1/employees').send({ fullName: 'Bilal Ahmed', joinDate: '2024-02-01' })

      const byName = await admin.get('/api/v1/employees?q=ayesha')
      expect(byName.body.meta.total).toBe(1)
      expect(byName.body.data[0].fullName).toBe('Ayesha Khan')

      const byCode = await admin.get('/api/v1/employees?q=EMP-0002')
      expect(byCode.body.data[0].fullName).toBe('Bilal Ahmed')
    })

    it('filters by department and paginates', async () => {
      const { admin, departmentId } = await seedOrg()
      for (let i = 1; i <= 5; i += 1) {
        await admin
          .post('/api/v1/employees')
          .send({ fullName: `Engineer ${i}`, joinDate: '2024-01-01', departmentId })
      }
      await admin.post('/api/v1/employees').send({ fullName: 'Outsider', joinDate: '2024-01-01' })

      const filtered = await admin.get(`/api/v1/employees?departmentId=${departmentId}`)
      expect(filtered.body.meta.total).toBe(5)

      const page2 = await admin.get('/api/v1/employees?page=2&limit=2')
      expect(page2.body.data).toHaveLength(2)
      expect(page2.body.meta.pages).toBe(3)
    })

    it('updates an employee and refuses self-management', async () => {
      const { admin } = await seedOrg()
      const created = await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Solo Person', joinDate: '2024-01-01' })
      const id = created.body.data.id

      const updated = await admin
        .patch(`/api/v1/employees/${id}`)
        .send({ phone: '+92-300-1234567' })
      expect(updated.status).toBe(200)
      expect(updated.body.data.phone).toBe('+92-300-1234567')

      const selfManager = await admin.patch(`/api/v1/employees/${id}`).send({ managerId: id })
      expect(selfManager.status).toBe(422)
    })

    it('archives instead of hard-deleting', async () => {
      const { admin } = await seedOrg()
      const created = await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Leaving Person', joinDate: '2024-01-01' })

      const res = await admin.post(`/api/v1/employees/${created.body.data.id}/archive`)

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe('terminated')
      expect(await EmployeeModel.countDocuments()).toBe(1)
    })
  })

  describe('CSV import and export', () => {
    it('dry-runs an import without writing anything', async () => {
      const { admin } = await seedOrg()

      const res = await admin.post('/api/v1/employees/import').send({ csv: CSV })

      expect(res.status).toBe(200)
      expect(res.body.data.dryRun).toBe(true)
      expect(res.body.data.totalRows).toBe(4)
      expect(res.body.data.validRows).toBe(2)
      expect(res.body.data.invalidRows).toBe(2)
      expect(res.body.data.imported).toBe(0)
      expect(await EmployeeModel.countDocuments()).toBe(0)
    })

    it('reports why rows were rejected', async () => {
      const { admin } = await seedOrg()

      const res = await admin.post('/api/v1/employees/import').send({ csv: CSV })
      const messages = res.body.data.errors.map((e: { message: string }) => e.message).join(' | ')

      expect(messages).toContain('Join date')
      expect(messages).toContain('Unknown department: Marketing')
    })

    it('commits the valid rows when asked to', async () => {
      const { admin } = await seedOrg()

      const res = await admin.post('/api/v1/employees/import').send({ csv: CSV, commit: true })

      expect(res.body.data.imported).toBe(2)
      expect(await EmployeeModel.countDocuments()).toBe(2)

      const stored = await EmployeeModel.findOne({ fullName: 'Ayesha Khan' })
      expect(stored?.employeeCode).toBe('EMP-0001')
      expect(stored?.departmentId).toBeTruthy()
    })

    it('exports a CSV document', async () => {
      const { admin } = await seedOrg()
      await admin
        .post('/api/v1/employees')
        .send({ fullName: 'Ayesha Khan', email: 'ayesha@saylani.test', joinDate: '2024-01-15' })

      const res = await admin.get('/api/v1/employees/export')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.text.split('\n')[0]).toContain('employeeCode')
      expect(res.text).toContain('Ayesha Khan')
    })

    it('denies export to an employee without report.export', async () => {
      await createUser({ email: 'employee@saylani.test', role: 'employee' })
      const employee = await loginAs(app, 'employee@saylani.test')

      const res = await employee.get('/api/v1/employees/export')
      expect(res.status).toBe(403)
    })
  })
})