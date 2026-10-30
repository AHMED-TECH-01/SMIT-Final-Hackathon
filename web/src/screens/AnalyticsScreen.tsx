import { useState } from 'react'
import { api } from '../lib/api'
import { dateKey, formatDate, formatMonth, formatMoney, label, shiftDays, todayKey } from '../lib/format'
import { useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type { Headcount, LeaveUsage, Overview, PayrollCost, TrendPoint } from '../lib/types'
import {
  Badge,
  BarRow,
  Banner,
  Button,
  EmptyState,
  Loading,
  PageHeader,
  Panel,
  Select,
  Stat,
  Table,
  Td,
  Th,
} from '../components/ui'
import {
  IconCalendarCheck,
  IconClock,
  IconInbox,
  IconTeam,
  IconWallet,
} from '../components/icons'

/**
 * Analytics.
 *
 * Every number is derived by the server from the operational collections, so
 * what is shown here can never drift from the records. The screens are the same
 * payloads the API documents — nothing is recomputed in the browser.
 */
export default function AnalyticsScreen() {
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Workforce, attendance, leave and payroll — read straight from the records."
      />
      <OverviewPanel />
      <div className="grid lg:grid-cols-2 gap-3.5 mt-3.5">
        <HeadcountPanel />
        <LeaveUsagePanel />
      </div>
      <TrendPanel />
      <PayrollCostPanel />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function OverviewPanel() {
  const { data, error, loading } = useAsync(() => api.get<Overview>('/analytics/overview'))

  if (loading) return <Loading />
  if (error) return <Banner tone="danger">{error}</Banner>
  if (!data) return null

  const overview = data.data
  const today = overview.today

  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5">
        <Stat
          label="Workforce"
          value={overview.workforce.total}
          hint={overview.workforce.byEmploymentType
            .map((entry) => `${entry.count} ${label(entry.type).toLowerCase()}`)
            .join(' · ')}
          icon={<IconTeam className="w-5 h-5" />}
        />
        <Stat
          label="Attendance rate"
          value={`${overview.attendance.rate}%`}
          hint={`${overview.attendance.attended} of ${overview.attendance.expected} expected days`}
          tone="success"
          icon={<IconCalendarCheck className="w-5 h-5" />}
        />
        <Stat
          label="Marked today"
          value={`${today.marked}/${today.marked + today.notMarked}`}
          hint={today.isWorkingDay ? 'A working day' : 'Weekend or holiday'}
          tone="info"
          icon={<IconClock className="w-5 h-5" />}
        />
        <Stat
          label="Waiting for approval"
          value={overview.pending.leaveRequests + overview.pending.corrections}
          hint={`${overview.pending.leaveRequests} leave · ${overview.pending.corrections} corrections`}
          tone={overview.pending.leaveRequests + overview.pending.corrections > 0 ? 'warning' : 'neutral'}
          icon={<IconInbox className="w-5 h-5" />}
        />
      </div>

      <Panel
        title="Today's board"
        description={formatDate(today.date)}
        className="mt-3.5"
        padded={false}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-line/70">
          {[
            { key: 'present', value: today.present },
            { key: 'late', value: today.late },
            { key: 'remote', value: today.remote },
            { key: 'absent', value: today.absent },
            { key: 'leave', value: today.onLeave, as: 'On leave' },
            { key: 'unmarked', value: today.notMarked, as: 'Not marked' },
          ].map((item) => (
            <div key={item.key} className="px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-secondary font-semibold">
                {item.as ?? label(item.key)}
              </div>
              <div className="text-[20px] font-extrabold text-ink leading-tight">{item.value}</div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Headcount                                                           */
/* ------------------------------------------------------------------ */

function HeadcountPanel() {
  const { data, error, loading } = useAsync(() => api.get<Headcount>('/analytics/headcount'))

  if (loading) return <Panel title="Headcount"><Loading /></Panel>
  if (error) return <Panel title="Headcount"><Banner tone="danger">{error}</Banner></Panel>
  if (!data) return null

  const headcount = data.data
  const departmentMax = Math.max(1, ...headcount.byDepartment.map((row) => row.count))
  const typeMax = Math.max(1, ...headcount.byEmploymentType.map((row) => row.count))

  return (
    <Panel title="Headcount" description={`As of ${formatDate(headcount.asOf)}`}>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div>
          <div className="text-[11px] text-ink-secondary font-medium">Active</div>
          <div className="text-[19px] font-extrabold text-ink">{headcount.total}</div>
        </div>
        <div>
          <div className="text-[11px] text-ink-secondary font-medium">Joiners this month</div>
          <div className="text-[19px] font-extrabold text-ink">{headcount.joiners.thisMonth}</div>
        </div>
        <div>
          <div className="text-[11px] text-ink-secondary font-medium">Last 30 days</div>
          <div className="text-[19px] font-extrabold text-ink">{headcount.joiners.last30Days}</div>
        </div>
      </div>

      <h3 className="text-[12px] font-semibold text-ink/80 mb-2">By department</h3>
      <div className="space-y-2.5">
        {headcount.byDepartment.length === 0 && (
          <p className="text-[12px] text-ink-secondary">No departments configured.</p>
        )}
        {headcount.byDepartment.map((row) => (
          <BarRow
            key={row.departmentId || row.departmentName}
            label={row.departmentName}
            value={row.count}
            max={departmentMax}
          />
        ))}
      </div>

      <h3 className="text-[12px] font-semibold text-ink/80 mt-4 mb-2">By employment type</h3>
      <div className="space-y-2.5">
        {headcount.byEmploymentType.map((row) => (
          <BarRow
            key={row.type}
            label={label(row.type)}
            value={row.count}
            max={typeMax}
            tone="info"
          />
        ))}
      </div>

      <h3 className="text-[12px] font-semibold text-ink/80 mt-4 mb-2">Tenure</h3>
      <div className="flex flex-wrap gap-2">
        {headcount.tenure.map((row) => (
          <Badge key={row.band} tone={row.count > 0 ? 'primary' : 'neutral'}>
            {label(row.band.replace(/-/g, ' '))} · {row.count}
          </Badge>
        ))}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Leave usage                                                         */
/* ------------------------------------------------------------------ */

function LeaveUsagePanel() {
  const [year, setYear] = useState(new Date().getFullYear())
  const { data, error, loading } = useAsync(
    () => api.get<LeaveUsage>('/analytics/leave-usage', { year }),
    [year],
  )

  const years = Array.from({ length: 5 }, (_, index) => new Date().getFullYear() - index)

  return (
    <Panel
      title="Leave usage"
      description="Approved and pending days for the selected year."
      actions={
        <Select
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
          className="w-auto py-1 text-[12px]"
        >
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      }
    >
      {loading && <Loading />}
      {error && <Banner tone="danger">{error}</Banner>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div>
              <div className="text-[11px] text-ink-secondary font-medium">Requests</div>
              <div className="text-[19px] font-extrabold text-ink">{data.data.totals.requests}</div>
            </div>
            <div>
              <div className="text-[11px] text-ink-secondary font-medium">Approved days</div>
              <div className="text-[19px] font-extrabold text-ink">{data.data.totals.approvedDays}</div>
            </div>
            <div>
              <div className="text-[11px] text-ink-secondary font-medium">Pending days</div>
              <div className="text-[19px] font-extrabold text-ink">{data.data.totals.pendingDays}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {data.data.byStatus.map((row) => (
              <Badge key={row.status} tone={row.status === 'approved' ? 'success' : 'neutral'}>
                {label(row.status)} · {row.count}
              </Badge>
            ))}
          </div>

          {data.data.byType.length === 0 ? (
            <EmptyState title="No leave types" description="Add leave types to see usage." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Requests</Th>
                  <Th>Approved</Th>
                  <Th>Pending</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.byType.map((row) => (
                  <tr key={row.leaveTypeId}>
                    <Td className="font-medium text-ink">{row.name}</Td>
                    <Td>{row.requests}</Td>
                    <Td>{row.approvedDays}</Td>
                    <Td>{row.pendingDays}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {data.data.topAbsentees.length > 0 && (
            <>
              <h3 className="text-[12px] font-semibold text-ink/80 mt-4 mb-2">
                Most leave taken
              </h3>
              <ul className="space-y-1.5">
                {data.data.topAbsentees.map((row) => (
                  <li
                    key={row.employeeId}
                    className="flex items-center justify-between text-[12.5px]"
                  >
                    <span className="text-ink/85">
                      {row.employeeName}
                      <span className="text-ink-secondary"> · {row.departmentName ?? 'Unassigned'}</span>
                    </span>
                    <span className="font-semibold text-ink">{row.days} day(s)</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Attendance trend                                                    */
/* ------------------------------------------------------------------ */

function TrendPanel() {
  const [days, setDays] = useState(30)
  const { data, error, loading } = useAsync(
    () => api.get<{ from: string; to: string; headcount: number; points: TrendPoint[] }>(
      '/analytics/attendance-trend',
      { days },
    ),
    [days],
  )

  const points = data?.data.points ?? []
  const peak = Math.max(1, ...points.map((point) => point.marked))

  return (
    <Panel
      title="Attendance trend"
      description={data ? `${formatDate(data.data.from)} → ${formatDate(data.data.to)}` : undefined}
      className="mt-3.5"
      actions={
        <Select
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          className="w-auto py-1 text-[12px]"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
        </Select>
      }
    >
      {loading && <Loading />}
      {error && <Banner tone="danger">{error}</Banner>}
      {data && points.length === 0 && (
        <EmptyState title="No attendance in this window" description="Record attendance to see a trend." />
      )}
      {data && points.length > 0 && (
        <>
          <div className="flex items-end gap-[3px] h-[130px]">
            {points.map((point) => {
              const height = Math.max(3, Math.round((point.marked / peak) * 100))
              const attended = point.present + point.late + point.remote
              const ratio = point.marked > 0 ? attended / point.marked : 0
              const colour = !point.isWorkingDay
                ? 'bg-line'
                : ratio > 0.85
                  ? 'bg-primary'
                  : ratio > 0.6
                    ? 'bg-warning'
                    : 'bg-danger'
              return (
                <div
                  key={point.date}
                  className="flex-1 min-w-[4px] flex flex-col justify-end"
                  title={`${formatDate(point.date)} — ${point.marked} marked, ${attended} in, ${point.absent} absent`}
                >
                  <div className={`w-full rounded-sm ${colour}`} style={{ height: `${height}%` }} />
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] text-ink-secondary">
            <span>{formatDate(dateKey(points[0]?.date ?? todayKey()))}</span>
            <span>
              {formatDate(dateKey(points[points.length - 1]?.date ?? shiftDays(todayKey(), 0)))}
            </span>
          </div>
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Payroll cost                                                        */
/* ------------------------------------------------------------------ */

function PayrollCostPanel() {
  const [months, setMonths] = useState(6)
  const { can } = useSession()
  const canSeeCompany = can('payroll.read.company')

  const { data, error, loading } = useAsync(
    () =>
      canSeeCompany
        ? api.get<PayrollCost>('/analytics/payroll-cost', { months })
        : Promise.resolve(null),
    [months, canSeeCompany],
  )

  if (!canSeeCompany) return null

  return (
    <Panel
      title="Payroll cost"
      description="Finalized runs only — drafts are never reported as cost."
      className="mt-3.5"
      actions={
        <Select
          value={months}
          onChange={(event) => setMonths(Number(event.target.value))}
          className="w-auto py-1 text-[12px]"
        >
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
          <option value={24}>24 months</option>
        </Select>
      }
    >
      {loading && <Loading />}
      {error && <Banner tone="danger">{error}</Banner>}
      {data && !data.data.latest && (
        <EmptyState
          title="No finalized payroll yet"
          description="Finalize a payroll run to see monthly cost."
        />
      )}
      {data && data.data.latest && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div>
              <div className="text-[11px] text-ink-secondary font-medium">Latest net</div>
              <div className="text-[17px] font-extrabold text-ink">
                {formatMoney(data.data.latest.totals.net)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-ink-secondary font-medium">Average net</div>
              <div className="text-[17px] font-extrabold text-ink">
                {formatMoney(data.data.averageNet)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-ink-secondary font-medium">Period</div>
              <div className="text-[17px] font-extrabold text-ink">
                {formatMonth(data.data.latest.year, data.data.latest.month)}
              </div>
            </div>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Headcount</Th>
                <Th>Gross</Th>
                <Th>Deductions</Th>
                <Th>Net</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.points.map((point) => (
                <tr key={point.periodKey}>
                  <Td className="font-medium text-ink">{formatMonth(point.year, point.month)}</Td>
                  <Td>{point.headcount}</Td>
                  <Td>{point.gross.toLocaleString('en-US')}</Td>
                  <Td>{point.deductions.toLocaleString('en-US')}</Td>
                  <Td className="font-semibold">{point.net.toLocaleString('en-US')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Panel>
  )
}
