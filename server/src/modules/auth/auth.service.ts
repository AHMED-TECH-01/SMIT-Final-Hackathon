import { HttpError, unauthorized, unprocessable } from '../../lib/http-error.js'
import {
  assertPasswordStrength,
  hashPassword,
  signSessionToken,
  verifyPassword,
} from './session.js'
import { normalizeEmail, UserModel, type UserDoc } from './user.model.js'
import type { Role } from './permissions.js'

export interface LoginResult {
  user: UserDoc
  token: string
}

/**
 * Verifies credentials and issues a session token.
 *
 * The password is checked *before* the account-status check so an attacker
 * cannot use the response to discover whether a given email is registered and
 * merely deactivated.
 */
export async function login(input: { email: string; password: string }): Promise<LoginResult> {
  const user = await UserModel.findOne({ email: normalizeEmail(input.email) }).select(
    '+passwordHash',
  )

  if (!user) throw unauthorized('Invalid email or password.')

  const passwordMatches = await verifyPassword(input.password, user.passwordHash)
  if (!passwordMatches) throw unauthorized('Invalid email or password.')

  if (user.status !== 'active') {
    throw new HttpError(
      403,
      'ACCOUNT_INACTIVE',
      'This account has been deactivated. Contact your administrator.',
    )
  }

  user.lastLoginAt = new Date()
  await user.save()

  const token = signSessionToken({
    sub: String(user._id),
    role: user.role as Role,
    cv: user.tokenVersion,
  })

  return { user, token }
}

/**
 * Changes the caller's own password.
 *
 * Increments `tokenVersion`, which revokes every other session, then returns a
 * fresh token so the current session keeps working.
 */
export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<{ token: string; user: UserDoc }> {
  const user = await UserModel.findById(userId).select('+passwordHash')
  if (!user) throw unauthorized('Your session is no longer valid.')

  const currentMatches = await verifyPassword(input.currentPassword, user.passwordHash)
  if (!currentMatches) throw unprocessable('Your current password is incorrect.')

  const strengthProblem = assertPasswordStrength(input.newPassword)
  if (strengthProblem) throw unprocessable(strengthProblem)

  const reusingCurrent = await verifyPassword(input.newPassword, user.passwordHash)
  if (reusingCurrent) {
    throw unprocessable('Your new password must be different from your current password.')
  }

  user.passwordHash = await hashPassword(input.newPassword)
  user.mustChangePassword = false
  user.tokenVersion += 1
  await user.save()

  const token = signSessionToken({
    sub: String(user._id),
    role: user.role as Role,
    cv: user.tokenVersion,
  })

  return { token, user }
}
