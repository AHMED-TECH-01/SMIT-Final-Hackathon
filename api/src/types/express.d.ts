import type { Request } from 'express'
import type { Role } from '../modules/auth/permissions.js'

export interface AuthUser {
  id: string
  email: string
  role: Role
  mustChangePassword: boolean
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export type AuthedRequest = Request & { user: AuthUser }
