import { useState } from 'react'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { useSession } from '../lib/session'
import type { User } from '../lib/types'
import { Banner, Button, Field, LeafBrand, Select, TextInput } from '../components/ui'

/**
 * First run only.
 *
 * The endpoint is safe to expose: once a company exists it refuses with 409, so
 * this screen cannot be used to mint a second administrator.
 */
export default function SetupScreen() {
  const { markSetupComplete } = useSession()
  const { run, busy, error, fieldErrors } = useAction()

  const [form, setForm] = useState({
    companyName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    timezone: 'Asia/Karachi',
    fullName: '',
    email: '',
    password: '',
    confirm: '',
  })
  const [localError, setLocalError] = useState<string | null>(null)

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    setLocalError(null)
    if (form.password !== form.confirm) {
      setLocalError('The two passwords do not match.')
      return
    }

    await run(async () => {
      const result = await api.post<{ company: { name: string }; user: User }>('/setup', {
        companyName: form.companyName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        address: form.address,
        timezone: form.timezone,
        admin: { fullName: form.fullName, email: form.email, password: form.password },
      })
      markSetupComplete(result.data.user)
    })
  }

  return (
    <div className="min-h-screen bg-app grid place-items-center px-4 py-8">
      <div className="w-full max-w-3xl card overflow-hidden">
        <div className="grid md:grid-cols-[300px_1fr]">
          <aside className="hidden md:flex flex-col justify-between bg-gradient-to-b from-primary to-[#046b3d] text-white p-6">
            <LeafBrand />
            <div className="space-y-3">
              <h2 className="text-[22px] font-extrabold leading-tight">
                Set up your company in one step.
              </h2>
              <p className="text-[12.5px] text-white/80 leading-relaxed">
                This creates the company profile and the first administrator. Everything else —
                departments, employees, payroll — is added from inside the app.
              </p>
            </div>
            <p className="text-[11px] text-white/60">
              The setup endpoint is one-time: it refuses to run again once a company exists.
            </p>
          </aside>

          <div className="p-6">
            <h1 className="text-[22px] font-extrabold text-ink">Welcome to HCM Lite</h1>
            <p className="text-[13px] text-ink-secondary mt-1 mb-5">
              Enter your company details and create the administrator account.
            </p>

            {(error || localError) && (
              <div className="mb-4">
                <Banner tone="danger">{localError ?? error}</Banner>
              </div>
            )}

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Company name" error={fieldErrors.companyName}>
                  <TextInput
                    value={form.companyName}
                    onChange={(event) => set('companyName')(event.target.value)}
                    placeholder="Saylani Tech"
                    autoFocus
                    required
                  />
                </Field>
                <Field label="Company email" error={fieldErrors.contactEmail}>
                  <TextInput
                    type="email"
                    value={form.contactEmail}
                    onChange={(event) => set('contactEmail')(event.target.value)}
                    placeholder="hr@company.com"
                    required
                  />
                </Field>
                <Field label="Contact phone" error={fieldErrors.contactPhone}>
                  <TextInput
                    value={form.contactPhone}
                    onChange={(event) => set('contactPhone')(event.target.value)}
                    placeholder="+92 21 111 222 333"
                  />
                </Field>
                <Field label="Time zone" error={fieldErrors.timezone}>
                  <Select
                    value={form.timezone}
                    onChange={(event) => set('timezone')(event.target.value)}
                  >
                    <option value="Asia/Karachi">Asia/Karachi (PKT)</option>
                    <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                    <option value="Europe/London">Europe/London (GMT/BST)</option>
                    <option value="America/New_York">America/New_York (ET)</option>
                  </Select>
                </Field>
              </div>

              <Field label="Address" error={fieldErrors.address}>
                <TextInput
                  value={form.address}
                  onChange={(event) => set('address')(event.target.value)}
                  placeholder="Karachi, Pakistan"
                />
              </Field>

              <hr className="border-line" />

              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Administrator name" error={fieldErrors['admin.fullName']}>
                  <TextInput
                    value={form.fullName}
                    onChange={(event) => set('fullName')(event.target.value)}
                    placeholder="Ahmed Raza"
                    required
                  />
                </Field>
                <Field label="Administrator email" error={fieldErrors['admin.email']}>
                  <TextInput
                    type="email"
                    value={form.email}
                    onChange={(event) => set('email')(event.target.value)}
                    placeholder="admin@company.com"
                    required
                  />
                </Field>
                <Field
                  label="Password"
                  hint="At least 10 characters, with upper case, lower case and a number."
                  error={fieldErrors['admin.password']}
                >
                  <TextInput
                    type="password"
                    value={form.password}
                    onChange={(event) => set('password')(event.target.value)}
                    required
                  />
                </Field>
                <Field label="Confirm password">
                  <TextInput
                    type="password"
                    value={form.confirm}
                    onChange={(event) => set('confirm')(event.target.value)}
                    required
                  />
                </Field>
              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={busy}>
                  Create company and administrator
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
