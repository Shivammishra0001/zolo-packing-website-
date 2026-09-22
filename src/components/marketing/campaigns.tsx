// Storefront campaign components. They fetch the LIVE campaigns from the API
// (nothing is hard-coded), pick the ones for their placement in priority order,
// and hand them to the presentational views. No campaign ⇒ nothing is rendered,
// so an empty marketing calendar leaves every page exactly as it was.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { marketingApi, type CampaignPlacement, type PublicCampaign } from "@/lib/api/marketing";
import { AnnouncementView, CampaignBannerView, CampaignPopupView, CampaignStripView, PromotionCardView } from "./CampaignViews";
import { browserPopupStores, canShowPopup, markPopupShown } from "./popup-frequency";

// ---------- one shared, short-lived cache for every placement ----------
// One request serves the whole page (bar + banner + cards + popup). It is
// refreshed after a minute so a campaign that starts or ends while the tab is
// open appears/disappears without a reload. The server already filters by
// schedule; endAt is re-checked here so an expired campaign vanishes on time
// even between refreshes.
const TTL_MS = 60_000;
let cache: PublicCampaign[] = [];
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = marketingApi.activeCampaigns()
    .then((d) => { cache = d.campaigns; })
    .catch(() => { /* API unreachable: keep what we have; promotions are optional */ })
    .finally(() => { fetchedAt = Date.now(); inFlight = null; listeners.forEach((l) => l()); });
  return inFlight;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  if (Date.now() - fetchedAt > TTL_MS) void load();
  const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, TTL_MS);
  return () => { listeners.delete(fn); window.clearInterval(id); };
};
const snapshot = () => cache;

/** Live campaigns for one placement, highest priority (lowest number) first. */
export function useActiveCampaigns(placement: CampaignPlacement): PublicCampaign[] {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const now = Date.now();
  return all.filter((c) => c.placements.includes(placement) && new Date(c.endAt).getTime() >= now && new Date(c.startAt).getTime() <= now);
}

// ---------- Announcement bar ----------

/** Renders the top campaign for the bar, or `fallback` when none is live. */
export function AnnouncementCampaign({ fallback = null }: { fallback?: ReactNode }) {
  const [top] = useActiveCampaigns("announcement_bar");
  return top ? <AnnouncementView campaign={top} /> : <>{fallback}</>;
}

// ---------- Homepage banner + promotional cards ----------

export function HomepageCampaignBanner() {
  const [top] = useActiveCampaigns("homepage_hero");
  if (!top) return null;
  return (
    <section className="bg-white pt-6 sm:pt-8" aria-label="Featured promotion">
      <div className="shell"><CampaignBannerView campaign={top} /></div>
    </section>
  );
}

export function PromotionCards({ max = 3 }: { max?: number }) {
  const cards = useActiveCampaigns("homepage_promo_card").slice(0, max);
  if (!cards.length) return null;
  const cols = cards.length === 1 ? "" : cards.length === 2 ? "md:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3";
  return (
    <section className="section-sm bg-white" aria-label="Promotions">
      <div className="shell">
        <div className={`grid gap-6 ${cols} ${cards.length === 1 ? "mx-auto max-w-3xl" : ""}`}>
          {cards.map((c) => <PromotionCardView key={c.id} campaign={c} />)}
        </div>
      </div>
    </section>
  );
}

/** Slim promotion for product listing / product detail / cart / checkout. */
export function CampaignStrip({ placement, className }: {
  placement: Extract<CampaignPlacement, "product_listing" | "product_detail" | "cart" | "checkout">;
  className?: string;
}) {
  const [top] = useActiveCampaigns(placement);
  if (!top) return null;
  return <div className={className}><CampaignStripView campaign={top} /></div>;
}

// ---------- Homepage popup ----------

/**
 * Shows at most ONE popup: the highest-priority live popup campaign whose
 * display frequency still allows it on this device. It waits for the
 * admin-chosen delay, records that it was shown (keyed by campaign id), and
 * closes on the close button, Escape, the overlay, or the CTA.
 */
export function CampaignPopup() {
  const candidates = useActiveCampaigns("homepage_popup");
  const [open, setOpen] = useState<PublicCampaign | null>(null);
  const [done, setDone] = useState(false); // one popup per homepage visit

  const pick = done || open ? null : candidates.find((c) => canShowPopup(c.id, c.popup.frequency, browserPopupStores())) ?? null;
  const pickId = pick?.id ?? null;

  useEffect(() => {
    if (!pick) return;
    const timer = window.setTimeout(() => {
      // Re-check at show time: another tab may have shown it during the delay.
      if (!canShowPopup(pick.id, pick.popup.frequency, browserPopupStores())) return;
      markPopupShown(pick.id, pick.popup.frequency, browserPopupStores());
      setOpen(pick);
    }, Math.min(Math.max(pick.popup.delaySeconds, 0), 60) * 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickId]);

  const close = () => { setOpen(null); setDone(true); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // A campaign that expires (or is paused) while open disappears with the data.
  if (!open || !candidates.some((c) => c.id === open.id)) return null;
  return <CampaignPopupView campaign={open} popup={open.popup} onClose={close} onNavigate={close} />;
}
