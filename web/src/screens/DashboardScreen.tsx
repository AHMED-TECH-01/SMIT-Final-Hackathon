import { api } from '../lib/api'
import { dateKey, formatDate, percent, formatTime } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { Link } from '../lib/router'
import { useSession } from '../lib/session'
import type {
  Announcement,
  Dashboard,
  LeaveBalance,
  TodayState,
} from '../lib/types'
import {
  Badge,
  BarRow,
  Banner,
  EmptyState,
  Loading,
  PageHeader,
  Panel,
  Stat,
  Table,
  Td,
  Th,
  statusTone,
} from '../components/ui'
import {
  IconCalendarCheck,
  IconCalendarClock,
  IconCheckCircle,
  IconClock,
  IconMegaphone,
  IconUsers,
  IconWallet,
} from '../components/icons'

/**
 * Landing screen.
 *
 * Two different dashboards behind one route: managers get the company picture
 * from a single `/analytics/dashboard` call, employees get their own day and
 * their own balances. Both read the same records the rest of the app writes.
 */
export default function DashboardScreen() {
  const { session, can } = useSession()
  const name = session?.user.fullName.split(' ')[0] ?? 'there'

  if (!can('analytics.read')) return <PersonalDashboard name={name} />
  return <CompanyDashboard name={name} />
}

/* ------------------------------------------------------------------ */
/* Managers                                                            */
/* ------------------------------------------------------------------ */

