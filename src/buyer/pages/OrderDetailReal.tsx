// Buyer order detail — real API (GET /orders/:id, POST /orders/:id/cancel).
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Circle, Download, XCircle } from "lucide-react";
import { Badge, Button, KeyValue, PageHeader } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { inrMinor, formatDateTime } from "@/admin/format";
import { useToast } from "@/components/ui/Toast";
import { orderApi, type Order } from "@/lib/api/commerce";
import { statusTone, paymentTone, prettyStatus, ORDER_FLOW } from "@/lib/order-status";

const CANCELLABLE = new Set(["PENDING", "CONFIRMED", "PROCESSING", "PACKED"]);

export default function OrderDetailReal() {
  const { id } = useParams();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = () => id && orderApi.get(id).then(setOrder).catch(() => setError(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const cancel = async () => {
    if (!id || !window.confirm("Cancel this order?")) return;
    setCancelling(true);
    try {
      const updated = await orderApi.cancel(id, "Cancelled by customer");
      setOrder(updated);
      toast.success("Order cancelled", "");
    } catch (err) {
      toast.error("Couldn't cancel", err instanceof Error ? err.message : "Please try again.");
    } finally { setCancelling(false); }
  };

  if (error) return <EmptyState title="Order not found" message="We couldn't find that order." />;
  if (!order) return <div className="p-8 text-center text-sm text-slate-400">Loading order…</div>;

  const isCancelled = order.status === "CANCELLED";
  const reachedIndex = ORDER_FLOW.indexOf(order.status as (typeof ORDER_FLOW)[number]);
  // status → timestamp from history for the progress rail
  const timeFor = (s: string) => order.statusHistory.find((h) => h.status === s)?.at;

  return (
    <div>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        subtitle={`Placed ${formatDateTime(order.placedAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <Link to={`/account/orders/${order.id}/invoice`}>
              <Button variant="secondary"><Download className="h-4 w-4" /> Invoice</Button>
            </Link>
            {CANCELLABLE.has(order.status) && (
              <Button variant="danger" onClick={cancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel order"}</Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone={statusTone(order.status)}>{prettyStatus(order.status)}</Badge>
        <Badge tone={paymentTone(order.paymentStatus)}>Payment: {prettyStatus(order.paymentStatus)}</Badge>
        <Badge tone="neutral">{order.paymentMethod.toUpperCase()}</Badge>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Progress timeline */}
          <Panel title="Tracking">
            {isCancelled ? (
              <div className="flex items-center gap-2 p-4 text-sm font-semibold text-red-600">
                <XCircle className="h-5 w-5" /> Order cancelled{order.cancelReason ? ` — ${order.cancelReason}` : ""}
              </div>
            ) : (
              <ol className="space-y-3 p-4">
                {ORDER_FLOW.map((s, i) => {
                  const done = i <= reachedIndex;
                  const at = timeFor(s);
                  return (
                    <li key={s} className="flex items-center gap-3">
                      {done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300" />}
                      <span className={`text-sm font-semibold ${done ? "text-slate-900" : "text-slate-400"}`}>{prettyStatus(s)}</span>
                      {at && <span className="ml-auto text-xs text-slate-400">{formatDateTime(at)}</span>}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          {/* Items */}
          <Panel title="Items">
            <div className="divide-y divide-slate-100">
              {order.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-semibold text-slate-900">{it.productName}</p>
                    <p className="text-xs text-slate-400">{it.sku ? `${it.sku} · ` : ""}{it.variant ? `${it.variant} · ` : ""}Qty {it.quantity} × {inrMinor(it.unitPriceMinor)}</p>
                  </div>
                  <span className="font-semibold text-slate-900">{inrMinor(it.lineTotalMinor)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Sidebar: price, address, payment */}
        <div className="space-y-5">
          <Panel title="Price details">
            <div className="space-y-2 p-4 text-sm">
              <Row label="Subtotal" value={inrMinor(order.subtotalMinor)} />
              {order.discountMinor > 0 && <Row label="Discount" value={`− ${inrMinor(order.discountMinor)}`} />}
              <Row label="GST" value={inrMinor(order.taxMinor)} />
              <Row label="Shipping" value={order.shippingMinor > 0 ? inrMinor(order.shippingMinor) : "Free"} />
              <div className="border-t border-slate-100 pt-2"><Row label={<b>Total</b>} value={<b>{inrMinor(order.grandTotalMinor)}</b>} /></div>
            </div>
          </Panel>

          <Panel title="Delivery address">
            <div className="p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">{order.shippingAddress.name}</p>
              <p>{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}</p>
              <p>{order.shippingAddress.city}, {order.shippingAddress.state} — {order.shippingAddress.postalCode}</p>
              <p className="text-xs text-slate-400">☎ {order.shippingAddress.phone}</p>
            </div>
          </Panel>

          <Panel title="Payment">
            <div className="p-4">
              <KeyValue items={[
                { label: "Method", value: order.paymentMethod.toUpperCase() },
                { label: "Status", value: prettyStatus(order.paymentStatus) },
                ...(order.payments[0] ? [{ label: "Reference", value: order.payments[0].paymentNumber }] : []),
              ]} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className="tabular-nums text-slate-800">{value}</span></div>;
}
