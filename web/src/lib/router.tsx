import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react'

/**
 * A history-based router in ~60 lines.
 *
 * The app has a dozen top-level screens and no nested layouts, so a dependency
 * would cost more than it saves: this gives real URLs, the back button and
 * deep links with nothing to install.
 */

interface RouterValue {
  path: string
  search: string
  navigate: (to: string, options?: { replace?: boolean }) => void
}

const RouterContext = createContext<RouterValue | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }))

  useEffect(() => {
    const sync = () =>
      setLocation({ path: window.location.pathname, search: window.location.search })

    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const current = `${window.location.pathname}${window.location.search}`
    if (to === current) return

    if (options?.replace) window.history.replaceState({}, '', to)
    else window.history.pushState({}, '', to)

    setLocation({ path: window.location.pathname, search: window.location.search })
    window.scrollTo({ top: 0 })
  }, [])

  const value = useMemo<RouterValue>(
    () => ({ path: location.path, search: location.search, navigate }),
    [location.path, location.search, navigate],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext)
  if (!value) throw new Error('useRouter must be used inside <RouterProvider>.')
  return value
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
  children: ReactNode
}

/** A real anchor, so middle-click and "open in new tab" keep working. */
export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter()

  return (
    <a
      href={to}
      {...rest}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}
