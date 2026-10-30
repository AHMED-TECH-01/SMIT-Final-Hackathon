import type { ReactNode } from 'react'
import Layout from './components/Layout'
import { Banner, Button, PageHeader, Spinner } from './components/ui'
import { RouterProvider, useRouter } from './lib/router'
import { SessionProvider, useSession } from './lib/session'
import { visibleNavItems } from './components/nav'
import SetupScreen from './screens/SetupScreen'
import LoginScreen from './screens/LoginScreen'
import ChangePasswordScreen from './screens/ChangePasswordScreen'
import DashboardScreen from './screens/DashboardScreen'
import OrganizationScreen from './screens/OrganizationScreen'
import EmployeesScreen from './screens/EmployeesScreen'
import AttendanceScreen from './screens/AttendanceScreen'
import LeaveScreen from './screens/LeaveScreen'
import PayrollScreen from './screens/PayrollScreen'
import AnalyticsScreen from './screens/AnalyticsScreen'
import AssistantScreen from './screens/AssistantScreen'
import AnnouncementsScreen from './screens/AnnouncementsScreen'
import AuditScreen from './screens/AuditScreen'
import SettingsScreen from './screens/SettingsScreen'

interface Route {
  path: string
  /** Rendered only when the session holds at least one of these permissions. */
  permissions?: string[]
  element: ReactNode
}

/**
 * One flat route table. Screens are top-level, so no nesting or params are
 * needed; the server enforces the same permissions these entries filter on.
 */
const ROUTES: Route[] = [
  { path: '/', element: <DashboardScreen /> },
  // A signed-in visitor who lands on the auth screens simply sees the dashboard.
  { path: '/login', element: <DashboardScreen /> },
  { path: '/setup', element: <DashboardScreen /> },
  { path: '/organization', permissions: ['organization.read'], element: <OrganizationScreen /> },
  { path: '/employees', permissions: ['employee.read'], element: <EmployeesScreen /> },
  { path: '/attendance', permissions: ['attendance.read'], element: <AttendanceScreen /> },
  {
    path: '/leave',
    permissions: ['leave.read.own', 'leave.apply', 'leave.approve'],
    element: <LeaveScreen />,
  },
  {
    path: '/payroll',
    permissions: ['payroll.read.own', 'payroll.read.company'],
    element: <PayrollScreen />,
  },
  { path: '/analytics', permissions: ['analytics.read'], element: <AnalyticsScreen /> },
  { path: '/assistant', permissions: ['ai.query'], element: <AssistantScreen /> },
  { path: '/announcements', permissions: ['announcement.read'], element: <AnnouncementsScreen /> },
  { path: '/audit-log', permissions: ['audit.read'], element: <AuditScreen /> },
  { path: '/settings', permissions: ['settings.manage'], element: <SettingsScreen /> },
]

function Splash({ label }: { label: string }) {
  return (
    <div className="min-h-screen grid place-items-center bg-app">
      <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
        <Spinner /> {label}
      </div>
    </div>
  )
}

function Forbidden() {
  const { navigate } = useRouter()
  return (
    <div className="card p-6 max-w-lg">
      <PageHeader title="Not available" description="Your role does not include this area." />
      <Banner tone="warning">
        You are signed in, but this screen needs a permission your account does not hold.
      </Banner>
      <div className="mt-4">
        <Button onClick={() => navigate('/')}>Back to dashboard</Button>
      </div>
    </div>
  )
}

function NotFound() {
  const { path, navigate } = useRouter()
  return (
    <div className="card p-6 max-w-lg">
      <PageHeader title="Page not found" description={`There is nothing at ${path}.`} />
      <Button onClick={() => navigate('/')}>Back to dashboard</Button>
    </div>
  )
}

function CurrentScreen() {
  const { path } = useRouter()
  const { can } = useSession()

  const route = ROUTES.find((entry) => entry.path === path)
  if (!route) return <NotFound />
  if (route.permissions && !route.permissions.some((permission) => can(permission))) {
    return <Forbidden />
  }
  return <>{route.element}</>
}

/**
 * Decides what the visitor may see at all:
 * first-run setup → sign-in → forced password change → the app.
 */
function Shell() {
  const { session, loading, setupRequired } = useSession()

  if (loading) return <Splash label="Starting HCM Lite…" />
  if (setupRequired) return <SetupScreen />
  if (!session) return <LoginScreen />
  if (session.user.mustChangePassword) return <ChangePasswordScreen />

  // A session with no permissions still needs a readable shell, not a blank page.
  const items = visibleNavItems((permission) => session.permissions.includes(permission))
  if (items.length === 0) {
    return (
      <Layout>
        <Banner tone="warning">
          This account has no permissions assigned. Contact an administrator.
        </Banner>
      </Layout>
    )
  }

  return (
    <Layout>
      <CurrentScreen />
      <footer className="mt-8 pb-2 text-center text-[11px] text-ink-secondary/80">
        HCM Lite — demo data. Signed in as {session.user.email}.
      </footer>
    </Layout>
  )
}

export default function App() {
  return (
    <RouterProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </RouterProvider>
  )
}
