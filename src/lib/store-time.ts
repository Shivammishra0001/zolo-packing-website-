// The store runs on India Standard Time. Marketing schedules (coupons,
// campaigns) are ENTERED and DISPLAYED in IST no matter where the admin's
// browser is, and travel to the API as absolute UTC instants — so "25 Sep 00:00"
// means the same moment for the admin, the server and every customer.
// IST has no daylight saving, so a fixed +05:30 offset is exact.
export const STORE_TIME_ZONE = "Asia/Kolkata";
export const STORE_TIME_ZONE_LABEL = "IST";
const OFFSET = "+05:30";
const OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** ISO instant → value for <input type="datetime-local">, expressed in IST. */
export function toStoreInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + OFFSET_MS).toISOString().slice(0, 16);
}

/** datetime-local value (IST wall clock) → ISO instant. Empty/invalid → null. */
export function fromStoreInput(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) return null;
  const d = new Date(`${local.slice(0, 16)}:00${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "25 Sep 2026" in store time. */
export function formatStoreDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: STORE_TIME_ZONE });
}

/** "25 Sep 2026, 12:00 am" in store time. */
export function formatStoreDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: STORE_TIME_ZONE,
  });
}
