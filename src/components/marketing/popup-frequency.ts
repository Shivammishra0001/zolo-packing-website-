// When may a homepage popup be shown again? Pure logic over injected storage so
// it is testable and so a blocked/throwing storage (private mode) degrades to
// "show it" rather than crashing the page.
//
// Every key carries the CAMPAIGN ID, so dismissing one campaign never hides a
// different (or future) campaign:
//   campaign_popup_dismissed_<id>  localStorage    once_per_campaign
//   campaign_popup_day_<id>        localStorage    once_per_day  (last shown date)
//   campaign_popup_session_<id>    sessionStorage  once_per_session
// every_visit is remembered in memory only (once per full page load), and
// `always` is never remembered.
import type { PopupFrequency } from "@/lib/api/marketing";

export const popupKeys = {
  dismissed: (id: string) => `campaign_popup_dismissed_${id}`,
  day: (id: string) => `campaign_popup_day_${id}`,
  session: (id: string) => `campaign_popup_session_${id}`,
};

type KV = Pick<Storage, "getItem" | "setItem">;
export interface PopupStores { local: KV | null; session: KV | null; memory: Set<string> }

const read = (s: KV | null, key: string): string | null => { try { return s?.getItem(key) ?? null; } catch { return null; } };
const write = (s: KV | null, key: string, value: string) => { try { s?.setItem(key, value); } catch { /* storage blocked */ } };

/** Local calendar day, e.g. "2026-09-25". */
export const dayStamp = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function canShowPopup(id: string, frequency: PopupFrequency, stores: PopupStores, now = new Date()): boolean {
  switch (frequency) {
    case "always": return true;
    case "every_visit": return !stores.memory.has(id);
    case "once_per_session": return read(stores.session, popupKeys.session(id)) == null;
    case "once_per_day": return read(stores.local, popupKeys.day(id)) !== dayStamp(now);
    case "once_per_campaign": return read(stores.local, popupKeys.dismissed(id)) == null;
    default: return false;
  }
}

/** Record that the popup was shown (called when it actually appears). */
export function markPopupShown(id: string, frequency: PopupFrequency, stores: PopupStores, now = new Date()): void {
  switch (frequency) {
    case "every_visit": stores.memory.add(id); break;
    case "once_per_session": write(stores.session, popupKeys.session(id), now.toISOString()); break;
    case "once_per_day": write(stores.local, popupKeys.day(id), dayStamp(now)); break;
    case "once_per_campaign": write(stores.local, popupKeys.dismissed(id), now.toISOString()); break;
    default: break;
  }
}

const shownThisPageLoad = new Set<string>();
const safe = (get: () => Storage): Storage | null => { try { return get(); } catch { return null; } };

export const browserPopupStores = (): PopupStores => ({
  local: typeof window === "undefined" ? null : safe(() => window.localStorage),
  session: typeof window === "undefined" ? null : safe(() => window.sessionStorage),
  memory: shownThisPageLoad,
});
