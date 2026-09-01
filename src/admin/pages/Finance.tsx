import { useMemo, useState } from "react";
import { CircleDollarSign, IndianRupee, Receipt, Wallet } from "lucide-react";
import { Badge, PageHeader, SearchInput, Tabs, Toolbar } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/Panel";
import { formatDateTime, inr, inrMinor } from "../format";
import { useAdminAnalytics, useAdminFinance } from "../dashboard-api";
import { INVOICE_STATUS } from "../statuses-ext";
import type { Invoice, Payment, PaymentMethod } from "../types";

// Finance — live invoices, payments and revenue from PostgreSQL.
//
// Removed from the previous version: an "input GST credit" invented as 42% of
// output GST, a COGS "estimate" invented as 62% of revenue, a revenue chart
// drawn from an empty mock series, and Remind/New-Invoice buttons that only
// toasted success. What renders now is real or absent.

function useFinanceData() {
  const q = useAdminFinance();
  const invoices: Invoice[] = useMemo(
    () =>
      (q.data?.invoices ?? []).map((i) => ({
        id: i.number ?? i.id,
        orderId: i.orderNumber ?? "—",
        customerName: i.customer ?? "—",
        // The API returns one grand total; a tax split is not recorded per
        // invoice yet, so none is displayed (never invented).
        amount: i.totalMinor / 100,
        tax: 0,
        status: (String(i.status).toLowerCase() === "paid" ? "paid" : "sent") as Invoice["status"],
        issuedAt: i.createdAt,
        dueAt: i.createdAt,
        paidAmount: String(i.status).toLowerCase() === "paid" ? i.totalMinor / 100 : 0,
      })),
    [q.data],
  );
  const payments: Payment[] = useMemo(
    () =>
      (q.data?.payments ?? []).map((p) => ({
        id: p.id,
        invoiceId: p.orderNumber ?? "—",
        customerName: "—",
        amount: p.amountMinor / 100,
        method: (p.method ?? "cash").toLowerCase() as PaymentMethod,
        reference: p.reference ?? "—",
        at: p.paidAt ?? p.createdAt,
      })),
    [q.data],
  );
  return { q, invoices, payments, summary: q.data?.summary ?? null };
}

const METHOD_LABEL: Record<PaymentMethod, string> = { upi: "UPI", neft: "NEFT", card: "Card", cheque: "Cheque", cash: "Cash" };
const METHOD_TONE: Record<PaymentMethod, "primary" | "info" | "success" | "neutral"> = { upi: "primary", neft: "info", card: "success", cheque: "neutral", cash: "neutral" };

function InvoicesTab() {
  const { invoices, summary } = useFinanceData();
  const [search, setSearch] = useState("");

  // NOTE: `invoices` must be a dependency — omitting it froze these panels at
  // their first (empty) render even after the API responded.
  const metrics = useMemo(() => {
    const invoiced = invoices.reduce((s, i) => s + i.amount, 0);
    const collected = invoices.reduce((s, i) => s + i.paidAmount, 0);
    return { invoiced, collected };
  }, [invoices]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return invoices.filter((i) => !s || [i.id, i.orderId, i.customerName].some((f) => f.toLowerCase().includes(s)));
  }, [invoices, search]);

  const columns: Column<Invoice>[] = [
    { key: "id", header: "Invoice", render: (i) => <span className="font-semibold erp-text">{i.id}</span> },
    { key: "order", header: "Order", render: (i) => <span className="erp-text-muted">{i.orderId}</span>, hideBelow: "sm" },
    { key: "customer", header: "Customer", render: (i) => <span className="block max-w-40 truncate erp-text">{i.customerName}</span> },
    { key: "amount", header: "Amount", render: (i) => <span className="font-semibold tabular-nums erp-text">{inr(i.amount)}</span> },
    { key: "paid", header: "Paid", render: (i) => <span className="tabular-nums erp-text-muted">{inr(i.paidAmount)}</span>, hideBelow: "lg" },
    { key: "status", header: "Status", render: (i) => <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge> },
    { key: "issued", header: "Issued", render: (i) => <span className="erp-text-muted">{formatDateTime(i.issuedAt)}</span>, hideBelow: "sm" },
  ];

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total Invoiced" value={inr(metrics.invoiced)} icon={Receipt} to="/admin/finance" detail="grand totals" />
        <MetricCard label="Collected" value={inr(metrics.collected)} icon={Wallet} to="/admin/finance" detail="payments received" />
        <MetricCard
          label="Receivable"
          value={summary ? inrMinor(summary.receivableMinor) : "—"}
          icon={CircleDollarSign}
          tone={summary && summary.receivableMinor > 0 ? "warn" : "default"}
          to="/admin/finance"
          detail={summary ? `${summary.receivableOrders} order(s)` : "loading"}
        />
        <MetricCard
          label="Refunded"
          value={summary ? inrMinor(summary.refundedMinor) : "—"}
          icon={IndianRupee}
          to="/admin/finance"
          detail="all time"
        />
      </div>

      <Toolbar className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoices…" className="w-full sm:w-72" />
      </Toolbar>

      <div className="erp-card card-shadow p-4 sm:p-5">
        {filtered.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices" message="Invoices are generated automatically when orders are placed." />
        ) : (
          <DataTable caption="Invoices" columns={columns} rows={filtered} rowKey={(i) => i.id} />
        )}
      </div>
    </>
  );
}

