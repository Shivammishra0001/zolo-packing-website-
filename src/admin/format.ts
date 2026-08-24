// ---------- Formatting helpers (INR, dates, relative time) ----------

/**
 * ₹1,84,300 — Indian grouping, no paise (admin-facing amounts).
 *
 * Takes RUPEES. The API returns money as integer minor units (paise), so any
 * value named `*Minor` must go through `inrMinor` instead — passing paise here
 * renders every amount 100x too large.
 */
export function inr(value: number): string {
  return (
    "₹" +
    Math.round(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })
  );
}

/** ₹1,84,300 from integer paise — the unit every API money field uses. */
export function inrMinor(minor: number): string {
  return inr((minor ?? 0) / 100);
}

/** "2h ago" when recent, absolute date otherwise */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const diff = now - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/** "24 Jul, 3:40 pm" */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** "24 Jul 2026" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "Today", "Tomorrow", or "26 Jul" — for due dates */
export function dueLabel(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const today = new Date(now);
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round(
    (startOfDay(d) - startOfDay(today)) / 86_400_000,
  );
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff === -1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** "1h 24m" countdown text; negative durations become "Overdue 32m" */
export function countdown(msRemaining: number): string {
  const overdue = msRemaining < 0;
  const abs = Math.abs(msRemaining);
  const totalMins = Math.floor(abs / 60_000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const core = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return overdue ? `Overdue ${core}` : core;
}
