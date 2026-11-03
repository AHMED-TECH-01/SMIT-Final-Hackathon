import { useState } from 'react'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { useRouter } from '../lib/router'
import { Banner, Button, Field, LeafBrand, TextInput } from '../components/ui'

/**
 * "Forgot password" step 2 — set a new password with the one-time token.
 *
 * No session is involved. A successful reset revokes every existing session
 * for the account (the server bumps tokenVersion), so the caller signs in
 * again with the new password.
 */
export default function ResetPasswordScreen({ defaultToken }: { defaultToken?: string }) {
  const { navigate } = useRouter()
  const { run, busy, error, fieldErrors, setError } = useAction()

  const [token, setToken] = useState(defaultToken ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [done, setDone] = useState(false)

  const submit = () => {
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.')
      return
    }
    return run(async () => {
      await api.post('/auth/reset-password', { token: token.trim(), newPassword })
      setDone(true)
    })
  }

  return (
    <div className="min-h-screen bg-app grid md:grid-cols-2">
      <aside className="hidden md:flex flex-col justify-between bg-gradient-to-br from-primary to-[#045c35] text-white p-10">
        <LeafBrand />
        <div className="max-w-sm space-y-3">
          <h1 className="text-[26px] font-extrabold leading-tight">Choose a new password.</h1>
          <p className="text-[13.5px] text-white/80 leading-relaxed">
            At least 10 characters with upper- and lower-case letters and a number. Setting it
            signs out every existing session for that account.
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
            <h2 className="text-[22px] font-extrabold text-ink tracking-tight">Set new password</h2>
            <p className="text-[13px] text-ink-secondary mt-1 mb-5">
              Paste the reset token you received, then choose your new password.
            </p>

            {error && !done && (
              <div className="mb-4">
                <Banner tone="danger">{error}</Banner>
              </div>
            )}

            {done ? (
              <div className="space-y-4">
                <Banner tone="success">
                  Your password has been updated. Sign in with the new one.
                </Banner>
                <Button className="w-full" onClick={() => navigate('/login')}>
                  Back to sign in
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
                <Field
                  label="Reset token"
                  htmlFor="token"
                  error={fieldErrors.token}
                  hint={!fieldErrors.token ? 'Expires 30 minutes after it was issued; works once.' : undefined}
                >
                  <TextInput
                    id="token"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="Paste the reset token"
                    autoFocus
                    required
                  />
                </Field>

                <Field label="New password" htmlFor="newPassword" error={fieldErrors.newPassword}>
                  <TextInput
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                  />
                </Field>

                <Field label="Confirm new password" htmlFor="confirmPassword">
                  <TextInput
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />
                </Field>

                <Button type="submit" loading={busy} className="w-full">
                  Update password
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
