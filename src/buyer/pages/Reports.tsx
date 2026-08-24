import { useMemo, useState, type ReactNode } from "react";
import {
  Download,
  FileText,
  Package,
  ReceiptIndianRupee,
  Quote,
  Wallet,
} from "lucide-react";
import { Badge, Button, PageHeader, Select, Tabs, Toolbar, type TabItem } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { formatDate, inr } from "@/admin/format";
import { TRACKING_STAGE, TRACKING_TONE } from "@/admin/orders-tracking";
import { INVOICE_STATUS } from "@/admin/statuses-ext";
import { useBuyerInvoices, useBuyerOrders, useBuyerQuotations } from "@/buyer/data";
import type { Order, PaymentStatus } from "@/buyer/types";
import { useToast } from "@/components/ui/Toast";

// ============================================================
// Buyer Reports — summaries scoped strictly to the logged-in account only.
// No company-wide / cross-customer aggregates are ever shown here.
// ============================================================

type DateRange = "30d" | "90d" | "year" | "all";
type OrderStatusFilter = "all" | "active" | "delivered" | "cancelled";
type PaymentFilter = "all" | PaymentStatus;

const DATE_RANGE_LABEL: Record<DateRange, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  year: "This year",
  all: "All time",
};

/** Buyer-friendly bucket derived from an order's tracking/status. */
function orderBucket(o: Order): Exclude<OrderStatusFilter, "all"> {
  if (o.trackingStage === "cancelled") return "cancelled";
  if (o.trackingStage === "delivered" || o.status === "delivered") return "delivered";
  return "active";
}

/** Whether an ISO date falls within the selected preset range. */
function inDateRange(iso: string | undefined, range: DateRange, now: number): boolean {
  if (range === "all") return true;
  if (!iso) return false;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  if (range === "year") return new Date(then).getFullYear() === new Date(now).getFullYear();
  const days = range === "30d" ? 30 : 90;
  return now - then <= days * 86_400_000;
}

type ReportTab = "orders" | "purchases" | "payments" | "quotations";

const TABS: TabItem[] = [
  { key: "orders", label: "Order History", icon: Package },
  { key: "purchases", label: "Purchase Summary", icon: ReceiptIndianRupee },
  { key: "payments", label: "Payment Summary", icon: Wallet },
  { key: "quotations", label: "Quotation History", icon: Quote },
];

export default function Reports() {
  const toast = useToast();
  const orders = useBuyerOrders();
  const invoices = useBuyerInvoices();
  const quotations = useBuyerQuotations();
  const now = Date.now();

  const [tab, setTab] = useState<ReportTab>("orders");
  const [range, setRange] = useState<DateRange>("90d");
  const [orderStatus, setOrderStatus] = useState<OrderStatusFilter>("all");
  const [payment, setPayment] = useState<PaymentFilter>("all");

  // Orders filtered by all toolbar controls — the shared basis for order &
  // purchase reports (both are buyer-scoped by the hook already).
  const filteredOrders = useMemo(
    () =>
      orders.filter((o) => {
        if (!inDateRange(o.placedAt, range, now)) return false;
        if (orderStatus !== "all" && orderBucket(o) !== orderStatus) return false;
        if (payment !== "all" && (o.paymentStatus ?? "pending") !== payment) return false;
        return true;
      }),
    [orders, range, orderStatus, payment, now],
  );

  // Invoices scoped by date range + payment status (paid/partial/pending map to
  // invoice status where meaningful).
  const filteredInvoices = useMemo(
    () =>
      invoices.filter((i) => {
        if (!inDateRange(i.issuedAt, range, now)) return false;
        if (payment === "paid" && i.status !== "paid") return false;
        if (payment === "partial" && i.status !== "partial") return false;
        if (payment === "pending" && !(i.status === "sent" || i.status === "overdue")) return false;
        return true;
      }),
    [invoices, range, payment, now],
  );

  const filteredQuotations = useMemo(
    () => quotations.filter((q) => inDateRange(q.submittedAt, range, now)),
    [quotations, range, now],
  );

  const exportToast = (what: string) =>
    toast.info("Export queued — CSV will download", `Preparing your ${what} report…`);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Account", to: "/account/dashboard" }, { label: "Reports" }]}
        title="Reports"
        subtitle="Your own order, purchase, payment and quotation summaries."
        actions={
          <Button variant="secondary" icon={Download} onClick={() => exportToast("full")}>
            Export
          </Button>
        }
      />

      <p className="text-xs erp-text-faint">
        These reports cover your logged-in account only — no data from other customers is included.
      </p>

      <Toolbar>
        <Select value={range} onChange={(v) => setRange(v as DateRange)} aria-label="Date range">
          {(Object.keys(DATE_RANGE_LABEL) as DateRange[]).map((k) => (
            <option key={k} value={k}>
              {DATE_RANGE_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select
          value={orderStatus}
          onChange={(v) => setOrderStatus(v as OrderStatusFilter)}
          aria-label="Order status"
        >
          <option value="all">All order statuses</option>
          <option value="active">Active</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select value={payment} onChange={(v) => setPayment(v as PaymentFilter)} aria-label="Payment status">
          <option value="all">All payments</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="pending">Pending</option>
        </Select>
      </Toolbar>

      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as ReportTab)} />

      {tab === "orders" && <OrderHistory orders={filteredOrders} onExport={() => exportToast("order history")} />}
      {tab === "purchases" && (
        <PurchaseSummary orders={filteredOrders} onExport={() => exportToast("purchase summary")} />
      )}
      {tab === "payments" && (
        <PaymentSummary invoices={filteredInvoices} onExport={() => exportToast("payment summary")} />
      )}
      {tab === "quotations" && (
        <QuotationHistory quotations={filteredQuotations} onExport={() => exportToast("quotation history")} />
      )}
    </div>
  );
}

// ---------- Shared bits ----------

function DownloadBtn({ onClick, label = "Download" }: { onClick: () => void; label?: string }) {
  return (
    <Button size="sm" variant="secondary" icon={Download} onClick={onClick}>
      {label}
    </Button>
  );
}

function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border erp-border erp-surface p-4">
      <p className="text-xs font-semibold erp-text-muted">{label}</p>
      <p className="mt-1.5 text-xl font-extrabold tabular-nums erp-text">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] erp-text-faint">{hint}</p>}
    </div>
  );
}

