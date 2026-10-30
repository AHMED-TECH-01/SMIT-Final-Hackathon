import { Router } from 'express'
import { z } from 'zod'
import { createCrudRouter } from '../../lib/crud-router.js'
import { conflict } from '../../lib/http-error.js'
import { DepartmentModel, toPublicDepartment } from './department.model.js'
import { DesignationModel, toPublicDesignation } from './designation.model.js'
import { LeaveTypeModel, toPublicLeaveType } from './leave-type.model.js'
import { HolidayModel, toPublicHoliday } from './holiday.model.js'
import { EmployeeModel } from '../employees/employee.model.js'

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier.')

const departmentBody = z.object({
  name: z.string().trim().min(2, 'Enter a department name.').max(120),
  code: z.string().trim().min(2).max(20).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
})

const designationBody = z.object({
  title: z.string().trim().min(2, 'Enter a designation title.').max(120),
  departmentId: objectId.optional(),
  grade: z.string().trim().max(20).optional(),
  isActive: z.boolean().optional(),
})

const leaveTypeBody = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(12),
  annualQuota: z.coerce.number().int().min(0).max(366),
  paid: z.boolean().optional(),
  carryForward: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

const holidayBody = z.object({
  name: z.string().trim().min(2).max(120),
  date: z.coerce.date(),
  optional: z.boolean().optional(),
})

/** Departments and designations cannot be deleted while employees point at them. */
async function assertNoEmployees(filter: Record<string, unknown>, label: string): Promise<void> {
  const count = await EmployeeModel.countDocuments(filter)
  if (count > 0) {
    throw conflict(`${label} cannot be deleted while ${count} employee(s) still reference it.`)
  }
}

export const departmentsRouter: Router = createCrudRouter({
  entity: 'department',
  model: DepartmentModel,
  readPermission: 'organization.read',
  writePermission: 'organization.manage',
  createSchema: departmentBody,
  updateSchema: departmentBody.partial(),
  searchFields: ['name', 'code'],
  sort: { name: 1 },
  toPublic: toPublicDepartment,
  beforeDelete: (id) => assertNoEmployees({ departmentId: id }, 'This department'),
})

export const designationsRouter: Router = createCrudRouter({
  entity: 'designation',
  model: DesignationModel,
  readPermission: 'organization.read',
  writePermission: 'organization.manage',
  createSchema: designationBody,
  updateSchema: designationBody.partial(),
  searchFields: ['title'],
  sort: { title: 1 },
  populate: [{ path: 'departmentId', select: 'name' }],
  toPublic: toPublicDesignation,
  beforeDelete: (id) => assertNoEmployees({ designationId: id }, 'This designation'),
})

export const leaveTypesRouter: Router = createCrudRouter({
  entity: 'leave_type',
  model: LeaveTypeModel,
  readPermission: 'organization.read',
  writePermission: 'organization.manage',
  createSchema: leaveTypeBody,
  updateSchema: leaveTypeBody.partial(),
  searchFields: ['name', 'code'],
  sort: { name: 1 },
  toPublic: toPublicLeaveType,
})

export const holidaysRouter: Router = createCrudRouter({
  entity: 'holiday',
  model: HolidayModel,
  readPermission: 'organization.read',
  writePermission: 'organization.manage',
  createSchema: holidayBody,
  updateSchema: holidayBody.partial(),
  searchFields: ['name'],
  sort: { date: 1 },
  toPublic: toPublicHoliday,
})