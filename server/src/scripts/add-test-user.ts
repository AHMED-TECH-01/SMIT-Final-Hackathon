/**
 * One-off script: upsert test@test.com with password 12345678.
 *
 * The password bypasses assertPasswordStrength intentionally — this account is
 * for local dev/testing only and would never reach a production deployment.
 * Role is set to 'admin' so the account can reach every screen.
 *
 * Usage (from hcm-lite/server/):
 *   npx tsx src/scripts/add-test-user.ts
 */

import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { hashPassword } from '../modules/auth/session.js'
import { UserModel } from '../modules/auth/user.model.js'
import { logger } from '../lib/logger.js'

const TEST_EMAIL = 'test@test.com'
const TEST_PASSWORD = '12345678'

async function main(): Promise<void> {
  await connectDatabase()

  try {
    const passwordHash = await hashPassword(TEST_PASSWORD)

    const result = await UserModel.findOneAndUpdate(
      { email: TEST_EMAIL },
      {
        $set: {
          email: TEST_EMAIL,
          fullName: 'Test User',
          passwordHash,
          role: 'admin',
          status: 'active',
          mustChangePassword: false,
        },
        $setOnInsert: {
          tokenVersion: 0,
          lastLoginAt: null,
        },
      },
      { upsert: true, new: true, runValidators: true },
    )

    if (result) {
      logger.info(
        { id: String(result._id), email: result.email, role: result.role },
        'Test user ready',
      )
      logger.info(`  Email:    ${TEST_EMAIL}`)
      logger.info(`  Password: ${TEST_PASSWORD}`)
      logger.info(`  Role:     admin  (full access to all screens)`)
    }
  } finally {
    await disconnectDatabase()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
