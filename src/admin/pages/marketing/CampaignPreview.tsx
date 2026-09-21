import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import type { CampaignPlacement, PopupSettings } from "@/lib/api/marketing";
import {
  AnnouncementView, CampaignBannerView, CampaignPopupView, CampaignStripView, PromotionCardView, type CampaignLike,
} from "@/components/marketing/CampaignViews";
import { cn } from "@/utils/cn";

// Preview = the REAL storefront components, fed the campaign being edited, on a
// storefront-coloured canvas. What the admin sees here is what customers get.

export const PLACEMENT_LABEL: Record<CampaignPlacement, string> = {
  announcement_bar: "Announcement Bar",
  homepage_hero: "Homepage Banner",
  homepage_promo_card: "Promotional Card",
  homepage_popup: "Homepage Popup",
  product_listing: "Product Listing",
  product_detail: "Product Detail",
  cart: "Cart",
  checkout: "Checkout",
};

const ORDER: CampaignPlacement[] = [
  "announcement_bar", "homepage_hero", "homepage_promo_card", "homepage_popup", "product_listing", "product_detail", "cart", "checkout",
];

export function CampaignPreviewModal({
  open, onClose, campaign, popup, placements, name,
}: {
  open: boolean;
  onClose: () => void;
  campaign: CampaignLike | null;
  popup: PopupSettings;
  placements: CampaignPlacement[];
  name: string;
}) {
  const available = placements.length ? ORDER.filter((p) => placements.includes(p)) : ORDER;
  const [view, setView] = useState<CampaignPlacement>(available[0]);
  const [popupOpen, setPopupOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    setView(available[0]);
    setPopupOpen(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !campaign) return null;

  const body = () => {
    switch (view) {
      case "announcement_bar":
        return (
          <div className="bg-dark-950 text-xs text-white">
            <div className="flex items-center justify-between gap-4 px-4 py-2">
              <div className="min-w-0 flex-1"><AnnouncementView campaign={campaign} /></div>
              <span className="hidden shrink-0 text-white/60 sm:inline">Track Order | Get Quote</span>
            </div>
          </div>
        );
      case "homepage_hero":
        return <div className="p-4 sm:p-6"><CampaignBannerView campaign={campaign} /></div>;
      case "homepage_promo_card":
        return <div className="mx-auto max-w-md p-4 sm:p-6"><PromotionCardView campaign={campaign} /></div>;
      case "homepage_popup":
        return (
          <div className="relative h-[560px] overflow-hidden bg-dark-50">
            {/* stand-in page behind the popup */}
            <div className="space-y-4 p-6 opacity-60" aria-hidden>
              <div className="h-40 rounded-2xl bg-dark-200" />
              <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-dark-200" />)}</div>
              <div className="h-24 rounded-xl bg-dark-200" />
            </div>
            {popupOpen
              ? <CampaignPopupView contained campaign={campaign} popup={popup} onClose={() => setPopupOpen(false)} />
              : <button type="button" onClick={() => setPopupOpen(true)} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-dark-900 px-5 py-2.5 text-sm font-bold text-white">Show popup again</button>}
          </div>
        );
      default:
        return <div className="p-4 sm:p-6"><CampaignStripView campaign={campaign} /></div>;
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Preview of ${name || "campaign"}`}>
      <div className="absolute inset-0 bg-dark-950/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl erp-surface shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b erp-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold erp-text">Preview — {name || "Untitled campaign"}</h2>
            <p className="text-xs erp-text-muted">Rendered with the customer-facing components. Links are disabled here.</p>
          </div>
          <button onClick={onClose} aria-label="Close preview" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="flex shrink-0 gap-1 overflow-x-auto border-b erp-border px-3 py-2 no-scrollbar" role="tablist" aria-label="Placement">
          {available.map((p) => (
            <button
              key={p} role="tab" aria-selected={view === p} onClick={() => { setView(p); setPopupOpen(true); }}
              className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold", view === p ? "bg-primary-500 text-white" : "erp-text-muted hover:erp-surface-2")}
            >
              {PLACEMENT_LABEL[p]}
            </button>
          ))}
        </div>

        {/* Storefront canvas: always light, links inert. */}
        <div
          className="flex-1 overflow-y-auto bg-white text-dark-900"
          onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) e.preventDefault(); }}
        >
          {body()}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t erp-border px-5 py-3 text-xs erp-text-muted">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{campaign.buttonLink ? <>Button opens <span className="font-mono erp-text">{campaign.buttonLink}</span>{campaign.buttonExternal && " in a new tab"}</> : "No button / link"}</span>
          </span>
          {campaign.mobileImageUrl && <span>Phones use the mobile image.</span>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
