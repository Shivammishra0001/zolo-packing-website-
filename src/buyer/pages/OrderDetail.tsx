import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  CreditCard,
  Download,
  FileText,
  MapPin,
  Package,
  Truck,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, KeyValue, PageHeader, Timeline, type TimelineEntry } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { formatDate, inr, relativeTime } from "@/admin/format";
import {
  BUYER_FLOW,
  BUYER_STAGE_LABEL,
  PAYMENT_STATUS,
  TRACKING_STAGE,
  TRACKING_TONE,
  toBuyerStage,
  type BuyerStage,
} from "@/admin/orders-tracking";
import { INVOICE_STATUS } from "@/admin/statuses-ext";
import { useBuyerInvoices, useBuyerOrder, useBuyerProfile } from "@/buyer/data";
import type { Order } from "@/buyer/types";

// ============================================================
// BUYER-safe order detail. Shows only this customer's order (scoped hook), with
// a simplified buyer tracking flow and buyer-friendly timeline. No internal
// costs, staff, notes or audit detail is ever surfaced.
// ============================================================

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

// ---------- Simplified BUYER tracking flow ----------
//   ✓ completed  ● current  ○ upcoming — orange (primary) accent.

function BuyerTrackingBar({ order }: { order: Order }) {
  const cancelled = order.trackingStage === "cancelled";
  const current = toBuyerStage(order.trackingStage ?? "order_received");
  const currentIdx = BUYER_FLOW.indexOf(current);

  if (cancelled) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        This order was cancelled. Please contact us if you have any questions.
      </div>
    );
  }

  const state = (i: number): "completed" | "current" | "upcoming" =>
    i < currentIdx ? "completed" : i === currentIdx ? "current" : "upcoming";

  return (
    <div className="overflow-x-auto no-scrollbar">
      <ol className="flex min-w-max items-start gap-0 pb-1" aria-label="Order progress">
        {BUYER_FLOW.map((stage: BuyerStage, i) => {
          const st = state(i);
          const isLast = i === BUYER_FLOW.length - 1;
          return (
            <li
              key={stage}
              className="flex flex-col items-center"
              aria-current={st === "current" ? "step" : undefined}
            >
              <div className="flex items-center">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors",
                    st === "completed" && "border-primary-500 bg-primary-500 text-white",
                    st === "current" &&
                      "border-primary-500 bg-white text-primary-600 ring-4 ring-primary-100 dark:bg-dark-900 dark:text-primary-400 dark:ring-primary-500/20",
                    st === "upcoming" && "erp-border erp-surface erp-text-faint",
                  )}
                >
                  {st === "completed" ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                {!isLast && (
                  <span
                    className={cn(
                      "h-0.5 w-12 sm:w-16",
                      i < currentIdx ? "bg-primary-500" : "bg-current opacity-30",
                    )}
                    aria-hidden
                  />
                )}
              </div>
              <div className="mt-1.5 w-16 px-0.5 text-center sm:w-20">
                <p
                  className={cn(
                    "text-[10px] font-semibold leading-tight",
                    st === "upcoming" ? "erp-text-faint" : "erp-text",
                  )}
                >
                  {BUYER_STAGE_LABEL[stage]}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- Page ----------

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const order = useBuyerOrder(id);
  const profile = useBuyerProfile();
  const invoices = useBuyerInvoices();

  // Scoping to this buyer means a not-found order == either missing OR belongs
  // to another customer — either way the buyer must not see it.
  const invoice = useMemo(() => invoices.find((iv) => iv.orderId === id), [invoices, id]);

  // Build a buyer-safe timeline: friendly labels only, never staff/notes/stage churn.
  const timeline = useMemo<TimelineEntry[]>(() => {
    if (!order?.history?.length) return [];
    const seen = new Set<BuyerStage>();
    const out: TimelineEntry[] = [];
    for (const h of order.history) {
      if (!h.toStage) continue;
      const bs = toBuyerStage(h.toStage);
      // Collapse internal churn: one entry per buyer-visible stage.
      if (seen.has(bs)) continue;
      seen.add(bs);
      out.push({
        id: h.id,
        title: `Order moved to ${BUYER_STAGE_LABEL[bs]}`,
        time: relativeTime(h.at),
        tone: bs === "delivered" ? "success" : "primary",
      });
    }
    return out;
  }, [order]);

  if (!order) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-5">
        <PageHeader
          breadcrumb={[
            { label: "Account", to: "/account/dashboard" },
            { label: "Orders", to: "/account/orders" },
            { label: "Not found" },
          ]}
          title="Order not found"
        />
        <Panel>
          <EmptyState
            icon={Package}
            title="We couldn't find that order"
            message="It may not exist, or it isn't linked to your account."
            action={
              <Link
                to="/account/orders"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-primary-600 hover:text-primary-700"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back to my orders
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const stage = order.trackingStage ?? "order_received";
  const s = order.summary ?? { subtotal: order.total, discount: 0, ecoPoints: 0, shipping: 0, gst: 0 };
  const grandTotal = s.subtotal - s.discount + s.shipping + s.gst;
  const balance = Math.max(grandTotal - order.amountPaid, 0);

  const downloadInvoice = () =>
    toast.success("Invoice", `Invoice for ${order.id} is being prepared for download.`);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Account", to: "/account/dashboard" },
          { label: "Orders", to: "/account/orders" },
          { label: order.id },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden>{order.productImage ?? "📦"}</span>
              {order.id}
            </span>
            <Badge tone={TRACKING_TONE[stage]} dot>{TRACKING_STAGE[stage].label}</Badge>
            {order.paymentStatus && (
              <Badge tone={PAYMENT_STATUS[order.paymentStatus].tone}>{PAYMENT_STATUS[order.paymentStatus].label}</Badge>
            )}
          </span>
        }
        subtitle={`Placed ${formatDate(order.placedAt)} · ${inr(grandTotal)}`}
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={downloadInvoice}>
              Download Invoice
            </Button>
            <Link
              to="/account/tracking"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 text-sm font-semibold text-white shadow-sm shadow-primary-500/20 transition-colors hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
            >
              <Truck className="h-4 w-4" aria-hidden /> Track Order
            </Link>
          </>
        }
      />

      {/* Buyer tracking flow */}
      <Panel title="Order Progress">
        <BuyerTrackingBar order={order} />
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
                    <th className="px-4 py-2.5">Product</th>
                    <th className="hidden px-3 py-2.5 sm:table-cell">Specifications</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5 text-right">Price</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map((li) => (
                    <tr key={li.id} className="border-b erp-border-soft align-top last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg erp-surface-2 text-lg" aria-hidden>
                            {order.productImage ?? "📦"}
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold erp-text">{li.productName}</p>
                            <p className="font-mono text-[11px] erp-text-faint">{li.config.boxType}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 sm:table-cell">
                        {order.type === "custom" ? (
                          <div className="flex flex-wrap gap-1">
                            <Badge tone="neutral">{li.config.dimensions}</Badge>
                            <Badge tone="neutral">{li.config.gsm} GSM</Badge>
                            <Badge tone="neutral">{li.config.material}</Badge>
                            <Badge tone="neutral">{li.config.printing}</Badge>
                            {li.config.finishes.map((f) => (
                              <Badge key={f} tone="info">{f}</Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs erp-text-muted">Ready-stock item</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums erp-text-muted">
                        {li.quantity.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums erp-text-muted">{inr(li.unitPrice)}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums erp-text">
                        {inr(li.unitPrice * li.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Info cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoCard title="Payment" icon={CreditCard}>
              <KeyValue
                items={[
                  {
                    label: "Status",
                    value: order.paymentStatus ? (
                      <Badge tone={PAYMENT_STATUS[order.paymentStatus].tone}>{PAYMENT_STATUS[order.paymentStatus].label}</Badge>
                    ) : (
                      "—"
                    ),
                  },
                  { label: "Paid", value: inr(order.amountPaid) },
                  { label: "Balance", value: inr(balance) },
                  {
                    label: "Invoice",
                    value: invoice ? (
                      <Badge tone={INVOICE_STATUS[invoice.status].tone}>{invoice.id}</Badge>
                    ) : (
                      "Not raised"
                    ),
                  },
                ]}
              />
            </InfoCard>

            <InfoCard
              title="Invoice"
              icon={FileText}
              action={
                <Button size="sm" variant="ghost" icon={Download} onClick={downloadInvoice}>
                  Download
                </Button>
              }
            >
              {invoice ? (
                <KeyValue
                  items={[
                    { label: "Invoice No.", value: <span className="font-mono text-xs">{invoice.id}</span> },
                    { label: "Amount", value: inr(invoice.amount + invoice.tax) },
                    { label: "Issued", value: formatDate(invoice.issuedAt) },
                    { label: "Due", value: formatDate(invoice.dueAt) },
                  ]}
                />
              ) : (
                <p className="text-sm erp-text-muted">
                  Your invoice will be available here once it has been raised for this order.
                </p>
              )}
            </InfoCard>

            <InfoCard title="Shipping Address" icon={MapPin}>
              <p className="text-sm font-semibold erp-text">{profile.name}</p>
              {profile.company && <p className="text-sm erp-text-muted">{profile.company}</p>}
              <p className="mt-0.5 text-sm erp-text-muted">
                Plot 14, Industrial Area Phase II<br />
                {profile.city || "Bengaluru"}, {profile.state || "India"}<br />
                {profile.phone || "—"}
              </p>
            </InfoCard>

            <InfoCard title="Delivery" icon={Truck}>
              <KeyValue
                items={[
                  { label: "Type", value: order.type === "ready_made" ? "Ready-stock" : "Custom" },
                  {
                    label: "Expected",
                    value: order.expectedDelivery
                      ? formatDate(order.expectedDelivery)
                      : formatDate(order.dueAt),
                  },
                  { label: "Tracking No.", value: order.trackingNumber ?? "Not booked yet" },
                ]}
              />
            </InfoCard>
          </div>

          {/* Buyer-safe timeline */}
          <Panel title="Order Timeline">
            {timeline.length > 0 ? (
              <Timeline entries={timeline} />
            ) : (
              <EmptyState message="No updates on this order yet. We'll keep you posted here." />
            )}
          </Panel>
        </div>

        {/* Sidebar: summary */}
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
                <dd className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {inr(order.amountPaid)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="erp-text-muted">Balance</dt>
                <dd className={cn("font-bold tabular-nums", balance > 0 ? "text-red-600 dark:text-red-400" : "erp-text")}>
                  {inr(balance)}
                </dd>
              </div>
            </dl>
            {balance > 0 && (
              <Button variant="primary" className="mt-4 w-full" onClick={() => toast.info("Payment", "Redirecting you to the payment page…")}>
                Pay Balance
              </Button>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
