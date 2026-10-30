import { useState } from 'react'
import { useAction } from '../lib/hooks'
import { useSession } from '../lib/session'
import { Banner, Button, Field, LeafBrand, TextInput } from '../components/ui'

/**
 * Sign-in.
 *
 * The session lives in an HttpOnly cookie, so there is nothing to store here:
 * a successful call is enough, and the provider refetches `/auth/me`.
 */
export default function LoginScreen() {
  const { signIn } = useSession()
  const { run, busy, error, fieldErrors } = useAction()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = () =>
    run(() => signIn(email.trim(), password))

  return (
    <div className="min-h-screen bg-app grid md:grid-cols-2">
      <aside className="hidden md:flex flex-col justify-between bg-gradient-to-br from-primary to-[#045c35] text-white p-10">
        <LeafBrand />

        <div className="max-w-sm space-y-4">
          <h1 className="text-[32px] font-extrabold leading-tight">
            One place for attendance, leave, payroll and people.
          </h1>
          <p className="text-[13.5px] text-white/80 leading-relaxed">
            HCM Lite keeps the whole employee lifecycle in one system, with role-based access and an
            audit trail behind every change.
          </p>

          <ul className="space-y-2 pt-2 text-[12.5px] text-white/85">
            {[
              'Check in, request leave and download payslips',
              'Approve queues for HR with a full audit trail',
              'Dashboards and an assistant that answer from live data',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-white/60">
          Saylani AI Hackathon build — seeded demo data, no real personal records.
        </p>
      </aside>

      <div className="grid place-items-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="md:hidden mb-6">
            <span className="text-[22px] font-extrabold tracking-tight">
              <span className="text-ink">HCM </span>
              <span className="text-primary">Lite</span>
            </span>
          </div>

          <h2 className="text-[22px] font-extrabold text-ink">Sign in</h2>
          <p className="text-[13px] text-ink-secondary mt-1 mb-5">
            Use the credentials issued by your administrator.
          </p>

          {error && (
            <div className="mb-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          <form
            className="space-y-3.5"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Field label="Work email" htmlFor="email" error={fieldErrors.email}>
              <TextInput
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoFocus
                required
              />
            </Field>

            <Field label="Password" htmlFor="password" error={fieldErrors.password}>
              <TextInput
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </Field>

            <Button type="submit" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="text-[11.5px] text-ink-secondary mt-5 leading-relaxed">
            Forgotten your password? Ask an administrator to reset it — the reset issues a
            temporary password you replace on your next sign-in.
          </p>
        </div>
      </div>
    </div>
  )
}
