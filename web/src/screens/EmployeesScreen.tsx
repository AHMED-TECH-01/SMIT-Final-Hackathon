import { useState } from 'react'
import { api } from '../lib/api'
import { dateKey, formatDate, label } from '../lib/format'
import { useAction, useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type {
  Department,
  Designation,
  Employee,
  EmployeeStatus,
  EmploymentType,
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
  Table,
  Td,
  TextInput,
  Th,
  statusTone,
} from '../components/ui'
import { IconDownload, IconPlus, IconUpload } from '../components/icons'

const EMPLOYMENT_TYPES: EmploymentType[] = ['full-time', 'part-time', 'contract', 'intern']
const EMPLOYEE_STATUSES: EmployeeStatus[] = ['active', 'probation', 'resigned', 'terminated']

interface EmployeeForm {
  employeeCode: string
  fullName: string
  email: string
  phone: string
  departmentId: string
  designationId: string
  joinDate: string
  employmentType: EmploymentType
  status: EmployeeStatus
  address: string
  emergencyContact: string
}

const EMPTY_FORM: EmployeeForm = {
  employeeCode: '',
  fullName: '',
  email: '',
  phone: '',
  departmentId: '',
  designationId: '',
  joinDate: new Date().toISOString().slice(0, 10),
  employmentType: 'full-time',
  status: 'active',
  address: '',
  emergencyContact: '',
}

/**
 * The employee directory.
 *
 * Employee codes are assigned by the server when left blank, so the form never
 * has to guess the next number when two administrators type at once.
 */
export default function EmployeesScreen() {
  const { can } = useSession()
  const canCreate = can('employee.create')
  const canUpdate = can('employee.update')
  const canArchive = can('employee.archive')
  const canExport = can('report.export')

  const [filters, setFilters] = useState({ q: '', departmentId: '', status: '' })
  const [page, setPage] = useState(1)

  const employees = useAsync(
    () =>
      api.get<Employee[]>('/employees', {
        q: filters.q || undefined,
        departmentId: filters.departmentId || undefined,
        status: filters.status || undefined,
        page,
        limit: 25,
      }),
    [filters.q, filters.departmentId, filters.status, page],
  )
  const departments = useAsync(() => api.get<Department[]>('/departments', { limit: 100 }))
  const designations = useAsync(() => api.get<Designation[]>('/designations', { limit: 100 }))

  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [archiving, setArchiving] = useState<Employee | null>(null)
  const archive = useAction()
  const [notice, setNotice] = useState<string | null>(null)

  const total = employees.data?.meta?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / 25))

  const exportCsv = async () => {
    setNotice(null)
    try {
      await api.download('/employees/export', 'employees.csv')
    } catch {
      setNotice('The export could not be prepared.')
    }
  }

  const confirmArchive = async () => {
    if (!archiving) return
    const ok = await archive.run(() => api.post(`/employees/${archiving.id}/archive`))
    if (ok) {
      setNotice(`${archiving.fullName} was archived.`)
      setArchiving(null)
      employees.reload()
    }
  }

  return (
    <>
      <PageHeader
        title="Employees"
        description="The directory: who works here, in which department, and since when."
        actions={
          <>
            {canExport && (
              <Button variant="outline" className="w-auto" onClick={() => void exportCsv()}>
                <IconDownload className="w-4 h-4" /> Export CSV
              </Button>
            )}
            {canCreate && (
              <Button onClick={() => setEditing('new')}>
                <IconPlus className="w-4 h-4" /> Add employee
              </Button>
            )}
          </>
        }
      />

      {notice && (
        <div className="mb-3">
          <Banner tone="info" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}
      {archive.error && <Banner tone="danger">{archive.error}</Banner>}

      <div className="card p-3 mb-3.5 flex flex-wrap items-end gap-2">
        <Field label="Search" className="flex-1 min-w-[200px]">
          <TextInput
            value={filters.q}
            onChange={(event) => {
              setPage(1)
              setFilters({ ...filters, q: event.target.value })
            }}
            placeholder="Name, code or email"
          />
        </Field>
        <Field label="Department">
          <Select
            value={filters.departmentId}
            onChange={(event) => {
              setPage(1)
              setFilters({ ...filters, departmentId: event.target.value })
            }}
          >
            <option value="">All</option>
            {(departments.data?.data ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={filters.status}
            onChange={(event) => {
              setPage(1)
              setFilters({ ...filters, status: event.target.value })
            }}
          >
            <option value="">All</option>
            {EMPLOYEE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {employees.loading && <Loading />}
      {employees.error && <Banner tone="danger">{employees.error}</Banner>}

      {employees.data && (
        <Panel
          title={`Directory — ${total} employee(s)`}
          description="Archived employees keep their history but leave the roster."
          padded={false}
        >
          {employees.data.data.length === 0 ? (
            <EmptyState
              title="No employees found"
              description="Adjust the filters, or add the first employee."
              action={
                canCreate ? <Button onClick={() => setEditing('new')}>Add employee</Button> : undefined
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Department</Th>
                  <Th>Designation</Th>
                  <Th>Joined</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>Login</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {employees.data.data.map((employee) => (
                  <tr key={employee.id}>
                    <Td>
                      <span className="font-medium text-ink">{employee.fullName}</span>
                      <span className="block text-[10.5px] text-ink-secondary">
                        {employee.employeeCode} · {employee.email ?? 'no email'}
                      </span>
                    </Td>
                    <Td className="text-ink-secondary">{employee.departmentName ?? '—'}</Td>
                    <Td className="text-ink-secondary">{employee.designationTitle ?? '—'}</Td>
                    <Td>{formatDate(employee.joinDate)}</Td>
                    <Td className="text-ink-secondary">{label(employee.employmentType)}</Td>
                    <Td>
                      <Badge tone={statusTone(employee.status)}>{label(employee.status)}</Badge>
                    </Td>
                    <Td>
                      {employee.userId ? <Badge tone="info">Linked</Badge> : <span className="text-ink-secondary">—</span>}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {canUpdate && (
                          <Button
                            variant="outline"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setEditing(employee)}
                          >
                            Edit
                          </Button>
                        )}
                        {canArchive && employee.status !== 'terminated' && (
                          <Button
                            variant="ghost"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setArchiving(employee)}
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-line/70">
              <span className="text-[11.5px] text-ink-secondary">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-auto px-2.5 py-1 text-[11.5px]"
                  disabled={page === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  className="w-auto px-2.5 py-1 text-[11.5px]"
                  disabled={page >= pages}
                  onClick={() => setPage((value) => Math.min(pages, value + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {editing && (
        <EmployeeModal
          employee={editing === 'new' ? null : editing}
          departments={departments.data?.data ?? []}
          designations={designations.data?.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            setNotice(message)
            employees.reload()
          }}
        />
      )}

      {archiving && (
        <Modal
          title={`Archive ${archiving.fullName}?`}
          description="Archiving keeps the record for payroll history but removes the person from the active roster."
          onClose={() => setArchiving(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setArchiving(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={archive.busy} onClick={() => void confirmArchive()}>
                Archive employee
              </Button>
            </>
          }
        >
          <p className="text-[12.5px] text-ink-secondary">
            Joined {formatDate(archiving.joinDate)} · {archiving.employeeCode}. This can be undone by
            editing the status afterwards.
          </p>
        </Modal>
      )}
    </>
  )
}

function EmployeeModal({
  employee,
  departments,
  designations,
  onClose,
  onSaved,
}: {
  employee: Employee | null
  departments: Department[]
  designations: Designation[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState<EmployeeForm>(
    employee
      ? {
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          email: employee.email ?? '',
          phone: employee.phone ?? '',
          departmentId: employee.departmentId ?? '',
          designationId: employee.designationId ?? '',
          joinDate: dateKey(employee.joinDate),
          employmentType: employee.employmentType,
          status: employee.status,
          address: employee.address ?? '',
          emergencyContact: employee.emergencyContact ?? '',
        }
      : EMPTY_FORM,
  )
  const { run, busy, error, fieldErrors } = useAction()

  const submit = async () => {
    const payload = {
      employeeCode: form.employeeCode || undefined,
      fullName: form.fullName,
      email: form.email || undefined,
      phone: form.phone || undefined,
      departmentId: form.departmentId || undefined,
      designationId: form.designationId || undefined,
      joinDate: form.joinDate,
      employmentType: form.employmentType,
      status: form.status,
      address: form.address || undefined,
      emergencyContact: form.emergencyContact || undefined,
    }

    const ok = await run(() =>
      employee
        ? api.patch(`/employees/${employee.id}`, payload)
        : api.post('/employees', payload),
    )
    if (ok) onSaved(employee ? `${form.fullName} updated.` : `${form.fullName} added to the directory.`)
  }

  const set = (key: keyof EmployeeForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <Modal
      title={employee ? `Edit ${employee.fullName}` : 'Add an employee'}
      description={
        employee
          ? 'Changing the status here also changes payroll eligibility.'
          : 'Leave the employee code blank and the server assigns the next one.'
      }
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {employee ? 'Save changes' : 'Add employee'}
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
        <Field label="Full name" error={fieldErrors.fullName}>
          <TextInput
            value={form.fullName}
            onChange={(event) => set('fullName')(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Employee code" hint="Optional" error={fieldErrors.employeeCode}>
          <TextInput
            value={form.employeeCode}
            onChange={(event) => set('employeeCode')(event.target.value)}
            placeholder="EMP-0001"
          />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <TextInput
            type="email"
            value={form.email}
            onChange={(event) => set('email')(event.target.value)}
          />
        </Field>
        <Field label="Phone" error={fieldErrors.phone}>
          <TextInput value={form.phone} onChange={(event) => set('phone')(event.target.value)} />
        </Field>
        <Field label="Department" error={fieldErrors.departmentId}>
          <Select
            value={form.departmentId}
            onChange={(event) => set('departmentId')(event.target.value)}
          >
            <option value="">Unassigned</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Designation" error={fieldErrors.designationId}>
          <Select
            value={form.designationId}
            onChange={(event) => set('designationId')(event.target.value)}
          >
            <option value="">Unassigned</option>
            {designations.map((designation) => (
              <option key={designation.id} value={designation.id}>
                {designation.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Join date" error={fieldErrors.joinDate}>
          <TextInput
            type="date"
            value={form.joinDate}
            onChange={(event) => set('joinDate')(event.target.value)}
          />
        </Field>
        <Field label="Employment type" error={fieldErrors.employmentType}>
          <Select
            value={form.employmentType}
            onChange={(event) => set('employmentType')(event.target.value)}
          >
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" error={fieldErrors.status}>
          <Select value={form.status} onChange={(event) => set('status')(event.target.value)}>
            {EMPLOYEE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Emergency contact" error={fieldErrors.emergencyContact}>
          <TextInput
            value={form.emergencyContact}
            onChange={(event) => set('emergencyContact')(event.target.value)}
            placeholder="Name and phone"
          />
        </Field>
        <Field label="Address" className="sm:col-span-2" error={fieldErrors.address}>
          <TextInput
            value={form.address}
            onChange={(event) => set('address')(event.target.value)}
          />
        </Field>
      </div>

      <p className="text-[11.5px] text-ink-secondary mt-3 flex items-center gap-1.5">
        <IconUpload className="w-3.5 h-3.5" />
        Bulk import is available from the API (POST /employees/import) with a CSV body.
      </p>
    </Modal>
  )
}
