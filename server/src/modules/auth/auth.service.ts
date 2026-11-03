import { HttpError, unauthorized, unprocessable } from '../../lib/http-error.js'
import { notify } from '../../lib/notify.js'
import { exposesResetToken } from '../../config/env.js'
import {
  REMEMBER_ME,
  assertPasswordStrength,
  createResetToken,
  hashPassword,
  hashResetToken,
  signSessionToken,
  verifyPassword,
} from './session.js'
import { normalizeEmail, UserModel, type UserDoc } from './user.model.js'
import type { Role } from './permissions.js'

export interface LoginResult {
  user: UserDoc
  token: string
  /** True when the caller asked for the extended “remember me” lifetime. */
  remember: boolean
}

/**
 * Verifies credentials and issues a session token.
 *
 * The password is checked *before* the account-status check so an attacker
 * cannot use the response to discover whether a given email is registered and
 * merely deactivated.
 *
 * `remember` extends both the JWT and the cookie to seven days; without it
 * the default 15-minute session applies. Nothing is stored in localStorage —
 * “remember me” is purely a longer HttpOnly cookie.
 */
export async function login(input: {
  email: string
  password: string
  remember?: boolean
}): Promise<LoginResult> {
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

  const remember = input.remember === true
  const token = signSessionToken(
    {
      sub: String(user._id),
      role: user.role as Role,
      cv: user.tokenVersion,
    },
    remember ? REMEMBER_ME.expiresIn : undefined,
  )

  return { user, token, remember }
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

export interface ForgotPasswordResult {
  /**
   * Only populated on a local run (`exposesResetToken`): HCM Lite has no email
   * provider wired up, so a deployed instance cannot deliver the reset token — the response
   * stays a generic request-processed notice and staff get an in-app alert. A
   * preview deployment counts as deployed: its `NODE_ENV` is not production, yet
   * its URL is reachable by anyone, so the token is never returned there.
   */
  devResetToken?: string
}

/**
 * Starts a self-service password reset.
 *
 * Always resolves — an unknown or inactive email produces the same response
 * as a known one, so the endpoint cannot be used to enumerate accounts. The
 * plaintext token is never stored; only its hash lives on the user row.
 */
export async function forgotPassword(email: string): Promise<ForgotPasswordResult> {
  const user = await UserModel.findOne({ email: normalizeEmail(email) })

  if (user && user.status === 'active') {
    const { token, tokenHash, expiresAt } = createResetToken()
    user.resetTokenHash = tokenHash
    user.resetTokenExpiresAt = expiresAt
    await user.save()

    // Notify the people who can act on it (no mail provider exists yet).
    const staff = await UserModel.find({ role: { $in: ['admin', 'hr'] }, status: 'active' }).select(
      '_id',
    )
    await notify({
      userIds: staff.map((staffUser) => staffUser._id),
      type: 'system',
      title: 'Password reset requested',
      body: `${user.email} requested a password reset. If they cannot complete it, reset the password from Settings → Accounts.`,
      link: '/settings',
    })

    return exposesResetToken ? { devResetToken: token } : {}
  }

  return {}
}

/**
 * Completes a password reset with a one-time token — no session required.
 *
 * A successful reset replaces the password, clears the token, and bumps
 * `tokenVersion`, which revokes every existing session for that account.
 * Every failure returns the same generic 422 so an attacker cannot tell an
 * expired token from a wrong one, and cannot confirm an email exists.
 */
export async function resetPassword(input: {
  token: string
  newPassword: string
}): Promise<void> {
  const user = await UserModel.findOne({
    resetTokenHash: hashResetToken(input.token),
  }).select('+passwordHash +resetTokenHash +resetTokenExpiresAt')

  const genericFailure = unprocessable(
    'This password reset link is invalid or has expired. Please request a new one.',
  )
  if (!user || user.status !== 'active') throw genericFailure
  if (!user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() <= Date.now()) {
    throw genericFailure
  }

  const strengthProblem = assertPasswordStrength(input.newPassword)
  if (strengthProblem) throw unprocessable(strengthProblem)

  const reusingCurrent = await verifyPassword(input.newPassword, user.passwordHash)
  if (reusingCurrent) {
    throw unprocessable('Your new password must be different from your current password.')
  }

  user.passwordHash = await hashPassword(input.newPassword)
  user.resetTokenHash = null
  user.resetTokenExpiresAt = null
  user.mustChangePassword = false
  user.tokenVersion += 1
  await user.save()
}