function CompanyDashboard({ name }: { name: string }) {
  const { data, error, loading } = useAsync(() => api.get<Dashboard>('/analytics/dashboard'))

  if (loading) return <Loading label="Building today's picture…" />
  if (error) return <Banner tone="danger">{error}</Banner>
  if (!data) return null

  const { overview, breakdown, trend, queues } = data.data
  const today = overview.today
  const departmentMax = Math.max(1, ...breakdown.byDepartment.map((row) => row.count))
  const trendMax = Math.max(1, ...trend.map((point) => point.marked))

  return (
    <>
      <PageHeader
        title={`Good to see you, ${name}`}
        description={`Company snapshot for ${formatDate(overview.asOf)} — ${overview.timezone}.`}
        actions={
          <Link to="/analytics" className="btn-outline w-auto px-3.5 py-2 text-[13px]">
            Open analytics
          </Link>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 mb-4">
        <Stat
          label="Workforce"
          value={overview.workforce.total}
          hint={`${breakdown.joiners.thisMonth} joined this month`}
          icon={<IconUsers className="w-5 h-5" />}
        />
        <Stat
          label="Attendance rate"
          value={percent(overview.attendance.rate)}
          hint={`${overview.attendance.workingDays} working days`}
          icon={<IconCheckCircle className="w-5 h-5" />}
          tone="success"
        />
        <Stat
          label="Marked today"
          value={`${today.marked}/${overview.workforce.total}`}
          hint={`${today.late} late · ${today.onLeave} on leave`}
          icon={<IconCalendarCheck className="w-5 h-5" />}
          tone="info"
        />
        <Stat
          label="Awaiting approval"
          value={overview.pending.leaveRequests + overview.pending.corrections}
          hint={`${overview.pending.leaveRequests} leave · ${overview.pending.corrections} corrections`}
          icon={<IconCalendarClock className="w-5 h-5" />}
          tone={overview.pending.leaveRequests + overview.pending.corrections > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3.5 items-start">
        <div className="space-y-3.5">
          <Panel title="Attendance, last 14 days" description="Recorded marks per day">
            {trend.every((point) => point.marked === 0) ? (
              <EmptyState
                title="No attendance recorded yet"
                description="Marks appear here as soon as people check in."
                action={
                  <Link to="/attendance" className="btn-primary">
                    Open attendance
                  </Link>
                }
              />
            ) : (
              <div className="flex items-end gap-1.5 h-40">
                {trend.map((point) => (
                  <div key={point.date} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t ${
                          point.isWorkingDay ? 'bg-primary/75' : 'bg-line'
                        }`}
                        style={{ height: `${Math.max(3, (point.marked / trendMax) * 100)}%` }}
                        title={`${point.date}: ${point.marked} marked, ${point.late} late`}
                      />
                    </div>
                    <span className="text-[9.5px] text-ink-secondary">
                      {point.date.slice(8)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="grid md:grid-cols-2 gap-3.5">
            <Panel title="Today" description={today.isWorkingDay ? 'A working day' : 'Non-working day'}>
              <div className="space-y-2.5">
                <BarRow
                  label="Present"
                  value={today.present}
                  max={Math.max(1, overview.workforce.total)}
                />
                <BarRow
                  label="Late"
                  value={today.late}
                  max={Math.max(1, overview.workforce.total)}
                  tone="warning"
                />
                <BarRow
                  label="Remote"
                  value={today.remote}
                  max={Math.max(1, overview.workforce.total)}
                  tone="info"
                />
                <BarRow
                  label="On leave"
                  value={today.onLeave}
                  max={Math.max(1, overview.workforce.total)}
                  tone="info"
                />
                <BarRow
                  label="Not marked"
                  value={today.notMarked}
                  max={Math.max(1, overview.workforce.total)}
                  tone="warning"
                />
              </div>
            </Panel>

            <Panel title="Headcount by department" description={`${breakdown.total} people`}>
              {breakdown.byDepartment.length === 0 ? (
                <EmptyState title="No departments yet" description="Add one under Organization." />
              ) : (
                <div className="space-y-2.5">
                  {breakdown.byDepartment.slice(0, 6).map((row) => (
                    <BarRow
                      key={row.departmentId || row.departmentName}
                      label={row.departmentName}
                      value={row.count}
                      max={departmentMax}
                    />
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>

        <div className="space-y-3.5">
          <Panel
            title="Approval queue"
            description="Oldest first"
            actions={
              <Link to="/leave" className="text-[11.5px] font-medium text-primary">
                View all
              </Link>
            }
          >
            {queues.leaveRequests.length === 0 && queues.corrections.length === 0 ? (
              <EmptyState title="Nothing waiting" description="The queues are clear." />
            ) : (
              <ul className="space-y-2.5">
                {queues.leaveRequests.map((request) => (
                  <li key={request.id} className="leading-tight">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-ink truncate">
                        {request.employeeName ?? 'Employee'}
                      </span>
                      <Badge tone="warning">Leave</Badge>
                    </div>
                    <p className="text-[11.5px] text-ink-secondary mt-0.5">
                      {request.days} day(s) · {request.leaveTypeName ?? 'Leave'} ·{' '}
                      {formatDate(request.startDate)}
                    </p>
                  </li>
                ))}
                {queues.corrections.map((correction) => (
                  <li key={correction.id} className="leading-tight">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-ink truncate">
                        {correction.employeeName ?? 'Employee'}
                      </span>
                      <Badge tone="warning">Correction</Badge>
                    </div>
                    <p className="text-[11.5px] text-ink-secondary mt-0.5">
                      {formatDate(correction.date)} → {correction.requestedStatus}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Payroll"
            actions={
              <Link to="/payroll" className="text-[11.5px] font-medium text-primary">
                Open
              </Link>
            }
          >
            {overview.payroll.latestFinalized ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <IconWallet className="w-4 h-4 text-primary" />
                  <span className="text-[12.5px] font-semibold">
                    {overview.payroll.latestFinalized.periodKey} finalized
                  </span>
                </div>
                <p className="text-[11.5px] text-ink-secondary">
                  {overview.payroll.latestFinalized.totals.headcount} payslips · net{' '}
                  {overview.payroll.latestFinalized.totals.net.toLocaleString('en-US')}
                </p>
                {overview.payroll.latestDraft && (
                  <p className="text-[11.5px] text-warning">
                    {overview.payroll.latestDraft.periodKey} is still a draft.
                  </p>
                )}
              </div>
            ) : (
              <EmptyState title="No payroll run yet" description="Create one from the Payroll screen." />
            )}
          </Panel>

          <Panel title="Quick links">
            <div className="grid grid-cols-2 gap-2">
              {[
                { to: '/employees', label: 'Employees', icon: IconUsers },
                { to: '/attendance', label: 'Attendance', icon: IconCalendarCheck },
                { to: '/announcements', label: 'Announce', icon: IconMegaphone },
                { to: '/assistant', label: 'Assistant', icon: IconClock },
              ].map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center gap-2 rounded-ctrl border border-line px-2.5 py-2 text-[12px] font-medium text-ink/80 hover:bg-surface-muted"
                >
                  <Icon className="w-4 h-4 text-primary" /> {label}
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Everyone else                                                       */
/* ------------------------------------------------------------------ */

function PersonalDashboard({ name }: { name: string }) {
  const { data, error, loading } = useAsync(async () => {
    const [today, balances, announcements] = await Promise.all([
      api.get<TodayState>('/attendance/today'),
      api.get<{ year: number; balances: LeaveBalance[] }>('/leave/balances'),
      api.get<Announcement[]>('/announcements', { limit: 3 }),
    ])
    return { today: today.data, balances: balances.data, announcements: announcements.data }
  })

  if (loading) return <Loading label="Loading your day…" />
  if (error) return <Banner tone="danger">{error}</Banner>
  if (!data) return null

  const { today, balances, announcements } = data
  const attendance = today.attendance
  const remaining = balances.balances.reduce((total, balance) => total + balance.remaining, 0)

  return (
    <>
      <PageHeader
        title={`Hello, ${name}`}
        description="Your day, your balances and the latest notices."
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 mb-4">
        <Stat
          label="Today"
          value={attendance ? attendance.status : 'Not marked'}
          hint={formatDate(today.date)}
          icon={<IconCalendarCheck className="w-5 h-5" />}
          tone={attendance ? 'success' : 'neutral'}
        />
        <Stat
          label="Checked in"
          value={
            attendance?.checkInAt
              ? formatTime(attendance.checkInAt)
              : '—'
          }
          hint={attendance?.minutesLate ? `${attendance.minutesLate} min late` : 'On time'}
          icon={<IconClock className="w-5 h-5" />}
          tone="info"
        />
        <Stat
          label="Leave remaining"
          value={remaining}
          hint={`${balances.balances.length} leave types`}
          icon={<IconCalendarClock className="w-5 h-5" />}
          tone="primary"
        />
        <Stat
          label="Latest notice"
          value={announcements[0] ? announcements[0].category : '—'}
          hint={announcements[0]?.title ?? 'Nothing published yet'}
          icon={<IconMegaphone className="w-5 h-5" />}
          tone="neutral"
        />
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-3.5 items-start">
        <Panel
          title="Notices"
          actions={
            <Link to="/announcements" className="text-[11.5px] font-medium text-primary">
              View all
            </Link>
          }
          padded={false}
        >
          {announcements.length === 0 ? (
            <EmptyState title="No announcements yet" description="Company notices will appear here." />
          ) : (
            <ul className="divide-y divide-line/70">
              {announcements.map((announcement) => (
                <li key={announcement.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(announcement.priority)}>{announcement.priority}</Badge>
                    <span className="text-[10.5px] text-ink-secondary">
                      {formatDate(announcement.publishAt)}
                    </span>
                    {!announcement.read && <Badge tone="primary">New</Badge>}
                  </div>
                  <p className="text-[13px] font-semibold text-ink mt-1">{announcement.title}</p>
                  <p className="text-[12px] text-ink-secondary line-clamp-2">{announcement.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Leave balances" padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Entitled</Th>
                <Th>Used</Th>
                <Th>Left</Th>
              </tr>
            </thead>
            <tbody>
              {balances.balances.map((balance) => (
                <tr key={balance.leaveTypeId}>
                  <Td>
                    <span className="font-medium">{balance.name}</span>
                    <span className="text-[10.5px] text-ink-secondary block">{balance.code}</span>
                  </Td>
                  <Td>{balance.entitled}</Td>
                  <Td>
                    {balance.used}
                    {balance.pending > 0 && (
                      <span className="text-[10.5px] text-warning"> (+{balance.pending})</span>
                    )}
                  </Td>
                  <Td>
                    <span className="font-semibold text-primary-dark">{balance.remaining}</span>
                  </Td>
                </tr>
              ))}
              {balances.balances.length === 0 && (
                <tr>
                  <Td className="text-ink-secondary">No leave types configured yet.</Td>
                  <Td />
                  <Td />
                  <Td />
                </tr>
              )}
            </tbody>
          </Table>
          <div className="px-4 py-3 border-t border-line/70">
            <Link to="/leave" className="btn-outline">
              Apply for leave
            </Link>
          </div>
        </Panel>
      </div>

      <p className="text-[11px] text-ink-secondary mt-3">
        {today.isHoliday
          ? `${dateKey(today.date)} is a non-working day${today.holidayName ? ` (${today.holidayName})` : ''}.`
          : `Attendance for ${dateKey(today.date)}. Check in from the Attendance screen.`}
      </p>
    </>
  )
}
