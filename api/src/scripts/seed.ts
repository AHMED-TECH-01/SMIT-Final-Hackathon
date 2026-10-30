import mongoose, { Types } from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { logger } from '../lib/logger.js'
import { dateKeyRange, dateKeyToUtcMidnight, zonedDateKey } from '../lib/dates.js'
import { workingDayKeys } from '../lib/working-days.js'
import { hashPassword } from '../modules/auth/session.js'
import { UserModel } from '../modules/auth/user.model.js'
import { CompanyModel } from '../modules/organization/company.model.js'
import { DepartmentModel } from '../modules/organization/department.model.js'
import { DesignationModel } from '../modules/organization/designation.model.js'
import { LeaveTypeModel } from '../modules/organization/leave-type.model.js'
import { HolidayModel } from '../modules/organization/holiday.model.js'
import { EmployeeModel } from '../modules/employees/employee.model.js'
import {
  AttendanceCorrectionModel,
  AttendanceModel,
  type AttendanceStatus,
} from '../modules/attendance/attendance.model.js'
import { LeaveRequestModel } from '../modules/leave/leave.model.js'
import { PayrollLineModel, PayrollRunModel, SalaryStructureModel } from '../modules/payroll/payroll.model.js'
import { buildRunLines, createDraftRun } from '../modules/payroll/payroll.service.js'
import { AnnouncementModel } from '../modules/announcements/announcement.model.js'
import { AuditLogModel } from '../modules/audit/audit.model.js'
import { NotificationModel } from '../modules/notifications/notification.model.js'

/**
 * Demo seed.
 *
 * Builds a single company with a realistic roster, a month of attendance, some
 * leave, salary structures and payroll history, so the dashboards, the assistant
 * and every PDF have something true to say on a fresh database.
 *
 *   npm run seed            # refuses if the database already has data
 *   npm run seed -- --reset # erases the demo collections first
 *
 * The script is deterministic: the same database always produces the same
 * figures, which makes the demo repeatable and screenshots reproducible.
 */

const TIMEZONE = 'Asia/Karachi'
const CURRENCY = 'PKR'
const DEMO_PASSWORD = 'Password123'
const DAY_MS = 86_400_000

/** Small deterministic PRNG (mulberry32) — no Math.random, so runs match. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const random = makeRandom(20261029)

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG', description: 'Product and platform engineering' },
  { name: 'People', code: 'PPL', description: 'HR, hiring and culture' },
  { name: 'Sales', code: 'SLS', description: 'New business and account management' },
  { name: 'Finance', code: 'FIN', description: 'Accounting and payroll control' },
  { name: 'Operations', code: 'OPS', description: 'Facilities and day-to-day running' },
] as const

const DESIGNATIONS = [
  { title: 'Software Engineer', department: 'Engineering', grade: 'L2' },
  { title: 'Senior Software Engineer', department: 'Engineering', grade: 'L3' },
  { title: 'HR Officer', department: 'People', grade: 'L2' },
  { title: 'HR Manager', department: 'People', grade: 'L4' },
  { title: 'Sales Executive', department: 'Sales', grade: 'L2' },
  { title: 'Accountant', department: 'Finance', grade: 'L3' },
  { title: 'Operations Lead', department: 'Operations', grade: 'L4' },
  { title: 'Operations Assistant', department: 'Operations', grade: 'L1' },
] as const

const LEAVE_TYPES = [
  { name: 'Annual leave', code: 'AL', annualQuota: 20, paid: true, carryForward: true },
  { name: 'Sick leave', code: 'SL', annualQuota: 10, paid: true, carryForward: false },
  { name: 'Casual leave', code: 'CL', annualQuota: 8, paid: true, carryForward: false },
  { name: 'Unpaid leave', code: 'UL', annualQuota: 0, paid: false, carryForward: false },
] as const

/** Fixed-date public holidays; enough for working-day arithmetic to be visible. */
const HOLIDAYS = [
  { name: 'Kashmir Day', month: 2, day: 5, optional: false },
  { name: 'Pakistan Day', month: 3, day: 23, optional: false },
  { name: 'Labour Day', month: 5, day: 1, optional: false },
  { name: 'Independence Day', month: 8, day: 14, optional: false },
  { name: 'Iqbal Day', month: 11, day: 9, optional: true },
  { name: 'Quaid-e-Azam Day', month: 12, day: 25, optional: false },
] as const

