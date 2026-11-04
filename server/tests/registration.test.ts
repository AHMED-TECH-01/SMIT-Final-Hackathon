import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { companyCount, createUser, userCount } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'
import { CompanyModel } from '../src/modules/organization/company.model.js'
import { UserModel } from '../src/modules/auth/user.model.js'
import { AuditLogModel } from '../src/modules/audit/audit.model.js'
import { PASSWORD_MIN_LENGTH } from '../src/modules/auth/session.js'

/**
 * Functionality 01's public front door: `POST /auth/register`.
 *
 * The sign-up page is the only way a stranger can create data, so these tests
 * are deliberately unflattering: they check what happens on the second attempt,
 * with a hostile key in the body, with a duplicate email, and after five tries
 * from one address.
 */

const ADMIN_DETAILS = {
  name: 'Ahmed Raza',
  email: 'admin@saylani.test',
  phone: '+92 300 1234567',
  password: 'Str0ngPassw0rd!',
  confirmPassword: 'Str0ngPassw0rd!',
}

const COMPANY_DETAILS = {
  name: 'Saylani Tech',
  industry: 'Information Technology',
  companySize: '11-50',
  country: 'Pakistan',
  city: 'Karachi',
  email: 'hr@saylani.test',
  phone: '+92 21 3456789',
}

interface Overrides {
  admin?: Partial<typeof ADMIN_DETAILS>
  company?: Partial<typeof COMPANY_DETAILS>
  acceptedTerms?: boolean
  acceptedPrivacyPolicy?: boolean
  /** Keys added at the top level of the body — the mass-assignment probe. */
  extra?: Record<string, unknown>
}

function registration(over: Overrides = {}) {
  return {
    admin: { ...ADMIN_DETAILS, ...over.admin },
    company: { ...COMPANY_DETAILS, ...over.company },
    acceptedTerms: over.acceptedTerms ?? true,
    acceptedPrivacyPolicy: over.acceptedPrivacyPolicy ?? true,
    ...over.extra,
  }
}

function fieldErrors(res: request.Response): Record<string, string> {
  const details = (res.body.error?.details ?? []) as { field: string; message: string }[]
  return Object.fromEntries(details.map((d) => [d.field, d.message]))
}

function setCookies(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []
}

