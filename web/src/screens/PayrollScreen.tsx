import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatDate, formatMoney, formatMonth, label } from '../lib/format'
import { useAction, useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type { Employee, PayrollRun, PayslipLine, SalaryStructure } from '../lib/types'
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
  TextInput,
  Th,
  statusTone,
} from '../components/ui'
import { IconCalendarCheck, IconWallet } from '../components/icons'

/**
 * Payroll.
 *
 * HR drafts a period from the stored salary structures, reviews the lines and
 * finalizes. Finalizing is admin-only on the server, publishes payslips and
 * notifies each employee. Employees only ever see their own finalized slips.
 */
export default function PayrollScreen() {
  const { can } = useSession()
  const isCompany = can('payroll.read.company')
  const canProcess = can('payroll.process')

  const [tab, setTab] = useState<'runs' | 'structures' | 'payslips'>(
    isCompany ? 'runs' : 'payslips',
  )

  return (
    <>
      <PageHeader
        title="Payroll"
        description={
          isCompany
            ? 'Draft a period, check the numbers, then publish the payslips.'
            : 'Your payslips, ready to download once payroll is finalized.'
        }
      />

      {isCompany ? (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'runs', label: 'Payroll runs' },
            { id: 'structures', label: 'Salary structures' },
            { id: 'payslips', label: 'My payslips' },
          ]}
        />
      ) : null}

      {tab === 'runs' && isCompany && <RunsTab canProcess={canProcess} canApprove={can('payroll.approve')} />}
      {tab === 'structures' && isCompany && <StructuresTab canProcess={canProcess} />}
      {tab === 'payslips' && <PayslipsTab />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

function RunsTab({ canProcess, canApprove }: { canProcess: boolean; canApprove: boolean }) {
  const runs = useAsync(() => api.get<PayrollRun[]>('/payroll/runs'))
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [period, setPeriod] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 })
  const create = useAction()
  const finalize = useAction()
  const [notice, setNotice] = useState<string | null>(null)

  const createRun = async () => {
    const ok = await create.run(() => api.post('/payroll/runs', period))
    if (ok) {
      setCreating(false)
      runs.reload()
    }
  }

  const finalizeRun = async (id: string) => {
    const ok = await finalize.run(() => api.post(`/payroll/runs/${id}/finalize`))
    if (ok) {
      setNotice('Payroll finalized. Payslips are now visible to employees and notifications were sent.')
      runs.reload()
    }
  }

  return (
    <>
      {(create.error || finalize.error) && (
        <div className="mb-3">
          <Banner tone="danger">{create.error ?? finalize.error}</Banner>
        </div>
      )}
      {notice && (
        <div className="mb-3">
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}

      <div className="flex justify-end gap-2 mb-3">
        {canProcess && <Button onClick={() => setCreating(true)}>Start a payroll run</Button>}
      </div>

      {runs.loading && <Loading />}
      {runs.error && <Banner tone="danger">{runs.error}</Banner>}

      {runs.data && (
        <Panel title="Runs" description="Newest first" padded={false}>
          {runs.data.data.length === 0 ? (
            <EmptyState
              title="No payroll runs yet"
              description="Set a salary structure for each employee, then start a run."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th>Status</Th>
                  <Th>Working days</Th>
                  <Th>Headcount</Th>
                  <Th>Gross</Th>
                  <Th>Net</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {runs.data.data.map((run) => (
                  <tr key={run.id} className={selected === run.id ? 'bg-primary-light/40' : ''}>
                    <Td>
                      <span className="font-medium text-ink">{formatMonth(run.year, run.month)}</span>
                      <span className="block text-[10.5px] text-ink-secondary">{run.periodKey}</span>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(run.status)}>{label(run.status)}</Badge>
                    </Td>
                    <Td>{run.workingDays}</Td>
                    <Td>{run.totals.headcount}</Td>
                    <Td>{run.totals.gross.toLocaleString('en-US')}</Td>
                    <Td className="font-semibold">{run.totals.net.toLocaleString('en-US')}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          className="w-auto px-2 py-1 text-[11.5px]"
                          onClick={() => setSelected(selected === run.id ? null : run.id)}
                        >
                          {selected === run.id ? 'Hide' : 'Open'}
                        </Button>
                        {run.status === 'draft' && canApprove && (
                          <Button
                            className="w-auto px-2 py-1 text-[11.5px]"
                            loading={finalize.busy}
                            onClick={() => void finalizeRun(run.id)}
                          >
                            Finalize
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {selected && <RunDetail runId={selected} canProcess={canProcess} canApprove={canApprove} />}

      {creating && (
        <Modal
          title="Start a payroll run"
          description="Amounts are computed from each employee's salary structure for the period."
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button loading={create.busy} onClick={() => void createRun()}>
                Create draft
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Year">
              <TextInput
                type="number"
                value={period.year}
                onChange={(event) => setPeriod({ ...period, year: Number(event.target.value) })}
              />
            </Field>
            <Field label="Month">
              <Select
                value={period.month}
                onChange={(event) => setPeriod({ ...period, month: Number(event.target.value) })}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>
                    {formatMonth(period.year, month)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-[11.5px] text-ink-secondary mt-3">
            Creating the same period twice returns the existing draft instead of duplicating it.
          </p>
        </Modal>
      )}
    </>
  )
}

function RunDetail({
  runId,
  canProcess,
  canApprove,
}: {
  runId: string
  canProcess: boolean
  canApprove: boolean
}) {
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ run: PayrollRun; lines: PayslipLine[] }>(`/payroll/runs/${runId}`),
    [runId],
  )
  const recompute = useAction()
  const [notice, setNotice] = useState<string | null>(null)

  const runRecompute = async () => {
    const ok = await recompute.run(() => api.post(`/payroll/runs/${runId}/recompute`))
    if (ok) {
      setNotice('Lines recomputed from the latest attendance and salary data.')
      reload()
    }
  }

  if (loading) return <Loading />
  if (error) return <Banner tone="danger">{error}</Banner>
  if (!data) return null

  const { run, lines } = data.data

  return (
    <div className="mt-3.5">
      <Panel
        title={`${formatMonth(run.year, run.month)} — ${lines.length} payslip(s)`}
        description={run.status === 'finalized' ? 'Finalized and published' : 'Draft — not visible to employees'}
        actions={
          run.status === 'draft' && canProcess ? (
            <Button variant="outline" loading={recompute.busy} onClick={() => void runRecompute()}>
              Recompute
            </Button>
          ) : canProcess ? null : undefined
        }
        padded={false}
      >
        {(recompute.error || notice) && (
          <div className="p-3">
            {recompute.error ? (
              <Banner tone="danger">{recompute.error}</Banner>
            ) : (
              <Banner tone="success" onDismiss={() => setNotice(null)}>
                {notice}
              </Banner>
            )}
          </div>
        )}

        {lines.length === 0 ? (
          <EmptyState
            title="No payslip lines"
            description="No employee has an active salary structure for this period."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Present</Th>
                <Th>Late</Th>
                <Th>Absent</Th>
                <Th>Gross</Th>
                <Th>Deductions</Th>
                <Th>Net</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <Td>
                    <span className="font-medium text-ink">{line.fullName}</span>
                    <span className="block text-[10.5px] text-ink-secondary">{line.employeeCode}</span>
                  </Td>
                  <Td>{line.presentDays}</Td>
                  <Td>{line.lateDays}</Td>
                  <Td>{line.absentDays}</Td>
                  <Td>{formatMoney(line.gross, line.currency)}</Td>
                  <Td>{formatMoney(line.totalDeductions, line.currency)}</Td>
                  <Td className="font-semibold">{formatMoney(line.net, line.currency)}</Td>
                  <Td>
                    <Button
                      variant="ghost"
                      className="w-auto px-2 py-1 text-[11.5px]"
                      onClick={() =>
                        void api.download(
                          `/payroll/runs/${run.id}/payslips/${line.employeeId}/pdf`,
                          `payslip-${run.periodKey}-${line.employeeCode}.pdf`,
                        )
                      }
                    >
                      PDF
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {run.status === 'draft' && canApprove === false && (
          <p className="px-4 py-2 text-[11.5px] text-ink-secondary border-t border-line/70">
            Finalizing payroll requires an administrator account.
          </p>
        )}
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Structures                                                          */
/* ------------------------------------------------------------------ */

function StructuresTab({ canProcess }: { canProcess: boolean }) {
  const structures = useAsync(() => api.get<SalaryStructure[]>('/payroll/structures'))
  const employees = useAsync(() => api.get<Employee[]>('/employees', { status: 'active', limit: 100 }))
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <>
      {structures.loading && <Loading />}
      {structures.error && <Banner tone="danger">{structures.error}</Banner>}

      {structures.data && (
        <Panel
          title="Salary structures"
          description="One active structure per employee — saving replaces it."
          padded={false}
        >
          {structures.data.data.length === 0 ? (
            <EmptyState
              title="No salary structures yet"
              description="Add one per employee before running payroll."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Currency</Th>
                  <Th>Base</Th>
                  <Th>Allowances</Th>
                  <Th>Deductions</Th>
                  <Th>Tax</Th>
                  <Th>Gross</Th>
                  <Th>Effective</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {structures.data.data.map((structure) => (
                  <tr key={structure.id}>
                    <Td>
                      <span className="font-medium text-ink">{structure.employeeName ?? '—'}</span>
                      <span className="block text-[10.5px] text-ink-secondary">
                        {structure.employeeCode ?? ''}
                      </span>
                    </Td>
                    <Td>{structure.currency}</Td>
                    <Td>{formatMoney(structure.baseSalary, structure.currency)}</Td>
                    <Td className="text-ink-secondary">
                      {structure.allowances.length
                        ? structure.allowances
                            .map((entry) => `${entry.label} ${entry.amount.toLocaleString('en-US')}`)
                            .join(', ')
                        : '—'}
                    </Td>
                    <Td className="text-ink-secondary">
                      {structure.deductions.length
                        ? structure.deductions
                            .map((entry) => `${entry.label} ${entry.amount.toLocaleString('en-US')}`)
                            .join(', ')
                        : '—'}
                    </Td>
                    <Td>{structure.taxPercent}%</Td>
                    <Td className="font-semibold">
                      {formatMoney(structure.grossSalary, structure.currency)}
                    </Td>
                    <Td className="text-ink-secondary">{formatDate(structure.effectiveFrom)}</Td>
                    <Td>
                      {canProcess && (
                        <Button
                          variant="outline"
                          className="w-auto px-2 py-1 text-[11.5px]"
                          onClick={() => setEditing(structure.employeeId)}
                        >
                          Edit
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {canProcess && (
            <div className="px-4 py-3 border-t border-line/70">
              <Button variant="outline" className="w-auto" onClick={() => setEditing('')}>
                Set a salary structure
              </Button>
            </div>
          )}
        </Panel>
      )}

      {canProcess && editing !== null && (
        <StructureModal
          employeeId={editing}
          employees={employees.data?.data ?? []}
          existing={structures.data?.data.find((row) => row.employeeId === editing) ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            structures.reload()
          }}
        />
      )}
    </>
  )
}

function StructureModal({
  employeeId,
  employees,
  existing,
  onClose,
  onSaved,
}: {
  employeeId: string
  employees: Employee[]
  existing: SalaryStructure | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    employeeId,
    currency: existing?.currency ?? 'PKR',
    baseSalary: existing ? String(existing.baseSalary) : '',
    allowanceLabel: '',
    allowanceAmount: '',
    deductionLabel: '',
    deductionAmount: '',
    taxPercent: existing ? String(existing.taxPercent) : '0',
    effectiveFrom: existing?.effectiveFrom.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  })
  const { run, busy, error, fieldErrors } = useAction()

  useEffect(() => {
    setForm((current) => ({ ...current, employeeId }))
  }, [employeeId])

  const submit = async () => {
    const allowances = form.allowanceLabel && form.allowanceAmount
      ? [{ label: form.allowanceLabel, amount: Number(form.allowanceAmount) }]
      : []
    const deductions = form.deductionLabel && form.deductionAmount
      ? [{ label: form.deductionLabel, amount: Number(form.deductionAmount) }]
      : []

    const ok = await run(() =>
      api.put(`/payroll/structures/${form.employeeId}`, {
        currency: form.currency,
        baseSalary: Number(form.baseSalary),
        allowances,
        deductions,
        taxPercent: Number(form.taxPercent),
        effectiveFrom: form.effectiveFrom,
      }),
    )
    if (ok) onSaved()
  }

  return (
    <Modal
      title={existing ? 'Edit salary structure' : 'Set a salary structure'}
      description="Payroll drafts read these values when a period is created."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Save structure
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
        <Field label="Employee" className="sm:col-span-2" error={fieldErrors.employeeId}>
          <Select
            value={form.employeeId}
            onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
          >
            <option value="">Select an employee…</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} · {employee.employeeCode}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Currency" error={fieldErrors.currency}>
          <TextInput
            value={form.currency}
            maxLength={3}
            onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Base salary" error={fieldErrors.baseSalary}>
          <TextInput
            type="number"
            value={form.baseSalary}
            onChange={(event) => setForm({ ...form, baseSalary: event.target.value })}
          />
        </Field>

        <Field label="Allowance label" hint="Optional" error={fieldErrors.allowances}>
          <TextInput
            value={form.allowanceLabel}
            onChange={(event) => setForm({ ...form, allowanceLabel: event.target.value })}
            placeholder="House rent"
          />
        </Field>
        <Field label="Allowance amount">
          <TextInput
            type="number"
            value={form.allowanceAmount}
            onChange={(event) => setForm({ ...form, allowanceAmount: event.target.value })}
          />
        </Field>

        <Field label="Deduction label" hint="Optional">
          <TextInput
            value={form.deductionLabel}
            onChange={(event) => setForm({ ...form, deductionLabel: event.target.value })}
            placeholder="Loan repayment"
          />
        </Field>
        <Field label="Deduction amount">
          <TextInput
            type="number"
            value={form.deductionAmount}
            onChange={(event) => setForm({ ...form, deductionAmount: event.target.value })}
          />
        </Field>

        <Field label="Income tax %" error={fieldErrors.taxPercent}>
          <TextInput
            type="number"
            value={form.taxPercent}
            onChange={(event) => setForm({ ...form, taxPercent: event.target.value })}
          />
        </Field>
        <Field label="Effective from" error={fieldErrors.effectiveFrom}>
          <TextInput
            type="date"
            value={form.effectiveFrom}
            onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
          />
        </Field>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Employee payslips                                                   */
/* ------------------------------------------------------------------ */

function PayslipsTab() {
  const { data, error, loading } = useAsync(() => api.get<PayslipLine[]>('/payroll/payslips'))
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const download = async (line: PayslipLine) => {
    setDownloading(line.id)
    setDownloadError(null)
    try {
      await api.download(
        `/payroll/payslips/${line.runId}/pdf`,
        `payslip-${line.periodKey ?? line.runId}.pdf`,
      )
    } catch {
      setDownloadError('The payslip could not be downloaded.')
    } finally {
      setDownloading(null)
    }
  }

  if (loading) return <Loading />
  if (error) return <Banner tone="danger">{error}</Banner>

  return (
    <>
      {downloadError && <Banner tone="danger">{downloadError}</Banner>}

      <Panel title="My payslips" description="Only finalized periods appear here" padded={false}>
        {!data || data.data.length === 0 ? (
          <EmptyState
            title="No payslips yet"
            description="Payslips become available once payroll for a period is finalized."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Gross</Th>
                <Th>Deductions</Th>
                <Th>Net</Th>
                <Th>Attendance</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.data.map((line) => (
                <tr key={line.id}>
                  <Td className="font-medium">{line.periodLabel ?? line.periodKey ?? '—'}</Td>
                  <Td>{formatMoney(line.gross, line.currency)}</Td>
                  <Td>{formatMoney(line.totalDeductions, line.currency)}</Td>
                  <Td className="font-semibold text-primary-dark">
                    {formatMoney(line.net, line.currency)}
                  </Td>
                  <Td className="text-ink-secondary">
                    {line.presentDays} present · {line.lateDays} late · {line.absentDays} absent
                  </Td>
                  <Td>
                    <Button
                      variant="outline"
                      className="w-auto px-2 py-1 text-[11.5px]"
                      loading={downloading === line.id}
                      onClick={() => void download(line)}
                    >
                      Download
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mt-3.5">
        <Stat
          label="Slips available"
          value={data?.data.length ?? 0}
          icon={<IconWallet className="w-5 h-5" />}
        />
        <Stat
          label="Latest net pay"
          value={data?.data[0] ? formatMoney(data.data[0].net, data.data[0].currency) : '—'}
          icon={<IconCalendarCheck className="w-5 h-5" />}
          tone="success"
        />
      </div>
    </>
  )
}
