import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import {
  dateKey,
  formatTime,
  label,
  minutesLabel,
  shiftDays,
  todayKey,
} from '../lib/format'
import { useAction, useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type {
  AttendanceCorrection,
  AttendanceRecord,
  AttendanceStatus,
  Board,
  BoardRow,
  Employee,
  TodayState,
} from '../lib/types'
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Select,
  Stat,
  Table,
  Tabs,
  Td,
  Textarea,
  TextInput,
  Th,
  statusTone,
} from '../components/ui'
import { IconCalendarCheck, IconCheckCircle, IconClock } from '../components/icons'

const STATUSES: AttendanceStatus[] = [
  'present',
  'late',
  'remote',
  'half-day',
  'absent',
  'leave',
  'holiday',
]

/**
 * Attendance.
 *
 * Staff see the company: today's board, the ledger, corrections and manual
 * marking. Everyone else sees their own day: check in, check out, history and
 * a correction request when something is wrong.
 */
export default function AttendanceScreen() {
  const { can } = useSession()
  const isStaff = can('attendance.manage')

  return (
    <>
      <PageHeader
        title="Attendance"
        description={
          isStaff
            ? "Today's marking, the ledger and correction requests."
            : 'Check in, review your history and fix a wrong mark.'
        }
      />
      {isStaff ? <StaffAttendance /> : <MyAttendance />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Employee: self-service                                              */
/* ------------------------------------------------------------------ */

function MyAttendance() {
  const [tab, setTab] = useState<'today' | 'history' | 'corrections'>('today')

  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'today', label: 'Today' },
          { id: 'history', label: 'My history' },
          { id: 'corrections', label: 'Corrections' },
        ]}
      />
      {tab === 'today' && <TodayCard />}
      {tab === 'history' && <MyHistory />}
      {tab === 'corrections' && <MyCorrections />}
    </>
  )
}

