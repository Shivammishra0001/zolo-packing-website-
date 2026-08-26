import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, FileText, Minus, Plus, ShoppingBag, X } from "lucide-react";
import { useToast } from "../components/ui/Toast";
import {
  useCart,
  computeTotals,
  lineTotalMinor,
  setQuantity,
  incrementQuantity,
  decrementQuantity,
  removeFromCart,
  clearCart,
  isCartHydrated,
} from "../lib/cart-store";
import { orderApi, type Quote } from "../lib/api/commerce";

const inr = (minor: number) => "₹" + Math.round(minor / 100).toLocaleString("en-IN");

export default function CartPage() {
  const items = useCart();
  const localTotals = computeTotals(items);
  const toast = useToast();
  const nav = useNavigate();

  // Authoritative totals from the server (tax/discount/shipping/grand total).
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Re-fetch the server quote whenever the cart contents change.
  useEffect(() => {
    let cancelled = false;
    if (items.length === 0) { setQuote(null); return; }
    orderApi.quote().then((q) => { if (!cancelled) setQuote(q); }).catch(() => {});
    return () => { cancelled = true; };
  }, [items]);

  const totals = quote ?? localTotals;

  const guardedMutate = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try { await fn(); } catch (err) {
      toast.error("Couldn't update cart", err instanceof Error ? err.message : "Please try again.");
    } finally { setBusyId(null); }
  };

  if (items.length === 0) {
    // Distinguish "still loading" from a genuinely empty cart.
    if (!isCartHydrated()) {
      return <main className="py-20 text-center text-sm text-dark-400">Loading your cart…</main>;
    }
    return (
      <main className="py-20">
        <div className="mx-auto max-w-lg px-4 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-dark-50">
            <ShoppingBag className="h-8 w-8 text-dark-300" />
          </div>
          <h1 className="font-display text-2xl font-extrabold text-dark-900">Your cart is empty</h1>
          <p className="mt-2 text-sm text-dark-500">Browse the catalog and add products to get started.</p>
          <Link to="/products" className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary-500 px-6 py-3 text-sm font-bold text-white hover:bg-primary-600">
            Browse products <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    );
  }

  const hasUnavailable = items.some((it) => it.unavailable);

  return (
    <main className="py-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Progress: Cart → Address → Review → Payment → Confirmation */}
        <CheckoutSteps current={0} />

        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-dark-900">Your Cart</h1>
            <p className="mt-0.5 text-sm text-dark-500">
              {items.length} product{items.length === 1 ? "" : "s"} · {items.reduce((s, it) => s + it.quantity, 0)} unit(s)
            </p>
          </div>
          <button
            onClick={() => guardedMutate("__all", clearCart).then(() => toast.info("Cart cleared", ""))}
            className="text-xs font-semibold text-red-600 hover:underline"
          >
            Clear cart
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Items */}
          <div className="space-y-3">
            {items.map((it) => (
              <div key={it.id} className={`flex gap-4 rounded-2xl border bg-white p-4 card-shadow ${it.unavailable ? "border-red-200" : "border-dark-100"} ${busyId === it.id ? "opacity-60" : ""}`}>
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-dark-50 text-3xl">
                  {/^(blob:|data:|https?:|\/)/.test(it.image) ? <img src={it.image} alt="" className="h-full w-full object-cover" /> : it.image}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-dark-900">{it.name}</p>
                      {it.sku && <p className="font-mono text-xs text-dark-400">{it.sku}</p>}
                      {it.variant && <p className="mt-0.5 text-xs text-dark-500">{it.variant}</p>}
                      {it.unavailable && <p className="mt-0.5 text-xs font-semibold text-red-600">No longer available — please remove</p>}
                    </div>
                    <button onClick={() => guardedMutate(it.id, () => removeFromCart(it.id))} aria-label={`Remove ${it.name}`} className="text-dark-400 hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="inline-flex items-center rounded-lg border border-dark-200">
                      <button onClick={() => guardedMutate(it.id, () => decrementQuantity(it.id))} disabled={busyId === it.id} className="p-2 hover:bg-dark-50 rounded-l-lg disabled:opacity-50" aria-label="Decrease quantity">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={it.available || undefined}
                        value={it.quantity}
                        onChange={(e) => guardedMutate(it.id, () => setQuantity(it.id, +e.target.value))}
                        className="w-14 border-x border-dark-200 py-1.5 text-center text-sm font-semibold outline-none"
                      />
                      <button onClick={() => guardedMutate(it.id, () => incrementQuantity(it.id))} disabled={busyId === it.id || it.quantity >= it.available} className="p-2 hover:bg-dark-50 rounded-r-lg disabled:opacity-50" aria-label="Increase quantity">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-dark-400">{inr(it.unitPriceMinor)} / unit</div>
                      <div className="font-bold text-dark-900">{inr(lineTotalMinor(it))}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <Link to="/products" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 hover:underline">
              ← Continue shopping
            </Link>
          </div>

          {/* Summary */}
          <aside className="h-fit rounded-2xl border border-dark-100 bg-white p-5 card-shadow lg:sticky lg:top-20">
            <h2 className="font-display font-bold text-dark-900">Order Summary</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Row label="Subtotal" value={inr(totals.subtotalMinor)} />
              <Row label="Discount" value={totals.discountMinor > 0 ? `− ${inr(totals.discountMinor)}` : inr(0)} />
              <Row label="GST (18%)" value={inr(totals.taxMinor)} />
              <Row label="Shipping" value={totals.shippingMinor > 0 ? inr(totals.shippingMinor) : "Free"} />
              <div className="border-t border-dark-100 pt-2.5">
                <Row label={<span className="font-bold text-dark-900">Grand Total</span>} value={<span className="font-extrabold text-dark-900">{inr(totals.grandTotalMinor)}</span>} />
              </div>
            </dl>

            <div className="mt-5 space-y-2.5">
              <button
                onClick={() => nav("/checkout/address")}
                disabled={hasUnavailable}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 py-3 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-50"
              >
                Proceed to Checkout <ArrowRight className="h-4 w-4" />
              </button>
              <Link to="/rfq" className="flex w-full items-center justify-center gap-2 rounded-xl border border-dark-200 py-3 text-sm font-bold text-dark-800 hover:bg-dark-50">
                <FileText className="h-4 w-4" /> Request Quotation
              </Link>
            </div>
            {hasUnavailable && <p className="mt-3 text-center text-[11px] text-red-500">Remove unavailable items to continue.</p>}
          </aside>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-dark-500">{label}</dt>
      <dd className="tabular-nums text-dark-800">{value}</dd>
    </div>
  );
}

// Shared checkout progress indicator: Cart → Address → Review → Payment → Done.
export function CheckoutSteps({ current }: { current: number }) {
  const steps = ["Cart", "Address", "Review", "Payment", "Confirmation"];
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-y-2 text-xs font-semibold">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full ${i <= current ? "bg-primary-500 text-white" : "bg-dark-100 text-dark-400"}`}>{i + 1}</span>
          <span className={`ml-1.5 ${i <= current ? "text-dark-900" : "text-dark-400"}`}>{s}</span>
          {i < steps.length - 1 && <span className="mx-2 h-px w-6 bg-dark-200 sm:w-8" />}
        </li>
      ))}
    </ol>
  );
}
