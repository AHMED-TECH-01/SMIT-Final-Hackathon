import express from 'express'
import type { Express } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { corsOrigins, isProd } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { serveWebApp } from './middleware/static-web.js'
import healthRoutes from './modules/health/health.routes.js'
import setupRoutes from './modules/setup/setup.routes.js'
import authRoutes from './modules/auth/auth.routes.js'
import usersRoutes from './modules/users/users.routes.js'
import employeesRoutes from './modules/employees/employees.routes.js'
import attendanceRoutes from './modules/attendance/attendance.routes.js'
import leaveRoutes from './modules/leave/leave.routes.js'
import payrollRoutes from './modules/payroll/payroll.routes.js'
import analyticsRoutes from './modules/analytics/analytics.routes.js'
import announcementsRoutes from './modules/announcements/announcements.routes.js'
import notificationsRoutes from './modules/notifications/notifications.routes.js'
import auditRoutes from './modules/audit/audit.routes.js'
import assistantRoutes from './modules/ai/assistant.routes.js'
import settingsRoutes from './modules/settings/settings.routes.js'
import {
  departmentsRouter,
  designationsRouter,
  holidaysRouter,
  leaveTypesRouter,
} from './modules/organization/organization.routes.js'

const API_PREFIX = '/api/v1'

/**
 * Builds the Express app without binding a port, so tests can drive it with
 * supertest and the server can own the listen/shutdown lifecycle.
 *
 * `webRoot` overrides where the compiled frontend is served from: pass a
 * directory in a test, `null` to force API-only, or leave it out and the
 * running process locates `web/dist` itself.
 */
export function createApp(webRoot?: string | null): Express {
  const app = express()

  app.disable('x-powered-by')
  // Required for correct client IPs behind a proxy (rate limiting relies on it).
  app.set('trust proxy', 1)

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Helmet turns this on by default, and it rewrites plain-HTTP
          // subresource URLs to HTTPS. That breaks the app whenever it runs
          // over http:// without TLS — a local production build, for instance.
          // Deployed traffic is already HTTPS end to end, so HSTS does the job.
          // (`[]` keeps a valueless directive; `null` removes it.)
          'upgrade-insecure-requests': isProd ? [] : null,
        },
      },
    }),
  )
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      // Sensitive responses must not be cached by intermediaries.
      exposedHeaders: ['X-RateLimit-Remaining', 'Retry-After'],
    }),
  )
  app.use(express.json({ limit: '100kb' }))
  app.use(express.urlencoded({ extended: false, limit: '100kb' }))
  app.use(cookieParser())

  app.use(`${API_PREFIX}/health`, healthRoutes)
  app.use(`${API_PREFIX}/setup`, setupRoutes)
  app.use(`${API_PREFIX}/auth`, authRoutes)
  app.use(`${API_PREFIX}/users`, usersRoutes)
  app.use(`${API_PREFIX}/employees`, employeesRoutes)
  app.use(`${API_PREFIX}/attendance`, attendanceRoutes)
  app.use(`${API_PREFIX}/leave`, leaveRoutes)
  app.use(`${API_PREFIX}/payroll`, payrollRoutes)
  app.use(`${API_PREFIX}/analytics`, analyticsRoutes)
  app.use(`${API_PREFIX}/announcements`, announcementsRoutes)
  app.use(`${API_PREFIX}/notifications`, notificationsRoutes)
  app.use(`${API_PREFIX}/audit-log`, auditRoutes)
  app.use(`${API_PREFIX}/assistant`, assistantRoutes)
  app.use(`${API_PREFIX}/settings`, settingsRoutes)

  app.use(`${API_PREFIX}/departments`, departmentsRouter)
  app.use(`${API_PREFIX}/designations`, designationsRouter)
  app.use(`${API_PREFIX}/leave-types`, leaveTypesRouter)
  app.use(`${API_PREFIX}/holidays`, holidaysRouter)

  // After the API, before the catch-all 404: the built UI when it is present.
  serveWebApp(app, API_PREFIX, webRoot)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}