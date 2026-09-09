import * as React from 'react'
import { ApiError } from '@/services/api'

interface QueryState<T> {
  data: T | undefined
  loading: boolean
  error: string | null
}

/**
 * Minimal request hook: data, loading and error, with a manual `refetch`.
 *
 * Deliberately small rather than pulling in a data-fetching library — the app
 * has a handful of read paths and no cache-invalidation requirements yet.
 * Stale responses are discarded, so fast typing in a search box cannot land an
 * older result after a newer one.
 */
export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList,
  options: { enabled?: boolean } = {},
): QueryState<T> & { refetch: () => void } {
  const enabled = options.enabled ?? true

  const [state, setState] = React.useState<QueryState<T>>({
    data: undefined,
    loading: enabled,
    error: null,
  })
  const [nonce, setNonce] = React.useState(0)

  // Keep the latest fetcher without making it a dependency, so callers can pass
  // an inline closure without causing an infinite loop.
  const fetcherRef = React.useRef(fetcher)
  fetcherRef.current = fetcher

  React.useEffect(() => {
    if (!enabled) {
      setState({ data: undefined, loading: false, error: null })
      return
    }

    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))

    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // A 401 is already handled globally (session cleared, redirect to
        // login), so it is not surfaced as an inline error here.
        if (error instanceof ApiError && error.isAuthError) {
          setState({ data: undefined, loading: false, error: null })
          return
        }
        const message =
          error instanceof Error ? error.message : 'Something went wrong. Please try again.'
        setState({ data: undefined, loading: false, error: message })
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce])

  return { ...state, refetch: React.useCallback(() => setNonce((n) => n + 1), []) }
}

/** Debounce a rapidly-changing value, e.g. a search box. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value)

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])

  return debounced
}