const TH = "px-3 py-2.5 first:pl-4 last:pr-4";
const TD = "px-3 py-3 first:pl-4 last:pr-4";

// ---------- Order History ----------

function OrderHistory({ orders, onExport }: { orders: Order[]; onExport: () => void }) {
  return (
    <Panel
      title="Order History"
      action={<DownloadBtn onClick={onExport} label="Export" />}
      bodyClassName="p-0"
    >
      {orders.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No orders" message="No orders match the selected filters for your account." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                <th className={TH}>Order ID</th>
                <th className={`${TH} hidden sm:table-cell`}>Date</th>
                <th className={TH}>Product</th>
                <th className={`${TH} text-right`}>Qty</th>
                <th className={`${TH} text-right`}>Amount</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const qty = o.lineItems.reduce((s, li) => s + li.quantity, 0);
                const stage = o.trackingStage ?? "order_received";
                return (
                  <tr key={o.id} className="border-b erp-border-soft last:border-0 erp-hover">
                    <td className={`${TD} font-mono text-xs font-semibold erp-text`}>{o.id}</td>
                    <td className={`${TD} hidden whitespace-nowrap erp-text-muted sm:table-cell`}>
                      {formatDate(o.placedAt)}
                    </td>
                    <td className={TD}>
                      <span className="font-semibold erp-text">
                        {o.productName ?? o.lineItems[0]?.productName ?? "—"}
                      </span>
                    </td>
                    <td className={`${TD} text-right tabular-nums erp-text-muted`}>
                      {qty.toLocaleString("en-IN")}
                    </td>
                    <td className={`${TD} text-right font-semibold tabular-nums erp-text`}>{inr(o.total)}</td>
                    <td className={TD}>
                      <Badge tone={TRACKING_TONE[stage]}>{TRACKING_STAGE[stage].short}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------- Purchase Summary ----------

function PurchaseSummary({ orders, onExport }: { orders: Order[]; onExport: () => void }) {
  const stats = useMemo(() => {
    const totalOrders = orders.length;
    const totalSpend = orders.reduce((s, o) => s + o.total, 0);
    const units = orders.reduce((s, o) => s + o.lineItems.reduce((u, li) => u + li.quantity, 0), 0);
    const avg = totalOrders ? totalSpend / totalOrders : 0;
    return { totalOrders, totalSpend, units, avg };
  }, [orders]);

  // Breakdown grouped by the first line item's box type (buyer's own orders).
  const breakdown = useMemo(() => {
    const map = new Map<string, { count: number; spend: number }>();
    for (const o of orders) {
      const key = o.lineItems[0]?.config?.boxType ?? "Other";
      const row = map.get(key) ?? { count: 0, spend: 0 };
      row.count += 1;
      row.spend += o.total;
      map.set(key, row);
    }
    return [...map.entries()]
      .map(([boxType, v]) => ({ boxType, ...v }))
      .sort((a, b) => b.spend - a.spend);
  }, [orders]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total orders" value={stats.totalOrders.toLocaleString("en-IN")} />
        <StatCard label="Total spend" value={inr(stats.totalSpend)} />
        <StatCard label="Avg order value" value={inr(stats.avg)} />
        <StatCard label="Units ordered" value={stats.units.toLocaleString("en-IN")} />
      </div>

      <Panel
        title="Spend by product type"
        action={<DownloadBtn onClick={onExport} label="Export" />}
        bodyClassName="p-0"
      >
        {breakdown.length === 0 ? (
          <div className="p-4">
            <EmptyState message="No purchases match the selected filters for your account." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                  <th className={TH}>Product / Box type</th>
                  <th className={`${TH} text-right`}>Orders</th>
                  <th className={`${TH} text-right`}>Spend</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => (
                  <tr key={r.boxType} className="border-b erp-border-soft last:border-0 erp-hover">
                    <td className={`${TD} font-semibold erp-text`}>{r.boxType}</td>
                    <td className={`${TD} text-right tabular-nums erp-text-muted`}>
                      {r.count.toLocaleString("en-IN")}
                    </td>
                    <td className={`${TD} text-right font-semibold tabular-nums erp-text`}>{inr(r.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------- Payment Summary ----------

function PaymentSummary({
  invoices,
  onExport,
}: {
  invoices: ReturnType<typeof useBuyerInvoices>;
  onExport: () => void;
}) {
  const stats = useMemo(() => {
    const invoiced = invoices.reduce((s, i) => s + i.amount + i.tax, 0);
    const paid = invoices.reduce((s, i) => s + i.paidAmount, 0);
    return { invoiced, paid, outstanding: Math.max(0, invoiced - paid) };
  }, [invoices]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total invoiced" value={inr(stats.invoiced)} />
        <StatCard label="Total paid" value={inr(stats.paid)} />
        <StatCard label="Outstanding" value={inr(stats.outstanding)} />
      </div>

      <Panel
        title="Invoices"
        action={<DownloadBtn onClick={onExport} label="Export" />}
        bodyClassName="p-0"
      >
        {invoices.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No invoices" message="No invoices match the selected filters for your account." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                  <th className={TH}>Invoice</th>
                  <th className={`${TH} hidden sm:table-cell`}>Order</th>
                  <th className={`${TH} text-right`}>Amount</th>
                  <th className={`${TH} text-right`}>Paid</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id} className="border-b erp-border-soft last:border-0 erp-hover">
                    <td className={`${TD} font-mono text-xs font-semibold erp-text`}>{i.id}</td>
                    <td className={`${TD} hidden font-mono text-xs erp-text-muted sm:table-cell`}>{i.orderId}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums erp-text`}>
                      {inr(i.amount + i.tax)}
                    </td>
                    <td className={`${TD} text-right tabular-nums erp-text-muted`}>{inr(i.paidAmount)}</td>
                    <td className={TD}>
                      <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------- Quotation History ----------

function QuotationHistory({
  quotations,
  onExport,
}: {
  quotations: ReturnType<typeof useBuyerQuotations>;
  onExport: () => void;
}) {
  const TONE: Record<string, "warning" | "info" | "success" | "neutral"> = {
    pending: "warning",
    quoted: "info",
    won: "success",
    lost: "neutral",
  };
  const LABEL: Record<string, string> = {
    pending: "Pending",
    quoted: "Quoted",
    won: "Won",
    lost: "Lost",
  };
  return (
    <Panel
      title="Quotation History"
      action={<DownloadBtn onClick={onExport} label="Export" />}
      bodyClassName="p-0"
    >
      {quotations.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No quotations"
            message="No quotation requests match the selected filters for your account."
            icon={FileText}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                <th className={TH}>Quote ID</th>
                <th className={`${TH} hidden sm:table-cell`}>Date</th>
                <th className={TH}>Product</th>
                <th className={`${TH} text-right`}>Qty</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id} className="border-b erp-border-soft last:border-0 erp-hover">
                  <td className={`${TD} font-mono text-xs font-semibold erp-text`}>{q.id}</td>
                  <td className={`${TD} hidden whitespace-nowrap erp-text-muted sm:table-cell`}>
                    {formatDate(q.submittedAt)}
                  </td>
                  <td className={`${TD} font-semibold erp-text`}>{q.boxType}</td>
                  <td className={`${TD} text-right tabular-nums erp-text-muted`}>
                    {q.quantity.toLocaleString("en-IN")}
                  </td>
                  <td className={TD}>
                    <Badge tone={TONE[q.status] ?? "neutral"}>{LABEL[q.status] ?? q.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
