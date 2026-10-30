import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js'
import { UserModel } from '../../src/modules/auth/user.model.js'
import { CompanyModel } from '../../src/modules/organization/company.model.js'
import { DepartmentModel } from '../../src/modules/organization/department.model.js'
import { DesignationModel } from '../../src/modules/organization/designation.model.js'
import { HolidayModel } from '../../src/modules/organization/holiday.model.js'
import { LeaveTypeModel } from '../../src/modules/organization/leave-type.model.js'
import { EmployeeModel } from '../../src/modules/employees/employee.model.js'
import { AttendanceModel } from '../../src/modules/attendance/attendance.model.js'
import { AuditLogModel } from '../../src/modules/audit/audit.model.js'
import { AnnouncementModel } from '../../src/modules/announcements/announcement.model.js'
import { NotificationModel } from '../../src/modules/notifications/notification.model.js'
import { LeaveRequestModel } from '../../src/modules/leave/leave.model.js'
import {
  PayrollLineModel,
  PayrollRunModel,
  SalaryStructureModel,
} from '../../src/modules/payroll/payroll.model.js'

let mongod: MongoMemoryServer | undefined

/** Every model that declares a unique index must be initialised before tests. */
const INDEXED_MODELS = [
  UserModel,
  CompanyModel,
  DepartmentModel,
  DesignationModel,
  HolidayModel,
  LeaveTypeModel,
  EmployeeModel,
  AttendanceModel,
  AuditLogModel,
  LeaveRequestModel,
  SalaryStructureModel,
  PayrollRunModel,
  PayrollLineModel,
  AnnouncementModel,
  NotificationModel,
]

/** Boots an isolated in-memory MongoDB and connects Mongoose to it. */
export async function startTestDb(): Promise<void> {
  mongod = await MongoMemoryServer.create()
  await connectDatabase(mongod.getUri())

  // Unique indexes must exist before duplicate-key behaviour is asserted.
  await Promise.all(INDEXED_MODELS.map((model) => model.init()))
}

export async function stopTestDb(): Promise<void> {
  await disconnectDatabase()
  if (mongod) {
    await mongod.stop()
    mongod = undefined
  }
}

/** Wipes data between tests without dropping indexes. */
export async function clearTestDb(): Promise<void> {
  const db = mongoose.connection.db
  if (!db) return
  const collections = await db.collections()
  await Promise.all(collections.map((c) => c.deleteMany({})))
}