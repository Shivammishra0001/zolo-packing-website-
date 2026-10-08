// Date-range presets, resolved to the { from, to } the APIs already accept.
//
// The backend's only arbitrary-range filter is `{ placedAt: { gte: from, lt:
// to } }` (server/src/services/sales.mjs), so every preset here resolves to a
// half-open interval: `from` inclusive, `to` exclusive. That is what makes
// "today" mean midnight-to-midnight rather than "the last 24 hours", and stops
// an order placed at 23:59 landing in two adjacent buckets.
//
// Dates are built in LOCAL time because the business reads them in IST and the
// server computes its own day boundaries locally too.

export type RangeKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all";

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  all: "All time",
};

/** Presets in the order a business user expects to scan them. */
export const RANGE_OPTIONS = (Object.keys(RANGE_LABEL) as RangeKey[]).map((value) => ({
  value,
  label: RANGE_LABEL[value],
}));

const atMidnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};
/** YYYY-MM-DD in LOCAL time. `toISOString()` would shift IST back a day. */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface ResolvedRange {
  /** Inclusive start, YYYY-MM-DD. Undefined means "no lower bound". */
  from?: string;
  /** EXCLUSIVE end, YYYY-MM-DD. Undefined means "up to now". */
  to?: string;
}

/**
 * Turn a preset into the query parameters the APIs take.
 *
 * `now` is injectable so this is testable without freezing the clock.
 */
export function resolveRange(key: RangeKey, now: Date = new Date()): ResolvedRange {
  const today = atMidnight(now);
  const tomorrow = addDays(today, 1);

  switch (key) {
    case "today":
      return { from: iso(today), to: iso(tomorrow) };
    case "yesterday":
      return { from: iso(addDays(today, -1)), to: iso(today) };
    // Trailing windows INCLUDE today, so "last 7 days" is 6 days back plus
    // today — the reading a business user expects, not 7 days ending yesterday.
    case "7d":
      return { from: iso(addDays(today, -6)), to: iso(tomorrow) };
    case "30d":
      return { from: iso(addDays(today, -29)), to: iso(tomorrow) };
    case "this_month":
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(tomorrow) };
    case "last_month":
      return {
        from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      };
    case "this_year":
      return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(tomorrow) };
    case "all":
      return {};
  }
}

/** How many days a preset spans — used to size the trailing-days analytics API. */
export function rangeDays(key: RangeKey, now: Date = new Date()): number {
  const { from } = resolveRange(key, now);
  if (!from) return 365;
  const start = new Date(`${from}T00:00:00`);
  const days = Math.round((atMidnight(now).getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.min(365, Math.max(1, days));
}
