// Onboarding state hook: loads the aggregate, exposes an autosaving profile
// patcher (debounced), child-collection mutators, and submit. The server is the
// source of truth — every mutation returns the DB-saved aggregate.
import { useCallback, useEffect, useRef, useState } from "react";
import { onboardingApi, type OnboardingProfile } from "./onboarding-api";
import { ApiError } from "./api";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useOnboarding() {
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProfile(await onboardingApi.get());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load onboarding");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Flush pending profile changes to the server.
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setSaveState("saving");
    try {
      const updated = await onboardingApi.patch(patch);
      setProfile(updated);
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setError(e instanceof ApiError ? (e.issues?.[0]?.message ?? e.message) : "Save failed");
    }
  }, []);

  // Optimistic local update + debounced autosave.
  const updateField = useCallback((patch: Record<string, unknown>) => {
    setProfile((p) => (p ? ({ ...p, ...patch } as OnboardingProfile) : p));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { flush(); }, 900);
  }, [flush]);

  // Generic child mutation wrapper — refreshes the aggregate afterward.
  const mutate = useCallback(async <T,>(fn: () => Promise<T>) => {
    setSaveState("saving");
    try {
      await fn();
      setProfile(await onboardingApi.get());
      setSaveState("saved");
      setError(null);
    } catch (e) {
      setSaveState("error");
      const msg = e instanceof ApiError ? (e.issues?.[0]?.message ?? e.message) : "Action failed";
      setError(msg);
      throw e;
    }
  }, []);

  const submit = useCallback(async () => {
    await flush();
    return mutate(() => onboardingApi.submit());
  }, [flush, mutate]);

  return { profile, loading, error, saveState, load, updateField, flush, mutate, submit, setError };
}
