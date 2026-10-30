import { useState } from 'react'
import { api } from '../lib/api'
import { formatDate, formatDateTime, label, todayKey } from '../lib/format'
import { useAction, useAsync } from '../lib/hooks'
import { useSession } from '../lib/session'
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementPriority,
  Department,
} from '../lib/types'
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Loading,
  Modal,
  PageHeader,
  Panel,
  Select,
  Tabs,
  Textarea,
  TextInput,
  statusTone,
} from '../components/ui'
import { IconMegaphone, IconPlus, IconSend } from '../components/icons'

const CATEGORIES = ['general', 'policy', 'event', 'holiday', 'payroll', 'it'] as const
const PRIORITIES: AnnouncementPriority[] = ['normal', 'high', 'urgent']
const AUDIENCES: AnnouncementAudience[] = ['all', 'department', 'role']

interface FeedMeta {
  unread?: number
}

/**
 * Announcements.
 *
 * Who may see a notice is stored on the row and re-checked on every read, so a
 * department notice never reaches another department and a draft never reaches
 * an employee — the feed query and the UI agree because both read the same rule.
 */
export default function AnnouncementsScreen() {
  const { can } = useSession()
  const canPublish = can('announcement.publish')
  const canManage = can('announcement.manage')

  const [status, setStatus] = useState<'feed' | 'draft' | 'archived'>('feed')
  const [composing, setComposing] = useState(false)

  return (
    <>
      <PageHeader
        title="Announcements"
        description={
          canPublish
            ? 'Post to everyone, a department or a role — and leave a record of who read it.'
            : 'Company notices, pinned first. Unread items are marked.'
        }
        actions={
          canPublish ? (
            <Button onClick={() => setComposing(true)}>
              <IconPlus className="w-4 h-4" /> New announcement
            </Button>
          ) : undefined
        }
      />

      {canManage ? (
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { id: 'feed', label: 'Feed' },
            { id: 'draft', label: 'Drafts' },
            { id: 'archived', label: 'Archived' },
          ]}
        />
      ) : null}

      <Feed
        status={status === 'feed' ? undefined : status}
        canManage={canManage}
        canPublish={canPublish}
      />

      {composing && (
        <ComposeModal
          onClose={() => setComposing(false)}
          onCreated={() => {
            setComposing(false)
            setStatus('feed')
          }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

function Feed({
  status,
  canManage,
  canPublish,
}: {
  status?: 'draft' | 'archived'
  canManage: boolean
  canPublish: boolean
}) {
  const feed = useAsync(
    () => api.get<Announcement[]>('/announcements', { status, limit: 40 }),
    [status],
  )
  const [open, setOpen] = useState<Announcement | null>(null)
  const [readers, setReaders] = useState<Announcement | null>(null)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState<Announcement | null>(null)
  const remove = useAction()
  const publish = useAction()

  const openAnnouncement = async (announcement: Announcement) => {
    setOpen(announcement)
    if (!announcement.read) {
      try {
        const updated = await api.post<Announcement>(`/announcements/${announcement.id}/read`)
        setOpen(updated.data)
        feed.reload()
      } catch {
        // A read receipt is a nicety; the notice itself is already shown.
      }
    }
  }

  const publishNow = async (announcement: Announcement) => {
    const ok = await publish.run(() =>
      api.patch(`/announcements/${announcement.id}`, { status: 'published' }),
    )
    if (ok) feed.reload()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const ok = await remove.run(() => api.delete(`/announcements/${deleting.id}`))
    if (ok) {
      setDeleting(null)
      setOpen(null)
      feed.reload()
    }
  }

  if (feed.loading) return <Loading />
  if (feed.error) return <Banner tone="danger">{feed.error}</Banner>

  const items = feed.data?.data ?? []
  const unread = (feed.data?.meta as FeedMeta | undefined)?.unread ?? 0

  return (
    <>
      {(publish.error || remove.error) && (
        <div className="mb-3">
          <Banner tone="danger">{publish.error ?? remove.error}</Banner>
        </div>
      )}

      {unread > 0 && status === undefined && (
        <div className="mb-3">
          <Banner tone="info">{unread} unread announcement(s) in this feed.</Banner>
        </div>
      )}

      {items.length === 0 ? (
        <Panel>
          <EmptyState
            title={status ? `No ${status} announcements` : 'No announcements yet'}
            description={
              canPublish
                ? 'Post the first notice — everyone in the audience is notified when it publishes.'
                : 'Notices published to your department or role will appear here.'
            }
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {items.map((announcement) => (
            <article
              key={announcement.id}
              className={`card px-4 py-3.5 ${announcement.read ? '' : 'border-primary/40'}`}
            >
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg bg-primary-light text-primary grid place-items-center shrink-0">
                  <IconMegaphone className="w-4.5 h-4.5" />
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {announcement.pinned && <Badge tone="primary">Pinned</Badge>}
                    <Badge tone={statusTone(announcement.priority)}>
                      {label(announcement.priority)}
                    </Badge>
                    {canManage && (
                      <Badge tone={statusTone(announcement.status)}>{label(announcement.status)}</Badge>
                    )}
                    <Badge>{label(announcement.category)}</Badge>
                    {!announcement.read && <Badge tone="info">Unread</Badge>}
                  </div>

                  <h3 className="text-[14px] font-semibold text-ink mt-1.5">{announcement.title}</h3>
                  <p className="text-[12.5px] text-ink-secondary mt-0.5 line-clamp-2">
                    {announcement.body}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-ink-secondary">
                    <span>{announcement.authorName}</span>
                    <span>· {formatDate(announcement.publishAt)}</span>
                    <span>· {audienceLabel(announcement)}</span>
                    <span>· {announcement.readCount} read</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    <Button
                      variant="outline"
                      className="w-auto px-2.5 py-1 text-[11.5px]"
                      onClick={() => void openAnnouncement(announcement)}
                    >
                      Read
                    </Button>
                    {canManage && (
                      <Button
                        variant="ghost"
                        className="w-auto px-2.5 py-1 text-[11.5px]"
                        onClick={() => setEditing(announcement)}
                      >
                        Edit
                      </Button>
                    )}
                    {canManage && announcement.status === 'draft' && (
                      <Button
                        variant="ghost"
                        className="w-auto px-2.5 py-1 text-[11.5px]"
                        loading={publish.busy}
                        onClick={() => void publishNow(announcement)}
                      >
                        <IconSend className="w-3.5 h-3.5" /> Publish
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        variant="ghost"
                        className="w-auto px-2.5 py-1 text-[11.5px]"
                        onClick={() => setReaders(announcement)}
                      >
                        Readers
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        variant="ghost"
                        className="w-auto px-2.5 py-1 text-[11.5px] text-danger"
                        onClick={() => setDeleting(announcement)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {open && (
        <Modal
          title={open.title}
          description={`${open.authorName} · ${formatDateTime(open.publishAt)} · ${audienceLabel(open)}`}
          onClose={() => setOpen(null)}
          wide
          footer={
            <Button variant="outline" onClick={() => setOpen(null)}>
              Close
            </Button>
          }
        >
          <div className="flex flex-wrap gap-2 mb-3">
            <Badge tone={statusTone(open.priority)}>{label(open.priority)}</Badge>
            <Badge>{label(open.category)}</Badge>
            <Badge tone={statusTone(open.status)}>{label(open.status)}</Badge>
            <Badge tone="neutral">{open.readCount} read</Badge>
          </div>
          <p className="text-[13px] text-ink/85 whitespace-pre-line leading-relaxed">{open.body}</p>
          {open.expiresAt && (
            <p className="text-[11.5px] text-ink-secondary mt-3">
              Expires {formatDate(open.expiresAt)}
            </p>
          )}
        </Modal>
      )}

      {readers && <ReadersModal announcement={readers} onClose={() => setReaders(null)} />}

      {editing && (
        <ComposeModal
          announcement={editing}
          onClose={() => setEditing(null)}
          onCreated={() => {
            setEditing(null)
            feed.reload()
          }}
        />
      )}

      {deleting && (
        <Modal
          title="Delete announcement"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={remove.busy} onClick={() => void confirmDelete()}>
                Delete
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink/80">
            Delete <strong>{deleting.title}</strong>? Read receipts are deleted with it; notifications
            already delivered stay in inboxes.
          </p>
        </Modal>
      )}
    </>
  )
}

function audienceLabel(announcement: Announcement): string {
  if (announcement.audience === 'department') {
    return announcement.departmentName ? `Department: ${announcement.departmentName}` : 'Department'
  }
  if (announcement.audience === 'role') {
    return `Role: ${label(announcement.role ?? 'employee')}`
  }
  return 'Everyone'
}

/* ------------------------------------------------------------------ */
/* Readers                                                             */
/* ------------------------------------------------------------------ */

interface ReaderRow {
  userId: string
  name: string | null
  email: string | null
  role: string | null
  readAt: string
}

function ReadersModal({
  announcement,
  onClose,
}: {
  announcement: Announcement
  onClose: () => void
}) {
  const readers = useAsync(
    () => api.get<ReaderRow[]>(`/announcements/${announcement.id}/readers`),
    [announcement.id],
  )

  return (
    <Modal title="Who has read this" description={announcement.title} onClose={onClose} wide>
      {readers.loading && <Loading />}
      {readers.error && <Banner tone="danger">{readers.error}</Banner>}
      {readers.data && readers.data.data.length === 0 && (
        <EmptyState title="Nobody has opened it yet" description="Receipts appear as people read." />
      )}
      {readers.data && readers.data.data.length > 0 && (
        <ul className="divide-y divide-line/70">
          {readers.data.data.map((reader) => (
            <li key={reader.userId} className="flex items-center justify-between py-2 text-[12.5px]">
              <span>
                <span className="font-medium text-ink">{reader.name ?? 'Unknown'}</span>
                <span className="text-ink-secondary"> · {reader.email ?? '—'}</span>
              </span>
              <span className="text-ink-secondary">{formatDateTime(reader.readAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Compose                                                             */
/* ------------------------------------------------------------------ */

function ComposeModal({
  announcement,
  onClose,
  onCreated,
}: {
  announcement?: Announcement
  onClose: () => void
  onCreated: () => void
}) {
  const departments = useAsync(() => api.get<Department[]>('/departments', { limit: 100 }))
  const [form, setForm] = useState({
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    category: announcement?.category ?? 'general',
    priority: announcement?.priority ?? 'normal',
    audience: announcement?.audience ?? 'all',
    departmentId: announcement?.departmentId ?? '',
    role: (announcement?.role ?? 'employee') as 'hr' | 'employee',
    pinned: announcement?.pinned ?? false,
    publishAt: announcement ? announcement.publishAt.slice(0, 10) : todayKey(),
    expiresAt: announcement?.expiresAt ? announcement.expiresAt.slice(0, 10) : '',
    draft: announcement?.status === 'draft',
  })
  const { run, busy, error, fieldErrors } = useAction()

  const submit = async () => {
    const body = {
      title: form.title,
      body: form.body,
      category: form.category,
      priority: form.priority,
      audience: form.audience,
      departmentId: form.audience === 'department' ? form.departmentId : undefined,
      role: form.audience === 'role' ? form.role : undefined,
      pinned: form.pinned,
      publishAt: form.publishAt,
      expiresAt: form.expiresAt || undefined,
      status: form.draft ? 'draft' : 'published',
    }

    const ok = await run(() =>
      announcement
        ? api.patch(`/announcements/${announcement.id}`, body)
        : api.post('/announcements', body),
    )
    if (ok) onCreated()
  }

  return (
    <Modal
      title={announcement ? 'Edit announcement' : 'New announcement'}
      description="Publishing notifies everyone in the audience, once."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {form.draft ? 'Save draft' : announcement ? 'Save and publish' : 'Publish'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <Field label="Title" error={fieldErrors.title}>
        <TextInput
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="Office closed on Friday"
          maxLength={140}
        />
      </Field>

      <Field label="Message" className="mt-3" error={fieldErrors.body}>
        <Textarea
          rows={6}
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
          placeholder="Write the notice, including anything people must do."
          maxLength={5000}
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Field label="Category" error={fieldErrors.category}>
          <Select
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {label(category)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Priority" error={fieldErrors.priority}>
          <Select
            value={form.priority}
            onChange={(event) =>
              setForm({ ...form, priority: event.target.value as AnnouncementPriority })
            }
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {label(priority)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Audience" error={fieldErrors.audience}>
          <Select
            value={form.audience}
            onChange={(event) =>
              setForm({ ...form, audience: event.target.value as AnnouncementAudience })
            }
          >
            {AUDIENCES.map((audience) => (
              <option key={audience} value={audience}>
                {audience === 'all' ? 'Everyone' : label(audience)}
              </option>
            ))}
          </Select>
        </Field>

        {form.audience === 'department' && (
          <Field label="Department" error={fieldErrors.departmentId}>
            <Select
              value={form.departmentId}
              onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
            >
              <option value="">Select a department…</option>
              {(departments.data?.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {form.audience === 'role' && (
          <Field label="Role" error={fieldErrors.role}>
            <Select
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as 'hr' | 'employee' })}
            >
              <option value="employee">Employees</option>
              <option value="hr">HR</option>
            </Select>
          </Field>
        )}

        <Field label="Publish on" error={fieldErrors.publishAt}>
          <TextInput
            type="date"
            value={form.publishAt}
            onChange={(event) => setForm({ ...form, publishAt: event.target.value })}
          />
        </Field>

        <Field
          label="Expires on"
          hint="Optional — the notice leaves the feed afterwards."
          error={fieldErrors.expiresAt}
        >
          <TextInput
            type="date"
            value={form.expiresAt}
            min={form.publishAt}
            onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4 mt-3">
        <Checkbox
          checked={form.pinned}
          onChange={(pinned) => setForm({ ...form, pinned })}
          label="Pin to the top"
        />
        <Checkbox
          checked={form.draft}
          onChange={(draft) => setForm({ ...form, draft })}
          label="Save as draft (do not notify)"
        />
      </div>
    </Modal>
  )
}
