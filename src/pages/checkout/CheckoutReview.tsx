import { CampaignStrip } from "@/components/marketing/campaigns";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, MapPin, Phone, ShoppingCart, Tag, X } from "lucide-react";
import { useToast } from "../../components/ui/Toast";
import { Breadcrumb, Button, ButtonLink, EmptyState, Input } from "../../components/UI";
import { CheckoutSteps, SummaryRow } from "../CartPage";
import { useCart } from "../../lib/cart-store";
import { addressApi, orderApi, type Address, type Quote } from "../../lib/api/commerce";
import { useCheckout } from "./checkout-context";

const inr = (m: number) => "₹" + Math.round(m / 100).toLocaleString("en-IN");
const isImageUrl = (s: string) => /^(blob:|data:|https?:|\/)/.test(s);

export default function CheckoutReview() {
  const nav = useNavigate();
  const toast = useToast();
  const items = useCart();
  const { shippingAddressId, couponCode, setCouponCode } = useCheckout();
  const [address, setAddress] = useState<Address | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [couponInput, setCouponInput] = useState(couponCode ?? "");
  const [applying, setApplying] = useState(false);

  // No address selected → back to the address step.
  useEffect(() => { if (!shippingAddressId) nav("/checkout/address", { replace: true }); }, [shippingAddressId, nav]);

  // Load the chosen address + the server quote (with any applied coupon).
  useEffect(() => {
    if (shippingAddressId) addressApi.list().then((list) => setAddress(list.find((a) => a.id === shippingAddressId) ?? null));
  }, [shippingAddressId]);

  const refreshQuote = (code?: string | null) =>
    orderApi.quote(code ?? null).then((q) => {
      setQuote(q);
      if (q.couponError) toast.error("Coupon not applied", q.couponError);
    }).catch(() => {});

  useEffect(() => { refreshQuote(couponCode); /* eslint-disable-next-line */ }, []);

  const applyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setApplying(true);
    try {
      const q = await orderApi.quote(code);
      setQuote(q);
      if (q.couponCode) { setCouponCode(q.couponCode); toast.success("Coupon applied", `${q.couponCode} — ${inr(q.discountMinor)} off`); }
      else { setCouponCode(null); toast.error("Coupon not applied", q.couponError ?? "Invalid coupon"); }
    } finally { setApplying(false); }
  };

  const removeCoupon = async () => {
    setCouponCode(null); setCouponInput("");
    await refreshQuote(null);
  };

  if (items.length === 0) {
    return (
      <main className="section-sm">
        <div className="shell">
          <div>
            <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Cart", to: "/cart" }, { label: "Checkout" }]} />
            <EmptyState
              className="mt-4"
              icon={ShoppingCart}
              title="Your cart is empty"
              message="Add products to your cart before checking out."
              action={<ButtonLink to="/products" icon={ArrowRight}>Browse products</ButtonLink>}
            />
          </div>
        </div>
      </main>
    );
  }

  const unitCount = items.reduce((s, it) => s + it.quantity, 0);

  return (
    <main className="section-sm">
      <div className="shell">
        <div>
          <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Cart", to: "/cart" }, { label: "Checkout" }]} />
          <CheckoutSteps current={2} className="mt-4" />
          {/* Admin-managed promotion (Marketing → Campaigns → Checkout). */}
          <CampaignStrip placement="checkout" className="mb-6" />

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              {/* Address */}
              <section className="card p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="h3 text-dark-900">Review your order</h1>
                    <p className="mt-1 text-sm text-dark-500">Check the delivery address and items before paying.</p>
                  </div>
                </div>

                <div className="card-flat mt-5 flex items-start gap-3 border-green-200 bg-green-50 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
                    <MapPin className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-bold text-dark-900">Delivery address</h2>
                      <Link to="/checkout/address" className="text-xs font-semibold text-green-600 hover:underline">Change</Link>
                    </div>
                    {address ? (
                      <div className="mt-1 text-sm text-dark-600">
                        <p className="font-semibold text-dark-900">{address.name}</p>
                        <p>{address.line1}{address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state} — {address.postalCode}</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-xs text-dark-500"><Phone className="h-3 w-3" aria-hidden /> {address.phone}</p>
                      </div>
                    ) : (
                      <div className="mt-2 space-y-2" aria-busy="true">
                        <div className="skeleton h-3 w-1/3" />
                        <div className="skeleton h-3 w-2/3" />
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Products */}
              <section className="card p-5 sm:p-6">
                <h2 className="h3 text-dark-900">Items</h2>
                <p className="mt-1 text-sm text-dark-500">{items.length} item{items.length === 1 ? "" : "s"} · {unitCount} unit{unitCount === 1 ? "" : "s"}</p>
                <ul className="mt-4 divide-y divide-dark-100">
                  {items.map((it) => (
                    <li key={it.id} className="flex items-center gap-3 py-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-green-50 text-xl">
                        {isImageUrl(it.image) ? <img src={it.image} alt="" className="h-full w-full object-contain p-0.5" /> : it.image}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm font-semibold leading-snug text-dark-900">{it.name}</p>
                        <p className="text-xs text-dark-500">{it.variant ? `${it.variant} · ` : ""}Qty {it.quantity} × {inr(it.unitPriceMinor)}</p>
                      </div>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-dark-900">{inr(it.unitPriceMinor * it.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <Link to="/cart" className="mt-2 inline-block text-xs font-semibold text-green-600 hover:underline">Edit cart</Link>
              </section>
            </div>

            {/* Summary + coupon */}
            <aside className="card h-fit p-5 lg:sticky lg:top-24">
              <h2 className="h3 text-dark-900">Order summary</h2>

              {/* Coupon */}
              <div className="mt-4">
                {quote?.couponCode ? (
                  <div className="flex items-center justify-between gap-2 rounded-[8px] border border-green-200 bg-green-50 px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-green-700"><Tag className="h-3.5 w-3.5" aria-hidden /> {quote.couponCode}</span>
                    <button type="button" onClick={removeCoupon} className="btn btn-ghost btn-sm h-8 w-8 px-0 text-green-700" aria-label="Remove coupon">
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ) : (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => { e.preventDefault(); void applyCoupon(); }}
                  >
                    <Input
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Coupon code"
                      aria-label="Coupon code"
                      className="min-w-0 flex-1 uppercase"
                      autoCapitalize="characters"
                    />
                    <Button type="submit" variant="outline" disabled={applying || !couponInput.trim()} className="shrink-0">
                      {applying ? "…" : "Apply"}
                    </Button>
                  </form>
                )}
              </div>

              <dl className="mt-4 divide-y divide-dark-100 border-t border-dark-100 pt-3 text-sm">
                <SummaryRow label="Subtotal" value={inr(quote?.subtotalMinor ?? 0)} />
                <SummaryRow label="Shipping" value={quote && quote.shippingMinor > 0 ? inr(quote.shippingMinor) : <span className="font-semibold text-green-600">Free</span>} />
                <SummaryRow label="GST (18%)" value={inr(quote?.taxMinor ?? 0)} />
                <SummaryRow label="Discount" value={quote && quote.discountMinor > 0 ? <span className="text-green-600">− {inr(quote.discountMinor)}</span> : inr(0)} />
                <SummaryRow
                  label={<span className="font-bold text-dark-900">Total payable</span>}
                  value={<span className="text-lg font-bold text-dark-900">{inr(quote?.grandTotalMinor ?? 0)}</span>}
                  className="pt-3"
                />
              </dl>
              <Button size="lg" className="mt-5 w-full" onClick={() => nav("/checkout/payment")}>
                Continue to Payment <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
