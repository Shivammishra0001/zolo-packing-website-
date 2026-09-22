import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, CheckCircle2, Download, MapPin, Package, QrCode, Truck } from "lucide-react";
import { Breadcrumb, ButtonLink, EmptyState } from "../../components/UI";
import { CheckoutSteps } from "../CartPage";
import { orderApi, type Order } from "../../lib/api/commerce";
import { paymentRequestsApi, type PaymentRequest } from "../../lib/api/settings";

const inr = (m: number) => "₹" + Math.round(m / 100).toLocaleString("en-IN");
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function CheckoutSuccess() {
  const { orderId } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [payReq, setPayReq] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (orderId) orderApi.get(orderId).then(setOrder).catch(() => setError(true));
  }, [orderId]);
  // UPI / bank-transfer orders have a payment link waiting for the customer.
  useEffect(() => {
    if (!order || order.paymentStatus === "PAID" || !["upi", "bank_transfer"].includes(order.paymentMethod)) return;
    paymentRequestsApi.mine(order.id).then((r) => setPayReq(r.requests.find((x) => x.status === "SENT" || x.status === "PENDING" || x.status === "SUBMITTED") ?? null)).catch(() => {});
  }, [order]);

  // Estimated delivery: +7 days from placement (display only).
  const eta = order ? new Date(new Date(order.placedAt).getTime() + 7 * 86400000).toISOString() : null;

  const crumbs = [{ label: "Home", to: "/" }, { label: "Checkout" }, { label: "Confirmation" }];

  if (error) {
    return (
      <main className="section-sm">
        <div className="shell">
          <div className="mx-auto max-w-xl">
            <Breadcrumb items={crumbs} />
            <EmptyState
              className="mt-4"
              icon={Package}
              title="We couldn't load that order"
              message="It may still be in your orders list."
              action={<ButtonLink to="/account/orders" variant="outline">View my orders</ButtonLink>}
            />
          </div>
        </div>
      </main>
    );
  }
  if (!order) {
    return (
      <main className="section-sm">
        <div className="shell">
          <div>
            <Breadcrumb items={crumbs} />
            <CheckoutSteps current={4} className="mt-4" />
            <div className="mx-auto max-w-xl space-y-4" aria-busy="true" aria-label="Loading your confirmation">
              <div className="skeleton h-56" />
              <div className="skeleton h-24" />
              <div className="skeleton h-24" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  const paidNow = order.paymentStatus === "PAID";
  const awaitingPayment = Boolean(payReq) && payReq?.status !== "SUBMITTED";
  const nextSteps: { title: string; body: string }[] = [
    awaitingPayment
      ? { title: "Complete your payment", body: `Use the secure link below to pay ${inr(payReq?.amountMinor ?? order.grandTotalMinor)} and share the reference.` }
      : { title: "Order confirmed", body: paidNow ? "Payment received. We've emailed you the confirmation." : "We've received your order and sent a confirmation to your email." },
    { title: "We pack it with care", body: "Our team prepares your items and updates you when they ship." },
    { title: `Delivery by ${eta ? fmtDate(eta) : "—"}`, body: `Shipping to ${order.shippingAddress.name}, ${order.shippingAddress.city}.` },
  ];

  return (
    <main className="section-sm">
      <div className="shell">
        <div>
          <Breadcrumb items={crumbs} />
          <CheckoutSteps current={4} className="mt-4" />

          <div className="mx-auto max-w-xl space-y-4">
            {/* Confirmation */}
            <section className="card p-6 text-center sm:p-8">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                <Check className="h-8 w-8" strokeWidth={3} aria-hidden />
              </span>
              <h1 className="h2 mt-4 text-dark-900">Order placed</h1>
              <p className="mt-2 text-sm text-dark-600">Thank you! Your order number is</p>
              <p className="mt-1 font-mono text-lg font-bold text-dark-900">{order.orderNumber}</p>

              <dl className="mt-6 grid gap-3 text-left sm:grid-cols-3">
                <Info icon={Truck} label="Estimated delivery" value={eta ? fmtDate(eta) : "—"} />
                <Info icon={MapPin} label="Delivery to" value={`${order.shippingAddress.name}, ${order.shippingAddress.city}`} />
                <Info icon={CheckCircle2} label="Payment" value={`${order.paymentMethod.replace(/_/g, " ").toUpperCase()} · ${order.paymentStatus}`} />
              </dl>

              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <ButtonLink to={`/account/orders/${order.id}`} className="w-full sm:w-auto">Track order</ButtonLink>
                <ButtonLink to="/products" variant="outline" className="w-full sm:w-auto">Continue shopping</ButtonLink>
              </div>
            </section>

            {/* Pay now (UPI / bank transfer) */}
            {payReq && (
              <section className="card border-green-200 bg-green-50 p-5 sm:p-6">
                <h2 className="flex items-center gap-2 text-base font-bold text-dark-900">
                  <QrCode className="h-5 w-5 text-green-600" aria-hidden /> Complete your payment
                </h2>
                <p className="mt-1.5 text-sm text-dark-600">
                  {payReq.status === "SUBMITTED"
                    ? "We've received your payment details and are verifying them — you'll be notified once confirmed."
                    : <>Pay <b className="text-dark-900">{inr(payReq.amountMinor)}</b> via {order.paymentMethod === "upi" ? "UPI / QR" : "bank transfer"} using your secure payment link, then share the transaction reference. Your order is confirmed once we verify it. The link was also sent to you by email / WhatsApp.</>}
                </p>
                {payReq.payUrl && payReq.status !== "SUBMITTED" && (
                  <a href={payReq.payUrl.replace(/^https?:\/\/[^/]+/, "")} className="btn btn-green mt-4 w-full sm:w-auto">Pay now</a>
                )}
              </section>
            )}

            {/* What happens next */}
            <section className="card p-5 sm:p-6">
              <h2 className="h3 text-dark-900">What happens next</h2>
              <ol className="mt-4 space-y-4">
                {nextSteps.map((s, i) => (
                  <li key={s.title} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-600">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-dark-900">{s.title}</p>
                      <p className="mt-0.5 text-sm text-dark-500">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* Items */}
            <section className="card p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="h3 text-dark-900">Items</h2>
                <Link to={`/account/orders/${order.id}/invoice`} className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline">
                  <Download className="h-3.5 w-3.5" aria-hidden /> Invoice
                </Link>
              </div>
              <ul className="mt-3 divide-y divide-dark-100">
                {order.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 text-dark-700">{it.productName} <span className="text-dark-500">× {it.quantity}</span></span>
                    <span className="shrink-0 font-semibold tabular-nums text-dark-900">{inr(it.lineTotalMinor)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-dark-100 pt-3">
                <span className="font-bold text-dark-900">{paidNow ? "Total paid" : "Total payable"}</span>
                <span className="text-lg font-bold tabular-nums text-dark-900">{inr(order.grandTotalMinor)}</span>
              </div>
            </section>

            <p className="text-center text-xs text-dark-500">
              <Link to="/account/orders" className="font-semibold text-green-600 hover:underline">View all orders</Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="card-flat flex items-start gap-2.5 p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden />
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-dark-500">{label}</dt>
        <dd className="truncate text-sm font-semibold text-dark-900">{value}</dd>
      </div>
    </div>
  );
}
