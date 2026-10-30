import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { EmployeeModel } from '../src/modules/employees/employee.model.js'
import { AuditLogModel } from '../src/modules/audit/audit.model.js'

describe('Organization master data', () => {
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

  describe('departments', () => {
    it('creates a department and lists it with pagination meta', async () => {
      const admin = await loginAs(app, ADMIN.email)

      const created = await admin
        .post('/api/v1/departments')
        .send({ name: 'Engineering', code: 'eng', description: 'Builds the product' })

      expect(created.status).toBe(201)
      expect(created.body.data.name).toBe('Engineering')
      expect(created.body.data.code).toBe('ENG')

      const list = await admin.get('/api/v1/departments')
      expect(list.status).toBe(200)
      expect(list.body.meta.total).toBe(1)
      expect(list.body.data[0].name).toBe('Engineering')
    })

    it('refuses a duplicate department name with 409', async () => {
      const admin = await loginAs(app, ADMIN.email)
      await admin.post('/api/v1/departments').send({ name: 'Finance' }).expect(201)

      const dup = await admin.post('/api/v1/departments').send({ name: 'Finance' })

      expect(dup.status).toBe(409)
      expect(dup.body.error.code).toBe('CONFLICT')
    })

    it('rejects an empty name with 400 and field details', async () => {
      const admin = await loginAs(app, ADMIN.email)

      const res = await admin.post('/api/v1/departments').send({ name: 'A' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.details[0].field).toBe('name')
    })

    it('lets HR manage departments but refuses employees', async () => {
      await createUser({ email: 'hr@saylani.test', role: 'hr' })
      await createUser({ email: 'employee@saylani.test', role: 'employee' })
      const hr = await loginAs(app, 'hr@saylani.test')
      const employee = await loginAs(app, 'employee@saylani.test')

      await hr.post('/api/v1/departments').send({ name: 'Operations' }).expect(201)

      const denied = await employee.post('/api/v1/departments').send({ name: 'Shadow IT' })
      expect(denied.status).toBe(403)
      expect(denied.body.error.code).toBe('FORBIDDEN')

      // Reading the org chart is allowed for everyone.
      const canRead = await employee.get('/api/v1/departments')
      expect(canRead.status).toBe(200)
    })

    it('updates a department', async () => {
      const admin = await loginAs(app, ADMIN.email)
      const created = await admin.post('/api/v1/departments').send({ name: 'Sales' })
      const id = created.body.data.id

      const updated = await admin
        .patch(`/api/v1/departments/${id}`)
        .send({ description: 'Revenue team' })

      expect(updated.status).toBe(200)
      expect(updated.body.data.description).toBe('Revenue team')
      expect(updated.body.data.name).toBe('Sales')
    })

    it('is searchable with ?q=', async () => {
      const admin = await loginAs(app, ADMIN.email)
      await admin.post('/api/v1/departments').send({ name: 'Engineering' }).expect(201)
      await admin.post('/api/v1/departments').send({ name: 'Finance' }).expect(201)

      const res = await admin.get('/api/v1/departments?q=fin')

      expect(res.body.meta.total).toBe(1)
      expect(res.body.data[0].name).toBe('Finance')
    })

    it('deletes an unused department and records an audit entry', async () => {
      const admin = await loginAs(app, ADMIN.email)
      const created = await admin.post('/api/v1/departments').send({ name: 'Temp' })
      const id = created.body.data.id

      const res = await admin.delete(`/api/v1/departments/${id}`)
      expect(res.status).toBe(200)
      expect(res.body.data.deleted).toBe(true)

      const audit = await AuditLogModel.findOne({ entity: 'department', action: 'create' })
      expect(audit).not.toBeNull()
      expect(audit?.actorEmail).toBe(ADMIN.email)
    })

    it('refuses to delete a department that still has employees', async () => {
      const admin = await loginAs(app, ADMIN.email)
      const created = await admin.post('/api/v1/departments').send({ name: 'Support' })
      const departmentId = created.body.data.id

      await EmployeeModel.create({
        employeeCode: 'EMP-001',
        fullName: 'Ayesha Khan',
        joinDate: new Date('2024-01-15'),
        departmentId,
      })

      const res = await admin.delete(`/api/v1/departments/${departmentId}`)

      expect(res.status).toBe(409)
      expect(res.body.error.message).toContain('employee')
    })

    it('returns 404 for a malformed or unknown id', async () => {
      const admin = await loginAs(app, ADMIN.email)

      const malformed = await admin.get('/api/v1/departments/not-an-id')
      expect(malformed.status).toBe(404)

      const missing = await admin.get('/api/v1/departments/64b7f9f2f1f1f1f1f1f1f1f1')
      expect(missing.status).toBe(404)
    })
  })

  describe('designations', () => {
    it('stores a designation and returns its department name', async () => {
      const admin = await loginAs(app, ADMIN.email)
      const dept = await admin.post('/api/v1/departments').send({ name: 'Engineering' })

      const created = await admin.post('/api/v1/designations').send({
        title: 'Senior Engineer',
        departmentId: dept.body.data.id,
        grade: 'L3',
      })
      expect(created.status).toBe(201)

      const list = await admin.get('/api/v1/designations')
      expect(list.body.data[0].title).toBe('Senior Engineer')
      expect(list.body.data[0].departmentName).toBe('Engineering')
    })
  })

  describe('leave types and holidays', () => {
    it('creates a leave type with a quota', async () => {
      const admin = await loginAs(app, ADMIN.email)

      const res = await admin.post('/api/v1/leave-types').send({
        name: 'Annual Leave',
        code: 'AL',
        annualQuota: 20,
      })

      expect(res.status).toBe(201)
      expect(res.body.data.annualQuota).toBe(20)
      expect(res.body.data.paid).toBe(true)
    })

    it('rejects a negative quota with 400', async () => {
      const admin = await loginAs(app, ADMIN.email)

      const res = await admin
        .post('/api/v1/leave-types')
        .send({ name: 'Broken', code: 'BR', annualQuota: -5 })

      expect(res.status).toBe(400)
    })

    it('accepts a holiday date and lists holidays chronologically', async () => {
      const admin = await loginAs(app, ADMIN.email)
      await admin.post('/api/v1/holidays').send({ name: 'Independence Day', date: '2026-08-14' }).expect(201)
      await admin.post('/api/v1/holidays').send({ name: 'New Year', date: '2026-01-01' }).expect(201)

      const list = await admin.get('/api/v1/holidays')

      expect(list.body.meta.total).toBe(2)
      expect(list.body.data[0].name).toBe('New Year')
    })
  })
})