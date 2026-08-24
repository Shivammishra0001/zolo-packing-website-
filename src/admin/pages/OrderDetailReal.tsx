// Admin order detail + status management — real API.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Badge, Button, KeyValue, PageHeader, Timeline, type TimelineEntry } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { inrMinor, formatDateTime } from "@/admin/format";
import { useToast } from "@/components/ui/Toast";
import { adminOrdersApi } from "@/lib/api/admin-orders";
import type { Order } from "@/lib/api/commerce";
import { statusTone, paymentTone, prettyStatus, ORDER_NEXT } from "@/lib/order-status";

export default function OrderDetailReal() {
  const { id } = useParams();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");

  const load = () => id && adminOrdersApi.get(id).then(setOrder).catch(() => setError(true));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const setStatus = async (status: string) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      const body: { status: string; note?: string; courier?: string; trackingNumber?: string } = { status, note: note || undefined };
      if (status === "SHIPPED") { body.courier = courier || undefined; body.trackingNumber = tracking || undefined; }
      const updated = await adminOrdersApi.updateStatus(id, body);
      setOrder(updated);
      setNote(""); setCourier(""); setTracking("");
      toast.success("Status updated", `Order is now ${prettyStatus(status)}.`);
    } catch (err) {
      toast.error("Couldn't update status", err instanceof Error ? err.message : "Please try again.");
    } finally { setBusy(false); }
  };

  if (error) return <EmptyState title="Order not found" message="We couldn't find that order." />;
  if (!order) return <div className="p-8 text-center text-sm text-slate-400">Loading order…</div>;

  const nextStatuses = ORDER_NEXT[order.status] ?? [];
  const timeline: TimelineEntry[] = order.statusHistory.map((h, i) => ({
    id: String(i), title: prettyStatus(h.status), meta: h.note ?? undefined, time: formatDateTime(h.at), tone: statusTone(h.status),
  }));

  return (
    <div>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        subtitle={`Placed ${formatDateTime(order.placedAt)}`}
        breadcrumb={[{ label: "Orders", to: "/admin/orders" }, { label: order.orderNumber }]}
        actions={<Link to={`/admin/orders/${order.id}/invoice`}><Button variant="secondary"><Download className="h-4 w-4" /> Invoice</Button></Link>}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <Badge tone={statusTone(order.status)}>{prettyStatus(order.status)}</Badge>
        <Badge tone={paymentTone(order.paymentStatus)}>Payment: {prettyStatus(order.paymentStatus)}</Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Panel title="Customer">
            <div className="p-4"><KeyValue items={[
              { label: "Name", value: order.customer?.name ?? "—" },
              { label: "Email", value: order.customer?.email ?? "—" },
              { label: "Phone", value: order.customer?.phone ?? order.shippingAddress.phone ?? "—" },
            ]} /></div>
          </Panel>

          <Panel title="Products">
            <div className="divide-y divide-slate-100">
              {order.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div><p className="font-semibold text-slate-900">{it.productName}</p><p className="text-xs text-slate-400">{it.sku ?? "—"}{it.variant ? ` · ${it.variant}` : ""} · Qty {it.quantity} × {inrMinor(it.unitPriceMinor)}</p></div>
                  <span className="font-semibold text-slate-900">{inrMinor(it.lineTotalMinor)}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Order timeline">
            <div className="p-4">{timeline.length ? <Timeline entries={timeline} /> : <p className="text-sm text-slate-400">No history yet.</p>}</div>
          </Panel>
        </div>

        <div className="space-y-5">
          {/* Status management */}
          <Panel title="Update status">
            <div className="space-y-3 p-4">
              {nextStatuses.length === 0 ? (
                <p className="text-sm text-slate-400">This order is in a terminal state.</p>
              ) : (
                <>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional note…" className="w-full rounded-lg border border-slate-200 p-2 text-sm outline-none focus:border-primary-400" />
                  {nextStatuses.includes("SHIPPED") && (
                    <div className="grid grid-cols-2 gap-2">
                      <input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Courier" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-primary-400" />
                      <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking #" className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-primary-400" />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {nextStatuses.map((s) => (
                      <Button key={s} variant={s === "CANCELLED" ? "danger" : "primary"} size="sm" onClick={() => setStatus(s)} disabled={busy}>
                        {prettyStatus(s)}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Panel>

          <Panel title="Price details">
            <div className="space-y-2 p-4 text-sm">
              <Row label="Subtotal" value={inrMinor(order.subtotalMinor)} />
              {order.discountMinor > 0 && <Row label={`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`} value={`− ${inrMinor(order.discountMinor)}`} />}
              <Row label="GST" value={inrMinor(order.taxMinor)} />
              <Row label="Shipping" value={order.shippingMinor > 0 ? inrMinor(order.shippingMinor) : "Free"} />
              <div className="border-t border-slate-100 pt-2"><Row label={<b>Total</b>} value={<b>{inrMinor(order.grandTotalMinor)}</b>} /></div>
            </div>
          </Panel>

          <Panel title="Shipping address">
            <div className="p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">{order.shippingAddress.name}</p>
              <p>{order.shippingAddress.line1}{order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}</p>
              <p>{order.shippingAddress.city}, {order.shippingAddress.state} — {order.shippingAddress.postalCode}</p>
              <p className="text-xs text-slate-400">☎ {order.shippingAddress.phone}</p>
            </div>
          </Panel>

          <Panel title="Payment">
            <div className="p-4"><KeyValue items={[
              { label: "Method", value: order.paymentMethod.toUpperCase() },
              { label: "Status", value: prettyStatus(order.paymentStatus) },
              ...(order.payments[0] ? [{ label: "Reference", value: order.payments[0].paymentNumber }] : []),
              { label: "Paid", value: inrMinor(order.paidMinor) },
            ]} /></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className="tabular-nums text-slate-800">{value}</span></div>;
}
