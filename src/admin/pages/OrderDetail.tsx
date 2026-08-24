import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CreditCard,
  MapPin,
  MoreHorizontal,
  Package,
  Palette,
  Printer,
  Truck,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { EmptyState, Panel } from "../components/Panel";
import {
  Badge,
  Button,
  Dialog,
  KeyValue,
  PageHeader,
  Select,
} from "../components/ui";
import { formatDate, formatDateTime, inr, relativeTime } from "../format";
import { customers } from "../mock-data";
import { invoices, payments, shipments } from "../mock-data-ext";
import { ORDER_STATUS } from "../statuses";
import { INVOICE_STATUS, SHIPMENT_STATUS } from "../statuses-ext";
import { useOrder, updateOrderStage } from "../orders-store";
import {
  PAYMENT_STATUS,
  PRODUCTION_STATUS,
  TRACKING_STAGE,
  TRACKING_TONE,
  flowFor,
  isForwardTransition,
} from "../orders-tracking";
import type { Order, OrderTrackingStage } from "../types";
import { TrackingBar } from "./orders/TrackingBar";

// ---------- Small section card ----------

function InfoCard({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: typeof Package;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border erp-border erp-surface card-shadow">
      <div className="flex items-center justify-between gap-2 border-b erp-border-soft px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide erp-text-faint">
          <Icon className="h-4 w-4" aria-hidden /> {title}
        </h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ---------- Update status modal ----------

function UpdateStatusModal({
  order,
  open,
  onClose,
}: {
  order: Order;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const flow = flowFor(order);
  const [next, setNext] = useState<OrderTrackingStage>(order.trackingStage ?? "order_received");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [confirmBackward, setConfirmBackward] = useState(false);

  const backward = !isForwardTransition(order, next) && next !== order.trackingStage;
  const cancelling = next === "cancelled";

  const apply = () => {
    if (backward && !confirmBackward) {
      setConfirmBackward(true);
      return;
    }
    updateOrderStage(order.id, next, { note: note.trim() || undefined, notifyCustomer: notify });
    toast.success(
      cancelling ? "Order cancelled" : "Status updated",
      `${order.id} → ${TRACKING_STAGE[next].label}${notify ? " · customer notified" : ""}.`,
    );
    setNote("");
    setConfirmBackward(false);
    onClose();
  };

  const field = "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";

  return (
    <Dialog
      open={open}
      onClose={() => { setConfirmBackward(false); onClose(); }}
      title="Update Order Status"
      description={`Move ${order.id} to a new stage in its manufacturing lifecycle.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => { setConfirmBackward(false); onClose(); }}>Cancel</Button>
          <Button variant={backward || cancelling ? "danger" : "primary"} onClick={apply}>
            {backward && !confirmBackward ? "Review backward step" : cancelling ? "Cancel order" : "Update status"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-xs font-semibold erp-text-muted">Current status</span>
            <div className="flex h-10 items-center rounded-lg erp-surface-2 px-3">
              <Badge tone={TRACKING_TONE[order.trackingStage ?? "order_received"]}>
                {TRACKING_STAGE[order.trackingStage ?? "order_received"].label}
              </Badge>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold erp-text-muted">New status</span>
            <Select value={next} onChange={(v) => { setNext(v as OrderTrackingStage); setConfirmBackward(false); }} aria-label="New status" className="w-full">
              {flow.map((s) => <option key={s} value={s}>{TRACKING_STAGE[s].label}</option>)}
              <option value="cancelled">Cancelled</option>
            </Select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Note</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional note for the activity log…" className={cn(field, "h-auto py-2")} />
        </label>

        <label className="flex cursor-pointer items-center gap-2.5 text-sm erp-text">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 rounded border-dark-300 text-primary-500 focus:ring-primary-500 dark:border-dark-600 dark:bg-dark-800" />
          Notify customer of this update
        </label>

        {backward && (
          <div className={cn("rounded-lg border px-3 py-2.5 text-xs font-semibold", confirmBackward ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300")}>
            {confirmBackward
              ? "This is a backward transition. Click “Cancel order”/“Update status” again to confirm."
              : "Moving to an earlier stage is a backward transition and needs confirmation."}
          </div>
        )}
        {cancelling && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            Cancelling stops the normal workflow. The order is retained (never deleted).
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ---------- Page ----------

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const order = useOrder(id);
  const [statusOpen, setStatusOpen] = useState(false);

  const customer = useMemo(() => customers.find((c) => c.id === order?.customerId), [order]);
  const invoice = useMemo(() => invoices.find((iv) => iv.orderId === order?.id), [order]);
  const invoicePayments = invoice ? payments.filter((p) => p.invoiceId === invoice.id) : [];
  const shipment = useMemo(() => shipments.find((s) => s.orderId === order?.id), [order]);

  if (!order) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Orders", to: "/admin/orders" }, { label: "Not found" }]} title="Order not found" />
        <Panel>
          <EmptyState
            icon={Package}
            title="We couldn't find that order"
            message="It may have been removed or the link is incorrect."
            action={
              <Link to="/admin/orders" className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-600 hover:text-primary-700">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to orders
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const s = order.summary ?? { subtotal: order.total, discount: 0, ecoPoints: 0, shipping: 0, gst: 0 };
  const grandTotal = s.subtotal - s.discount + s.shipping + s.gst;
  const balance = Math.max(grandTotal - order.amountPaid, 0);
  const cancelled = order.trackingStage === "cancelled";
  const approvedArtwork = order.artwork.find((a) => a.status === "approved") ?? order.artwork[order.artwork.length - 1];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* Header */}
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Orders", to: "/admin/orders" }, { label: order.id }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden>{order.productImage}</span>
              {order.id}
            </span>
            <Badge tone={TRACKING_TONE[order.trackingStage ?? "order_received"]} dot>
              {TRACKING_STAGE[order.trackingStage ?? "order_received"].label}
            </Badge>
            {order.paymentStatus && <Badge tone={PAYMENT_STATUS[order.paymentStatus].tone}>{PAYMENT_STATUS[order.paymentStatus].label}</Badge>}
          </span>
        }
        subtitle={`${order.customerName} · placed ${formatDate(order.placedAt)} · ${inr(grandTotal)}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => toast.success("Invoice", `${order.id} invoice PDF is being prepared.`)}>Invoice</Button>
            <Button variant="secondary" icon={Truck} onClick={() => toast.info("Tracking", order.trackingNumber ? `AWB ${order.trackingNumber}` : "No AWB booked yet.")}>Track</Button>
            <Button variant="primary" onClick={() => setStatusOpen(true)}>Update Status</Button>
          </>
        }
      />

      {/* Tracking bar */}
      <Panel title="Tracking Progress">
        <TrackingBar order={order} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-4 lg:col-span-2">
          {/* Items */}
          <Panel title="Order Items" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                    <th className="px-4 py-2.5">Product / SKU</th>
                    <th className="px-3 py-2.5">Specifications</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5 text-right">Price</th>
                    <th className="px-3 py-2.5 text-right">Tax</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map((li) => {
                    const lineTotal = li.unitPrice * li.quantity;
                    const tax = Math.round(lineTotal * 0.18);
                    return (
                      <tr key={li.id} className="border-b erp-border-soft align-top last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg erp-surface-2 text-lg" aria-hidden>{order.productImage}</span>
                            <div>
                              <p className="font-semibold erp-text">{li.productName}</p>
                              <p className="font-mono text-[11px] erp-text-faint">{li.config.boxType}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {order.type === "custom" ? (
                            <div className="flex flex-wrap gap-1">
                              <Badge tone="neutral">{li.config.dimensions}</Badge>
                              <Badge tone="neutral">{li.config.gsm} GSM</Badge>
                              <Badge tone="neutral">{li.config.material}</Badge>
                              <Badge tone="neutral">{li.config.printing}</Badge>
                              {li.config.finishes.map((f) => <Badge key={f} tone="info">{f}</Badge>)}
                            </div>
                          ) : (
                            <span className="text-xs erp-text-muted">Ready-stock item</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums erp-text-muted">{li.quantity.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-3 text-right tabular-nums erp-text-muted">{inr(li.unitPrice)}</td>
                        <td className="px-3 py-3 text-right tabular-nums erp-text-faint">{inr(tax)}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums erp-text">{inr(lineTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Info sections grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoCard title="Customer" icon={Package}>
              <KeyValue
                items={[
                  { label: "Company", value: order.customerName },
                  { label: "Contact", value: customer?.name ?? "—" },
                  { label: "Email", value: customer?.email ?? "—" },
                  { label: "Phone", value: customer?.phone ?? order.phone ?? "—" },
                  { label: "GSTIN", value: customer?.gstin ?? "—" },
                ]}
              />
            </InfoCard>

            <InfoCard title="Shipping Address" icon={MapPin}>
              <p className="text-sm erp-text">{customer?.name ?? order.customerName}</p>
              <p className="mt-0.5 text-sm erp-text-muted">
                Plot 14, Industrial Area Phase II<br />
                {customer?.city ?? "Bengaluru"}, India<br />
                {customer?.phone ?? "—"}
              </p>
            </InfoCard>

            <InfoCard title="Payment" icon={CreditCard}>
              <KeyValue
                items={[
                  { label: "Status", value: order.paymentStatus ? <Badge tone={PAYMENT_STATUS[order.paymentStatus].tone}>{PAYMENT_STATUS[order.paymentStatus].label}</Badge> : "—" },
                  { label: "Paid", value: inr(order.amountPaid) },
                  { label: "Balance", value: inr(balance) },
                  { label: "Invoice", value: invoice ? <Badge tone={INVOICE_STATUS[invoice.status].tone}>{invoice.id}</Badge> : "Not raised" },
                ]}
              />
              {invoicePayments.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t erp-border-soft pt-3">
                  {invoicePayments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between text-xs">
                      <span className="erp-text-muted">{p.method.toUpperCase()} · {p.reference}</span>
                      <span className="font-semibold erp-text">{inr(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </InfoCard>

            <InfoCard title="Artwork" icon={Palette}>
              {order.artwork.length > 0 && approvedArtwork ? (
                <div className="space-y-2">
                  <KeyValue
                    items={[
                      { label: "Latest file", value: <span className="font-mono text-xs">{approvedArtwork.fileName}</span> },
                      { label: "Version", value: `v${approvedArtwork.version}` },
                      { label: "Status", value: <Badge tone={approvedArtwork.status === "approved" ? "success" : "warning"}>{approvedArtwork.status.replace(/_/g, " ")}</Badge> },
                      { label: "Approved", value: approvedArtwork.approvedAt ? formatDate(approvedArtwork.approvedAt) : "Pending" },
                    ]}
                  />
                  <Button size="sm" variant="ghost" onClick={() => toast.info("Artwork", approvedArtwork.fileName)}>View artwork</Button>
                </div>
              ) : (
                <p className="text-sm erp-text-muted">{order.type === "ready_made" ? "Not applicable for ready-stock." : "No artwork uploaded yet."}</p>
              )}
            </InfoCard>

            <InfoCard title="Production" icon={Printer}>
              <KeyValue
                items={[
                  { label: "Status", value: order.productionStatus ? <Badge tone={PRODUCTION_STATUS[order.productionStatus].tone}>{PRODUCTION_STATUS[order.productionStatus].label}</Badge> : "—" },
                  { label: "Current stage", value: TRACKING_STAGE[order.trackingStage ?? "order_received"].label },
                  { label: "Type", value: order.type === "ready_made" ? "Ready-stock" : "Custom manufacturing" },
                ]}
              />
            </InfoCard>

            <InfoCard title="Courier / Delivery" icon={Truck}>
              {shipment ? (
                <KeyValue
                  items={[
                    { label: "Courier", value: shipment.courier },
                    { label: "AWB", value: shipment.awb ?? order.trackingNumber ?? "Not booked" },
                    { label: "Status", value: <Badge tone={SHIPMENT_STATUS[shipment.status].tone}>{SHIPMENT_STATUS[shipment.status].label}</Badge> },
                    { label: "Expected", value: order.expectedDelivery ? formatDate(order.expectedDelivery) : formatDate(order.dueAt) },
                  ]}
                />
              ) : (
                <KeyValue
                  items={[
                    { label: "Courier", value: "Not assigned" },
                    { label: "Expected", value: order.expectedDelivery ? formatDate(order.expectedDelivery) : formatDate(order.dueAt) },
                  ]}
                />
              )}
            </InfoCard>
          </div>

          {/* Activity history */}
          <Panel title="Activity History" bodyClassName="p-0">
            {order.history && order.history.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                      <th className="px-4 py-2.5">Date / Time</th>
                      <th className="px-3 py-2.5">Action</th>
                      <th className="hidden px-3 py-2.5 sm:table-cell">From → To</th>
                      <th className="px-3 py-2.5">By</th>
                      <th className="px-4 py-2.5">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.history.map((h) => (
                      <tr key={h.id} className="border-b erp-border-soft align-top last:border-0">
                        <td className="whitespace-nowrap px-4 py-2.5 erp-text-muted">
                          {formatDateTime(h.at)}
                          <span className="block text-[11px] erp-text-faint">{relativeTime(h.at)}</span>
                        </td>
                        <td className="px-3 py-2.5 font-medium erp-text">{h.action}</td>
                        <td className="hidden px-3 py-2.5 sm:table-cell">
                          {h.toStage ? (
                            <span className="flex items-center gap-1 text-xs erp-text-muted">
                              {h.fromStage && <span>{TRACKING_STAGE[h.fromStage].short} →</span>}
                              <span className="font-semibold erp-text">{TRACKING_STAGE[h.toStage].short}</span>
                            </span>
                          ) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 erp-text-muted">{h.by}</td>
                        <td className="px-4 py-2.5 erp-text-faint">{h.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4"><EmptyState message="No activity recorded yet." /></div>
            )}
          </Panel>
        </div>

        {/* Sidebar: order summary */}
        <div className="space-y-4">
          <Panel title="Order Summary">
            <dl className="space-y-2 text-sm">
              {[
                { label: "Subtotal", value: inr(s.subtotal) },
                { label: "Discount", value: s.discount > 0 ? `− ${inr(s.discount)}` : inr(0) },
                { label: "Eco Points", value: `${s.ecoPoints} pts` },
                { label: "Shipping", value: s.shipping > 0 ? inr(s.shipping) : "Free" },
                { label: "GST (18%)", value: inr(s.gst) },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between">
                  <dt className="erp-text-muted">{row.label}</dt>
                  <dd className="font-semibold tabular-nums erp-text">{row.value}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between border-t erp-border pt-2.5 text-base">
                <dt className="font-bold erp-text">Grand Total</dt>
                <dd className="font-extrabold tabular-nums erp-text">{inr(grandTotal)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="erp-text-muted">Paid</dt>
                <dd className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{inr(order.amountPaid)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="erp-text-muted">Balance</dt>
                <dd className={cn("font-bold tabular-nums", balance > 0 ? "text-red-600 dark:text-red-400" : "erp-text")}>{inr(balance)}</dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Order Meta">
            <KeyValue
              items={[
                { label: "Order Date", value: formatDate(order.placedAt) },
                { label: "Due Date", value: formatDate(order.dueAt) },
                { label: "Type", value: order.type === "ready_made" ? "Ready-made" : "Custom" },
                { label: "Coarse status", value: <Badge tone="neutral">{ORDER_STATUS[order.status].label}</Badge> },
              ]}
            />
          </Panel>

          {cancelled && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              <MoreHorizontal className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              This order is cancelled and excluded from the normal workflow. Its records are preserved.
            </div>
          )}
        </div>
      </div>

      <UpdateStatusModal order={order} open={statusOpen} onClose={() => setStatusOpen(false)} />
    </div>
  );
}
