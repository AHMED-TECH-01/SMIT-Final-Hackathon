import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js'
import { ADMIN, bootstrapCompany, createUser, loginAs } from './helpers/factory.js'
import { resetLoginRateLimit } from '../src/middleware/login-rate-limit.js'
import { invalidateCompanySettings } from '../src/modules/organization/company.settings.js'

const NOTICE = {
  title: 'Office closed on Friday',
  body: 'The office will remain closed this Friday for maintenance work.',
}

describe('Announcements, notifications and the audit trail', () => {
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
    invalidateCompanySettings()
    resetLoginRateLimit()
    await bootstrapCompany(app)
  })

  /** Ayesha sits in Engineering, Bilal in Marketing; both have logins. */
  async function seed() {
    const admin = await loginAs(app, ADMIN.email)

    const ayeshaUser = await createUser({
      email: 'ayesha@saylani.test',
      fullName: 'Ayesha Khan',
      role: 'employee',
    })
    const bilalUser = await createUser({
      email: 'bilal@saylani.test',
      fullName: 'Bilal Ahmed',
      role: 'employee',
    })
    await createUser({ email: 'hr@saylani.test', fullName: 'Hina Rahman', role: 'hr' })

    const engineering = await admin.post('/api/v1/departments').send({ name: 'Engineering' })
    const marketing = await admin.post('/api/v1/departments').send({ name: 'Marketing' })

    await admin.post('/api/v1/employees').send({
      fullName: 'Ayesha Khan',
      email: 'ayesha@saylani.test',
      joinDate: '2024-01-15',
      departmentId: engineering.body.data.id,
      userId: String(ayeshaUser._id),
    })
    await admin.post('/api/v1/employees').send({
      fullName: 'Bilal Ahmed',
      email: 'bilal@saylani.test',
      joinDate: '2024-02-01',
      departmentId: marketing.body.data.id,
      userId: String(bilalUser._id),
    })

    return {
      admin,
      engineeringId: engineering.body.data.id as string,
      marketingId: marketing.body.data.id as string,
      ayeshaAgent: await loginAs(app, 'ayesha@saylani.test'),
      bilalAgent: await loginAs(app, 'bilal@saylani.test'),
      hrAgent: await loginAs(app, 'hr@saylani.test'),
    }
  }

  describe('feed visibility', () => {
    it('shows a published all-staff notice to everyone', async () => {
      const { admin, ayeshaAgent, bilalAgent } = await seed()

      const created = await admin.post('/api/v1/announcements').send(NOTICE)
      expect(created.status).toBe(201)
      expect(created.body.data.authorName).toBe(ADMIN.fullName)
      expect(created.body.data.status).toBe('published')

      const ayesha = await ayeshaAgent.get('/api/v1/announcements')
      expect(ayesha.status).toBe(200)
      expect(ayesha.body.data).toHaveLength(1)
      expect(ayesha.body.data[0].title).toBe(NOTICE.title)
      expect(ayesha.body.data[0].read).toBe(false)
      expect(ayesha.body.meta.unread).toBe(1)

      expect((await bilalAgent.get('/api/v1/announcements')).body.data).toHaveLength(1)
    })

    it('keeps a department notice inside that department', async () => {
      const { admin, engineeringId, ayeshaAgent, bilalAgent } = await seed()

      await admin.post('/api/v1/announcements').send({
        ...NOTICE,
        title: 'Engineering stand-up moved',
        audience: 'department',
        departmentId: engineeringId,
      })

      const ayesha = await ayeshaAgent.get('/api/v1/announcements')
      expect(ayesha.body.data).toHaveLength(1)
      expect(ayesha.body.data[0].departmentName).toBe('Engineering')

      const bilal = await bilalAgent.get('/api/v1/announcements')
      expect(bilal.body.data).toHaveLength(0)

      // Knowing the id is not enough: the row itself is re-checked.
      const direct = await bilalAgent.get(`/api/v1/announcements/${ayesha.body.data[0].id}`)
      expect(direct.status).toBe(404)
    })

    it('hides drafts from employees but not from HR', async () => {
      const { admin, ayeshaAgent, hrAgent } = await seed()

      const draft = await admin
        .post('/api/v1/announcements')
        .send({ ...NOTICE, title: 'Draft: new leave policy', status: 'draft' })
      expect(draft.status).toBe(201)

      expect((await ayeshaAgent.get('/api/v1/announcements')).body.data).toHaveLength(0)
      expect((await ayeshaAgent.get(`/api/v1/announcements/${draft.body.data.id}`)).status).toBe(404)

      const drafts = await hrAgent.get('/api/v1/announcements?status=draft')
      expect(drafts.body.data).toHaveLength(1)
      expect(drafts.body.data[0].status).toBe('draft')
    })

    it('holds a scheduled notice back until its publish time', async () => {
      const { admin, ayeshaAgent } = await seed()

      const scheduled = await admin.post('/api/v1/announcements').send({
        ...NOTICE,
        title: 'Annual dinner announced',
        publishAt: new Date(Date.now() + 86_400_000).toISOString(),
      })

      expect(scheduled.status).toBe(201)
      expect((await ayeshaAgent.get('/api/v1/announcements')).body.data).toHaveLength(0)
      expect(
        (await admin.get('/api/v1/announcements?status=published')).body.data,
      ).toHaveLength(1)
    })

    it('drops a notice once it expires', async () => {
      const { admin, ayeshaAgent } = await seed()
      const now = Date.now()

      await admin.post('/api/v1/announcements').send({
        ...NOTICE,
        title: 'Yesterday only',
        publishAt: new Date(now - 2 * 86_400_000).toISOString(),
        expiresAt: new Date(now - 86_400_000).toISOString(),
      })

      expect((await ayeshaAgent.get('/api/v1/announcements')).body.data).toHaveLength(0)
    })
  })

  describe('publishing rules', () => {
    it('refuses a department audience without a department', async () => {
      const { admin } = await seed()

      const res = await admin
        .post('/api/v1/announcements')
        .send({ ...NOTICE, audience: 'department' })

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('UNPROCESSABLE')
    })

    it('refuses an unknown department', async () => {
      const { admin } = await seed()

      const res = await admin.post('/api/v1/announcements').send({
        ...NOTICE,
        audience: 'department',
        departmentId: '64b7f9b2f1a2c3d4e5f60718',
      })

      expect(res.status).toBe(422)
    })

    it('refuses an expiry before publication', async () => {
      const { admin } = await seed()
      const now = Date.now()

      const res = await admin.post('/api/v1/announcements').send({
        ...NOTICE,
        publishAt: new Date(now).toISOString(),
        expiresAt: new Date(now - 60_000).toISOString(),
      })

      expect(res.status).toBe(422)
    })

    it('keeps employees out of the publishing endpoints', async () => {
      const { admin, ayeshaAgent } = await seed()
      const created = await admin.post('/api/v1/announcements').send(NOTICE)
      const id = created.body.data.id

      expect((await ayeshaAgent.post('/api/v1/announcements').send(NOTICE)).status).toBe(403)
      expect((await ayeshaAgent.patch(`/api/v1/announcements/${id}`).send({ pinned: true })).status).toBe(403)
      expect((await ayeshaAgent.delete(`/api/v1/announcements/${id}`)).status).toBe(403)
    })

    it('pins and unpins a notice, newest pin first', async () => {
      const { admin, ayeshaAgent } = await seed()

      await admin.post('/api/v1/announcements').send({ ...NOTICE, title: 'Older notice' })
      const pinned = await admin.post('/api/v1/announcements').send({
        ...NOTICE,
        title: 'Pinned notice',
      })

      await admin
        .patch(`/api/v1/announcements/${pinned.body.data.id}`)
        .send({ pinned: true })
        .expect(200)

      const feed = await ayeshaAgent.get('/api/v1/announcements')
      expect(feed.body.data[0].title).toBe('Pinned notice')
      expect(feed.body.data[0].pinned).toBe(true)
    })
  })

  describe('read receipts', () => {
    it('records one receipt per reader', async () => {
      const { admin, ayeshaAgent, bilalAgent } = await seed()
      const created = await admin.post('/api/v1/announcements').send(NOTICE)
      const id = created.body.data.id as string

      const first = await ayeshaAgent.post(`/api/v1/announcements/${id}/read`)
      expect(first.status).toBe(200)
      expect(first.body.data.read).toBe(true)
      expect(first.body.data.readCount).toBe(1)

      // Re-opening must not append a second receipt.
      const again = await ayeshaAgent.post(`/api/v1/announcements/${id}/read`)
      expect(again.body.data.readCount).toBe(1)

      await bilalAgent.post(`/api/v1/announcements/${id}/read`).expect(200)

      const readers = await admin.get(`/api/v1/announcements/${id}/readers`)
      expect(readers.status).toBe(200)
      expect(readers.body.data).toHaveLength(2)
      expect(readers.body.data.map((entry: { name: string }) => entry.name).sort()).toEqual([
        'Ayesha Khan',
        'Bilal Ahmed',
      ])

      expect((await ayeshaAgent.get('/api/v1/announcements')).body.meta.unread).toBe(0)
    })

    it('keeps the reader list away from employees', async () => {
      const { admin, ayeshaAgent } = await seed()
      const created = await admin.post('/api/v1/announcements').send(NOTICE)

      const res = await ayeshaAgent.get(`/api/v1/announcements/${created.body.data.id}/readers`)
      expect(res.status).toBe(403)
    })
  })

  describe('notifications', () => {
    it('delivers a notice to the audience inboxes only', async () => {
      const { admin, engineeringId, ayeshaAgent, bilalAgent } = await seed()

      await admin.post('/api/v1/announcements').send({
        ...NOTICE,
        title: 'Engineering only',
        audience: 'department',
        departmentId: engineeringId,
      })

      const ayesha = await ayeshaAgent.get('/api/v1/notifications')
      expect(ayesha.status).toBe(200)
      expect(ayesha.body.data).toHaveLength(1)
      expect(ayesha.body.data[0].type).toBe('announcement')
      expect(ayesha.body.meta.unread).toBe(1)

      expect((await bilalAgent.get('/api/v1/notifications')).body.data).toHaveLength(0)
    })

    it('marks one notification or all of them as read', async () => {
      const { admin, ayeshaAgent } = await seed()

      await admin.post('/api/v1/announcements').send({ ...NOTICE, title: 'First notice' })
      await admin.post('/api/v1/announcements').send({ ...NOTICE, title: 'Second notice' })

      const inbox = await ayeshaAgent.get('/api/v1/notifications')
      expect(inbox.body.data).toHaveLength(2)
      expect((await ayeshaAgent.get('/api/v1/notifications/unread-count')).body.data.unread).toBe(2)

      const one = await ayeshaAgent.post(`/api/v1/notifications/${inbox.body.data[0].id}/read`)
      expect(one.body.data.read).toBe(true)
      expect((await ayeshaAgent.get('/api/v1/notifications/unread-count')).body.data.unread).toBe(1)

      const unreadOnly = await ayeshaAgent.get('/api/v1/notifications?unread=true')
      expect(unreadOnly.body.data).toHaveLength(1)

      const all = await ayeshaAgent.post('/api/v1/notifications/read-all')
      expect(all.body.data.updated).toBe(1)
      expect((await ayeshaAgent.get('/api/v1/notifications/unread-count')).body.data.unread).toBe(0)
    })

    it('never lets one user touch another user\'s inbox', async () => {
      const { admin, marketingId, ayeshaAgent, bilalAgent } = await seed()

      await admin.post('/api/v1/announcements').send({
        ...NOTICE,
        title: 'Marketing only',
        audience: 'department',
        departmentId: marketingId,
      })

      const bilalInbox = await bilalAgent.get('/api/v1/notifications')
      expect(bilalInbox.body.data).toHaveLength(1)
      const bilalNotificationId = bilalInbox.body.data[0].id as string

      expect((await ayeshaAgent.post(`/api/v1/notifications/${bilalNotificationId}/read`)).status).toBe(404)
      expect((await ayeshaAgent.delete(`/api/v1/notifications/${bilalNotificationId}`)).status).toBe(404)
      expect(bilalInbox.body.data).toHaveLength(1)
    })

    it('deletes a notification once', async () => {
      const { admin, ayeshaAgent } = await seed()
      await admin.post('/api/v1/announcements').send(NOTICE)

      const inbox = await ayeshaAgent.get('/api/v1/notifications')
      const id = inbox.body.data[0].id as string

      await ayeshaAgent.delete(`/api/v1/notifications/${id}`).expect(200)
      expect((await ayeshaAgent.delete(`/api/v1/notifications/${id}`)).status).toBe(404)
      expect((await ayeshaAgent.get('/api/v1/notifications')).body.data).toHaveLength(0)
    })

    it('notifies the applicant when their leave is decided', async () => {
      const { admin, ayeshaAgent } = await seed()

      const leaveType = await admin
        .post('/api/v1/leave-types')
        .send({ name: 'Annual', code: 'ANN', annualQuota: 20 })

      const applied = await ayeshaAgent.post('/api/v1/leave/requests').send({
        leaveTypeId: leaveType.body.data.id,
        startDate: '2024-06-10',
        endDate: '2024-06-11',
        reason: 'Family event out of town',
      })
      expect(applied.status).toBe(201)

      await admin
        .patch(`/api/v1/leave/requests/${applied.body.data.id}/decision`)
        .send({ decision: 'approved' })
        .expect(200)

      const inbox = await ayeshaAgent.get('/api/v1/notifications')
      const titles = inbox.body.data.map((entry: { title: string }) => entry.title)
      expect(titles).toContain('Leave request approved')

      // The order itself went to the approvers, not to the applicant.
      const adminInbox = await admin.get('/api/v1/notifications')
      expect(
        adminInbox.body.data.map((entry: { title: string }) => entry.title),
      ).toContain('New leave request')
    })
  })

  describe('audit trail', () => {
    it('records privileged actions for the admin', async () => {
      const { admin } = await seed()

      await admin.post('/api/v1/announcements').send(NOTICE)

      const res = await admin.get('/api/v1/audit-log?entity=announcement')
      expect(res.status).toBe(200)
      expect(res.body.data.length).toBeGreaterThan(0)
      expect(res.body.data[0].action).toBe('create')
      expect(res.body.data[0].actorEmail).toBe(ADMIN.email)

      const facets = await admin.get('/api/v1/audit-log/facets')
      expect(facets.body.data.entities).toContain('announcement')
    })

    it('is closed to HR and employees', async () => {
      const { hrAgent, ayeshaAgent } = await seed()

      expect((await hrAgent.get('/api/v1/audit-log')).status).toBe(403)
      expect((await ayeshaAgent.get('/api/v1/audit-log')).status).toBe(403)
    })

    it('filters by actor and by date range', async () => {
      const { admin } = await seed()
      await admin.post('/api/v1/announcements').send(NOTICE)

      const byActor = await admin.get(`/api/v1/audit-log?actorEmail=${ADMIN.email}`)
      expect(byActor.body.data.length).toBeGreaterThan(0)

      const future = await admin.get('/api/v1/audit-log?from=2099-01-01')
      expect(future.body.data).toHaveLength(0)

      const inverted = await admin.get('/api/v1/audit-log?from=2024-06-10&to=2024-06-01')
      expect(inverted.status).toBe(400)
    })
  })
})