// Buyer dashboard — every figure comes from GET /me/dashboard, scoped
// server-side to the signed-in buyer. No client-side filtering, no placeholder
// records: an empty account renders empty states and a failure renders an error.
import { Link } from "react-router-dom";
import { CreditCard, IndianRupee, MapPin, Package, ShoppingBag, Truck } from "lucide-react";
import { Badge, PageHeader } from "@/admin/components/ui";
import { Panel, EmptyState } from "@/admin/components/Panel";
import { MetricCard, MetricCardSkeleton } from "@/admin/components/MetricCard";
import { inrMinor, formatDate } from "@/admin/format";
import { statusTone, paymentTone, prettyStatus } from "@/lib/order-status";
import { buyerApi } from "@/lib/api/commerce";
import { useBuyerQuery } from "@/buyer/use-buyer-query";

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel>
      <EmptyState
        icon={Package}
        title="We couldn't load your dashboard"
        message={message}
        action={
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600"
          >
            Try again
          </button>
        }
      />
    </Panel>
  );
}

export default function Dashboard() {
  const q = useBuyerQuery(() => buyerApi.dashboard(), []);
  const shipments = useBuyerQuery(() => buyerApi.shipments(5), []);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your orders, payments and deliveries at a glance." />

      {/* KPIs — skeletons while loading so no zero is ever shown as fact. */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {q.status === "loading" ? (
          Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
        ) : q.status === "success" ? (
          <>
            <MetricCard label="Total orders" value={q.data.orders.total} icon={ShoppingBag} detail={`${q.data.orders.active} active`} to="/account/orders" />
            <MetricCard label="Delivered" value={q.data.orders.delivered} icon={Package} detail={q.data.orders.cancelled ? `${q.data.orders.cancelled} cancelled` : "none cancelled"} to="/account/orders" />
            <MetricCard label="Total spend" value={inrMinor(q.data.totalSpendMinor)} icon={IndianRupee} detail="excl. cancelled" to="/account/payments" />
            <MetricCard label="Saved addresses" value={q.data.addresses} icon={MapPin} detail={`${q.data.unreadNotifications} unread alerts`} to="/account/settings" />
          </>
        ) : null}
      </div>

      {q.status === "error" && <ErrorPanel message={q.error} onRetry={q.retry} />}

      {q.status === "success" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Recent orders */}
          <Panel title="Recent orders" bodyClassName="p-0">
            {q.data.recentOrders.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                title="No orders yet"
                message="When you place an order it will appear here."
                action={
                  <Link to="/shop" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600">
                    Browse products
                  </Link>
                }
              />
            ) : (
              <ul>
                {q.data.recentOrders.map((o) => (
                  <li key={o.id} className="border-b erp-border-soft last:border-0">
                    <Link to={`/account/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors erp-hover sm:px-5">
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm font-semibold erp-text">{o.orderNumber}</span>
                        <span className="block text-xs erp-text-muted">
                          {formatDate(o.createdAt)} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={paymentTone(o.paymentStatus)}>{prettyStatus(o.paymentStatus)}</Badge>
                        <Badge tone={statusTone(o.status)}>{prettyStatus(o.status)}</Badge>
                        <span className="w-20 text-right text-sm font-bold tabular-nums erp-text">{inrMinor(o.grandTotalMinor)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Active deliveries */}
          <Panel title="Deliveries" bodyClassName="p-0">
            {shipments.status === "loading" ? (
              <div className="p-6 text-center text-sm erp-text-muted">Loading deliveries…</div>
            ) : shipments.status === "error" ? (
              <EmptyState icon={Truck} title="Couldn't load deliveries" message={shipments.error} />
            ) : shipments.data.shipments.length === 0 ? (
              <EmptyState icon={Truck} title="Nothing in transit" message="Deliveries appear here once your order ships." />
            ) : (
              <ul>
                {shipments.data.shipments.map((s) => (
                  <li key={s.id} className="border-b erp-border-soft last:border-0">
                    <Link
                      to={s.orderId ? `/account/orders/${s.orderId}` : "/account/tracking"}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors erp-hover sm:px-5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm font-semibold erp-text">{s.orderNumber ?? s.shipmentNumber}</span>
                        <span className="block text-xs erp-text-muted">
                          {s.courier ?? "Courier pending"}
                          {s.trackingNumber ? ` · ${s.trackingNumber}` : ""}
                        </span>
                      </span>
                      <Badge tone={s.status === "DELIVERED" ? "success" : "info"}>{prettyStatus(s.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {q.status === "success" && (
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/account/payments" className="inline-flex items-center gap-2 rounded-lg border erp-border px-4 py-2 text-sm font-semibold erp-text transition-colors erp-hover">
            <CreditCard className="h-4 w-4" aria-hidden /> Payment history
          </Link>
          <Link to="/account/tracking" className="inline-flex items-center gap-2 rounded-lg border erp-border px-4 py-2 text-sm font-semibold erp-text transition-colors erp-hover">
            <Truck className="h-4 w-4" aria-hidden /> Track deliveries
          </Link>
        </div>
      )}
    </div>
  );
}
