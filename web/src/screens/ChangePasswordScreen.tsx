import { useState } from 'react'
import { api } from '../lib/api'
import { useAction } from '../lib/hooks'
import { useSession } from '../lib/session'
import { Banner, Button, Field, LeafBrand, TextInput } from '../components/ui'

/**
 * Shown instead of the app while `mustChangePassword` is true.
 *
 * The server refuses every other endpoint in that state (`requirePasswordChanged`),
 * so this is the only screen that can work — and it is also where a session
 * created with a temporary password is upgraded.
 */
export default function ChangePasswordScreen() {
  const { session, refresh, signOut } = useSession()
  const { run, busy, error, fieldErrors } = useAction()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = async () => {
    setLocalError(null)
    if (newPassword !== confirm) {
      setLocalError('The two passwords do not match.')
      return
    }

    const ok = await run(async () => {
      await api.post('/auth/change-password', { currentPassword, newPassword })
    })
    if (ok) await refresh()
  }

  return (
    <div className="min-h-screen bg-app grid place-items-center px-4 py-8">
      <div className="w-full max-w-md card overflow-hidden">
        <div className="bg-gradient-to-r from-primary to-[#046b3d] text-white px-6 py-4">
          <LeafBrand />
        </div>

        <div className="p-6">
          <h1 className="text-[20px] font-extrabold text-ink">Choose a new password</h1>
          <p className="text-[13px] text-ink-secondary mt-1 mb-4">
            Signed in as {session?.user.email}. This account was issued a temporary password, so it
            must be replaced before you can continue.
          </p>

          {(error || localError) && (
            <div className="mb-4">
              <Banner tone="danger">{localError ?? error}</Banner>
            </div>
          )}

          <form
            className="space-y-3.5"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Field label="Current password" error={fieldErrors.currentPassword}>
              <TextInput
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoFocus
                required
              />
            </Field>

            <Field
              label="New password"
              hint="At least 10 characters, with upper case, lower case and a number."
              error={fieldErrors.newPassword}
            >
              <TextInput
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </Field>

            <Field label="Confirm new password">
              <TextInput
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
              />
            </Field>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button variant="ghost" onClick={() => void signOut()}>
                Sign out
              </Button>
              <Button type="submit" loading={busy}>
                Update password
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
