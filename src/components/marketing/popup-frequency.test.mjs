// Popup frequency rules. Run: npx tsx --test src/components/marketing/popup-frequency.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { canShowPopup, markPopupShown, popupKeys } from "./popup-frequency.ts";

const kv = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const stores = () => ({ local: kv(), session: kv(), memory: new Set() });

test("once_per_session uses sessionStorage, keyed by campaign id", () => {
  const s = stores();
  assert.equal(canShowPopup("A", "once_per_session", s), true);
  markPopupShown("A", "once_per_session", s);
  assert.equal(canShowPopup("A", "once_per_session", s), false);
  assert.ok(s.session.m.has(popupKeys.session("A")));
  assert.equal(s.local.m.size, 0);
  assert.equal(canShowPopup("B", "once_per_session", s), true, "another campaign is unaffected");
  assert.equal(canShowPopup("A", "once_per_session", { ...s, session: kv() }), true, "a new session shows it again");
});

test("once_per_day stores the last shown date and resets the next day", () => {
  const s = stores();
  const today = new Date(2026, 8, 25, 10, 0);
  markPopupShown("A", "once_per_day", s, today);
  assert.equal(s.local.m.get(popupKeys.day("A")), "2026-09-25");
  assert.equal(canShowPopup("A", "once_per_day", s, new Date(2026, 8, 25, 23, 59)), false);
  assert.equal(canShowPopup("A", "once_per_day", s, new Date(2026, 8, 26, 0, 1)), true);
});

test("once_per_campaign persists in localStorage under campaign_popup_dismissed_<id> only", () => {
  const s = stores();
  markPopupShown("A", "once_per_campaign", s);
  assert.ok(s.local.m.has("campaign_popup_dismissed_A"));
  assert.equal(canShowPopup("A", "once_per_campaign", s), false);
  assert.equal(canShowPopup("NEXT-CAMPAIGN", "once_per_campaign", s), true, "a future campaign is never hidden by an old dismissal");
});

test("every_visit is once per page load (memory only); always is never remembered", () => {
  const s = stores();
  markPopupShown("A", "every_visit", s);
  assert.equal(canShowPopup("A", "every_visit", s), false);
  assert.equal(canShowPopup("A", "every_visit", { ...s, memory: new Set() }), true, "next page load");
  assert.equal(s.local.m.size + s.session.m.size, 0);
  markPopupShown("A", "always", s);
  assert.equal(canShowPopup("A", "always", s), true);
});

test("blocked storage never throws — the popup simply shows", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  const s = { local: broken, session: broken, memory: new Set() };
  assert.doesNotThrow(() => markPopupShown("A", "once_per_day", s));
  assert.equal(canShowPopup("A", "once_per_campaign", s), true);
  assert.equal(canShowPopup("A", "once_per_session", { local: null, session: null, memory: new Set() }), true);
});
