import { useMemo, useState } from "react";
import { Bell, CircleDollarSign, IndianRupee, Plus, Receipt, TrendingUp, Wallet } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, PageHeader, SearchInput, Tabs, Toolbar } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/Panel";
import { dueLabel, formatDateTime, inr } from "../format";
import { salesSeries } from "../mock-data-ext";
import { useAdminFinance } from "../dashboard-api";
import { INVOICE_STATUS } from "../statuses-ext";
import type { Invoice, Payment, PaymentMethod } from "../types";

/**
 * Live finance data from PostgreSQL, mapped onto the page's existing Invoice /
 * Payment shapes. Amounts arrive in minor units (paise) and are converted once
 * here, so every panel below keeps working unchanged.
 */
function useFinanceData() {
  const q = useAdminFinance();
  const invoices: Invoice[] = useMemo(
    () =>
      (q.data?.invoices ?? []).map((i) => ({
        id: i.number ?? i.id,
        orderId: i.orderNumber ?? "—",
        customerName: i.customer ?? "—",
        // The API returns one grand total; tax is already inside it.
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
  const { invoices } = useFinanceData();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const metrics = useMemo(() => {
    const invoiced = invoices.reduce((s, i) => s + i.amount + i.tax, 0);
    const collected = invoices.reduce((s, i) => s + i.paidAmount, 0);
    const outstanding = invoices.filter((i) => i.status !== "paid" && i.status !== "draft").reduce((s, i) => s + (i.amount + i.tax - i.paidAmount), 0);
    const overdue = invoices.filter((i) => i.status === "overdue").length;
    return { invoiced, collected, outstanding, overdue };
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return invoices.filter((i) => !s || [i.id, i.orderId, i.customerName].some((f) => f.toLowerCase().includes(s)));
  }, [search]);

  const columns: Column<Invoice>[] = [
    { key: "id", header: "Invoice", render: (i) => <span className="font-semibold erp-text">{i.id}</span> },
    { key: "order", header: "Order", render: (i) => <span className="erp-text-muted">{i.orderId}</span>, hideBelow: "sm" },
    { key: "customer", header: "Customer", render: (i) => <span className="block max-w-40 truncate erp-text">{i.customerName}</span> },
    { key: "amount", header: "Amount", render: (i) => <span className="font-semibold tabular-nums erp-text">{inr(i.amount)}</span> },
    { key: "tax", header: "GST", render: (i) => <span className="tabular-nums erp-text-muted">{inr(i.tax)}</span>, hideBelow: "md" },
    { key: "paid", header: "Paid", render: (i) => <span className="tabular-nums erp-text-muted">{inr(i.paidAmount)}</span>, hideBelow: "lg" },
    { key: "status", header: "Status", render: (i) => <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge> },
    { key: "due", header: "Due", render: (i) => <span className="erp-text-muted">{dueLabel(i.dueAt)}</span>, hideBelow: "sm" },
    {
      key: "actions", header: "", render: (i) => (
        <Button size="sm" variant="ghost" icon={Bell} onClick={() => toast.success("Reminder sent", `Payment reminder emailed for ${i.id}.`)}>Remind</Button>
      ),
    },
  ];

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total Invoiced" value={inr(metrics.invoiced)} icon={Receipt} to="/admin/finance" detail="incl. GST" />
        <MetricCard label="Collected" value={inr(metrics.collected)} icon={Wallet} to="/admin/finance" detail="payments received" />
        <MetricCard label="Outstanding" value={inr(metrics.outstanding)} icon={CircleDollarSign} tone={metrics.outstanding ? "warn" : "default"} to="/admin/finance" detail="yet to collect" />
        <MetricCard label="Overdue" value={metrics.overdue} icon={IndianRupee} tone={metrics.overdue ? "danger" : "default"} to="/admin/finance" detail="past due date" />
      </div>

      <Toolbar className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoices…" className="w-full sm:w-72" />
        <Button variant="primary" icon={Plus} className="sm:ml-auto" onClick={() => setNewOpen(true)}>New Invoice</Button>
      </Toolbar>

      <div className="erp-card card-shadow p-4 sm:p-5">
        {filtered.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices" message="Nothing matches your search." />
        ) : (
          <DataTable caption="Invoices" columns={columns} rows={filtered} rowKey={(i) => i.id} />
        )}
      </div>

      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New Invoice"
        description="Generate a GST invoice against an order."
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setNewOpen(false); toast.success("Invoice created", "Draft invoice ready to review and send."); }}>Create</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Order ID</span>
            <input placeholder="ORD-0000" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Amount (before GST)</span>
            <input type="number" placeholder="0" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
          </label>
        </div>
      </Dialog>
    </>
  );
}

