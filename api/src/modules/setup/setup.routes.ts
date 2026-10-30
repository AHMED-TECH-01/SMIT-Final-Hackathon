import { Router } from 'express'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { validate } from '../../middleware/validate.js'
import { setSessionCookie } from '../auth/session.js'
import { toPublicUser } from '../auth/user.model.js'
import { getSetupStatus, performSetup, setupSchema } from './setup.service.js'

const router = Router()

/** Lets the client decide whether to show onboarding or the sign-in screen. */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    ok(res, await getSetupStatus())
  }),
)

/**
 * One-time initialisation. Returns 409 once a company exists, so it cannot be
 * used to mint extra administrators later.
 */
router.post(
  '/',
  validate({ body: setupSchema }),
  asyncHandler(async (req, res) => {
    const result = await performSetup(req.body)
    setSessionCookie(res, result.token)
    ok(
      res,
      {
        company: result.company,
        user: toPublicUser(result.user),
        setupRequired: false,
      },
      201,
    )
  }),
)

export default router
