import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Banknote, Building2, FileText, Loader2, Lock, QrCode } from "lucide-react";
import { useToast } from "../../components/ui/Toast";
import { CheckoutSteps } from "../CartPage";
import { hydrateCart, useCart } from "../../lib/cart-store";
import { orderApi, type CheckoutPaymentMethod, type Quote } from "../../lib/api/commerce";
import { checkoutMethodsApi, type PublicPaymentMethod } from "../../lib/api/settings";
import { useCheckout, clearCheckoutState } from "./checkout-context";

const inr = (m: number) => "₹" + Math.round(m / 100).toLocaleString("en-IN");
const ICON: Record<string, typeof Banknote> = { cod: Banknote, upi: QrCode, bank_transfer: Building2, neft: Building2, cheque: FileText };

export default function CheckoutPayment() {
  const nav = useNavigate();
  const toast = useToast();
  const items = useCart();
  const { shippingAddressId, couponCode, paymentMethod, setPaymentMethod } = useCheckout();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [methods, setMethods] = useState<PublicPaymentMethod[] | null>(null);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  // A stable idempotency key for THIS checkout attempt — a double-click or a
  // retry after a network blip never creates two orders.
  const idempotencyKey = useMemo(() => `co_${shippingAddressId ?? ""}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, [shippingAddressId]);

  useEffect(() => { if (!shippingAddressId) nav("/checkout/address", { replace: true }); }, [shippingAddressId, nav]);

  // Methods come from the admin's Payment Settings (enabled ones only). If the
  // remembered choice is no longer offered, fall back to the first available.
  useEffect(() => {
    checkoutMethodsApi.list()
      .then((r) => {
        setMethods(r.methods);
        if (r.methods.length && !r.methods.some((m) => m.key === paymentMethod)) setPaymentMethod(r.methods[0].key as CheckoutPaymentMethod);
      })
      .catch((e) => setMethodsError(e instanceof Error ? e.message : "Could not load payment methods."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-quote when the method changes so the COD charge (or a limit error) shows.
  useEffect(() => { orderApi.quote(couponCode ?? null, paymentMethod).then(setQuote).catch(() => {}); }, [couponCode, paymentMethod]);

  const selected = methods?.find((m) => m.key === paymentMethod) ?? null;
  const blocked = Boolean(quote?.paymentError) || !selected;

  const placeOrder = async () => {
    if (!shippingAddressId || placing || blocked) return;
    setPlacing(true);
    try {
      // Attach the customer's default BILLING address when they have one, so the
      // order's frozen billing snapshot is their real billing details rather
      // than a copy of the shipping address.
      let billingAddressId: string | null = null;
      try {
        const { addressApi } = await import("../../lib/api/commerce");
        const list = await addressApi.list();
        billingAddressId = list.find((a) => a.kind === "billing" && a.isDefault)?.id ?? null;
      } catch { /* fall back to shipping-as-billing server-side */ }
      const order = await orderApi.place({
        shippingAddressId,
        billingAddressId,
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
            {methodsError && <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{methodsError}</div>}
            {methods === null && !methodsError && <div className="rounded-2xl border border-dark-100 p-4 text-sm text-dark-400">Loading payment methods…</div>}
            {methods?.length === 0 && (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">No payment method is available right now. Please contact us to complete your order.</div>
            )}
            {methods?.map((m) => {
              const Icon = ICON[m.key] ?? Banknote;
              const active = paymentMethod === m.key;
              return (
                <label key={m.key} className={`flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4 ${active ? "border-primary-500 ring-1 ring-primary-200" : "border-dark-200 hover:border-dark-300"}`}>
                  <input type="radio" name="pay" checked={active} onChange={() => setPaymentMethod(m.key as CheckoutPaymentMethod)} className="mt-1 accent-primary-600" />
                  <div className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-bold text-dark-900"><Icon className="h-4 w-4 text-primary-600" /> {m.displayName}</span>
                    <p className="text-sm text-dark-500">{m.description}</p>
                    {m.key === "cod" && (m.config.codChargeMinor ?? 0) > 0 && <p className="mt-0.5 text-xs text-dark-500">COD charge: {inr(m.config.codChargeMinor ?? 0)}</p>}
                    {m.key === "cod" && (m.config.minOrderMinor != null || m.config.maxOrderMinor != null) && (
                      <p className="mt-0.5 text-xs text-dark-400">
                        Available for orders {m.config.minOrderMinor != null ? `from ${inr(m.config.minOrderMinor)}` : ""}{m.config.minOrderMinor != null && m.config.maxOrderMinor != null ? " " : ""}{m.config.maxOrderMinor != null ? `up to ${inr(m.config.maxOrderMinor)}` : ""}
                      </p>
                    )}
                    {active && m.key === "upi" && (
                      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-dark-50 p-3 text-xs text-dark-600">
                        {m.config.qrUrl && <img src={m.config.qrUrl} alt="UPI QR code" className="h-24 w-24 rounded-md bg-white object-contain p-0.5" />}
                        <div>
                          {m.config.upiId && <p>UPI ID: <span className="font-mono font-bold text-dark-900">{m.config.upiId}</span></p>}
                          <p className="mt-1">After placing the order you'll get a secure link to pay the exact amount and share your UPI transaction ID. Your order is confirmed once we verify it.</p>
                        </div>
                      </div>
                    )}
                    {active && m.key === "bank_transfer" && (
                      <p className="mt-2 rounded-xl bg-dark-50 p-3 text-xs text-dark-600">Bank details and a secure link to share your UTR are sent after you place the order.</p>
                    )}
                    {active && quote?.paymentError && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{quote.paymentError}</p>}
                  </div>
                </label>
              );
            })}
          </div>

          {/* Summary */}
          <aside className="h-fit rounded-2xl border border-dark-100 bg-white p-5 lg:sticky lg:top-20">
            <h2 className="font-bold text-dark-900">Order total</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Subtotal" value={inr(quote?.subtotalMinor ?? 0)} />
              {quote && quote.discountMinor > 0 && <Row label="Discount" value={`− ${inr(quote.discountMinor)}`} />}
              <Row label="GST (18%)" value={inr(quote?.taxMinor ?? 0)} />
              <Row label="Shipping" value={quote && quote.shippingMinor > 0 ? inr(quote.shippingMinor) : "Free"} />
              {quote && quote.codChargeMinor > 0 && <Row label="COD charge" value={inr(quote.codChargeMinor)} />}
              <div className="border-t border-dark-100 pt-2">
                <Row label={<span className="font-bold text-dark-900">Total payable</span>} value={<span className="font-extrabold text-dark-900">{inr(quote?.grandTotalMinor ?? 0)}</span>} />
              </div>
            </dl>
            <button onClick={placeOrder} disabled={placing || blocked} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 py-3 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-60">
              {placing ? <><Loader2 className="h-4 w-4 animate-spin" /> Placing order…</> : <>Place order{selected ? ` (${selected.key === "cod" ? "COD" : selected.displayName})` : ""}</>}
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