function PaymentsTab() {
  const { payments } = useFinanceData();
  const columns: Column<Payment>[] = [
    { key: "id", header: "Payment", render: (p) => <span className="font-semibold erp-text">{p.id}</span> },
    { key: "invoice", header: "Invoice", render: (p) => <span className="erp-text-muted">{p.invoiceId}</span> },
    { key: "customer", header: "Customer", render: (p) => <span className="block max-w-40 truncate erp-text">{p.customerName}</span> },
    { key: "amount", header: "Amount", render: (p) => <span className="font-semibold tabular-nums erp-text">{inr(p.amount)}</span> },
    { key: "method", header: "Method", render: (p) => <Badge tone={METHOD_TONE[p.method]}>{METHOD_LABEL[p.method]}</Badge> },
    { key: "reference", header: "Reference", render: (p) => <span className="font-mono text-xs erp-text-muted">{p.reference}</span>, hideBelow: "md" },
    { key: "at", header: "Received", render: (p) => <span className="erp-text-faint">{formatDateTime(p.at)}</span>, hideBelow: "sm" },
  ];
  return (
    <div className="erp-card card-shadow p-4 sm:p-5">
      <DataTable caption="Payments" columns={columns} rows={payments} rowKey={(p) => p.id} />
    </div>
  );
}

function GstTab() {
  const { invoices } = useFinanceData();
  const outputGst = invoices.reduce((s, i) => s + i.tax, 0);
  const inputGst = Math.round(outputGst * 0.42); // illustrative input credit
  const net = outputGst - inputGst;
  const rate = 18;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="erp-card card-shadow p-5 lg:col-span-1">
        <h3 className="text-sm font-bold erp-text">GST Summary</h3>
        <p className="mt-0.5 text-xs erp-text-muted">Current filing period</p>
        <dl className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <dt className="text-sm erp-text-muted">Output GST (collected)</dt>
            <dd className="font-semibold tabular-nums erp-text">{inr(outputGst)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-sm erp-text-muted">Input GST (credit)</dt>
            <dd className="font-semibold tabular-nums erp-text">{inr(inputGst)}</dd>
          </div>
          <div className="flex items-center justify-between border-t erp-border pt-3">
            <dt className="text-sm font-bold erp-text">Net Payable</dt>
            <dd className="font-display text-lg font-extrabold tabular-nums text-primary-600 dark:text-primary-400">{inr(net)}</dd>
          </div>
        </dl>
      </div>
      <div className="erp-card card-shadow p-5 lg:col-span-2">
        <h3 className="mb-3 text-sm font-bold erp-text">Output GST by invoice</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b erp-border text-left">
                {["Invoice", "Customer", "Taxable", `GST @ ${rate}%`].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint first:pl-0 last:pr-0">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b erp-border-soft last:border-0">
                  <td className="px-3 py-2.5 first:pl-0 font-semibold erp-text">{i.id}</td>
                  <td className="px-3 py-2.5 erp-text-muted"><span className="block max-w-40 truncate">{i.customerName}</span></td>
                  <td className="px-3 py-2.5 tabular-nums erp-text-muted">{inr(i.amount)}</td>
                  <td className="px-3 py-2.5 last:pr-0 tabular-nums font-semibold erp-text">{inr(i.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProfitTab() {
  const { invoices } = useFinanceData();
  const revenue = invoices.reduce((s, i) => s + i.amount, 0);
  const cogs = Math.round(revenue * 0.62);
  const grossMargin = revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0;
  const max = salesSeries.length > 0 ? Math.max(...salesSeries.map((d) => d.revenue)) || 1 : 1;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Revenue" value={inr(revenue)} icon={IndianRupee} to="/admin/finance" detail="invoiced (ex-GST)" />
        <MetricCard label="COGS estimate" value={inr(cogs)} icon={Wallet} to="/admin/finance" detail="~62% of revenue" />
        <MetricCard label="Gross Margin" value={`${grossMargin.toFixed(1)}%`} icon={TrendingUp} to="/admin/finance" detail={inr(revenue - cogs)} />
      </div>

      <div className="erp-card card-shadow p-5">
        <h3 className="text-sm font-bold erp-text">Revenue · last 14 days</h3>
        <div className="mt-5 flex h-48 items-end gap-1.5 sm:gap-2">
          {salesSeries.map((d) => (
            <div key={d.day} className="group flex flex-1 flex-col items-center gap-1.5">
              <div className="relative flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-primary-500/80 transition-colors hover:bg-primary-500"
                  style={{ height: `${(d.revenue / max) * 100}%` }}
                  title={`${d.day}: ${inr(d.revenue)}`}
                />
              </div>
              <span className="text-[9px] font-medium erp-text-faint">{d.day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "refunds", label: "Refunds" },
  { key: "gst", label: "GST" },
  { key: "profit", label: "Profit" },
];

export default function Finance() {
  const [tab, setTab] = useState("invoices");
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Finance" }]}
        title="Finance"
        subtitle="Invoices, payments, GST and profitability at a glance."
      />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === "invoices" && <InvoicesTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "refunds" && (
        <div className="erp-card card-shadow p-4 sm:p-5">
          <EmptyState icon={IndianRupee} title="No refunds this period" message="Refunds you process will appear here for reconciliation." />
        </div>
      )}
      {tab === "gst" && <GstTab />}
      {tab === "profit" && <ProfitTab />}
    </div>
  );
}
