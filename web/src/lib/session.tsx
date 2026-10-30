import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, ApiError, setUnauthorizedHandler } from './api'
import type { User } from './types'

/**
 * The signed-in session and the effective permissions the server returned.
 *
 * The UI uses `can()` only to hide what would be refused anyway — every screen
 * still calls an endpoint that enforces the same permission server-side.
 */

export interface SessionState {
  user: User
  permissions: string[]
}

interface SessionValue {
  session: SessionState | null
  loading: boolean
  setupRequired: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  markSetupComplete: (user: User) => void
  can: (permission: string) => boolean
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: User; permissions: string[] }>('/auth/me')
      setSession({ user: me.data.user, permissions: me.data.permissions })
      setSetupRequired(false)
      return
    } catch (error) {
      // A 401 simply means "not signed in"; anything else is also treated as
      // "not signed in" so the UI can never get stuck on a loading screen.
      if (!(error instanceof ApiError)) throw error
      setSession(null)
    }

    try {
      const status = await api.get<{ setupRequired: boolean }>('/setup/status')
      setSetupRequired(status.data.setupRequired)
    } catch {
      setSetupRequired(false)
    }
  }, [])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    // An expired cookie anywhere in the app drops the session immediately.
    setUnauthorizedHandler(() => setSession(null))
    return () => setUnauthorizedHandler(null)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ user: User }>('/auth/login', { email, password })
    const me = await api.get<{ user: User; permissions: string[] }>('/auth/me')
    setSession({ user: me.data.user ?? result.data.user, permissions: me.data.permissions })
    setSetupRequired(false)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      setSession(null)
    }
  }, [])

  const markSetupComplete = useCallback((user: User) => {
    setSetupRequired(false)
    // The first administrator holds every permission; /auth/me confirms it.
    void api
      .get<{ user: User; permissions: string[] }>('/auth/me')
      .then((me) => setSession({ user: me.data.user ?? user, permissions: me.data.permissions }))
      .catch(() => setSession({ user, permissions: [] }))
  }, [])

  const value = useMemo<SessionValue>(
    () => ({
      session,
      loading,
      setupRequired,
      signIn,
      signOut,
      refresh,
      markSetupComplete,
      can: (permission: string) => session?.permissions.includes(permission) ?? false,
    }),
    [session, loading, setupRequired, signIn, signOut, refresh, markSetupComplete],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.')
  return value
}

/** Shorthand for screens that only need a yes/no answer. */
export function useCan(): (permission: string) => boolean {
  return useSession().can
}