function TodayCard() {
  const { data, error, loading, reload } = useAsync(() => api.get<TodayState>('/attendance/today'))
  const { run, busy, error: actionError } = useAction()

  if (loading) return <Loading />
  if (error) return <Banner tone="danger">{error}</Banner>
  if (!data) return null

  const state = data.data
  const record = state.attendance

  const check = async (path: 'check-in' | 'check-out') => {
    const ok = await run(() => api.post(`/attendance/${path}`))
    if (ok) reload()
  }

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-3.5 items-start">
      <Panel title={`Today — ${state.date}`} description={state.isHoliday ? state.holidayName ?? 'Non-working day' : 'Working day'}>
        {actionError && (
          <div className="mb-3">
            <Banner tone="danger">{actionError}</Banner>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-card border border-line p-3">
            <p className="text-[11.5px] text-ink-secondary">Check-in</p>
            <p className="text-[18px] font-bold text-ink">
              {record?.checkInAt ? formatTime(record.checkInAt) : '—'}
            </p>
            {record && record.minutesLate > 0 && (
              <p className="text-[11px] text-warning">{record.minutesLate} min late</p>
            )}
          </div>
          <div className="rounded-card border border-line p-3">
            <p className="text-[11.5px] text-ink-secondary">Check-out</p>
            <p className="text-[18px] font-bold text-ink">
              {record?.checkOutAt ? formatTime(record.checkOutAt) : '—'}
            </p>
            <p className="text-[11px] text-ink-secondary">
              {record ? minutesLabel(record.minutesWorked) : 'Not marked'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void check('check-in')}
            loading={busy}
            disabled={state.checkedIn}
          >
            <IconCheckCircle className="w-4 h-4" />
            {state.checkedIn ? 'Checked in' : 'Check in'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void check('check-out')}
            loading={busy}
            disabled={!state.checkedIn || state.checkedOut}
          >
            <IconClock className="w-4 h-4" />
            {state.checkedOut ? 'Checked out' : 'Check out'}
          </Button>
          {record && <Badge tone={statusTone(record.status)}>{label(record.status)}</Badge>}
        </div>

        <p className="text-[11.5px] text-ink-secondary mt-3">
          Lateness is measured against the company's work start and grace period, which an
          administrator sets under Settings.
        </p>
      </Panel>

      <Panel title="Something wrong?">
        <p className="text-[12.5px] text-ink-secondary leading-relaxed">
          If a day was marked incorrectly — a missed check-in, a day you worked remotely, or an
          absence that was actually approved leave — send a correction request with a short reason.
          HR reviews it and the attendance record is updated when it is approved.
        </p>
      </Panel>
    </div>
  )
}

function MyHistory() {
  const [range, setRange] = useState({ from: shiftDays(todayKey(), -29), to: todayKey() })

  const { data, error, loading } = useAsync(
    () =>
      api.get<{
        from: string
        to: string
        summary: {
          total: number
          byStatus: Record<string, number>
          minutesLate: number
          minutesWorked: number
        }
        records: AttendanceRecord[]
      }>('/attendance/me', { from: range.from, to: range.to }),
    [range.from, range.to],
  )

  return (
    <>
      <div className="card p-3 mb-3.5 flex flex-wrap items-end gap-2">
        <Field label="From">
          <TextInput
            type="date"
            value={range.from}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </Field>
        <Field label="To">
          <TextInput
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </Field>
      </div>

      {loading && <Loading />}
      {error && <Banner tone="danger">{error}</Banner>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-3.5">
            <Stat label="Days marked" value={data.data.summary.total} />
            <Stat label="Present" value={data.data.summary.byStatus.present ?? 0} tone="success" />
            <Stat label="Late" value={data.data.summary.byStatus.late ?? 0} tone="warning" />
            <Stat
              label="Hours worked"
              value={minutesLabel(data.data.summary.minutesWorked)}
              tone="info"
            />
          </div>

          <Panel padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th>In</Th>
                  <Th>Out</Th>
                  <Th>Late</Th>
                  <Th>Worked</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.records.map((record) => (
                  <tr key={record.id}>
                    <Td>{dateKey(record.date)}</Td>
                    <Td>
                      <Badge tone={statusTone(record.status)}>{label(record.status)}</Badge>
                    </Td>
                    <Td>{formatTime(record.checkInAt)}</Td>
                    <Td>{formatTime(record.checkOutAt)}</Td>
                    <Td>{record.minutesLate ? `${record.minutesLate}m` : '—'}</Td>
                    <Td>{minutesLabel(record.minutesWorked)}</Td>
                  </tr>
                ))}
                {data.data.records.length === 0 && (
                  <tr>
                    <Td className="text-ink-secondary">No records in this range.</Td>
                    <Td />
                    <Td />
                    <Td />
                    <Td />
                    <Td />
                  </tr>
                )}
              </tbody>
            </Table>
          </Panel>
        </>
      )}
    </>
  )
}

