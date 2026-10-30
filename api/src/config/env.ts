import { resolve } from 'node:path'
import { z } from 'zod'

/**
 * Load a `.env` file when one exists.
 *
 * Node's own loader is used (>= 20.12), so the project needs no dotenv
 * dependency, and variables already present in the environment always win —
 * which is what makes container and CI configuration behave as expected.
 */
function loadDotEnv(): void {
  if (typeof process.loadEnvFile !== 'function') return

  // Run from `api/` (npm workspace) or from the repository root.
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
    try {
      process.loadEnvFile(candidate)
      return
    } catch {
      // A missing file is normal; try the next location.
    }
  }
}

/**
 * Fail fast on misconfiguration. Missing or malformed required variables
 * abort startup with a clear message instead of surfacing later as a
 * confusing runtime error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters of random data'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  /**
   * The assistant works offline by default: answers are composed from live
   * database facts. Pointing it at a chat model only changes the wording.
   */
  AI_PROVIDER: z.enum(['rules', 'openai']).default('rules'),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_MODEL: z.string().default('gpt-4o-mini'),
  /**
   * Optional explicit location of the built frontend (`web/dist`). When it is
   * set — or when the build is found by searching the usual places — the API
   * also serves the UI, so browser and API share one origin in production and
   * the session cookie stays first-party.
   */
  WEB_ROOT: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  loadDotEnv()
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    // Never echo values — only names and reasons.
    throw new Error(
      `Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the required values.`,
    )
  }

  return parsed.data
}

// Tests set their own environment before importing the app.
export const env: Env = loadEnv()

export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'

export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean)
