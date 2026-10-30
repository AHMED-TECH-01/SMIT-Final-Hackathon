import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { formatDateTime, label } from '../lib/format'
import { useRouter } from '../lib/router'
import { useSession } from '../lib/session'
import type { Notification } from '../lib/types'
import { Avatar, Badge, Spinner } from './ui'
import { IconBell, IconChevronDown } from './icons'

/**
 * Top bar: company identity, the notification inbox and the account menu.
 *
 * Notifications are produced by real events on the server (a leave decision, a
 * finalized payroll run), so this menu is a view of the same records the feed
 * shows — nothing is generated in the browser.
 */
export default function Header() {
  const { session, signOut } = useSession()
  const { navigate } = useRouter()

  const [company, setCompany] = useState<string>('')
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const [count, list] = await Promise.all([
        api.get<{ unread: number }>('/notifications/unread-count'),
        api.get<Notification[]>('/notifications', { limit: 6 }),
      ])
      setUnread(count.data.unread)
      setItems(list.data)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load()
    api
      .get<{ name: string }>('/settings/public')
      .then((res) => setCompany(res.data.name))
      .catch(() => setCompany(''))
  }, [load])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const openInbox = async () => {
    setOpen((value) => !value)
    if (!open) await load()
  }

  const markAllRead = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/notifications/read-all')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const openNotification = async (notification: Notification) => {
    setOpen(false)
    if (!notification.read) {
      await api.post(`/notifications/${notification.id}/read`).catch(() => undefined)
      void load()
    }
    navigate(notification.link ?? '/')
  }

  const user = session?.user
  if (!user) return null

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 h-header bg-white border-b border-line px-4 md:px-5">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink truncate">{company || 'HCM Lite'}</p>
        <p className="text-[11px] text-ink-secondary truncate">Human Capital Management</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => void openInbox()}
            className="relative p-2 rounded-full text-ink-secondary hover:bg-surface-muted"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            aria-expanded={open}
          >
            <IconBell className="w-[18px] h-[18px]" />
            {unread > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-[3px] grid place-items-center rounded-full bg-danger text-white text-[9px] font-bold">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 mt-1 w-[330px] card shadow-pop overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-line">
                <span className="text-[12px] font-semibold text-ink">Notifications</span>
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  disabled={busy || unread === 0}
                  className="text-[11.5px] font-medium text-primary disabled:text-ink-secondary/60"
                >
                  {busy ? 'Working…' : 'Mark all read'}
                </button>
              </div>

              {error && <p className="px-3 py-2 text-[11.5px] text-danger">{error}</p>}

              <div className="max-h-[320px] overflow-y-auto">
                {items.length === 0 && (
                  <p className="px-3 py-6 text-center text-[12px] text-ink-secondary">
                    Nothing yet. Leave decisions and finalized payroll appear here.
                  </p>
                )}

                {items.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void openNotification(notification)}
                    className={`w-full text-left px-3 py-2.5 border-b border-line/60 last:border-0 hover:bg-surface-muted ${
                      notification.read ? '' : 'bg-primary-light/40'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge tone={notification.read ? 'neutral' : 'primary'}>
                        {notification.type}
                      </Badge>
                      <span className="ml-auto text-[10.5px] text-ink-secondary">
                        {formatDateTime(notification.createdAt)}
                      </span>
                    </div>
                    <p className="text-[12.5px] font-semibold text-ink mt-1">{notification.title}</p>
                    <p className="text-[11.5px] text-ink-secondary line-clamp-2">{notification.body}</p>
                  </button>
                ))}
              </div>

              {busy && (
                <div className="px-3 py-1.5 border-t border-line flex items-center gap-2 text-[11px] text-ink-secondary">
                  <Spinner className="w-3 h-3" /> Updating…
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pl-1 pr-2 py-1">
          <Avatar name={user.fullName} />
          <div className="text-left leading-tight hidden sm:block">
            <span className="block text-[13px] font-semibold text-ink">{user.fullName}</span>
            <span className="block text-[11px] text-primary">{label(user.role)}</span>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="ml-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-secondary hover:text-ink px-2 py-1 rounded hover:bg-surface-muted"
            title="Sign out"
          >
            Sign out <IconChevronDown className="w-3.5 h-3.5 rotate-[-90deg]" />
          </button>
        </div>
      </div>
    </header>
  )
}