function MyCorrections() {
  const { data, error, loading, reload } = useAsync(() =>
    api.get<AttendanceCorrection[]>('/attendance/corrections'),
  )

  const [form, setForm] = useState({
    date: todayKey(),
    requestedStatus: 'present' as AttendanceStatus,
    checkInAt: '',
    checkOutAt: '',
    reason: '',
  })
  const [open, setOpen] = useState(false)
  const { run, busy, error: submitError, fieldErrors } = useAction()

  const submit = async () => {
    const ok = await run(() =>
      api.post('/attendance/corrections', {
        date: form.date,
        requestedStatus: form.requestedStatus,
        requestedCheckInAt: form.checkInAt ? `${form.date}T${form.checkInAt}:00` : undefined,
        requestedCheckOutAt: form.checkOutAt ? `${form.date}T${form.checkOutAt}:00` : undefined,
        reason: form.reason,
      }),
    )
    if (ok) {
      setOpen(false)
      setForm({ date: todayKey(), requestedStatus: 'present', checkInAt: '', checkOutAt: '', reason: '' })
      reload()
    }
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setOpen(true)}>Request a correction</Button>
      </div>

      {loading && <Loading />}
      {error && <Banner tone="danger">{error}</Banner>}

      {data && (
        <Panel title="My correction requests" padded={false}>
          {data.data.length === 0 ? (
            <EmptyState
              title="No correction requests"
              description="Nothing has been raised for your attendance."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Requested</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                  <Th>Decision note</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((correction) => (
                  <tr key={correction.id}>
                    <Td>{dateKey(correction.date)}</Td>
                    <Td>{label(correction.requestedStatus)}</Td>
                    <Td className="max-w-[280px]">{correction.reason}</Td>
                    <Td>
                      <Badge tone={statusTone(correction.status)}>{label(correction.status)}</Badge>
                    </Td>
                    <Td className="text-ink-secondary">{correction.decisionNote ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {open && (
        <Modal
          title="Request an attendance correction"
          description="HR will review this request and update the record if approved."
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} loading={busy}>
                Send request
              </Button>
            </>
          }
        >
          {submitError && (
            <div className="mb-3">
              <Banner tone="danger">{submitError}</Banner>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Date" error={fieldErrors.date}>
              <TextInput
                type="date"
                value={form.date}
                max={todayKey()}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </Field>
            <Field label="Correct status" error={fieldErrors.requestedStatus}>
              <Select
                value={form.requestedStatus}
                onChange={(event) =>
                  setForm({ ...form, requestedStatus: event.target.value as AttendanceStatus })
                }
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Check-in time" hint="Optional" error={fieldErrors.requestedCheckInAt}>
              <TextInput
                type="time"
                value={form.checkInAt}
                onChange={(event) => setForm({ ...form, checkInAt: event.target.value })}
              />
            </Field>
            <Field label="Check-out time" hint="Optional" error={fieldErrors.requestedCheckOutAt}>
              <TextInput
                type="time"
                value={form.checkOutAt}
                onChange={(event) => setForm({ ...form, checkOutAt: event.target.value })}
              />
            </Field>
          </div>

          <Field label="Reason" className="mt-3" error={fieldErrors.reason}>
            <Textarea
              rows={3}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              placeholder="I was working from the client site and could not check in."
            />
          </Field>
        </Modal>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

function StaffAttendance() {
  const [tab, setTab] = useState<'board' | 'ledger' | 'corrections' | 'mark'>('board')

  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'board', label: 'Daily board' },
          { id: 'ledger', label: 'Ledger' },
          { id: 'corrections', label: 'Corrections' },
          { id: 'mark', label: 'Mark attendance' },
        ]}
      />
      {tab === 'board' && <BoardTab />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'corrections' && <CorrectionsTab />}
      {tab === 'mark' && <MarkTab />}
    </>
  )
}

function BoardTab() {
  const [date, setDate] = useState(todayKey())
  const { data, error, loading } = useAsync(
    () => api.get<Board>('/attendance/board', { date }),
    [date],
  )

  if (loading) return <Loading />
  if (error) return <Banner tone="danger">{error}</Banner>
  if (!data) return null

  const board = data.data
  const totals = board.totals

  return (
    <>
      <div className="card p-3 mb-3.5 flex flex-wrap items-end gap-2">
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2 pb-1">
          {Object.entries(totals).map(([status, count]) => (
            <Badge key={status} tone={statusTone(status)}>
              {label(status)} {count}
            </Badge>
          ))}
          {board.weekend && <Badge tone="neutral">Weekend</Badge>}
          {board.holidayName && <Badge tone="info">{board.holidayName}</Badge>}
        </div>
      </div>

      <Panel
        title={`Board for ${board.date}`}
        description={`${board.headcount} active employees. Anyone still unmarked today is counted as absent once the day has passed.`}
        padded={false}
      >
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Department</Th>
              <Th>Status</Th>
              <Th>In</Th>
              <Th>Out</Th>
              <Th>Late</Th>
              <Th>Worked</Th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row: BoardRow) => (
              <tr key={row.employeeId}>
                <Td>
                  <span className="font-medium text-ink">{row.fullName}</span>
                  <span className="block text-[10.5px] text-ink-secondary">{row.employeeCode}</span>
                </Td>
                <Td className="text-ink-secondary">{row.departmentName ?? '—'}</Td>
                <Td>
                  <Badge tone={statusTone(row.status)}>{label(row.status)}</Badge>
                </Td>
                <Td>{formatTime(row.checkInAt)}</Td>
                <Td>{formatTime(row.checkOutAt)}</Td>
                <Td>{row.minutesLate ? `${row.minutesLate}m` : '—'}</Td>
                <Td>{minutesLabel(row.minutesWorked)}</Td>
              </tr>
            ))}
            {board.rows.length === 0 && (
              <tr>
                <Td className="text-ink-secondary">No active employees yet.</Td>
                <Td />
                <Td />
                <Td />
                <Td />
                <Td />
                <Td />
              </tr>
            )}
          </tbody>
        </Table>
      </Panel>
    </>
  )
}

function LedgerTab() {
  const [range, setRange] = useState({ from: shiftDays(todayKey(), -13), to: todayKey() })
  const [status, setStatus] = useState('')

  const { data, error, loading } = useAsync(
    () =>
      api.get<AttendanceRecord[]>('/attendance', {
        from: range.from,
        to: range.to,
        status: status || undefined,
        limit: 100,
      }),
    [range.from, range.to, status],
  )

  return (
    <>
      <div className="card p-3 mb-3.5 flex flex-wrap items-end gap-2">
        <Field label="From">
          <TextInput
            type="date"
            value={range.from}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </Field>
        <Field label="To">
          <TextInput
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {loading && <Loading />}
      {error && <Banner tone="danger">{error}</Banner>}

      {data && (
        <Panel
          title="Attendance ledger"
          description={`${data.meta?.total ?? data.data.length} record(s)`}
          padded={false}
        >
          {data.data.length === 0 ? (
            <EmptyState title="No records" description="Nothing matches this range and filter." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Employee</Th>
                  <Th>Status</Th>
                  <Th>In</Th>
                  <Th>Out</Th>
                  <Th>Late</Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((record) => (
                  <tr key={record.id}>
                    <Td>{dateKey(record.date)}</Td>
                    <Td>
                      <span className="font-medium text-ink">{record.employeeName ?? '—'}</span>
                      <span className="block text-[10.5px] text-ink-secondary">
                        {record.employeeCode ?? ''}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(record.status)}>{label(record.status)}</Badge>
                    </Td>
                    <Td>{formatTime(record.checkInAt)}</Td>
                    <Td>{formatTime(record.checkOutAt)}</Td>
                    <Td>{record.minutesLate ? `${record.minutesLate}m` : '—'}</Td>
                    <Td className="text-ink-secondary">{label(record.source)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}
    </>
  )
}

function CorrectionsTab() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | ''>('pending')
  const { data, error, loading, reload } = useAsync(
    () => api.get<AttendanceCorrection[]>('/attendance/corrections', { status: status || undefined }),
    [status],
  )

  const [deciding, setDeciding] = useState<AttendanceCorrection | null>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const { run, busy, error: decisionError } = useAction()

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!deciding) return
    const ok = await run(() =>
      api.patch(`/attendance/corrections/${deciding.id}`, {
        decision,
        decisionNote: decisionNote || undefined,
      }),
    )
    if (ok) {
      setDeciding(null)
      setDecisionNote('')
      reload()
    }
  }

  return (
    <>
      <div className="card p-3 mb-3.5 flex items-end gap-2">
        <Field label="Show">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </Select>
        </Field>
      </div>

      {loading && <Loading />}
      {error && <Banner tone="danger">{error}</Banner>}

      {data && (
        <Panel title="Correction requests" padded={false}>
          {data.data.length === 0 ? (
            <EmptyState title="Nothing here" description="No requests with this status." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Date</Th>
                  <Th>Requested</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((correction) => (
                  <tr key={correction.id}>
                    <Td>
                      <span className="font-medium text-ink">{correction.employeeName ?? '—'}</span>
                      <span className="block text-[10.5px] text-ink-secondary">
                        {correction.employeeCode ?? ''}
                      </span>
                    </Td>
                    <Td>{dateKey(correction.date)}</Td>
                    <Td>{label(correction.requestedStatus)}</Td>
                    <Td className="max-w-[260px]">{correction.reason}</Td>
                    <Td>
                      <Badge tone={statusTone(correction.status)}>{label(correction.status)}</Badge>
                    </Td>
                    <Td>
                      {correction.status === 'pending' && (
                        <Button
                          variant="outline"
                          className="w-auto px-2 py-1 text-[11.5px]"
                          onClick={() => {
                            setDeciding(correction)
                            setDecisionNote('')
                          }}
                        >
                          Review
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {deciding && (
        <Modal
          title="Review correction"
          description={`${deciding.employeeName ?? 'Employee'} · ${dateKey(deciding.date)}`}
          onClose={() => setDeciding(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => void decide('rejected')}
              >
                Reject
              </Button>
              <Button loading={busy} onClick={() => void decide('approved')}>
                Approve
              </Button>
            </>
          }
        >
          {decisionError && (
            <div className="mb-3">
              <Banner tone="danger">{decisionError}</Banner>
            </div>
          )}

          <p className="text-[12.5px] text-ink/80 mb-2">
            <strong>Requested:</strong> {label(deciding.requestedStatus)} on {dateKey(deciding.date)}
          </p>
          <p className="text-[12.5px] text-ink-secondary mb-3">{deciding.reason}</p>

          <Field label="Decision note" hint="Optional. Shown to the employee.">
            <Textarea
              rows={3}
              value={decisionNote}
              onChange={(event) => setDecisionNote(event.target.value)}
              placeholder="Approved — verified with the site supervisor."
            />
          </Field>
        </Modal>
      )}
    </>
  )
}

function MarkTab() {
  const { data: employees } = useAsync(() =>
    api.get<Employee[]>('/employees', { status: 'active', limit: 100 }),
  )

  const [form, setForm] = useState({
    employeeId: '',
    date: todayKey(),
    status: 'present' as AttendanceStatus,
    note: '',
  })
  const { run, busy, error, fieldErrors } = useAction()
  const [done, setDone] = useState<string | null>(null)

  const options = useMemo(
    () => (employees?.data ?? []).map((employee) => ({
      id: employee.id,
      text: `${employee.fullName} · ${employee.employeeCode}`,
    })),
    [employees],
  )

  const submit = async () => {
    setDone(null)
    const ok = await run(() =>
      api.post('/attendance/mark', {
        employeeId: form.employeeId,
        date: form.date,
        status: form.status,
        note: form.note || undefined,
      }),
    )
    if (ok) setDone(`Saved ${label(form.status)} for ${form.date}.`)
  }

  return (
    <Panel title="Mark attendance manually" description="Useful for corrections, remote days and new joiners." className="max-w-2xl">
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {done && (
        <div className="mb-3">
          <Banner tone="success" onDismiss={() => setDone(null)}>
            {done}
          </Banner>
        </div>
      )}

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Field label="Employee" error={fieldErrors.employeeId}>
          <Select
            value={form.employeeId}
            onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
            required
          >
            <option value="">Select an employee…</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.text}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Date" error={fieldErrors.date}>
            <TextInput
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
              required
            />
          </Field>
          <Field label="Status" error={fieldErrors.status}>
            <Select
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value as AttendanceStatus })
              }
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Note" hint="Optional" error={fieldErrors.note}>
          <TextInput
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
            placeholder="Approved by the line manager"
          />
        </Field>

        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            <IconCalendarCheck className="w-4 h-4" /> Save mark
          </Button>
        </div>
      </form>
    </Panel>
  )
}
