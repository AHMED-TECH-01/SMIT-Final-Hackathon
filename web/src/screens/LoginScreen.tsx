import { useState } from 'react'
import { useAction } from '../lib/hooks'
import { useRouter } from '../lib/router'
import { useSession } from '../lib/session'
import { IconEye, IconEyeOff } from '../components/icons'
import { Banner, Button, Checkbox, Field, LeafBrand, TextInput } from '../components/ui'

/**
 * Sign-in — the /login screen.
 *
 * The session lives in an HttpOnly cookie, so there is nothing to store here:
 * a successful call is enough, and the provider already holds the fetched
 * `/auth/me` result. “Remember me” is real behaviour, not decoration: it asks
 * the server for a 7-day cookie instead of the 15-minute default, and nothing
 * is ever written to localStorage.
 */
export default function LoginScreen() {
  const { signIn, setupRequired } = useSession()
  const { navigate } = useRouter()
  const { run, busy, error, fieldErrors } = useAction()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)

  const submit = () =>
    run(async () => {
      await signIn(email.trim(), password, remember)
      // The session is set; land on the dashboard URL so the address bar and
      // what is rendered always agree.
      navigate('/', { replace: true })
    })

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

      <div className="grid place-items-center px-5 py-10 bg-gradient-to-b from-primary-light/60 via-app to-app">
        <div className="w-full max-w-md">
          <div className="md:hidden mb-6">
            <span className="text-[22px] font-extrabold tracking-tight">
              <span className="text-ink">HCM </span>
              <span className="text-primary">Lite</span>
            </span>
          </div>

          <div className="card p-7 shadow-[0_18px_44px_-24px_rgba(7,139,81,0.35)]">
            <div className="mb-6">
              <h2 className="text-[24px] font-extrabold text-ink tracking-tight">Welcome Back</h2>
              <p className="text-[13px] text-ink-secondary mt-1">
                Sign in to your HCM Lite account.
              </p>
            </div>

            {error && (
              <div className="mb-4">
                <Banner tone="danger">{error}</Banner>
              </div>
            )}

            <form
              className="space-y-4"
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
                {/* The toggle lives inside the field; the input keeps room
                    for it via right padding. */}
                <div className="relative">
                  <TextInput
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-ink-secondary hover:text-primary hover:bg-primary-light transition-colors"
                  >
                    {showPassword ? (
                      <IconEyeOff className="w-4 h-4" />
                    ) : (
                      <IconEye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </Field>

              <div className="flex items-center justify-between gap-3">
                <Checkbox
                  checked={remember}
                  onChange={setRemember}
                  label="Remember me for 7 days"
                />
                <a
                  href="/forgot-password"
                  onClick={(event) => {
                    event.preventDefault()
                    navigate('/forgot-password')
                  }}
                  className="text-[12.5px] font-medium text-primary hover:text-primary-dark"
                >
                  Forgot password?
                </a>
              </div>

              <Button type="submit" loading={busy} className="w-full">
                Sign In
              </Button>
            </form>

            {/* Registration on this product is the one-time company setup; the
                link only appears while the server still reports setup pending.
                Sign-up and the wizard are two doors to the same creation path. */}
            {setupRequired && (
              <p className="text-[12.5px] text-ink-secondary mt-5 text-center">
                New company?{' '}
                <a
                  href="/signup"
                  onClick={(event) => {
                    event.preventDefault()
                    navigate('/signup')
                  }}
                  className="font-medium text-primary hover:text-primary-dark"
                >
                  Create a company account
                </a>{' '}
                or{' '}
                <a
                  href="/setup"
                  onClick={(event) => {
                    event.preventDefault()
                    navigate('/setup')
                  }}
                  className="font-medium text-primary hover:text-primary-dark"
                >
                  run company setup
                </a>
              </p>
            )}
          </div>

          <p className="text-[11.5px] text-ink-secondary mt-5 leading-relaxed text-center">
            Forgotten your password and the reset link does not arrive? Ask an administrator to
            reset it — the reset issues a temporary password you replace on your next sign-in.
          </p>
        </div>
      </div>
    </div>
  )
}
