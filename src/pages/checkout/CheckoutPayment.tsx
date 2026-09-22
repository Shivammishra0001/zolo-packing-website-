import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Banknote, Building2, FileText, Loader2, Lock, QrCode, ShoppingCart } from "lucide-react";
import { useToast } from "../../components/ui/Toast";
import { Breadcrumb, Button, ButtonLink, EmptyState, cx } from "../../components/UI";
import { CheckoutSteps, SummaryRow } from "../CartPage";
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
  const loadMethods = () => {
    setMethodsError(null);
    checkoutMethodsApi.list()
      .then((r) => {
        setMethods(r.methods);
        if (r.methods.length && !r.methods.some((m) => m.key === paymentMethod)) setPaymentMethod(r.methods[0].key as CheckoutPaymentMethod);
      })
      .catch((e) => setMethodsError(e instanceof Error ? e.message : "Could not load payment methods."));
  };
  useEffect(() => {
    loadMethods();
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
          <CheckoutSteps current={3} className="mt-4" />

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* Methods */}
            <section className="card p-5 sm:p-6">
              <h1 className="h3 text-dark-900">Payment</h1>
              <p className="mt-1 text-sm text-dark-500">Choose how you'd like to pay.</p>

              <div className="mt-5 space-y-3">
                {methodsError && (
                  <div className="rounded-[12px] border border-red-200 bg-red-50 p-4" role="alert">
                    <p className="text-sm font-semibold text-red-700">We couldn't load the payment methods.</p>
                    <p className="mt-0.5 text-xs text-red-700/80">Check your connection and try again.</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={loadMethods}>Try again</Button>
                  </div>
                )}
                {methods === null && !methodsError && (
                  <div className="space-y-3" aria-busy="true" aria-label="Loading payment methods">
                    <div className="skeleton h-20" />
                    <div className="skeleton h-20" />
                  </div>
                )}
                {methods?.length === 0 && (
                  <div className="rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    No payment method is available right now. Please contact us to complete your order.
                  </div>
                )}
                {methods?.map((m) => {
                  const Icon = ICON[m.key] ?? Banknote;
                  const active = paymentMethod === m.key;
                  return (
                    <label
                      key={m.key}
                      className={cx(
                        "card-flat flex cursor-pointer items-start gap-3 p-4 transition-colors",
                        active ? "border-green-500 bg-green-50 ring-2 ring-green-200" : "hover:border-dark-300",
                      )}
                    >
                      <input
                        type="radio"
                        name="pay"
                        checked={active}
                        onChange={() => setPaymentMethod(m.key as CheckoutPaymentMethod)}
                        className="mt-1 h-4 w-4 shrink-0 accent-green-600"
                      />
                      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", active ? "bg-green-100 text-green-600" : "bg-dark-100 text-dark-600")}>
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block font-semibold text-dark-900">{m.displayName}</span>
                        <p className="mt-0.5 text-sm text-dark-500">{m.description}</p>
                        {m.key === "cod" && (m.config.codChargeMinor ?? 0) > 0 && <p className="mt-1 text-xs text-dark-500">COD charge: {inr(m.config.codChargeMinor ?? 0)}</p>}
                        {m.key === "cod" && (m.config.minOrderMinor != null || m.config.maxOrderMinor != null) && (
                          <p className="mt-0.5 text-xs text-dark-500">
                            Available for orders {m.config.minOrderMinor != null ? `from ${inr(m.config.minOrderMinor)}` : ""}{m.config.minOrderMinor != null && m.config.maxOrderMinor != null ? " " : ""}{m.config.maxOrderMinor != null ? `up to ${inr(m.config.maxOrderMinor)}` : ""}
                          </p>
                        )}
                        {active && m.key === "upi" && (
                          <div className="card-flat mt-3 flex flex-wrap items-center gap-3 bg-cream-50 p-3 text-xs text-dark-600">
                            {m.config.qrUrl && <img src={m.config.qrUrl} alt="UPI QR code" className="h-24 w-24 rounded-[8px] bg-white object-contain p-0.5" />}
                            <div className="min-w-0 flex-1">
                              {m.config.upiId && <p>UPI ID: <span className="font-mono font-bold text-dark-900">{m.config.upiId}</span></p>}
                              <p className="mt-1">After placing the order you'll get a secure link to pay the exact amount and share your UPI transaction ID. Your order is confirmed once we verify it.</p>
                            </div>
                          </div>
                        )}
                        {active && m.key === "bank_transfer" && (
                          <p className="card-flat mt-3 bg-cream-50 p-3 text-xs text-dark-600">Bank details and a secure link to share your UTR are sent after you place the order.</p>
                        )}
                        {active && quote?.paymentError && <p className="field-error rounded-[8px] bg-red-50 px-3 py-2">{quote.paymentError}</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>

            {/* Summary */}
            <aside className="card h-fit p-5 lg:sticky lg:top-24">
              <h2 className="h3 text-dark-900">Order summary</h2>
              <p className="mt-1 text-xs text-dark-500">{items.length} item{items.length === 1 ? "" : "s"} · {unitCount} unit{unitCount === 1 ? "" : "s"}</p>
              <dl className="mt-4 divide-y divide-dark-100 text-sm">
                <SummaryRow label="Subtotal" value={inr(quote?.subtotalMinor ?? 0)} />
                <SummaryRow label="Shipping" value={quote && quote.shippingMinor > 0 ? inr(quote.shippingMinor) : <span className="font-semibold text-green-600">Free</span>} />
                <SummaryRow label="GST (18%)" value={inr(quote?.taxMinor ?? 0)} />
                {quote && quote.discountMinor > 0 && <SummaryRow label="Discount" value={<span className="text-green-600">− {inr(quote.discountMinor)}</span>} />}
                {quote && quote.codChargeMinor > 0 && <SummaryRow label="COD charge" value={inr(quote.codChargeMinor)} />}
                <SummaryRow
                  label={<span className="font-bold text-dark-900">Total payable</span>}
                  value={<span className="text-lg font-bold text-dark-900">{inr(quote?.grandTotalMinor ?? 0)}</span>}
                  className="pt-3"
                />
              </dl>
              <Button size="lg" className="mt-5 w-full" onClick={placeOrder} disabled={placing || blocked}>
                {placing
                  ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Placing order…</>
                  : <>Place order{selected ? ` (${selected.key === "cod" ? "COD" : selected.displayName})` : ""}</>}
              </Button>
              <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-dark-500"><Lock className="h-3 w-3" aria-hidden /> Amount confirmed by the server.</p>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
