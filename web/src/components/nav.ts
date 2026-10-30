import type { ComponentType } from 'react'
import {
  IconBot,
  IconBuilding,
  IconCalendar,
  IconCalendarCheck,
  IconChart,
  IconDashboard,
  IconHistory,
  IconMegaphone,
  IconSettings,
  IconUsers,
  IconWallet,
} from './icons'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Visible when the user holds at least one of these permissions. */
  permissions?: string[]
}

/**
 * The navigation is derived from permissions, not from the role name: an
 * administrator sees everything because they hold every permission, and a new
 * role added on the server needs no change here.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: IconDashboard },
  { to: '/organization', label: 'Organization', icon: IconBuilding, permissions: ['organization.read'] },
  { to: '/employees', label: 'Employees', icon: IconUsers, permissions: ['employee.read'] },
  {
    to: '/attendance',
    label: 'Attendance',
    icon: IconCalendarCheck,
    permissions: ['attendance.read'],
  },
  {
    to: '/leave',
    label: 'Leave',
    icon: IconCalendar,
    permissions: ['leave.read.own', 'leave.apply', 'leave.approve'],
  },
  {
    to: '/payroll',
    label: 'Payroll',
    icon: IconWallet,
    permissions: ['payroll.read.own', 'payroll.read.company'],
  },
  { to: '/analytics', label: 'Analytics', icon: IconChart, permissions: ['analytics.read'] },
  { to: '/assistant', label: 'AI Assistant', icon: IconBot, permissions: ['ai.query'] },
  {
    to: '/announcements',
    label: 'Announcements',
    icon: IconMegaphone,
    permissions: ['announcement.read'],
  },
  { to: '/audit-log', label: 'Audit Log', icon: IconHistory, permissions: ['audit.read'] },
  { to: '/settings', label: 'Settings', icon: IconSettings, permissions: ['settings.manage'] },
]

export function visibleNavItems(can: (permission: string) => boolean): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.permissions || item.permissions.some((permission) => can(permission)),
  )
}
