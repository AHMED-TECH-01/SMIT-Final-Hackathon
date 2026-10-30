/**
 * Runs before any test file imports application code, because `config/env.ts`
 * validates and freezes environment values at import time.
 */
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
// Keep bcrypt fast in tests; production uses 12.
process.env.BCRYPT_ROUNDS = '4'
process.env.JWT_SECRET = 'test-only-secret-value-at-least-32-characters-long'
process.env.JWT_EXPIRES_IN = '15m'
// Replaced by the in-memory server's URI inside startTestDb().
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused-placeholder'
process.env.CORS_ORIGINS = 'http://localhost:5173'
