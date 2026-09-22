import { CampaignStrip } from "@/components/marketing/campaigns";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, FileText, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useToast } from "../components/ui/Toast";
import { Breadcrumb, Button, ButtonLink, EmptyState, cx } from "../components/UI";
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
const isImageUrl = (s: string) => /^(blob:|data:|https?:|\/)/.test(s);

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
      return (
        <main className="section-sm">
          <div className="shell">
            <div>
              <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Cart" }]} />
              <div className="mt-4 skeleton h-8 w-40" />
              <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]" aria-busy="true" aria-label="Loading your cart">
                <div className="space-y-3">
                  <div className="skeleton h-24" />
                  <div className="skeleton h-24" />
                  <div className="skeleton h-24" />
                </div>
                <div className="skeleton h-64" />
              </div>
            </div>
          </div>
        </main>
      );
    }
    return (
      <main className="section-sm">
        <div className="shell">
          <div>
            <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Cart" }]} />
            <h1 className="h2 mt-4 text-dark-900">Your cart</h1>
            <EmptyState
              className="mt-6"
              icon={ShoppingCart}
              title="Your cart is empty"
              message="Browse the catalog and add products to get started."
              action={<ButtonLink to="/products" icon={ArrowRight}>Browse products</ButtonLink>}
            />
          </div>
        </div>
      </main>
    );
  }

  const hasUnavailable = items.some((it) => it.unavailable);
  const unitCount = items.reduce((s, it) => s + it.quantity, 0);

  return (
    <main className="section-sm">
      <div className="shell">
        <div>
          <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Cart" }]} />
          {/* Progress: Cart → Address → Review → Payment → Confirmation */}
          <CheckoutSteps current={0} className="mt-4" />
          {/* Admin-managed promotion (Marketing → Campaigns → Cart). */}
          <CampaignStrip placement="cart" className="mb-6" />

          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="h2 text-dark-900">Your cart</h1>
              <p className="mt-1 text-sm text-dark-500">
                {items.length} item{items.length === 1 ? "" : "s"} · {unitCount} unit{unitCount === 1 ? "" : "s"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              className="text-red-600 hover:bg-red-50"
              disabled={busyId === "__all"}
              onClick={() => guardedMutate("__all", clearCart).then(() => toast.info("Cart cleared", ""))}
            >
              Clear cart
            </Button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* Items */}
            <div>
              <ul className="space-y-3">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className={cx(
                      "card-flat p-4 transition-opacity",
                      it.unavailable && "border-red-200",
                      busyId === it.id && "opacity-60",
                    )}
                  >
                    <div className="flex gap-4">
                      {/* Image stage */}
                      <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-green-50 text-3xl">
                        {isImageUrl(it.image) ? <img src={it.image} alt="" className="h-full w-full object-contain p-1" /> : it.image}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-dark-900">{it.name}</p>
                            {(it.variant || it.sku) && (
                              <p className="mt-0.5 text-xs text-dark-500">
                                {it.variant}{it.variant && it.sku ? " · " : ""}{it.sku && <span className="font-mono">{it.sku}</span>}
                              </p>
                            )}
                            <p className="mt-0.5 text-xs text-dark-500">{inr(it.unitPriceMinor)} / unit</p>
                            {it.unavailable && <p className="mt-1 text-xs font-semibold text-red-600">No longer available — please remove</p>}
                          </div>
                          <button
                            type="button"
                            onClick={() => guardedMutate(it.id, () => removeFromCart(it.id))}
                            disabled={busyId === it.id}
                            aria-label={`Remove ${it.name}`}
                            className="btn btn-ghost btn-sm -mr-2 -mt-1 h-9 w-9 shrink-0 px-0 text-dark-400 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <QuantityStepper
                            value={it.quantity}
                            max={it.available || undefined}
                            disabled={busyId === it.id}
                            canIncrement={it.quantity < it.available}
                            onDecrement={() => guardedMutate(it.id, () => decrementQuantity(it.id))}
                            onIncrement={() => guardedMutate(it.id, () => incrementQuantity(it.id))}
                            onChange={(n) => guardedMutate(it.id, () => setQuantity(it.id, n))}
                          />
                          <p className="text-base font-bold tabular-nums text-dark-900">{inr(lineTotalMinor(it))}</p>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <ButtonLink to="/products" variant="ghost" size="sm" className="mt-4 -ml-3 text-green-600">
                ← Continue shopping
              </ButtonLink>
            </div>

            {/* Summary */}
            <aside className="card h-fit p-5 lg:sticky lg:top-24">
              <h2 className="h3 text-dark-900">Order summary</h2>
              <dl className="mt-4 divide-y divide-dark-100 text-sm">
                <Row label="Subtotal" value={inr(totals.subtotalMinor)} />
                <Row label="Shipping" value={totals.shippingMinor > 0 ? inr(totals.shippingMinor) : <span className="font-semibold text-green-600">Free</span>} />
                <Row label="GST (18%)" value={inr(totals.taxMinor)} />
                <Row label="Discount" value={totals.discountMinor > 0 ? <span className="text-green-600">− {inr(totals.discountMinor)}</span> : inr(0)} />
                <Row
                  label={<span className="font-bold text-dark-900">Total</span>}
                  value={<span className="text-lg font-bold text-dark-900">{inr(totals.grandTotalMinor)}</span>}
                  className="pt-3"
                />
              </dl>

              <div className="mt-5 space-y-2">
                <Button size="lg" className="w-full" onClick={() => nav("/checkout/address")} disabled={hasUnavailable}>
                  Proceed to Checkout <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
                <ButtonLink to="/rfq" variant="outline" className="w-full" icon={FileText}>
                  Request quotation
                </ButtonLink>
                <ButtonLink to="/products" variant="ghost" className="w-full">
                  Continue shopping
                </ButtonLink>
              </div>
              {hasUnavailable && <p className="field-error mt-3 text-center">Remove unavailable items to continue.</p>}
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

function QuantityStepper({
  value,
  max,
  disabled,
  canIncrement,
  onDecrement,
  onIncrement,
  onChange,
}: {
  value: number;
  max?: number;
  disabled?: boolean;
  canIncrement: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
  onChange: (n: number) => void;
}) {
  return (
    <div className="inline-flex h-9 items-stretch overflow-hidden rounded-[8px] border border-dark-200 bg-white">
      <button
        type="button"
        onClick={onDecrement}
        disabled={disabled || value <= 1}
        className="flex w-9 items-center justify-center text-dark-700 transition-colors hover:bg-dark-50 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(+e.target.value)}
        aria-label="Quantity"
        className="w-12 border-x border-dark-200 bg-white text-center text-sm font-semibold tabular-nums text-dark-900 outline-none focus:bg-green-50 disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={onIncrement}
        disabled={disabled || !canIncrement}
        className="flex w-9 items-center justify-center text-dark-700 transition-colors hover:bg-dark-50 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** One line of an order summary (label left, amount right). Shared by cart + checkout. */
export function SummaryRow({ label, value, className = "" }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-3 py-2.5 first:pt-0", className)}>
      <dt className="text-dark-500">{label}</dt>
      <dd className="tabular-nums text-dark-800">{value}</dd>
    </div>
  );
}
const Row = SummaryRow;

// Shared checkout progress indicator: Cart → Address → Review → Payment → Done.
// Numbered 28px circles: done = green with a check, current = navy, upcoming =
// white with a hairline border. On phones only the current step keeps its label.
export function CheckoutSteps({ current, className = "" }: { current: number; className?: string }) {
  const steps = ["Cart", "Address", "Review", "Payment", "Confirmation"];
  return (
    <nav aria-label="Checkout progress" className={cx("mb-6", className)}>
      <ol className="flex items-center">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} className={cx("flex items-center", i < steps.length - 1 && "flex-1")}>
              <div className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
                <span
                  className={cx(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    done && "bg-green-500 text-white",
                    active && "bg-navy-900 text-white",
                    !done && !active && "border border-dark-200 bg-white text-dark-500",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                  {done && <span className="sr-only">{s} (completed)</span>}
                </span>
                <span
                  className={cx(
                    "whitespace-nowrap text-xs font-semibold",
                    active ? "text-dark-900" : done ? "text-green-600" : "text-dark-500",
                    !active && "hidden sm:inline",
                  )}
                >
                  {s}
                </span>
              </div>
              {i < steps.length - 1 && (
                <span className={cx("mx-2 h-px min-w-3 flex-1 sm:mx-3", done ? "bg-green-500" : "bg-dark-200")} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