describe('Functionality 01b — public company registration', () => {
  let app: Express

  beforeAll(async () => {
    await startTestDb()
    app = createApp()
  })
  afterAll(async () => {
    await stopTestDb()
  })
  beforeEach(async () => {
    await clearTestDb()
    resetLoginRateLimit()
    invalidateCompanySettings()
  })

  const register = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/auth/register').send(body)

  describe('the happy path', () => {
    it('creates the company and its first administrator', async () => {
      const res = await register(registration())

      expect(res.status).toBe(201)
      expect(res.body.data.company.name).toBe(COMPANY_DETAILS.name)
      expect(res.body.data.company.industry).toBe(COMPANY_DETAILS.industry)
      expect(res.body.data.company.companySize).toBe(COMPANY_DETAILS.companySize)
      expect(res.body.data.company.country).toBe(COMPANY_DETAILS.country)
      expect(res.body.data.company.city).toBe(COMPANY_DETAILS.city)
      expect(res.body.data.company.email).toBe(COMPANY_DETAILS.email)
      expect(res.body.data.company.phone).toBe(COMPANY_DETAILS.phone)
      expect(res.body.data.user.fullName).toBe(ADMIN_DETAILS.name)
      expect(res.body.data.user.email).toBe(ADMIN_DETAILS.email)
      expect(res.body.data.setupRequired).toBe(false)

      expect(await companyCount()).toBe(1)
      expect(await userCount()).toBe(1)
    })

    it('assigns the administrator role on the server, never from the body', async () => {
      const res = await register(
        registration({
          extra: {
            role: 'superadmin',
            status: 'inactive',
            companyId: '000000000000000000000000',
            setupComplete: false,
            mustChangePassword: true,
          },
        }),
      )

      expect(res.status).toBe(201)
      expect(res.body.data.user.role).toBe('admin')
      expect(res.body.data.user.status).toBe('active')
      expect(res.body.data.user.mustChangePassword).toBe(false)

      const company = await CompanyModel.findOne({}).lean()
      expect(company?.setupComplete).toBe(true)
      // The user document has no tenant field at all: this deployment is
      // single-tenant, so there is nothing for a forged companyId to write to.
      const user = await UserModel.findOne({}).lean()
      expect(user).not.toHaveProperty('companyId')
    })

    it('normalizes both email addresses before they are stored', async () => {
      await register(
        registration({
          admin: { email: '  Admin@Saylani.TEST ' },
          company: { email: ' HR@Saylani.test ' },
        }),
      )

      const user = await UserModel.findOne({}).lean()
      const company = await CompanyModel.findOne({}).lean()
      expect(user?.email).toBe(ADMIN_DETAILS.email)
      expect(company?.contactEmail).toBe(COMPANY_DETAILS.email)
    })

    it('stores a bcrypt hash and never the password', async () => {
      const res = await register(registration())
      expect(res.status).toBe(201)

      const user = await UserModel.findOne({}).select('+passwordHash').lean()
      expect(user?.passwordHash).toBeTruthy()
      expect(user?.passwordHash).not.toBe(ADMIN_DETAILS.password)
      expect(user?.passwordHash.startsWith('$2')).toBe(true)

      const serialized = JSON.stringify(res.body)
      expect(serialized).not.toContain('passwordHash')
      expect(serialized).not.toContain('tokenVersion')
      expect(serialized).not.toContain(ADMIN_DETAILS.password)
    })

    it('starts an HttpOnly session that survives a page reload', async () => {
      const agent = request.agent(app)
      const res = await agent.post('/api/v1/auth/register').send(registration())

      const cookies = setCookies(res)
      expect(cookies.some((c) => c.startsWith('hcm_session='))).toBe(true)
      expect(cookies.join(';')).toMatch(/HttpOnly/i)
      expect(cookies.join(';')).toMatch(/SameSite=Lax/i)

      const me = await agent.get('/api/v1/auth/me')
      expect(me.status).toBe(200)
      expect(me.body.data.user.email).toBe(ADMIN_DETAILS.email)
      expect(me.body.data.user.role).toBe('admin')
    })

    it('grants the administrator the full permission set immediately', async () => {
      const agent = request.agent(app)
      await agent.post('/api/v1/auth/register').send(registration())

      const me = await agent.get('/api/v1/auth/me')
      const permissions = me.body.data.permissions as string[]
      // 'settings.manage' and 'audit.read' are admin-only; an employee or HR
      // session would not carry them.
      expect(permissions).toHaveLength(26)
      expect(permissions).toContain('settings.manage')
      expect(permissions).toContain('audit.read')
    })

    it('marks setup as complete so the wizard is never shown again', async () => {
      await register(registration())

      const res = await request(app).get('/api/v1/setup/status')
      expect(res.status).toBe(200)
      expect(res.body.data.setupRequired).toBe(false)
    })

    it('serves the new company settings without waiting out the cache', async () => {
      // Warm the cache with the pre-registration defaults first; without the
      // invalidation in performSetup the dashboard would show "HCM Lite".
      await request(app).get('/api/v1/setup/status')

      const agent = request.agent(app)
      await agent.post('/api/v1/auth/register').send(registration())

      const res = await agent.get('/api/v1/settings/public')
      expect(res.status).toBe(200)
      expect(res.body.data.name).toBe(COMPANY_DETAILS.name)
    })

    it('records the registration in the audit trail', async () => {
      const res = await register(registration())

      const entry = await AuditLogModel.findOne({ action: 'auth.register' }).lean()
      expect(entry).toBeTruthy()
      expect(entry?.entity).toBe('company')
      expect(entry?.entityId).toBe(res.body.data.company.id)
      // The request carried no session, so the route attributes the entry to the
      // account it created; an actor filter would otherwise never find it.
      // `actorId` is an ObjectId path, hence the string conversion on a lean doc.
      expect(String(entry?.actorId)).toBe(res.body.data.user.id)
      expect(entry?.actorEmail).toBe(ADMIN_DETAILS.email)
      expect(entry?.ip).toBeTruthy()
      expect(entry?.meta).toMatchObject({
        company: COMPANY_DETAILS.name,
        adminEmail: ADMIN_DETAILS.email,
      })
    })
  })

  describe('one company per deployment', () => {
    it('refuses a second registration and creates nothing extra', async () => {
      const first = await register(registration())
      expect(first.status).toBe(201)

      const second = await register(
        registration({
          admin: { email: 'someone.else@saylani.test' },
          company: { name: 'Second Company' },
        }),
      )

      expect(second.status).toBe(409)
      expect(second.body.error.code).toBe('CONFLICT')
      expect(second.body.error.message).toMatch(/sign in/i)
      expect(await companyCount()).toBe(1)
      expect(await userCount()).toBe(1)
    })

    it('refuses registration once the setup wizard has run', async () => {
      await request(app)
        .post('/api/v1/setup')
        .send({
          companyName: COMPANY_DETAILS.name,
          contactEmail: COMPANY_DETAILS.email,
          timezone: 'Asia/Karachi',
          admin: {
            fullName: ADMIN_DETAILS.name,
            email: ADMIN_DETAILS.email,
            password: ADMIN_DETAILS.password,
          },
        })

      const res = await register(registration())
      expect(res.status).toBe(409)
      expect(await userCount()).toBe(1)
    })

    it('still asks the caller to sign in rather than registering again', async () => {
      await register(registration())

      const login = await request(app).post('/api/v1/auth/login').send({
        email: ADMIN_DETAILS.email,
        password: ADMIN_DETAILS.password,
      })
      expect(login.status).toBe(200)
    })

    it('throttles repeated sign-up attempts from one address', async () => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const res = await register(
          registration({ company: { name: `Attempt ${attempt}` } }),
        )
        // Only the first can succeed; the rest are either validation or 409.
        expect([201, 409]).toContain(res.status)
      }

      const blocked = await register(registration())
      expect(blocked.status).toBe(429)
      expect(blocked.body.error.code).toBe('RATE_LIMITED')
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
      expect(await companyCount()).toBe(1)
    })
  })

  describe('validation', () => {
    it('rejects an empty body with a field error for every required value', async () => {
      const res = await register({})

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      const fields = Object.keys(fieldErrors(res))
      expect(fields).toContain('admin')
      expect(fields).toContain('company')
      expect(fields).toContain('acceptedTerms')
      expect(fields).toContain('acceptedPrivacyPolicy')
      expect(await companyCount()).toBe(0)
    })

    it('reports each missing field with its section path', async () => {
      const res = await register({
        admin: { name: 'A' },
        company: { companySize: 'millions' },
        acceptedTerms: false,
        acceptedPrivacyPolicy: false,
      })

      expect(res.status).toBe(400)
      const errors = fieldErrors(res)
      expect(errors['admin.name']).toBeTruthy()
      expect(errors['admin.email']).toBeTruthy()
      expect(errors['admin.phone']).toBeTruthy()
      expect(errors['admin.password']).toBeTruthy()
      expect(errors['admin.confirmPassword']).toBeTruthy()
      expect(errors['company.companySize']).toBeTruthy()
      expect(errors['acceptedTerms']).toBeTruthy()
      expect(errors['acceptedPrivacyPolicy']).toBeTruthy()
    })

    it.each([
      ['administrator', { admin: { email: 'not-an-email' } }],
      ['company', { company: { email: 'not-an-email' } }],
    ] as [string, Overrides][])(
      'rejects a malformed %s email',
      async (_label, over) => {
        const res = await register(registration(over))

        expect(res.status).toBe(400)
        const errors = fieldErrors(res)
        expect(over.admin ? errors['admin.email'] : errors['company.email']).toMatch(/valid/i)
        expect(await companyCount()).toBe(0)
      },
    )

    it('rejects a password shorter than the policy and creates nothing', async () => {
      const short = 'Ab1'
      expect(short.length).toBeLessThan(PASSWORD_MIN_LENGTH)

      const res = await register(
        registration({ admin: { password: short, confirmPassword: short } }),
      )

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('UNPROCESSABLE')
      expect(res.body.error.message).toMatch(/password must contain/i)
      expect(await companyCount()).toBe(0)
      expect(await userCount()).toBe(0)
    })

    it('rejects a password with no digit even when it is long enough', async () => {
      const noDigit = 'OnlyLettersAndCase'
      const res = await register(
        registration({ admin: { password: noDigit, confirmPassword: noDigit } }),
      )

      expect(res.status).toBe(422)
      expect(await companyCount()).toBe(0)
    })

    it('rejects mismatched password confirmations', async () => {
      const res = await register(registration({ admin: { confirmPassword: 'Str0ngPassw0rd?' } }))

      expect(res.status).toBe(400)
      expect(fieldErrors(res)['admin.confirmPassword']).toMatch(/match/i)
      expect(await companyCount()).toBe(0)
    })

    it.each([
      ['too short', '12345'],
      ['far too long', '+92 300 123456789012345678'],
      ['with letters', '+92-300-CALLNOW'],
    ])('rejects a phone number that is %s', async (_label, phone) => {
      const res = await register(registration({ admin: { phone } }))

      expect(res.status).toBe(400)
      expect(fieldErrors(res)['admin.phone']).toMatch(/phone/i)
    })

    it('accepts the phone separators a real form submits', async () => {
      const res = await register(
        registration({
          admin: { phone: '(+92) 300-123.4567' },
          company: { phone: '+92 21 3456789' },
        }),
      )

      expect(res.status).toBe(201)
      const user = await UserModel.findOne({}).lean()
      expect(user?.phone).toBe('(+92) 300-123.4567')
    })

    it('only accepts the company sizes the form offers', async () => {
      const res = await register(registration({ company: { companySize: '999+' } }))

      expect(res.status).toBe(400)
      expect(fieldErrors(res)['company.companySize']).toBeTruthy()
    })

    it.each([
      ['industry', { industry: 'x' }],
      ['country', { country: 'x' }],
      ['city', { city: '   ' }],
      ['name', { name: 'x' }],
    ] as [string, Partial<typeof COMPANY_DETAILS>][])(
      'requires a real %s',
      async (field, company) => {
        const res = await register(registration({ company }))

        expect(res.status).toBe(400)
        expect(fieldErrors(res)[`company.${field}`]).toBeTruthy()
      },
    )

    it.each(['acceptedTerms', 'acceptedPrivacyPolicy'] as const)(
      'refuses to register until %s is accepted',
      async (key) => {
        const res = await register(registration({ [key]: false } as Overrides))

        expect(res.status).toBe(400)
        expect(fieldErrors(res)[key]).toBeTruthy()
        expect(await companyCount()).toBe(0)
        expect(await userCount()).toBe(0)
      },
    )

    it('rejects a form section that is not an object', async () => {
      // A non-object section is a client bug, not a server one: it must be
      // rejected rather than reaching the creation path.
      const res = await register({ ...registration(), admin: 'Ahmed Raza' } as never)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(await companyCount()).toBe(0)
    })
  })

  describe('failure atomicity', () => {
    it('rolls the company back when the administrator cannot be created', async () => {
      // No company exists, so registration is still possible — but the email is
      // already taken, which fails the second insert.
      await createUser({ email: ADMIN_DETAILS.email, role: 'admin' })
      expect(await companyCount()).toBe(0)

      const res = await register(registration())

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('CONFLICT')
      // The compensating rollback: no half-created tenant left behind.
      expect(await companyCount()).toBe(0)
      expect(await userCount()).toBe(1)
    })

    it('leaves setup required after a rolled-back registration', async () => {
      await createUser({ email: ADMIN_DETAILS.email, role: 'admin' })
      await register(registration())

      const res = await request(app).get('/api/v1/setup/status')
      expect(res.body.data.setupRequired).toBe(true)
    })

    it('still lets the operator register after a rolled-back attempt', async () => {
      await createUser({ email: ADMIN_DETAILS.email, role: 'admin' })
      await register(registration())

      resetLoginRateLimit()
      const res = await register(
        registration({ admin: { name: 'Second Admin', email: 'second@saylani.test' } }),
      )

      expect(res.status).toBe(201)
      expect(await companyCount()).toBe(1)
    })
  })
})
