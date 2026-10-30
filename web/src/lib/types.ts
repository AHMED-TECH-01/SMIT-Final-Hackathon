/**
 * Wire types for the API.
 *
 * These mirror the `toPublic*` mappers on the server. They are hand-written
 * rather than generated so the UI stays readable and the field names the
 * components use are visible in one place.
 */

export type Role = 'admin' | 'hr' | 'employee'

export interface User {
  id: string
  email: string
  fullName: string
  role: Role
  status: 'active' | 'inactive'
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface Department {
  id: string
  name: string
  code: string | null
  description: string | null
  isActive: boolean
  createdAt: string
}

export interface Designation {
  id: string
  title: string
  departmentId: string | null
  departmentName: string | null
  grade: string | null
  isActive: boolean
  createdAt: string
}

export interface LeaveType {
  id: string
  name: string
  code: string
  annualQuota: number
  paid: boolean
  carryForward: boolean
  isActive: boolean
}

export interface Holiday {
  id: string
  name: string
  date: string
  optional: boolean
}

export type EmployeeStatus = 'active' | 'probation' | 'resigned' | 'terminated'
export type EmploymentType = 'full-time' | 'part-time' | 'contract' | 'intern'

export interface Employee {
  id: string
  employeeCode: string
  fullName: string
  email: string | null
  phone: string | null
  departmentId: string | null
  departmentName: string | null
  designationId: string | null
  designationTitle: string | null
  managerId: string | null
  userId: string | null
  joinDate: string
  employmentType: EmploymentType
  status: EmployeeStatus
  dateOfBirth: string | null
  address: string | null
  emergencyContact: string | null
  createdAt: string
}

export type AttendanceStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'half-day'
  | 'remote'
  | 'leave'
  | 'holiday'

export interface AttendanceRecord {
  id: string
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  date: string
  status: AttendanceStatus
  checkInAt: string | null
  checkOutAt: string | null
  minutesLate: number
  minutesWorked: number
  source: string
  note: string | null
}

export interface TodayState {
  date: string
  employeeId: string
  checkedIn: boolean
  checkedOut: boolean
  isHoliday: boolean
  holidayName: string | null
  attendance: AttendanceRecord | null
}

export interface BoardRow {
  employeeId: string
  employeeCode: string
  fullName: string
  departmentName: string | null
  /** `not-marked` is a view-only status: the day has not finished yet. */
  status: AttendanceStatus | 'not-marked'
  checkInAt: string | null
  checkOutAt: string | null
  minutesLate: number
  minutesWorked: number
  recorded: boolean
}

export interface Board {
  date: string
  weekend: boolean
  holidayName: string | null
  totals: Record<string, number>
  headcount: number
  rows: BoardRow[]
}

export type CorrectionStatus = 'pending' | 'approved' | 'rejected'

export interface AttendanceCorrection {
  id: string
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  date: string
  requestedStatus: AttendanceStatus
  requestedCheckInAt: string | null
  requestedCheckOutAt: string | null
  reason: string
  status: CorrectionStatus
  decisionNote: string | null
  decidedAt: string | null
  createdAt: string
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface LeaveRequest {
  id: string
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  leaveTypeId: string
  leaveTypeName: string | null
  startDate: string
  endDate: string
  days: number
  halfDay: boolean
  reason: string
  status: LeaveStatus
  decisionNote: string | null
  decidedAt: string | null
  createdAt: string
}

export interface LeaveBalance {
  leaveTypeId: string
  name: string
  code: string
  entitled: number
  used: number
  pending: number
  remaining: number
}

export interface SalaryComponent {
  label: string
  amount: number
}

export interface SalaryStructure {
  id: string
  employeeId: string
  employeeName: string | null
  employeeCode: string | null
  currency: string
  baseSalary: number
  allowances: SalaryComponent[]
  deductions: SalaryComponent[]
  taxPercent: number
  grossSalary: number
  effectiveFrom: string
  isActive: boolean
}

export interface PayrollTotals {
  headcount: number
  gross: number
  deductions: number
  net: number
  tax: number
}

export interface PayrollRun {
  id: string
  periodKey: string
  year: number
  month: number
  status: 'draft' | 'finalized'
  workingDays: number
  totals: PayrollTotals
  finalizedAt: string | null
  createdAt: string
}

export interface PayslipLine {
  id: string
  runId: string
  employeeId: string
  employeeCode: string
  fullName: string
  departmentName: string | null
  currency: string
  baseSalary: number
  allowances: SalaryComponent[]
  deductions: SalaryComponent[]
  gross: number
  tax: number
  unpaidDeduction: number
  totalDeductions: number
  net: number
  workingDays: number
  presentDays: number
  lateDays: number
  absentDays: number
  leaveDays: number
  periodKey?: string | null
  periodLabel?: string | null
}

export type AnnouncementStatus = 'draft' | 'published' | 'archived'
export type AnnouncementAudience = 'all' | 'department' | 'role'
export type AnnouncementPriority = 'normal' | 'high' | 'urgent'

export interface Announcement {
  id: string
  title: string
  body: string
  category: string
  priority: AnnouncementPriority
  audience: AnnouncementAudience
  departmentId: string | null
  departmentName: string | null
  role: 'hr' | 'employee' | null
  status: AnnouncementStatus
  pinned: boolean
  publishAt: string
  expiresAt: string | null
  authorName: string
  readCount: number
  read: boolean
  createdAt: string
  updatedAt: string
}

export interface Notification {
  id: string
  type: 'leave' | 'attendance' | 'payroll' | 'announcement' | 'system'
  title: string
  body: string
  link: string | null
  read: boolean
  readAt: string | null
  createdAt: string
}

export interface AuditEntry {
  id: string
  actorId: string | null
  actorEmail: string | null
  action: string
  entity: string
  entityId: string | null
  meta: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

export interface Overview {
  asOf: string
  timezone: string
  workforce: {
    total: number
    byEmploymentType: { type: string; count: number }[]
  }
  today: {
    date: string
    isWorkingDay: boolean
    present: number
    late: number
    remote: number
    absent: number
    onLeave: number
    marked: number
    notMarked: number
  }
  attendance: {
    from: string
    to: string
    workingDays: number
    expected: number
    recorded: number
    attended: number
    absent: number
    rate: number
  }
  pending: { leaveRequests: number; corrections: number }
  payroll: { latestFinalized: PayrollRun | null; latestDraft: PayrollRun | null }
}

export interface Headcount {
  asOf: string
  total: number
  byStatus: { status: string; count: number }[]
  byEmploymentType: { type: string; count: number }[]
  byDepartment: { departmentId: string; departmentName: string; count: number }[]
  tenure: { band: string; count: number }[]
  joiners: { thisMonth: number; last30Days: number }
}

export interface TrendPoint {
  date: string
  isWorkingDay: boolean
  present: number
  late: number
  remote: number
  absent: number
  onLeave: number
  marked: number
  rate: number
}

export interface Dashboard {
  generatedAt: string
  overview: Overview
  breakdown: Headcount
  trend: TrendPoint[]
  queues: {
    leaveRequests: LeaveRequest[]
    corrections: AttendanceCorrection[]
  }
}

export interface LeaveUsage {
  year: number
  totals: { requests: number; approvedDays: number; pendingDays: number }
  byStatus: { status: string; count: number }[]
  byType: {
    leaveTypeId: string
    name: string
    approvedDays: number
    pendingDays: number
    requests: number
  }[]
  byDepartment: { departmentId: string; departmentName: string; days: number }[]
  topAbsentees: {
    employeeId: string
    employeeName: string
    departmentName: string | null
    days: number
  }[]
}

export interface PayrollCost {
  months: number
  points: {
    periodKey: string
    year: number
    month: number
    headcount: number
    gross: number
    deductions: number
    tax: number
    net: number
  }[]
  latest: PayrollRun | null
  averageNet: number
}

export interface AssistantFact {
  name: string
  label: string
  summary: string
  data?: unknown
}

export interface AssistantReply {
  answer: string
  intent: string
  tools: AssistantFact[]
  provider: string
  suggestions: string[]
}

export interface CompanySettingsPayload {
  company: {
    id: string | null
    name: string
    contactEmail: string
    contactPhone: string
    address: string
    timezone: string
    currency: string
    updatedAt: string | null
  }
  attendance: { workStart: string; workStartMinutes: number; graceMinutes: number }
  roster: { employees: number; activeEmployees: number; departments: number; users: number }
  system: { apiVersion: string; setupComplete: boolean }
}
