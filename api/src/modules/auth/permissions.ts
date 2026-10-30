/**
 * Central permission catalogue.
 *
 * Authorization is expressed as permissions, never as scattered
 * `if (role === 'admin')` checks. Roles map to permission sets here; the
 * middleware evaluates this map on every request.
 */

export const ROLES = ['admin', 'hr', 'employee'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'user.read',
  'user.create',
  'user.manage',
  'settings.manage',
  'organization.manage',
  'organization.read',
  'employee.read',
  'employee.create',
  'employee.update',
  'employee.archive',
  'attendance.read',
  'attendance.manage',
  'leave.apply',
  'leave.read.own',
  'leave.approve',
  'payroll.read.own',
  'payroll.read.company',
  'payroll.process',
  'payroll.approve',
  'announcement.read',
  'announcement.publish',
  'announcement.manage',
  'report.export',
  'analytics.read',
  'audit.read',
  'ai.query',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * Role → permissions.
 * Deliberate restrictions:
 *  • HR cannot read the audit log, manage settings, or finalize payroll.
 *  • Employees only ever reach their own records.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,

  hr: [
    'organization.read',
    'organization.manage',
    'employee.read',
    'employee.create',
    'employee.update',
    'employee.archive',
    'attendance.read',
    'attendance.manage',
    'leave.approve',
    'payroll.read.company',
    'payroll.process',
    'announcement.read',
    'announcement.publish',
    'announcement.manage',
    'report.export',
    'analytics.read',
    'ai.query',
  ],

  employee: [
    'organization.read',
    'attendance.read',
    'leave.apply',
    'leave.read.own',
    'payroll.read.own',
    'announcement.read',
    'ai.query',
  ],
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

export function can(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission)
}

/** Unknown roles are denied by default. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}
