import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Zap } from "lucide-react";
import type { StoreProduct } from "@/lib/products";
import { ProductCard } from "@/components/NewProductCard";
import { useActiveCampaigns } from "@/components/marketing/campaigns";

// ============================================================
// DealsRail — the discounted-products band.
//
// EVERYTHING HERE IS REAL OR ABSENT. The section renders only when products
// actually carry a sale price below their list price (Product.salePriceMinor,
// which is also what the server charges). No sale products ⇒ the whole band
// returns null rather than showing an empty shell or invented offers.
//
// The countdown is the part most easily faked, so it is the part most tightly
// bound to data: it appears ONLY when a live campaign is scheduled for this
// placement, and it counts down to that campaign's real endAt. With no
// campaign there is no timer — the deals still show, they simply have no
// advertised deadline, which is the truth.
//
// Dark band, mirroring the reference's "Daily Deals": the colour change marks
// this as a promotional interruption in the page rhythm rather than another
// product rail.
// ============================================================

/** Largest discount first — the strongest offers lead. */
function byDiscount(a: StoreProduct, b: StoreProduct) {
  const off = (p: StoreProduct) => {
    const list = p.priceMinor ?? 0;
    const sale = p.salePriceMinor ?? list;
    return list > 0 ? (list - sale) / list : 0;
  };
  return off(b) - off(a);
}

/**
 * Time left until `endsAt`, recomputed every second.
 *
 * Returns null once the deadline passes so the caller can drop the timer
 * rather than render "00:00:00" indefinitely.
 */
function useCountdown(endsAt: string | null): { h: string; m: string; s: string } | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  if (!endsAt) return null;
  const left = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(left) || left <= 0) return null;

  const total = Math.floor(left / 1000);
  // Hours, not days: a deal ending in three weeks is not urgent, and padding
  // it into a day counter invites the fake-urgency pattern this avoids.
  return {
    h: String(Math.floor(total / 3600)).padStart(2, "0"),
    m: String(Math.floor((total % 3600) / 60)).padStart(2, "0"),
    s: String(total % 60).padStart(2, "0"),
  };
}

function TimeBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-[52px] flex-col items-center rounded-lg bg-white/10 px-2.5 py-1.5">
      <span className="font-display text-lg font-extrabold leading-none tabular-nums text-white">{value}</span>
      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">{label}</span>
    </div>
  );
}

export function DealsRail({ products, limit = 4 }: { products: StoreProduct[]; limit?: number }) {
  // A live campaign placed on the homepage gives the band its deadline. The
  // hook already filters to campaigns inside their start/end window.
  const campaigns = useActiveCampaigns("homepage_promo_card");
  const endsAt = campaigns.length > 0 ? campaigns[0].endAt : null;
  const countdown = useCountdown(endsAt);

  const deals = useMemo(
    () =>
      products
        .filter((p) => p.salePriceMinor != null && p.salePriceMinor > 0 && p.salePriceMinor < (p.priceMinor ?? 0))
        .sort(byDiscount)
        .slice(0, limit),
    [products, limit],
  );

  // No genuine offers ⇒ no section. Never an empty promotional shell.
  if (deals.length === 0) return null;

  return (
    <section className="section bg-navy-900" aria-labelledby="deals-heading">
      <div className="shell">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-primary-400">
              <Zap className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 id="deals-heading" className="font-display text-xl font-extrabold tracking-tight text-white sm:text-2xl">
                Current offers
              </h2>
              <p className="mt-0.5 text-sm text-white/60">
                {deals.length === 1 ? "One product is" : `${deals.length} products are`} discounted right now
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Only with a real campaign deadline behind it. */}
            {countdown && (
              <div className="flex items-center gap-2">
                <span className="hidden text-xs font-semibold uppercase tracking-wide text-white/60 sm:inline">
                  Ends in
                </span>
                <div className="flex gap-1.5">
                  <TimeBlock value={countdown.h} label="Hrs" />
                  <TimeBlock value={countdown.m} label="Min" />
                  <TimeBlock value={countdown.s} label="Sec" />
                </div>
              </div>
            )}
            <Link
              to="/products?sort=price-asc"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              View all <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>

        {/* Same ProductCard as every other rail: one card implementation means
            cart, wishlist, quote-only and stock rules cannot drift between
            sections. */}
        <div className="grid-cards">
          {deals.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