function PaymentsTab() {
  const { payments } = useFinanceData();
  const columns: Column<Payment>[] = [
    { key: "id", header: "Payment", render: (p) => <span className="font-semibold erp-text">{p.id}</span> },
    { key: "invoice", header: "Order", render: (p) => <span className="erp-text-muted">{p.invoiceId}</span> },
    { key: "amount", header: "Amount", render: (p) => <span className="font-semibold tabular-nums erp-text">{inr(p.amount)}</span> },
    { key: "method", header: "Method", render: (p) => <Badge tone={METHOD_TONE[p.method] ?? "neutral"}>{METHOD_LABEL[p.method] ?? p.method}</Badge> },
    { key: "reference", header: "Reference", render: (p) => <span className="font-mono text-xs erp-text-muted">{p.reference}</span>, hideBelow: "md" },
    { key: "at", header: "Received", render: (p) => <span className="erp-text-faint">{formatDateTime(p.at)}</span>, hideBelow: "sm" },
  ];
  return (
    <div className="erp-card card-shadow p-4 sm:p-5">
      {payments.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments yet" message="Captured payments appear here as orders are paid." />
      ) : (
        <DataTable caption="Payments" columns={columns} rows={payments} rowKey={(p) => p.id} />
      )}
    </div>
  );
}

/** Revenue trend — REAL daily series from /admin/analytics. */
function RevenueTab() {
  const q = useAdminAnalytics(14);
  const series = q.data?.series ?? [];
  const max = Math.max(...series.map((d) => d.revenueMinor), 1);
  return (
    <div className="erp-card card-shadow p-5">
      <h3 className="text-sm font-bold erp-text">Revenue · last 14 days</h3>
      {series.length === 0 ? (
        <EmptyState icon={IndianRupee} message={q.status === "loading" ? "Loading…" : "No revenue recorded in this period."} />
      ) : (
        <div className="mt-5 flex h-48 items-end gap-1.5 sm:gap-2">
          {series.map((d) => (
            <div key={d.day} className="group flex flex-1 flex-col items-center gap-1.5">
              <div className="relative flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-primary-500/80 transition-colors hover:bg-primary-500"
                  style={{ height: `${(d.revenueMinor / max) * 100}%` }}
                  title={`${d.day}: ${inrMinor(d.revenueMinor)}`}
                />
              </div>
              <span className="text-[9px] font-medium erp-text-faint">{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs erp-text-faint">
        GST breakdowns and profit margins will appear once per-line tax and cost data are recorded — they are never estimated.
      </p>
    </div>
  );
}

const TABS = [
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "revenue", label: "Revenue" },
];

export default function Finance() {
  const [tab, setTab] = useState("invoices");
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Finance" }]}
        title="Finance"
        subtitle="Invoices, payments and revenue at a glance."
      />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === "invoices" && <InvoicesTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "revenue" && <RevenueTab />}
    </div>
  );
}
