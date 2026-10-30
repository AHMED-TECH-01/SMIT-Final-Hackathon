import { useState } from 'react'
import { api } from '../lib/api'
import { dateKey, formatDate, label } from '../lib/format'
import { useAction, useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type { Department, Designation, Holiday, LeaveType } from '../lib/types'
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
  Table,
  Tabs,
  Td,
  TextInput,
  Th,
} from '../components/ui'
import { IconPlus } from '../components/icons'

type TabId = 'departments' | 'designations' | 'leave-types' | 'holidays'

/**
 * Master data.
 *
 * Everything the other modules point at lives here: departments, the job
 * titles inside them, the leave types employees can apply against, and the
 * holiday calendar that leave and absence both subtract.
 */
export default function OrganizationScreen() {
  const [tab, setTab] = useState<TabId>('departments')

  return (
    <>
      <PageHeader
        title="Organization"
        description="Departments, job titles, leave types and the public holidays used across the system."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'departments', label: 'Departments' },
          { id: 'designations', label: 'Designations' },
          { id: 'leave-types', label: 'Leave types' },
          { id: 'holidays', label: 'Holidays' },
        ]}
      />

      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'designations' && <DesignationsTab />}
      {tab === 'leave-types' && <LeaveTypesTab />}
      {tab === 'holidays' && <HolidaysTab />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Departments                                                         */
/* ------------------------------------------------------------------ */

function DepartmentsTab() {
  const { can } = useSession()
  const canManage = can('organization.manage')

  const list = useAsync(() => api.get<Department[]>('/departments', { limit: 100 }))
  const [editing, setEditing] = useState<Department | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)
  const remove = useAction()
  const [notice, setNotice] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    const ok = await remove.run(() => api.delete(`/departments/${deleting.id}`))
    if (ok) {
      setNotice(`${deleting.name} was deleted.`)
      setDeleting(null)
      list.reload()
    }
  }

  return (
    <>
      <PageHeader
        title=""
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <IconPlus className="w-4 h-4" /> Add department
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <div className="mb-3">
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}
      {remove.error && <Banner tone="danger">{remove.error}</Banner>}
      {list.loading && <Loading />}
      {list.error && <Banner tone="danger">{list.error}</Banner>}

      {list.data && (
        <Panel title={`${list.data.data.length} department(s)`} padded={false}>
          {list.data.data.length === 0 ? (
            <EmptyState
              title="No departments yet"
              description="Add the departments people are organised into."
              action={canManage ? <Button onClick={() => setEditing('new')}>Add department</Button> : undefined}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Code</Th>
                  <Th>Description</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((department) => (
                  <tr key={department.id}>
                    <Td className="font-medium text-ink">{department.name}</Td>
                    <Td className="text-ink-secondary">{department.code ?? '—'}</Td>
                    <Td className="text-ink-secondary max-w-[280px]">{department.description ?? '—'}</Td>
                    <Td>
                      <Badge tone={department.isActive ? 'success' : 'neutral'}>
                        {department.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    <Td>
                      {canManage && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setEditing(department)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setDeleting(department)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {editing && (
        <DepartmentModal
          department={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            setNotice(message)
            list.reload()
          }}
        />
      )}

      {deleting && (
        <Modal
          title="Delete department"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={remove.busy} onClick={() => void confirmDelete()}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink/80">
            Delete <strong>{deleting.name}</strong>? Departments that still have employees cannot be
            deleted — the server refuses instead of orphaning them.
          </p>
        </Modal>
      )}
    </>
  )
}

function DepartmentModal({
  department,
  onClose,
  onSaved,
}: {
  department: Department | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState({
    name: department?.name ?? '',
    code: department?.code ?? '',
    description: department?.description ?? '',
    isActive: department?.isActive ?? true,
  })
  const { run, busy, error, fieldErrors } = useAction()

  const submit = async () => {
    const body = {
      name: form.name,
      code: form.code || undefined,
      description: form.description || undefined,
      isActive: form.isActive,
    }
    const ok = await run(() =>
      department ? api.patch(`/departments/${department.id}`, body) : api.post('/departments', body),
    )
    if (ok) onSaved(department ? 'Department updated.' : 'Department created.')
  }

  return (
    <Modal
      title={department ? 'Edit department' : 'Add department'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {department ? 'Save changes' : 'Create department'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <Field label="Name" error={fieldErrors.name}>
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Engineering"
        />
      </Field>
      <Field label="Code" className="mt-3" hint="Short handle, e.g. ENG." error={fieldErrors.code}>
        <TextInput
          value={form.code}
          onChange={(event) => setForm({ ...form, code: event.target.value })}
          placeholder="ENG"
        />
      </Field>
      <Field label="Description" className="mt-3" error={fieldErrors.description}>
        <TextInput
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          placeholder="Product and platform engineering"
        />
      </Field>
      <div className="mt-3">
        <Checkbox
          checked={form.isActive}
          onChange={(isActive) => setForm({ ...form, isActive })}
          label="Active"
        />
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Designations                                                        */
/* ------------------------------------------------------------------ */

function DesignationsTab() {
  const { can } = useSession()
  const canManage = can('organization.manage')

  const list = useAsync(() => api.get<Designation[]>('/designations', { limit: 100 }))
  const departments = useAsync(() => api.get<Department[]>('/departments', { limit: 100 }))
  const [editing, setEditing] = useState<Designation | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Designation | null>(null)
  const remove = useAction()
  const [notice, setNotice] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    const ok = await remove.run(() => api.delete(`/designations/${deleting.id}`))
    if (ok) {
      setNotice(`${deleting.title} was deleted.`)
      setDeleting(null)
      list.reload()
    }
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <IconPlus className="w-4 h-4" /> Add designation
          </Button>
        )}
      </div>

      {notice && (
        <div className="mb-3">
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}
      {remove.error && <Banner tone="danger">{remove.error}</Banner>}
      {list.loading && <Loading />}
      {list.error && <Banner tone="danger">{list.error}</Banner>}

      {list.data && (
        <Panel title={`${list.data.data.length} designation(s)`} padded={false}>
          {list.data.data.length === 0 ? (
            <EmptyState
              title="No designations yet"
              description="A designation is the job title an employee holds."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Department</Th>
                  <Th>Grade</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((designation) => (
                  <tr key={designation.id}>
                    <Td className="font-medium text-ink">{designation.title}</Td>
                    <Td className="text-ink-secondary">{designation.departmentName ?? '—'}</Td>
                    <Td className="text-ink-secondary">{designation.grade ?? '—'}</Td>
                    <Td>
                      <Badge tone={designation.isActive ? 'success' : 'neutral'}>
                        {designation.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    <Td>
                      {canManage && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setEditing(designation)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setDeleting(designation)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {editing && (
        <DesignationModal
          designation={editing === 'new' ? null : editing}
          departments={departments.data?.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            setNotice(message)
            list.reload()
          }}
        />
      )}

      {deleting && (
        <Modal
          title="Delete designation"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={remove.busy} onClick={() => void confirmDelete()}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink/80">
            Delete <strong>{deleting.title}</strong>? Designations still held by employees cannot be
            deleted.
          </p>
        </Modal>
      )}
    </>
  )
}

function DesignationModal({
  designation,
  departments,
  onClose,
  onSaved,
}: {
  designation: Designation | null
  departments: Department[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState({
    title: designation?.title ?? '',
    departmentId: designation?.departmentId ?? '',
    grade: designation?.grade ?? '',
    isActive: designation?.isActive ?? true,
  })
  const { run, busy, error, fieldErrors } = useAction()

  const submit = async () => {
    const body = {
      title: form.title,
      departmentId: form.departmentId || undefined,
      grade: form.grade || undefined,
      isActive: form.isActive,
    }
    const ok = await run(() =>
      designation
        ? api.patch(`/designations/${designation.id}`, body)
        : api.post('/designations', body),
    )
    if (ok) onSaved(designation ? 'Designation updated.' : 'Designation created.')
  }

  return (
    <Modal
      title={designation ? 'Edit designation' : 'Add designation'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {designation ? 'Save changes' : 'Create designation'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <Field label="Title" error={fieldErrors.title}>
        <TextInput
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="Senior Software Engineer"
        />
      </Field>
      <Field label="Department" className="mt-3" error={fieldErrors.departmentId}>
        <Select
          value={form.departmentId}
          onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
        >
          <option value="">Not assigned</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Grade" className="mt-3" hint="Optional band, e.g. L3." error={fieldErrors.grade}>
        <TextInput
          value={form.grade}
          onChange={(event) => setForm({ ...form, grade: event.target.value })}
          placeholder="L3"
        />
      </Field>
      <div className="mt-3">
        <Checkbox
          checked={form.isActive}
          onChange={(isActive) => setForm({ ...form, isActive })}
          label="Active"
        />
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Leave types                                                         */
/* ------------------------------------------------------------------ */

function LeaveTypesTab() {
  const { can } = useSession()
  const canManage = can('organization.manage')

  const list = useAsync(() => api.get<LeaveType[]>('/leave-types', { limit: 100 }))
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null)
  const [deleting, setDeleting] = useState<LeaveType | null>(null)
  const remove = useAction()
  const [notice, setNotice] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    const ok = await remove.run(() => api.delete(`/leave-types/${deleting.id}`))
    if (ok) {
      setNotice(`${deleting.name} was deleted.`)
      setDeleting(null)
      list.reload()
    }
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <IconPlus className="w-4 h-4" /> Add leave type
          </Button>
        )}
      </div>

      {notice && (
        <div className="mb-3">
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}
      {remove.error && <Banner tone="danger">{remove.error}</Banner>}
      {list.loading && <Loading />}
      {list.error && <Banner tone="danger">{list.error}</Banner>}

      {list.data && (
        <Panel
          title={`${list.data.data.length} leave type(s)`}
          description="Quotas are per employee per year; balances are derived from the request ledger."
          padded={false}
        >
          {list.data.data.length === 0 ? (
            <EmptyState
              title="No leave types yet"
              description="Employees cannot apply for leave until at least one type exists."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Code</Th>
                  <Th>Days / year</Th>
                  <Th>Paid</Th>
                  <Th>Carry forward</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((type) => (
                  <tr key={type.id}>
                    <Td className="font-medium text-ink">{type.name}</Td>
                    <Td className="text-ink-secondary">{type.code}</Td>
                    <Td>{type.annualQuota}</Td>
                    <Td>{type.paid ? 'Yes' : 'No'}</Td>
                    <Td>{type.carryForward ? 'Yes' : 'No'}</Td>
                    <Td>
                      <Badge tone={type.isActive ? 'success' : 'neutral'}>
                        {type.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </Td>
                    <Td>
                      {canManage && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setEditing(type)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setDeleting(type)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {editing && (
        <LeaveTypeModal
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            setNotice(message)
            list.reload()
          }}
        />
      )}

      {deleting && (
        <Modal
          title="Delete leave type"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={remove.busy} onClick={() => void confirmDelete()}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink/80">
            Delete <strong>{deleting.name}</strong>? Existing requests keep their record, but no new
            request can use this type.
          </p>
        </Modal>
      )}
    </>
  )
}

function LeaveTypeModal({
  type,
  onClose,
  onSaved,
}: {
  type: LeaveType | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState({
    name: type?.name ?? '',
    code: type?.code ?? '',
    annualQuota: String(type?.annualQuota ?? 20),
    paid: type?.paid ?? true,
    carryForward: type?.carryForward ?? false,
    isActive: type?.isActive ?? true,
  })
  const { run, busy, error, fieldErrors } = useAction()

  const submit = async () => {
    const body = {
      name: form.name,
      code: form.code,
      annualQuota: Number(form.annualQuota),
      paid: form.paid,
      carryForward: form.carryForward,
      isActive: form.isActive,
    }
    const ok = await run(() =>
      type ? api.patch(`/leave-types/${type.id}`, body) : api.post('/leave-types', body),
    )
    if (ok) onSaved(type ? 'Leave type updated.' : 'Leave type created.')
  }

  return (
    <Modal
      title={type ? 'Edit leave type' : 'Add leave type'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {type ? 'Save changes' : 'Create leave type'}
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
        <Field label="Name" error={fieldErrors.name}>
          <TextInput
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Annual leave"
          />
        </Field>
        <Field label="Code" hint="Two to twelve characters." error={fieldErrors.code}>
          <TextInput
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
            placeholder="AL"
          />
        </Field>
      </div>
      <Field
        label="Days per year"
        className="mt-3"
        hint="The quota each employee is entitled to."
        error={fieldErrors.annualQuota}
      >
        <TextInput
          type="number"
          min={0}
          max={366}
          value={form.annualQuota}
          onChange={(event) => setForm({ ...form, annualQuota: event.target.value })}
        />
      </Field>
      <div className="mt-3 flex flex-wrap gap-4">
        <Checkbox checked={form.paid} onChange={(paid) => setForm({ ...form, paid })} label="Paid" />
        <Checkbox
          checked={form.carryForward}
          onChange={(carryForward) => setForm({ ...form, carryForward })}
          label="Carry forward"
        />
        <Checkbox
          checked={form.isActive}
          onChange={(isActive) => setForm({ ...form, isActive })}
          label="Active"
        />
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Holidays                                                            */
/* ------------------------------------------------------------------ */

function HolidaysTab() {
  const { can } = useSession()
  const canManage = can('organization.manage')

  const list = useAsync(() => api.get<Holiday[]>('/holidays', { limit: 100 }))
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Holiday | null>(null)
  const remove = useAction()
  const [notice, setNotice] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    const ok = await remove.run(() => api.delete(`/holidays/${deleting.id}`))
    if (ok) {
      setNotice(`${deleting.name} was removed.`)
      setDeleting(null)
      list.reload()
    }
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        {canManage && (
          <Button onClick={() => setEditing('new')}>
            <IconPlus className="w-4 h-4" /> Add holiday
          </Button>
        )}
      </div>

      {notice && (
        <div className="mb-3">
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}
      {remove.error && <Banner tone="danger">{remove.error}</Banner>}
      {list.loading && <Loading />}
      {list.error && <Banner tone="danger">{list.error}</Banner>}

      {list.data && (
        <Panel
          title={`${list.data.data.length} holiday(s)`}
          description="Holidays are excluded from leave day counts and from payroll working days."
          padded={false}
        >
          {list.data.data.length === 0 ? (
            <EmptyState
              title="No holidays yet"
              description="Add the public and optional holidays for the year."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((holiday) => (
                  <tr key={holiday.id}>
                    <Td className="font-medium text-ink">{formatDate(dateKey(holiday.date))}</Td>
                    <Td>{holiday.name}</Td>
                    <Td>
                      <Badge tone={holiday.optional ? 'info' : 'success'}>
                        {holiday.optional ? 'Optional' : 'Public'}
                      </Badge>
                    </Td>
                    <Td>
                      {canManage && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="outline"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setEditing(holiday)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            className="w-auto px-2 py-1 text-[11.5px]"
                            onClick={() => setDeleting(holiday)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {editing && (
        <HolidayModal
          holiday={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null)
            setNotice(message)
            list.reload()
          }}
        />
      )}

      {deleting && (
        <Modal
          title="Remove holiday"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={remove.busy} onClick={() => void confirmDelete()}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink/80">
            Remove <strong>{deleting.name}</strong> ({formatDate(dateKey(deleting.date))})? That day
            becomes a working day again.
          </p>
        </Modal>
      )}
    </>
  )
}

function HolidayModal({
  holiday,
  onClose,
  onSaved,
}: {
  holiday: Holiday | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState({
    name: holiday?.name ?? '',
    date: holiday ? dateKey(holiday.date) : '',
    optional: holiday?.optional ?? false,
  })
  const { run, busy, error, fieldErrors } = useAction()

  const submit = async () => {
    const body = { name: form.name, date: form.date, optional: form.optional }
    const ok = await run(() =>
      holiday ? api.patch(`/holidays/${holiday.id}`, body) : api.post('/holidays', body),
    )
    if (ok) onSaved(holiday ? 'Holiday updated.' : 'Holiday added.')
  }

  return (
    <Modal
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {holiday ? 'Save changes' : 'Add holiday'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <Field label="Name" error={fieldErrors.name}>
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Eid ul-Fitr"
        />
      </Field>
      <Field label="Date" className="mt-3" error={fieldErrors.date}>
        <TextInput
          type="date"
          value={form.date}
          onChange={(event) => setForm({ ...form, date: event.target.value })}
        />
      </Field>
      <div className="mt-3">
        <Checkbox
          checked={form.optional}
          onChange={(optional) => setForm({ ...form, optional })}
          label="Optional holiday"
        />
      </div>
      <p className="text-[11.5px] text-ink-secondary mt-3">
        {label('optional')} holidays still count as days off, but the calendar marks them
        differently.
      </p>
    </Modal>
  )
}
