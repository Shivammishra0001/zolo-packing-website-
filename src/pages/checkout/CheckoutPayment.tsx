import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Banknote, Loader2, Lock } from "lucide-react";
import { useToast } from "../../components/ui/Toast";
import { CheckoutSteps } from "../CartPage";
import { hydrateCart, useCart } from "../../lib/cart-store";
import { orderApi, type Quote } from "../../lib/api/commerce";
import { useCheckout, clearCheckoutState } from "./checkout-context";

const inr = (m: number) => "₹" + Math.round(m / 100).toLocaleString("en-IN");

export default function CheckoutPayment() {
  const nav = useNavigate();
  const toast = useToast();
  const items = useCart();
  const { shippingAddressId, couponCode, paymentMethod, setPaymentMethod } = useCheckout();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [placing, setPlacing] = useState(false);

  // A stable idempotency key for THIS checkout attempt — a double-click or a
  // retry after a network blip never creates two orders.
  const idempotencyKey = useMemo(() => `co_${shippingAddressId ?? ""}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, [shippingAddressId]);

  useEffect(() => { if (!shippingAddressId) nav("/checkout/address", { replace: true }); }, [shippingAddressId, nav]);
  useEffect(() => { orderApi.quote(couponCode ?? null).then(setQuote).catch(() => {}); }, [couponCode]);

  const placeOrder = async () => {
    if (!shippingAddressId || placing) return;
    setPlacing(true);
    try {
      const order = await orderApi.place({
        shippingAddressId,
        couponCode: couponCode ?? null,
        paymentMethod,
        idempotencyKey,
      });
      clearCheckoutState();
      await hydrateCart(); // cart was cleared server-side
      nav(`/checkout/success/${order.id}`, { replace: true });
    } catch (err) {
      toast.error("Couldn't place order", err instanceof Error ? err.message : "Please try again.");
      setPlacing(false);
    }
  };

  if (items.length === 0 && !placing) {
    return <main className="py-20 text-center text-sm text-dark-500">Your cart is empty.</main>;
  }

  return (
    <main className="py-10">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <CheckoutSteps current={3} />
        <h1 className="font-display text-2xl font-extrabold text-dark-900">Payment</h1>
        <p className="mt-0.5 text-sm text-dark-500">Choose how you'd like to pay.</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            {/* COD (only supported method right now) */}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-primary-500 bg-white p-4 ring-1 ring-primary-200">
              <input type="radio" name="pay" checked={paymentMethod === "cod"} onChange={() => setPaymentMethod("cod")} className="mt-1 accent-primary-600" />
              <div>
                <span className="flex items-center gap-2 font-bold text-dark-900"><Banknote className="h-4 w-4 text-primary-600" /> Cash on Delivery</span>
                <p className="text-sm text-dark-500">Pay in cash when your order is delivered.</p>
              </div>
            </label>
            <div className="rounded-2xl border border-dashed border-dark-200 p-4 text-sm text-dark-400">
              Online payment (UPI / Card / Net Banking) is coming soon.
            </div>
          </div>

          {/* Summary */}
          <aside className="h-fit rounded-2xl border border-dark-100 bg-white p-5 lg:sticky lg:top-20">
            <h2 className="font-bold text-dark-900">Order total</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Subtotal" value={inr(quote?.subtotalMinor ?? 0)} />
              {quote && quote.discountMinor > 0 && <Row label="Discount" value={`− ${inr(quote.discountMinor)}`} />}
              <Row label="GST (18%)" value={inr(quote?.taxMinor ?? 0)} />
              <Row label="Shipping" value={quote && quote.shippingMinor > 0 ? inr(quote.shippingMinor) : "Free"} />
              <div className="border-t border-dark-100 pt-2">
                <Row label={<span className="font-bold text-dark-900">Total payable</span>} value={<span className="font-extrabold text-dark-900">{inr(quote?.grandTotalMinor ?? 0)}</span>} />
              </div>
            </dl>
            <button onClick={placeOrder} disabled={placing} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 py-3 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-60">
              {placing ? <><Loader2 className="h-4 w-4 animate-spin" /> Placing order…</> : <>Place order (COD)</>}
            </button>
            <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-dark-400"><Lock className="h-3 w-3" /> Amount confirmed by the server.</p>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex items-center justify-between"><dt className="text-dark-500">{label}</dt><dd className="tabular-nums text-dark-800">{value}</dd></div>;
}
