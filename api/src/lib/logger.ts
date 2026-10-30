import pino from 'pino'
import { env, isProd, isTest } from '../config/env.js'

/**
 * Structured JSON logs in production, human-readable lines in development,
 * silent during tests unless explicitly enabled.
 *
 * Redaction list is a safety net: nothing sensitive should reach a log line
 * even if a request body is logged by mistake.
 */
export const logger = pino({
  level: isTest ? (process.env.LOG_LEVEL ?? 'silent') : env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'newPassword',
      'currentPassword',
      'passwordHash',
      'req.headers.cookie',
      'req.headers.authorization',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  transport: isProd || isTest ? undefined : { target: 'pino-pretty', options: { colorize: true } },
})