interface Person {
  fullName: string
  department: string
  designation: string
  joinDate: string
  employmentType: 'full-time' | 'part-time' | 'contract' | 'intern'
  status: 'active' | 'probation' | 'resigned' | 'terminated'
  /** Creates a login account for this person (admin sees them in Employees). */
  login?: boolean
}

const PEOPLE: Person[] = [
  { fullName: 'Ayesha Khan', department: 'Engineering', designation: 'Senior Software Engineer', joinDate: '2021-03-01', employmentType: 'full-time', status: 'active', login: true },
  { fullName: 'Bilal Ahmed', department: 'Engineering', designation: 'Software Engineer', joinDate: '2022-07-11', employmentType: 'full-time', status: 'active', login: true },
  { fullName: 'Fatima Noor', department: 'Engineering', designation: 'Software Engineer', joinDate: '2023-01-16', employmentType: 'full-time', status: 'active' },
  { fullName: 'Hassan Raza', department: 'Sales', designation: 'Sales Executive', joinDate: '2020-09-01', employmentType: 'full-time', status: 'active', login: true },
  { fullName: 'Zainab Malik', department: 'Sales', designation: 'Sales Executive', joinDate: '2023-05-22', employmentType: 'full-time', status: 'active' },
  { fullName: 'Usman Tariq', department: 'Finance', designation: 'Accountant', joinDate: '2019-11-04', employmentType: 'full-time', status: 'active' },
  { fullName: 'Maryam Siddiqui', department: 'People', designation: 'HR Manager', joinDate: '2018-02-19', employmentType: 'full-time', status: 'active' },
  { fullName: 'Imran Sheikh', department: 'Operations', designation: 'Operations Lead', joinDate: '2020-06-15', employmentType: 'full-time', status: 'active' },
  { fullName: 'Sana Iqbal', department: 'People', designation: 'HR Officer', joinDate: '2024-01-08', employmentType: 'full-time', status: 'probation' },
  { fullName: 'Ahmed Yousaf', department: 'Engineering', designation: 'Software Engineer', joinDate: '2024-08-05', employmentType: 'full-time', status: 'probation' },
  { fullName: 'Hira Aslam', department: 'Finance', designation: 'Accountant', joinDate: '2022-12-01', employmentType: 'part-time', status: 'active' },
  { fullName: 'Kamran Ali', department: 'Operations', designation: 'Operations Assistant', joinDate: '2023-09-18', employmentType: 'contract', status: 'active' },
  { fullName: 'Nida Farooq', department: 'Sales', designation: 'Sales Executive', joinDate: '2019-04-01', employmentType: 'full-time', status: 'resigned' },
]

/** Base pay by designation — the structure builder scales allowances from it. */
const BASE_SALARY: Record<string, number> = {
  'Software Engineer': 120_000,
  'Senior Software Engineer': 180_000,
  'HR Officer': 90_000,
  'HR Manager': 160_000,
  'Sales Executive': 85_000,
  Accountant: 100_000,
  'Operations Lead': 130_000,
  'Operations Assistant': 60_000,
}

function emailFor(fullName: string): string {
  return `${fullName.toLowerCase().replace(/\s+/g, '.')}@hcm.test`
}

function codeFor(index: number): string {
  return `EMP-${String(index + 1).padStart(3, '0')}`
}

