// Buyer portal data hook.
//
// Four explicit states — loading | success | empty | error — so a page can
// never render a fabricated row while a request is in flight, and a failure is
// always visible rather than silently swallowed into an empty list.
//
// There is deliberately NO mock fallback: if the API fails, the page shows the
// error and a retry, because hiding a broken backend behind placeholder data is
// how the previous version of these screens misled everyone.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, NetworkError } from "@/lib/api/client";

export type BuyerQuery<T> =
  | { status: "loading"; data: null; error: null; retry: () => void }
  | { status: "success"; data: T; error: null; retry: () => void }
  | { status: "error"; data: null; error: string; retry: () => void };

function messageFor(err: unknown): string {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 401) return "Your session has expired. Please sign in again.";
    if (err.status === 403) return "You don't have access to this.";
    if (err.status === 404) return "We couldn't find that record.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * Fetch once per `deps` change, with a manual retry.
 *
 * `fetcher` is held in a ref so an inline arrow doesn't retrigger the effect on
 * every render — the dependency array is the single source of when to refetch.
 */
export function useBuyerQuery<T>(fetcher: () => Promise<T>, deps: unknown[] = []): BuyerQuery<T> {
  const [state, setState] = useState<{ status: "loading" | "success" | "error"; data: T | null; error: string | null }>({
    status: "loading",
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null, error: null });

    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data, error: null });
      })
      .catch((err) => {
        // Never fall back to placeholder data — surface the failure.
        if (!cancelled) setState({ status: "error", data: null, error: messageFor(err) });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry } as BuyerQuery<T>;
}
