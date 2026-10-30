import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './api'

/**
 * Loads data for a screen and keeps the three states every screen needs:
 * loading, error, and the data itself. `reload()` refetches after a mutation.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)

    loaderRef
      .current()
      .then((result) => {
        if (!alive) return
        setData(result)
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        setError(errorMessage(err))
        setLoading(false)
      })

    return () => {
      alive = false
    }
    // The caller decides what the loader depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])

  return { data, error, loading, reload, setData }
}

/**
 * Wraps a submit handler with `busy` and `error` state so forms do not have to
 * repeat the same try/catch around every button.
 */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const run = useCallback(async (task: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      await task()
      return true
    } catch (err) {
      const maybe = err as { fieldErrors?: () => Record<string, string> }
      setFieldErrors(typeof maybe.fieldErrors === 'function' ? maybe.fieldErrors() : {})
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  return { run, busy, error, fieldErrors, setError }
}
