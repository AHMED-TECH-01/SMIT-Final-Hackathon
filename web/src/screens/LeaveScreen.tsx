import { useState } from 'react'
import { api } from '../lib/api'
import { dateKey, formatDate, label, todayKey } from '../lib/format'
import { useAction, useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type { LeaveBalance, LeaveRequest, LeaveStatus, LeaveType } from '../lib/types'
import {
  Badge,
  Banner,
  Button,
  Checkbox,
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

/**
 * Leave.
 *
 * Employees apply, watch their balances and cancel while a request is pending.
 * Approvers get the queue; approving writes the decision, updates the balance
 * (balances are derived, never stored) and notifies the applicant.
 */
export default function LeaveScreen() {
  const { can } = useSession()
  const canApply = can('leave.apply')
  const canApprove = can('leave.approve')

  const [tab, setTab] = useState<'mine' | 'approvals'>(canApply ? 'mine' : 'approvals')

  return (
    <>
      <PageHeader
        title="Leave"
        description={
          canApprove
            ? "Review requests and keep an eye on the team's time off."
            : 'Apply for time off and track what is left this year.'
        }
      />

      {canApply && canApprove ? (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'mine', label: 'My leave' },
            { id: 'approvals', label: 'Approvals' },
          ]}
        />
      ) : null}

      {tab === 'mine' && canApply ? <MyLeave /> : <Approvals />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* My leave                                                            */
/* ------------------------------------------------------------------ */

function MyLeave() {
  const balances = useAsync(() => api.get<{ year: number; balances: LeaveBalance[] }>('/leave/balances'))
  const types = useAsync(() => api.get<LeaveType[]>('/leave-types', { limit: 100 }))
  const requests = useAsync(() =>
    api.get<LeaveRequest[]>('/leave/requests', { limit: 50 }),
  )

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: todayKey(),
    endDate: todayKey(),
    halfDay: false,
    reason: '',
  })
  const { run, busy, error, fieldErrors } = useAction()
  const cancel = useAction()

  const submit = async () => {
    const ok = await run(() =>
      api.post('/leave/requests', {
        leaveTypeId: form.leaveTypeId,
        startDate: form.startDate,
        endDate: form.endDate,
        halfDay: form.halfDay,
        reason: form.reason,
      }),
    )
    if (ok) {
      setOpen(false)
      setForm({
        leaveTypeId: '',
        startDate: todayKey(),
        endDate: todayKey(),
        halfDay: false,
        reason: '',
      })
      balances.reload()
      requests.reload()
    }
  }

  const cancelRequest = async (request: LeaveRequest) => {
    const ok = await cancel.run(() => api.patch(`/leave/requests/${request.id}/cancel`))
    if (ok) {
      balances.reload()
      requests.reload()
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-3.5">
        {balances.loading && <Loading />}
        {balances.data?.data.balances.map((balance) => (
          <Stat
            key={balance.leaveTypeId}
            label={balance.name}
            value={balance.remaining}
            hint={`${balance.used} used · ${balance.pending} pending of ${balance.entitled}`}
            tone={balance.remaining === 0 ? 'warning' : 'success'}
          />
        ))}
        {balances.data && balances.data.data.balances.length === 0 && (
          <div className="col-span-full">
            <Banner tone="info">No leave types are configured yet. Ask HR to add them.</Banner>
          </div>
        )}
      </div>

      {cancel.error && <Banner tone="danger">{cancel.error}</Banner>}

      <div className="flex justify-end mb-3">
        <Button onClick={() => setOpen(true)} disabled={(types.data?.data.length ?? 0) === 0}>
          Apply for leave
        </Button>
      </div>

      <Panel title="My requests" padded={false}>
        {requests.loading && <Loading />}
        {requests.error && <Banner tone="danger">{requests.error}</Banner>}
        {requests.data && (
          <>
            {requests.data.data.length === 0 ? (
              <EmptyState
                title="No leave requests yet"
                description="Your requests and their decisions will appear here."
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th>Days</Th>
                    <Th>Status</Th>
                    <Th>Reason</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {requests.data.data.map((request) => (
                    <tr key={request.id}>
                      <Td>{request.leaveTypeName ?? 'Leave'}</Td>
                      <Td>{formatDate(request.startDate)}</Td>
                      <Td>{formatDate(request.endDate)}</Td>
                      <Td>
                        {request.days}
                        {request.halfDay ? ' (half)' : ''}
                      </Td>
                      <Td>
                        <Badge tone={statusTone(request.status)}>{label(request.status)}</Badge>
                      </Td>
                      <Td className="max-w-[240px] text-ink-secondary">{request.reason}</Td>
                      <Td>
                        {request.status === 'pending' && (
                          <Button
                            variant="ghost"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            loading={cancel.busy}
                            onClick={() => void cancelRequest(request)}
                          >
                            Cancel
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Panel>

      {open && (
        <Modal
          title="Apply for leave"
          description="Working days are counted automatically — weekends and holidays are excluded."
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submit()} loading={busy}>
                Submit request
              </Button>
            </>
          }
        >
          {error && (
            <div className="mb-3">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Leave type" error={fieldErrors.leaveTypeId} className="sm:col-span-2">
              <Select
                value={form.leaveTypeId}
                onChange={(event) => setForm({ ...form, leaveTypeId: event.target.value })}
              >
                <option value="">Select a type…</option>
                {(types.data?.data ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name} ({type.annualQuota} days/year)
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="From" error={fieldErrors.startDate}>
              <TextInput
                type="date"
                value={form.startDate}
                onChange={(event) => {
                  const startDate = event.target.value
                  setForm((current) => ({
                    ...current,
                    startDate,
                    endDate: current.endDate < startDate ? startDate : current.endDate,
                  }))
                }}
              />
            </Field>
            <Field label="To" error={fieldErrors.endDate}>
              <TextInput
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              />
            </Field>
          </div>

          <div className="mt-3">
            <Checkbox
              checked={form.halfDay}
              onChange={(halfDay) => setForm({ ...form, halfDay })}
              label="Half day (single day only)"
            />
          </div>

          <Field label="Reason" className="mt-3" error={fieldErrors.reason}>
            <Textarea
              rows={3}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
              placeholder="Family wedding out of town."
            />
          </Field>
        </Modal>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

function Approvals() {
  const [status, setStatus] = useState<LeaveStatus | ''>('pending')
  const { data, error, loading, reload } = useAsync(
    () => api.get<LeaveRequest[]>('/leave/requests', { status: status || undefined, limit: 100 }),
    [status],
  )

  const [deciding, setDeciding] = useState<LeaveRequest | null>(null)
  const [note, setNote] = useState('')
  const { run, busy, error: decisionError } = useAction()

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!deciding) return
    const ok = await run(() =>
      api.patch(`/leave/requests/${deciding.id}/decision`, {
        decision,
        decisionNote: note || undefined,
      }),
    )
    if (ok) {
      setDeciding(null)
      setNote('')
      reload()
    }
  }

  const pendingCount = (data?.data ?? []).filter((request) => request.status === 'pending').length

  return (
    <>
      <div className="card p-3 mb-3.5 flex flex-wrap items-end gap-2 justify-between">
        <Field label="Show">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value as LeaveStatus | '')}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All</option>
          </Select>
        </Field>
        {status === 'pending' && (
          <Badge tone={pendingCount > 0 ? 'warning' : 'success'}>
            {pendingCount} waiting
          </Badge>
        )}
      </div>

      {loading && <Loading />}
      {error && <Banner tone="danger">{error}</Banner>}

      {data && (
        <Panel title="Leave requests" padded={false}>
          {data.data.length === 0 ? (
            <EmptyState title="Nothing here" description="No requests with this status." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Type</Th>
                  <Th>Period</Th>
                  <Th>Days</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((request) => (
                  <tr key={request.id}>
                    <Td>
                      <span className="font-medium text-ink">{request.employeeName ?? '—'}</span>
                      <span className="block text-[10.5px] text-ink-secondary">
                        {request.employeeCode ?? ''}
                      </span>
                    </Td>
                    <Td>{request.leaveTypeName ?? '—'}</Td>
                    <Td>
                      {dateKey(request.startDate)}
                      {dateKey(request.startDate) !== dateKey(request.endDate)
                        ? ` → ${dateKey(request.endDate)}`
                        : ''}
                    </Td>
                    <Td>{request.days}</Td>
                    <Td className="max-w-[220px] text-ink-secondary">{request.reason}</Td>
                    <Td>
                      <Badge tone={statusTone(request.status)}>{label(request.status)}</Badge>
                    </Td>
                    <Td>
                      {request.status === 'pending' && (
                        <Button
                          variant="outline"
                          className="w-auto px-2 py-1 text-[11.5px]"
                          onClick={() => {
                            setDeciding(request)
                            setNote('')
                          }}
                        >
                          Decide
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
          title="Decide on leave"
          description={`${deciding.employeeName ?? 'Employee'} · ${deciding.days} day(s) · ${deciding.leaveTypeName ?? 'Leave'}`}
          onClose={() => setDeciding(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void decide('rejected')}>
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

          <p className="text-[12.5px] text-ink/80">
            {formatDate(deciding.startDate)} → {formatDate(deciding.endDate)}
          </p>
          <p className="text-[12.5px] text-ink-secondary mt-1 mb-3">{deciding.reason}</p>

          <Field label="Decision note" hint="Optional. The employee is notified either way.">
            <Textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Approved — please hand over before you leave."
            />
          </Field>
        </Modal>
      )}
    </>
  )
}
