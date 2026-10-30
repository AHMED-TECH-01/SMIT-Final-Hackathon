import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { formatDateTime, label } from '../lib/format'
import { useAction, useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type { CompanySettingsPayload, Role, User } from '../lib/types'
import {
  Badge,
  Banner,
  Button,
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
import { IconCopy, IconPlus } from '../components/icons'

const TIME_ZONES = [
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Riyadh',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
]

const ROLES: Role[] = ['admin', 'hr', 'employee']

/**
 * Settings.
 *
 * The attendance policy here is not cosmetic: check-in reads the work start and
 * grace period from these settings, so moving the start time changes what counts
 * as late on the very next punch. Saving invalidates the server's cached copy.
 */
export default function SettingsScreen() {
  const { data, error, loading, reload } = useAsync(() =>
    api.get<CompanySettingsPayload>('/settings'),
  )
  const [notice, setNotice] = useState<string | null>(null)

  if (loading) return <Loading />
  if (error) return <Banner tone="danger">{error}</Banner>
  if (!data) return null

  const settings = data.data

  return (
    <>
      <PageHeader
        title="Settings"
        description="Company profile, the attendance policy the system enforces, and the accounts that can sign in."
      />

      {notice && (
        <div className="mb-3">
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-3.5">
        <RosterStat label="Employees" value={settings.roster.employees} hint={`${settings.roster.activeEmployees} active`} />
        <RosterStat label="Departments" value={settings.roster.departments} />
        <RosterStat label="Accounts" value={settings.roster.users} />
        <RosterStat
          label="Setup"
          value={settings.system.setupComplete ? 'Complete' : 'Pending'}
          hint={`API ${settings.system.apiVersion}`}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-3.5">
        <CompanyForm
          settings={settings}
          onSaved={(message) => {
            setNotice(message)
            reload()
          }}
        />
        <AttendanceForm
          settings={settings}
          onSaved={(message) => {
            setNotice(message)
            reload()
          }}
        />
      </div>

      <UsersPanel />
    </>
  )
}

function RosterStat({
  label: name,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11.5px] text-ink-secondary font-medium">{name}</div>
      <div className="text-[20px] font-extrabold text-ink leading-tight">{value}</div>
      {hint && <div className="text-[11px] text-ink-secondary/80">{hint}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Company profile                                                     */
/* ------------------------------------------------------------------ */

function CompanyForm({
  settings,
  onSaved,
}: {
  settings: CompanySettingsPayload
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState({
    name: settings.company.name,
    contactEmail: settings.company.contactEmail,
    contactPhone: settings.company.contactPhone,
    address: settings.company.address,
    timezone: settings.company.timezone,
    currency: settings.company.currency,
  })
  const { run, busy, error, fieldErrors } = useAction()

  useEffect(() => {
    setForm({
      name: settings.company.name,
      contactEmail: settings.company.contactEmail,
      contactPhone: settings.company.contactPhone,
      address: settings.company.address,
      timezone: settings.company.timezone,
      currency: settings.company.currency,
    })
  }, [settings])

  const submit = async () => {
    const body: Record<string, string> = {
      name: form.name,
      timezone: form.timezone,
      currency: form.currency,
    }
    // Optional fields are only sent when filled, so clearing one is explicit.
    if (form.contactEmail) body.contactEmail = form.contactEmail
    if (form.contactPhone) body.contactPhone = form.contactPhone
    if (form.address) body.address = form.address

    const ok = await run(() => api.patch('/settings/company', body))
    if (ok) onSaved('Company profile saved.')
  }

  const zones = TIME_ZONES.includes(form.timezone)
    ? TIME_ZONES
    : [form.timezone, ...TIME_ZONES]

  return (
    <Panel
      title="Company profile"
      description="Shown in the header, payslips and the setup screen."
      actions={
        <Button loading={busy} onClick={() => void submit()}>
          Save
        </Button>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <Field label="Company name" error={fieldErrors.name}>
        <TextInput
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Field label="Contact email" error={fieldErrors.contactEmail}>
          <TextInput
            type="email"
            value={form.contactEmail}
            onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
            placeholder="hr@company.com"
          />
        </Field>
        <Field label="Contact phone" error={fieldErrors.contactPhone}>
          <TextInput
            value={form.contactPhone}
            onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
            placeholder="+92 21 1234 5678"
          />
        </Field>
        <Field
          label="Time zone"
          hint="Drives the working day, lateness and every date the API derives."
          error={fieldErrors.timezone}
        >
          <Select
            value={form.timezone}
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency" hint="Three-letter code, e.g. PKR." error={fieldErrors.currency}>
          <TextInput
            value={form.currency}
            maxLength={3}
            onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
          />
        </Field>
      </div>

      <Field label="Address" className="mt-3" error={fieldErrors.address}>
        <TextInput
          value={form.address}
          onChange={(event) => setForm({ ...form, address: event.target.value })}
          placeholder="Floor 3, Main Boulevard, Lahore"
        />
      </Field>

      <p className="text-[11.5px] text-ink-secondary mt-3">
        Last updated {formatDateTime(settings.company.updatedAt)}. Changes are audited.
      </p>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Attendance policy                                                   */
/* ------------------------------------------------------------------ */

function AttendanceForm({
  settings,
  onSaved,
}: {
  settings: CompanySettingsPayload
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState({
    workStart: settings.attendance.workStart,
    graceMinutes: String(settings.attendance.graceMinutes),
  })
  const { run, busy, error, fieldErrors } = useAction()

  useEffect(() => {
    setForm({
      workStart: settings.attendance.workStart,
      graceMinutes: String(settings.attendance.graceMinutes),
    })
  }, [settings])

  const submit = async () => {
    const ok = await run(() =>
      api.patch('/settings/attendance', {
        workStart: form.workStart,
        graceMinutes: Number(form.graceMinutes),
      }),
    )
    if (ok) onSaved('Attendance policy saved. The next check-in uses it.')
  }

  const grace = Number(form.graceMinutes)
  const lateAfter = lateAfterTime(form.workStart, Number.isFinite(grace) ? grace : 0)

  return (
    <Panel
      title="Attendance policy"
      description="What the check-in endpoint compares against, in the company time zone."
      actions={
        <Button loading={busy} onClick={() => void submit()}>
          Save
        </Button>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Work starts" error={fieldErrors.workStart}>
          <TextInput
            type="time"
            value={form.workStart}
            onChange={(event) => setForm({ ...form, workStart: event.target.value })}
          />
        </Field>
        <Field
          label="Grace period (minutes)"
          hint="0–240. A check-in up to this long after the start is not late."
          error={fieldErrors.graceMinutes}
        >
          <TextInput
            type="number"
            min={0}
            max={240}
            value={form.graceMinutes}
            onChange={(event) => setForm({ ...form, graceMinutes: event.target.value })}
          />
        </Field>
      </div>

      <div className="mt-3 rounded-ctrl bg-surface-muted px-3 py-2.5 text-[12px] text-ink/80">
        Check-in counts as <strong>late</strong> after{' '}
        <strong>{lateAfter}</strong>. Currently configured in{' '}
        <strong>{settings.company.timezone}</strong>.
      </div>
    </Panel>
  )
}

/** 'HH:MM' + grace → 'HH:MM', wrapping past midnight. */
function lateAfterTime(workStart: string, graceMinutes: number): string {
  const [hours, minutes] = workStart.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return '—'
  const total = (hours * 60 + minutes + Math.max(0, graceMinutes)) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

function UsersPanel() {
  const { can, session } = useSession()
  const canRead = can('user.read')
  const canCreate = can('user.create')
  const canManage = can('user.manage')

  const users = useAsync(
    () => (canRead ? api.get<User[]>('/users') : Promise.resolve(null)),
    [canRead],
  )
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const toggle = useAction()

  if (!canRead) return null

  const setStatus = async (user: User) => {
    const status = user.status === 'active' ? 'inactive' : 'active'
    const ok = await toggle.run(() => api.patch(`/users/${user.id}/status`, { status }))
    if (ok) {
      setNotice(`${user.fullName} is now ${status}.`)
      users.reload()
    }
  }

  return (
    <Panel
      title="Accounts"
      description="Who can sign in. Employee accounts are created from the employee record."
      className="mt-3.5"
      padded={false}
      actions={
        canCreate ? (
          <Button className="w-auto px-2.5 py-1 text-[11.5px]" onClick={() => setCreating(true)}>
            <IconPlus className="w-3.5 h-3.5" /> Add account
          </Button>
        ) : undefined
      }
    >
      {(notice || toggle.error) && (
        <div className="p-3">
          {toggle.error ? (
            <Banner tone="danger">{toggle.error}</Banner>
          ) : (
            <Banner tone="success" onDismiss={() => setNotice(null)}>
              {notice}
            </Banner>
          )}
        </div>
      )}

      {users.loading && <Loading />}
      {users.error && <Banner tone="danger">{users.error}</Banner>}

      {users.data && (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {users.data.data.map((user) => {
              const isSelf = user.id === session?.user.id
              return (
                <tr key={user.id}>
                  <Td>
                    <span className="font-medium text-ink">{user.fullName}</span>
                    {user.mustChangePassword && (
                      <span className="block text-[10.5px] text-warning">must change password</span>
                    )}
                  </Td>
                  <Td className="text-ink-secondary">{user.email}</Td>
                  <Td>
                    <Badge tone={user.role === 'admin' ? 'primary' : user.role === 'hr' ? 'info' : 'neutral'}>
                      {label(user.role)}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(user.status)}>{label(user.status)}</Badge>
                  </Td>
                  <Td className="text-ink-secondary whitespace-nowrap">
                    {formatDateTime(user.lastLoginAt)}
                  </Td>
                  <Td>
                    {canManage && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          className="w-auto px-2 py-1 text-[11.5px]"
                          onClick={() => setResetting(user)}
                        >
                          Reset password
                        </Button>
                        <Button
                          variant="ghost"
                          className="w-auto px-2 py-1 text-[11.5px]"
                          disabled={isSelf}
                          title={isSelf ? 'You cannot change your own status here.' : undefined}
                          loading={toggle.busy}
                          onClick={() => void setStatus(user)}
                        >
                          {user.status === 'active' ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(message) => {
            setCreating(false)
            setNotice(message)
            users.reload()
          }}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onReset={(password) => {
            setTempPassword({ email: resetting.email, password })
            setResetting(null)
            users.reload()
          }}
        />
      )}

      {tempPassword && (
        <Modal
          title="Temporary password"
          description="Give this to the account holder. It is shown once and must be changed at first sign-in."
          onClose={() => setTempPassword(null)}
          footer={
            <Button variant="outline" onClick={() => setTempPassword(null)}>
              Done
            </Button>
          }
        >
          <p className="text-[12.5px] text-ink-secondary mb-2">{tempPassword.email}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-ctrl border border-line bg-surface-muted px-3 py-2 font-mono text-[13px] text-ink">
              {tempPassword.password}
            </code>
            <Button
              variant="outline"
              className="w-auto"
              onClick={() => void navigator.clipboard?.writeText(tempPassword.password)}
            >
              <IconCopy className="w-4 h-4" /> Copy
            </Button>
          </div>
        </Modal>
      )}
    </Panel>
  )
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (message: string) => void
}) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    role: 'hr' as Role,
    temporaryPassword: '',
  })
  const { run, busy, error, fieldErrors } = useAction()

  const submit = async () => {
    const ok = await run(() => api.post('/users', form))
    if (ok) onCreated(`${form.fullName} can now sign in and must change their password.`)
  }

  return (
    <Modal
      title="Add an account"
      description="The person is forced to replace the temporary password on first sign-in."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            Create account
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <Field label="Full name" error={fieldErrors.fullName}>
        <TextInput
          value={form.fullName}
          onChange={(event) => setForm({ ...form, fullName: event.target.value })}
          placeholder="Sana Iqbal"
        />
      </Field>

      <Field label="Email" className="mt-3" error={fieldErrors.email}>
        <TextInput
          type="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
          placeholder="sana@company.com"
        />
      </Field>

      <Field label="Role" className="mt-3" error={fieldErrors.role}>
        <Select
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {label(role)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Temporary password"
        className="mt-3"
        hint="At least 10 characters with upper, lower and a digit."
        error={fieldErrors.temporaryPassword}
      >
        <TextInput
          value={form.temporaryPassword}
          onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })}
          placeholder="Welcome2026x"
        />
      </Field>
    </Modal>
  )
}

function ResetPasswordModal({
  user,
  onClose,
  onReset,
}: {
  user: User
  onClose: () => void
  onReset: (password: string) => void
}) {
  const { run, busy, error } = useAction()

  const confirm = async () => {
    let issued = ''
    const ok = await run(async () => {
      const response = await api.post<{ temporaryPassword: string }>(
        `/users/${user.id}/reset-password`,
      )
      issued = response.data.temporaryPassword
      return response
    })
    if (ok) onReset(issued)
  }

  return (
    <Modal
      title="Reset password"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void confirm()}>
            Issue a new password
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <p className="text-[13px] text-ink/85">
        Issue a new temporary password for <strong>{user.fullName}</strong> ({user.email})? Their
        current sessions stop working immediately and they must choose a new password at next
        sign-in.
      </p>
    </Modal>
  )
}
