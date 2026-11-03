import { useState } from 'react'
import { useAction } from '../lib/hooks'
import { useRouter } from '../lib/router'
import { api } from '../lib/api'
import { Banner, Button, Field, LeafBrand, TextInput } from '../components/ui'

/**
 * "Forgot password" step 1 — request a reset.
 *
 * HCM Lite has no email provider, so in development the API returns the reset
 * token directly and the UI offers the next step. In production the response
 * is deliberately generic (no enumeration) and administrators are notified
 * in-app that a reset was requested.
 */
export default function ForgotPasswordScreen() {
  const { navigate } = useRouter()
  const { run, busy, error, fieldErrors } = useAction()

  const [email, setEmail] = useState('')
  const [devToken, setDevToken] = useState<string | null>(null)

  const submit = () =>
    run(async () => {
      const res = await api.post<{ message: string; devResetToken?: string }>(
        '/auth/forgot-password',
        { email: email.trim() },
      )
      setDevToken(res.data.devResetToken ?? null)
    })

  return (
    <div className="min-h-screen bg-app grid md:grid-cols-2">
      <aside className="hidden md:flex flex-col justify-between bg-gradient-to-br from-primary to-[#045c35] text-white p-10">
        <LeafBrand />
        <div className="max-w-sm space-y-3">
          <h1 className="text-[26px] font-extrabold leading-tight">Locked out? It happens.</h1>
          <p className="text-[13.5px] text-white/80 leading-relaxed">
            Request a password reset and your administrators are notified in-app. In this
            development build the reset token is shown here so you can complete the flow.
          </p>
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

          <div className="card p-7">
            <h2 className="text-[22px] font-extrabold text-ink tracking-tight">Reset password</h2>
            <p className="text-[13px] text-ink-secondary mt-1 mb-5">
              Enter the email you sign in with. We’ll start a reset if an active account matches it.
            </p>

            {error && (
              <div className="mb-4">
                <Banner tone="danger">{error}</Banner>
              </div>
            )}

            {devToken ? (
              <div className="space-y-4">
                <Banner tone="info">
                  Development build: the reset token is shown instead of emailed. It expires in 30
                  minutes and works once.
                </Banner>
                <Field label="Reset token" htmlFor="token">
                  <TextInput readOnly value={devToken} id="token" onFocus={(e) => e.target.select()} />
                </Field>
                <Button
                  className="w-full"
                  onClick={() => navigate(`/reset-password?token=${encodeURIComponent(devToken)}`)}
                >
                  Continue to set a new password
                </Button>
              </div>
            ) : (
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
                <Button type="submit" loading={busy} className="w-full">
                  Request reset
                </Button>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="w-full text-[12.5px] font-medium text-primary hover:text-primary-dark"
                >
                  Back to sign in
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
