import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../../src/app.js'
import { CompanyModel } from '../../src/modules/organization/company.model.js'
import { hashPassword } from '../../src/modules/auth/session.js'
import { UserModel } from '../../src/modules/auth/user.model.js'
import type { Role } from '../../src/modules/auth/permissions.js'

export const ADMIN = {
  fullName: 'Ahmed Raza',
  email: 'admin@saylani.test',
  password: 'Str0ngPassw0rd!',
}

export const COMPANY = {
  companyName: 'Saylani Tech',
  contactEmail: 'hr@saylani.test',
  timezone: 'Asia/Karachi',
}

/** A ready app plus an agent whose cookie jar already holds the admin session. */
export async function bootstrapCompany(
  app: Express = createApp(),
): Promise<{ app: Express; adminAgent: ReturnType<typeof request.agent>; adminId: string }> {
  const adminAgent = request.agent(app)

  const res = await adminAgent.post('/api/v1/setup').send({
    ...COMPANY,
    admin: ADMIN,
  })

  if (res.status !== 201) {
    throw new Error(`Setup failed in test helper: ${res.status} ${JSON.stringify(res.body)}`)
  }

  return { app, adminAgent, adminId: res.body.data.user.id }
}

/** Creates a user directly in the DB with a known password. */
export async function createUser(input: {
  email: string
  fullName?: string
  role: Role
  password?: string
  mustChangePassword?: boolean
  status?: 'active' | 'inactive'
}) {
  return UserModel.create({
    email: input.email,
    fullName: input.fullName ?? input.email.split('@')[0],
    passwordHash: await hashPassword(input.password ?? ADMIN.password),
    role: input.role,
    status: input.status ?? 'active',
    mustChangePassword: input.mustChangePassword ?? false,
  })
}

/** Signs in and returns an agent carrying that user's session cookie. */
export async function loginAs(
  app: Express,
  email: string,
  password: string = ADMIN.password,
) {
  const agent = request.agent(app)
  const res = await agent.post('/api/v1/auth/login').send({ email, password })
  if (res.status !== 200) {
    throw new Error(`Login failed in test helper: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return agent
}

export async function companyCount(): Promise<number> {
  return CompanyModel.countDocuments()
}

export async function userCount(): Promise<number> {
  return UserModel.countDocuments()
}
