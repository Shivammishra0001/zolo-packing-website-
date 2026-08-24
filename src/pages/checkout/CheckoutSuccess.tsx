import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Download, MapPin, Package, Truck } from "lucide-react";
import { CheckoutSteps } from "../CartPage";
import { orderApi, type Order } from "../../lib/api/commerce";

const inr = (m: number) => "₹" + Math.round(m / 100).toLocaleString("en-IN");
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function CheckoutSuccess() {
  const { orderId } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (orderId) orderApi.get(orderId).then(setOrder).catch(() => setError(true));
  }, [orderId]);

  // Estimated delivery: +7 days from placement (display only).
  const eta = order ? new Date(new Date(order.placedAt).getTime() + 7 * 86400000).toISOString() : null;

  if (error) {
    return <main className="py-20 text-center"><p className="text-dark-500">We couldn't load that order.</p><Link to="/account/orders" className="mt-3 inline-block font-bold text-primary-600">View my orders</Link></main>;
  }
  if (!order) return <main className="py-20 text-center text-sm text-dark-400">Loading your confirmation…</main>;

  return (
    <main className="py-10">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <CheckoutSteps current={4} />

        <div className="rounded-2xl border border-green-100 bg-green-50 p-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
          <h1 className="mt-3 font-display text-2xl font-extrabold text-dark-900">Order placed successfully</h1>
          <p className="mt-1 text-sm text-dark-600">Thank you! Your order <span className="font-bold">{order.orderNumber}</span> has been placed.</p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Info icon={Package} label="Order ID" value={order.orderNumber} />
          <Info icon={Truck} label="Estimated delivery" value={eta ? fmtDate(eta) : "—"} />
          <Info icon={MapPin} label="Delivery to" value={`${order.shippingAddress.name}, ${order.shippingAddress.city}`} />
          <Info icon={CheckCircle2} label="Payment" value={`${order.paymentMethod.toUpperCase()} · ${order.paymentStatus}`} />
        </div>

        {/* Items */}
        <section className="mt-5 rounded-2xl border border-dark-100 bg-white p-5">
          <h2 className="font-bold text-dark-900">Items</h2>
          <div className="mt-3 divide-y divide-dark-100">
            {order.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-dark-700">{it.productName} × {it.quantity}</span>
                <span className="font-semibold text-dark-900">{inr(it.lineTotalMinor)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-dark-100 pt-3">
            <span className="font-bold text-dark-900">Total paid</span>
            <span className="font-extrabold text-dark-900">{inr(order.grandTotalMinor)}</span>
          </div>
        </section>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to={`/account/orders/${order.id}`} className="inline-flex items-center gap-2 rounded-xl bg-dark-900 px-5 py-3 text-sm font-bold text-white hover:bg-dark-800">
            View order
          </Link>
          <Link to={`/account/orders/${order.id}/invoice`} className="inline-flex items-center gap-2 rounded-xl border border-dark-200 px-5 py-3 text-sm font-bold text-dark-800 hover:bg-dark-50">
            <Download className="h-4 w-4" /> Invoice
          </Link>
          <Link to="/account/orders" className="inline-flex items-center gap-2 rounded-xl border border-dark-200 px-5 py-3 text-sm font-bold text-dark-800 hover:bg-dark-50">
            Track order
          </Link>
          <Link to="/products" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-primary-600 hover:bg-primary-50">
            Continue shopping
          </Link>
        </div>
      </div>
    </main>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-dark-100 bg-white p-4">
      <Icon className="mt-0.5 h-5 w-5 text-primary-600" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-dark-400">{label}</p>
        <p className="truncate font-semibold text-dark-900">{value}</p>
      </div>
    </div>
  );
}
