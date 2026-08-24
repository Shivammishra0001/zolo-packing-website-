import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** Re-renders on an interval — powers live SLA countdowns and "2h ago" labels */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export interface MockQuery<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Simulates an async fetch over mock data so panels exercise their real
 * loading / error / empty states. Append `?demo=loading` or `?demo=error`
 * to the URL to hold every panel in that state for review.
 */
export function useMockQuery<T>(data: T, delayMs = 500): MockQuery<T> {
  const [params] = useSearchParams();
  const demo = params.get("demo");
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (demo === "loading") {
      setState({ data: null, loading: true, error: null });
      return;
    }
    setState({ data: null, loading: true, error: null });
    const t = setTimeout(() => {
      if (demo === "error" && attempt === 0) {
        setState({ data: null, loading: false, error: "Couldn't reach the server. Check your connection and try again." });
      } else {
        setState({ data: dataRef.current, loading: false, error: null });
      }
    }, delayMs);
    return () => clearTimeout(t);
  }, [demo, attempt, delayMs]);

  return { ...state, retry: () => setAttempt((a) => a + 1) };
}