function atUtcMidnight(key: string, hours = 0, minutes = 0): Date {
  return new Date(dateKeyToUtcMidnight(key).getTime() + (hours * 60 + minutes) * 60_000)
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/* ------------------------------------------------------------------ */
/* Reset                                                               */
/* ------------------------------------------------------------------ */

export async function clearDemoCollections(): Promise<void> {
  // Deleting documents keeps the unique indexes that make the seed meaningful.
  const models: mongoose.Model<any>[] = [
    NotificationModel,
    AuditLogModel,
    AnnouncementModel,
    PayrollLineModel,
    PayrollRunModel,
    SalaryStructureModel,
    LeaveRequestModel,
    AttendanceCorrectionModel,
    AttendanceModel,
    EmployeeModel,
    UserModel,
    HolidayModel,
    LeaveTypeModel,
    DesignationModel,
    DepartmentModel,
    CompanyModel,
  ]

  for (const model of models) {
    await model.deleteMany({})
  }
}

/* ------------------------------------------------------------------ */
/* Seed steps                                                          */
/* ------------------------------------------------------------------ */

async function seedDemoData(): Promise<SeedSummary> {
  const todayKey = zonedDateKey(new Date(), TIMEZONE)
  const year = Number(todayKey.slice(0, 4))

  /* Company ---------------------------------------------------------- */
  await CompanyModel.create({
    key: 'primary',
    name: 'Saylani Technologies',
    contactEmail: 'hr@saylani.test',
    contactPhone: '+92 21 111 729 526',
    address: 'Bahadurabad, Karachi',
    timezone: TIMEZONE,
    currency: CURRENCY,
    workStartMinutes: 9 * 60,
    graceMinutes: 15,
    setupComplete: true,
  })

  /* Accounts --------------------------------------------------------- */
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const admin = await UserModel.create({
    email: 'admin@hcm.test',
    fullName: 'Adeel Rehman',
    passwordHash,
    role: 'admin',
    status: 'active',
    mustChangePassword: false,
  })
  const hrUser = await UserModel.create({
    email: 'hr@hcm.test',
    fullName: 'Maryam Siddiqui',
    passwordHash,
    role: 'hr',
    status: 'active',
    mustChangePassword: false,
  })

  /* Master data ------------------------------------------------------ */
  const departments = new Map<string, Types.ObjectId>()
  for (const department of DEPARTMENTS) {
    const created = await DepartmentModel.create(department)
    departments.set(department.name, created._id)
  }

  const designations = new Map<string, Types.ObjectId>()
  for (const designation of DESIGNATIONS) {
    const created = await DesignationModel.create({
      title: designation.title,
      departmentId: departments.get(designation.department),
      grade: designation.grade,
      isActive: true,
    })
    designations.set(designation.title, created._id)
  }

  const leaveTypes = new Map<string, Types.ObjectId>()
  for (const leaveType of LEAVE_TYPES) {
    const created = await LeaveTypeModel.create(leaveType)
    leaveTypes.set(leaveType.code, created._id)
  }

  for (const holiday of HOLIDAYS) {
    await HolidayModel.create({
      name: holiday.name,
      date: new Date(Date.UTC(year, holiday.month - 1, holiday.day)),
      optional: holiday.optional,
    })
  }

  /* Employees -------------------------------------------------------- */
  interface Seeded {
    id: Types.ObjectId
    fullName: string
    code: string
    designation: string
    department: string
    status: string
    userId: Types.ObjectId | null
  }

  const employees: Seeded[] = []

  for (const [index, person] of PEOPLE.entries()) {
    const email = emailFor(person.fullName)
    let userId: Types.ObjectId | null = null

    if (person.login) {
      const user = await UserModel.create({
        email,
        fullName: person.fullName,
        passwordHash,
        role: 'employee',
        status: 'active',
        mustChangePassword: false,
      })
      userId = user._id
    }

    const employee = await EmployeeModel.create({
      employeeCode: codeFor(index),
      fullName: person.fullName,
      email,
      phone: `+92 300 ${String(1_000_000 + index * 12_345).slice(0, 7)}`,
      departmentId: departments.get(person.department),
      designationId: designations.get(person.designation),
      userId: userId ?? undefined,
      joinDate: dateKeyToUtcMidnight(person.joinDate),
      employmentType: person.employmentType,
      status: person.status,
      address: 'Karachi, Pakistan',
      emergencyContact: '+92 321 7654321',
    })

    employees.push({
      id: employee._id,
      fullName: person.fullName,
      code: employee.employeeCode,
      designation: person.designation,
      department: person.department,
      status: employee.status,
      userId,
    })
  }

  // The HR login belongs to the HR manager's employee record.
  const hrEmployee = employees.find((employee) => employee.fullName === 'Maryam Siddiqui')
  if (hrEmployee) {
    await EmployeeModel.updateOne({ _id: hrEmployee.id }, { $set: { userId: hrUser._id } })
    hrEmployee.userId = hrUser._id
  }

  /* Leave requests --------------------------------------------------- */
  const workforce = employees.filter(
    (employee) => employee.status === 'active' || employee.status === 'probation',
  )

  interface LeaveSeed {
    employee: Seeded
    typeCode: string
    from: string
    to: string
    status: 'approved' | 'pending' | 'rejected'
    reason: string
    halfDay?: boolean
  }

  const leaveSeeds: LeaveSeed[] = [
    { employee: workforce[0]!, typeCode: 'AL', from: '2026-09-14', to: '2026-09-18', status: 'approved', reason: 'Family trip to the north.' },
    { employee: workforce[1]!, typeCode: 'SL', from: '2026-09-21', to: '2026-09-21', status: 'approved', reason: 'Flu, doctor advised rest.' },
    { employee: workforce[3]!, typeCode: 'CL', from: '2026-10-02', to: '2026-10-02', status: 'approved', reason: 'Property paperwork.' },
    { employee: workforce[4]!, typeCode: 'AL', from: '2026-10-26', to: '2026-10-28', status: 'approved', reason: 'Wedding in the family.' },
    { employee: workforce[2]!, typeCode: 'SL', from: '2026-10-19', to: '2026-10-20', status: 'pending', reason: 'Dental surgery and follow-up.' },
    { employee: workforce[5]!, typeCode: 'AL', from: '2026-11-09', to: '2026-11-13', status: 'pending', reason: 'Annual leave booked with family.' },
    { employee: workforce[6]!, typeCode: 'CL', from: '2026-10-05', to: '2026-10-05', status: 'rejected', reason: 'Personal errand.' },
  ]

  /** Approved leave days, so attendance and payroll agree with the ledger. */
  const approvedLeave = new Map<string, Set<string>>()

  for (const seedItem of leaveSeeds) {
    const typeId = leaveTypes.get(seedItem.typeCode)
    if (!typeId) continue

    const days = seedItem.halfDay
      ? 0.5
      : Math.max(1, (await workingDayKeys(seedItem.from, seedItem.to, TIMEZONE)).length)

    await LeaveRequestModel.create({
      employeeId: seedItem.employee.id,
      leaveTypeId: typeId,
      startDate: dateKeyToUtcMidnight(seedItem.from),
      endDate: dateKeyToUtcMidnight(seedItem.to),
      days,
      halfDay: Boolean(seedItem.halfDay),
      reason: seedItem.reason,
      status: seedItem.status,
      decidedBy: seedItem.status === 'pending' ? undefined : hrUser._id,
      decidedAt: seedItem.status === 'pending' ? undefined : new Date(),
      decisionNote:
        seedItem.status === 'rejected' ? 'Coverage is too thin that week.' : undefined,
    })

    if (seedItem.status === 'approved') {
      const keys = approvedLeave.get(String(seedItem.employee.id)) ?? new Set<string>()
      for (const key of dateKeyRange(seedItem.from, seedItem.to)) keys.add(key)
      approvedLeave.set(String(seedItem.employee.id), keys)
    }
  }

  /* Attendance ------------------------------------------------------- */
  // Yesterday backwards, so today stays open for a live check-in in the demo.
  const windowStart = new Date(dateKeyToUtcMidnight(todayKey).getTime() - 44 * DAY_MS)
    .toISOString()
    .slice(0, 10)
  const windowEnd = new Date(dateKeyToUtcMidnight(todayKey).getTime() - DAY_MS)
    .toISOString()
    .slice(0, 10)
  const workDays = await workingDayKeys(windowStart, windowEnd, TIMEZONE)

  const attendanceRows: Record<string, unknown>[] = []

  for (const day of workDays) {
    for (const employee of workforce) {
      const onLeave = approvedLeave.get(String(employee.id))?.has(day) ?? false
      if (onLeave) {
        attendanceRows.push({
          employeeId: employee.id,
          date: dateKeyToUtcMidnight(day),
          status: 'leave' satisfies AttendanceStatus,
          minutesLate: 0,
          minutesWorked: 0,
          source: 'system',
          note: 'Approved leave',
        })
        continue
      }

      const roll = random()
      let status: AttendanceStatus = 'present'
      if (roll > 0.93) status = 'absent'
      else if (roll > 0.86) status = 'remote'
      else if (roll > 0.74) status = 'late'

      if (status === 'absent') {
        attendanceRows.push({
          employeeId: employee.id,
          date: dateKeyToUtcMidnight(day),
          status,
          minutesLate: 0,
          minutesWorked: 0,
          source: 'system',
          note: 'No check-in recorded',
        })
        continue
      }

      const lateBy = status === 'late' ? 25 + Math.floor(random() * 45) : Math.floor(random() * 10)
      const inHour = 9 + Math.floor((lateBy + 5) / 60)
      const inMinute = (lateBy + 5) % 60
      const worked = 8 * 60 + Math.floor(random() * 40) - 10

      attendanceRows.push({
        employeeId: employee.id,
        date: dateKeyToUtcMidnight(day),
        status,
        checkInAt: atUtcMidnight(day, inHour, inMinute),
        checkOutAt: new Date(atUtcMidnight(day, inHour, inMinute).getTime() + worked * 60_000),
        minutesLate: lateBy,
        minutesWorked: worked,
        source: 'web',
      })
    }
  }

  if (attendanceRows.length > 0) {
    await AttendanceModel.insertMany(attendanceRows, { ordered: false })
  }

  /* One pending correction, so the approvals screen is never empty ----- */
  const correctionTarget = workforce[4]!
  await AttendanceCorrectionModel.create({
    employeeId: correctionTarget.id,
    date: dateKeyToUtcMidnight(workDays[workDays.length - 2] ?? windowEnd),
    requestedStatus: 'present',
    requestedCheckInAt: atUtcMidnight(workDays[workDays.length - 2] ?? windowEnd, 9, 5),
    requestedCheckOutAt: atUtcMidnight(workDays[workDays.length - 2] ?? windowEnd, 18, 0),
    reason: 'The office network was down when I tried to check in.',
    status: 'pending',
  })

  /* Salary structures ------------------------------------------------ */
  for (const employee of employees) {
    if (employee.status === 'resigned' || employee.status === 'terminated') continue

    const base = BASE_SALARY[employee.designation] ?? 80_000
    const partTime = employee.fullName === 'Hira Aslam'

    await SalaryStructureModel.create({
      employeeId: employee.id,
      currency: CURRENCY,
      baseSalary: partTime ? Math.round(base * 0.6) : base,
      allowances: [
        { label: 'House rent', amount: Math.round(base * 0.2) },
        { label: 'Transport', amount: 8_000 },
        { label: 'Medical', amount: 5_000 },
      ],
      deductions: [
        { label: 'Provident fund', amount: Math.round(base * 0.05) },
        { label: 'EOBI', amount: 370 },
      ],
      taxPercent: base >= 150_000 ? 10 : 5,
      effectiveFrom: dateKeyToUtcMidnight('2026-01-01'),
      isActive: true,
    })
  }

  /* Payroll history --------------------------------------------------- */
  const current = { year, month: Number(todayKey.slice(5, 7)) }

  for (const delta of [-2, -1]) {
    const period = shiftMonth(current.year, current.month, delta)
    const run = await createDraftRun(period)
    await buildRunLines(run, TIMEZONE)
    run.status = 'finalized'
    run.finalizedAt = new Date()
    run.finalizedBy = admin._id
    await run.save()
  }

  // A draft for the current period: HR has something real to review and finalize.
  const draft = await createDraftRun(current)
  await buildRunLines(draft, TIMEZONE)

  /* Announcements ------------------------------------------------------ */
  const people = departments.get('People')

  const pinned = await AnnouncementModel.create({
    title: 'Payroll for the previous month has been published',
    body: [
      'Payslips for the previous period are now available under Payroll → My payslips.',
      'Download the PDF for your records. Any query about a deduction should reach HR within seven days.',
    ].join('\n\n'),
    category: 'payroll',
    priority: 'high',
    audience: 'all',
    status: 'published',
    pinned: true,
    publishAt: new Date(Date.now() - 2 * DAY_MS),
    authorId: hrUser._id,
    authorName: 'Maryam Siddiqui',
    reads: [{ userId: admin._id, readAt: new Date(Date.now() - DAY_MS) }],
  })

  await AnnouncementModel.create({
    title: 'Office closed for the public holiday',
    body: 'The office will be closed for the declared public holiday. Support rota staff have been contacted separately.',
    category: 'holiday',
    priority: 'normal',
    audience: 'all',
    status: 'published',
    publishAt: new Date(Date.now() - 6 * DAY_MS),
    authorId: hrUser._id,
    authorName: 'Maryam Siddiqui',
    reads: [],
  })

  await AnnouncementModel.create({
    title: 'New expense policy effective next month',
    body: 'All expense claims must now be submitted within 14 days of the spend. Claims older than that need a manager note.',
    category: 'policy',
    priority: 'normal',
    audience: 'department',
    departmentId: people,
    status: 'published',
    publishAt: new Date(Date.now() - 9 * DAY_MS),
    authorId: admin._id,
    authorName: 'Adeel Rehman',
    reads: [],
  })

  await AnnouncementModel.create({
    title: 'Quarterly town hall — agenda',
    body: 'Draft agenda for the town hall. To be published once the leadership review is complete.',
    category: 'event',
    priority: 'normal',
    audience: 'all',
    status: 'draft',
    publishAt: new Date(Date.now() + 3 * DAY_MS),
    authorId: admin._id,
    authorName: 'Adeel Rehman',
    reads: [],
  })

  /* Notifications ------------------------------------------------------ */
  const loginUsers = employees
    .map((employee) => employee.userId)
    .filter((id): id is Types.ObjectId => Boolean(id))

  await NotificationModel.insertMany(
    [
      {
        userId: admin._id,
        type: 'system',
        title: 'Welcome to HCM Lite',
        body: 'Demo data has been loaded. Start from the dashboard, then try the assistant.',
        link: '/',
      },
      {
        userId: pinned.authorId,
        type: 'announcement',
        title: pinned.title,
        body: pinned.body.slice(0, 157),
        link: `/announcements/${String(pinned._id)}`,
      },
      ...loginUsers.slice(0, 4).map((userId) => ({
        userId,
        type: 'payroll' as const,
        title: 'Payslip available',
        body: 'Your payslip for the previous month is ready to download.',
        link: '/payroll',
      })),
    ],
    { ordered: false },
  )

  /* Audit trail -------------------------------------------------------- */
  await AuditLogModel.insertMany([
    {
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'create',
      entity: 'user',
      entityId: String(admin._id),
      meta: { role: 'admin', source: 'seed' },
      ip: '127.0.0.1',
    },
    {
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'update',
      entity: 'settings',
      meta: { section: 'attendance', workStartMinutes: 540, graceMinutes: 15 },
      ip: '127.0.0.1',
    },
    {
      actorId: hrUser._id,
      actorEmail: hrUser.email,
      action: 'create',
      entity: 'leave_request',
      meta: { status: 'approved', days: 5 },
      ip: '127.0.0.1',
    },
    {
      actorId: admin._id,
      actorEmail: admin.email,
      action: 'finalize',
      entity: 'payroll_run',
      meta: { period: `${current.year}-${String(current.month - 1).padStart(2, '0')}` },
      ip: '127.0.0.1',
    },
  ])

  logger.info(
    {
      employees: employees.length,
      attendance: attendanceRows.length,
      workingDays: workDays.length,
      leaveRequests: leaveSeeds.length,
    },
    'Seed complete',
  )

  return {
    employees: employees.length,
    attendance: attendanceRows.length,
    workingDays: workDays.length,
    leaveRequests: leaveSeeds.length,
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export interface SeedSummary {
  employees: number
  attendance: number
  workingDays: number
  leaveRequests: number
}

/**
 * Seeds the demo dataset into an already-connected database.
 *
 * Refuses to touch a database that already holds a company unless `reset` is
 * set, so an accidental run can never erase real data.
 */
export async function runSeed(options: { reset?: boolean } = {}): Promise<SeedSummary> {
  const existing = await CompanyModel.exists({ key: 'primary' })

  if (existing && !options.reset) {
    throw new Error('This database already contains a company. Re-run with --reset to erase and reseed.')
  }

  if (existing) {
    logger.warn('Resetting demo collections')
    await clearDemoCollections()
  }

  return seedDemoData()
}

async function main(): Promise<void> {
  await connectDatabase()

  try {
    await runSeed({ reset: process.argv.includes('--reset') })

    logger.info(
      { demoPassword: DEMO_PASSWORD },
      'Demo accounts ready — every account uses the demo password',
    )
    logger.info('  admin@hcm.test  · administrator')
    logger.info('  hr@hcm.test     · HR')
    logger.info('  ayesha.khan@hcm.test · employee')
  } finally {
    await disconnectDatabase()
  }
}

// Importable by tests without booting the CLI.
if (process.argv[1] && /scripts[\\/]seed\.(ts|js)$/.test(process.argv[1])) {
  main().catch(async (err) => {
    logger.fatal({ err }, 'Seed failed')
    await mongoose.connection.close().catch(() => undefined)
    process.exit(1)
  })
}
