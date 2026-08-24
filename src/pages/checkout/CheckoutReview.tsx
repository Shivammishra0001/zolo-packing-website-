import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Tag, X } from "lucide-react";
import { useToast } from "../../components/ui/Toast";
import { CheckoutSteps } from "../CartPage";
import { useCart } from "../../lib/cart-store";
import { addressApi, orderApi, type Address, type Quote } from "../../lib/api/commerce";
import { useCheckout } from "./checkout-context";

const inr = (m: number) => "₹" + Math.round(m / 100).toLocaleString("en-IN");

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
    return <main className="py-20 text-center"><p className="text-dark-500">Your cart is empty.</p><Link to="/products" className="mt-3 inline-block font-bold text-primary-600">Browse products</Link></main>;
  }

  return (
    <main className="py-10">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <CheckoutSteps current={2} />
        <h1 className="font-display text-2xl font-extrabold text-dark-900">Review your order</h1>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            {/* Address */}
            <section className="rounded-2xl border border-dark-100 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-dark-900">Delivery address</h2>
                <Link to="/checkout/address" className="text-xs font-bold text-primary-600 hover:underline">Change</Link>
              </div>
              {address ? (
                <div className="mt-2 text-sm text-dark-600">
                  <p className="font-semibold text-dark-900">{address.name}</p>
                  <p>{address.line1}{address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state} — {address.postalCode}</p>
                  <p className="text-xs text-dark-400">☎ {address.phone}</p>
                </div>
              ) : <p className="mt-2 text-sm text-dark-400">Loading…</p>}
            </section>

            {/* Products */}
            <section className="rounded-2xl border border-dark-100 bg-white p-5">
              <h2 className="font-bold text-dark-900">Products</h2>
              <div className="mt-3 divide-y divide-dark-100">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-dark-50 text-xl">{/^(blob:|data:|https?:|\/)/.test(it.image) ? <img src={it.image} alt="" className="h-full w-full rounded-lg object-cover" /> : it.image}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-dark-900">{it.name}</p>
                      <p className="text-xs text-dark-400">{it.variant ? `${it.variant} · ` : ""}Qty {it.quantity}</p>
                    </div>
                    <span className="text-sm font-bold text-dark-900">{inr(it.unitPriceMinor * it.quantity)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Price details + coupon */}
          <aside className="h-fit space-y-4 lg:sticky lg:top-20">
            <section className="rounded-2xl border border-dark-100 bg-white p-5">
              <h2 className="font-bold text-dark-900">Coupon</h2>
              {quote?.couponCode ? (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-primary-50 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-700"><Tag className="h-3.5 w-3.5" /> {quote.couponCode}</span>
                  <button onClick={removeCoupon} className="text-primary-600 hover:text-primary-800"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Coupon code" className="flex-1 rounded-lg border border-dark-200 px-3 py-2 text-sm uppercase outline-none focus:border-primary-400" />
                  <button onClick={applyCoupon} disabled={applying} className="rounded-lg bg-dark-900 px-4 py-2 text-sm font-bold text-white hover:bg-dark-800 disabled:opacity-60">{applying ? "…" : "Apply"}</button>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-dark-100 bg-white p-5">
              <h2 className="font-bold text-dark-900">Price details</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Subtotal" value={inr(quote?.subtotalMinor ?? 0)} />
                <Row label="Discount" value={quote && quote.discountMinor > 0 ? `− ${inr(quote.discountMinor)}` : inr(0)} />
                <Row label="GST (18%)" value={inr(quote?.taxMinor ?? 0)} />
                <Row label="Shipping" value={quote && quote.shippingMinor > 0 ? inr(quote.shippingMinor) : "Free"} />
                <div className="border-t border-dark-100 pt-2">
                  <Row label={<span className="font-bold text-dark-900">Total payable</span>} value={<span className="font-extrabold text-dark-900">{inr(quote?.grandTotalMinor ?? 0)}</span>} />
                </div>
              </dl>
              <button onClick={() => nav("/checkout/payment")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 py-3 text-sm font-bold text-white hover:bg-primary-600">
                Continue to Payment <ArrowRight className="h-4 w-4" />
              </button>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex items-center justify-between"><dt className="text-dark-500">{label}</dt><dd className="tabular-nums text-dark-800">{value}</dd></div>;
}
