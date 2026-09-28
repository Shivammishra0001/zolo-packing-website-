import { useCallback, useEffect, useState } from "react";
import { IndianRupee, Plus, Users, Wallet } from "lucide-react";
import { MetricCard, MetricCardSkeleton } from "../../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, Panel } from "../../components/Panel";
import { Badge, Button, PageHeader, Pagination, SearchInput, Select, Toolbar } from "../../components/ui";
import { inrMinor, relativeTime } from "../../format";
import { CustomerFormDialog } from "../../crm/CustomerFormDialog";
import { OrderFormDialog, type OrderCustomer } from "../../crm/OrderFormDialog";
import { financialTone, friendlyError } from "../../crm/money";
import { adminCrmApi, type CrmCustomer, type CrmPaymentSummary } from "@/lib/api/admin-crm";

// ============================================================
// Admin → Customers (§5, §6, §38, §39).
//
// Replaces the old fetch-everything-then-filter-in-JS list. Search, filters
// and pagination are all server-side, so this page costs the same whether the
// business has 30 customers or 30,000.
//
// Every money column is DERIVED server-side from the order/payment tables —
// nothing here is a stored per-customer total that could drift.
// ============================================================

const PAGE_SIZE = 25;

export default function CrmCustomers() {
  const [rows, setRows] = useState<CrmCustomer[]>([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [summary, setSummary] = useState<CrmPaymentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [balance, setBalance] = useState("all");
  const [page, setPage] = useState(1);

  const [addOpen, setAddOpen] = useState(false);
  const [orderFor, setOrderFor] = useState<OrderCustomer | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, sum] = await Promise.all([
        adminCrmApi.listCustomers({
          q: search.trim() || undefined,
          page,
          limit: PAGE_SIZE,
          hasPending: balance === "pending" ? "1" : undefined,
          hasOverdue: balance === "overdue" ? "1" : undefined,
        }),
        adminCrmApi.paymentSummary(),
      ]);
      setRows(list.customers);
      setMeta({ total: list.total, pages: list.pages });
      setSummary(sum);
    } catch (err) {
      setError(friendlyError(err, "Unable to load customers."));
    } finally {
      setLoading(false);
    }
  }, [search, page, balance]);

  useEffect(() => { void load(); }, [load]);
  // Any filter change returns to page 1 — page 7 of a new filter is meaningless.
  useEffect(() => { setPage(1); }, [search, balance]);

  const columns: Column<CrmCustomer>[] = [
    {
      key: "customer",
      header: "Customer",
      // Company on top when there is one, with the contact person beneath.
      // Without a company the second line would just repeat the email that
      // the Contact column already shows, so it falls back to the type.
      render: (c) => (
        <div className="min-w-0">
          <div className="truncate font-semibold erp-text">{c.company || c.name}</div>
          {/* Only render a second line when it says something. A business
              shows its contact person; an individual says so; anything else
              gets nothing rather than a bare em dash. */}
          {(c.company || c.customerType === "individual") && (
            <div className="truncate text-xs erp-text-muted">
              {c.company ? c.name : "Individual"}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      hideBelow: "md",
      render: (c) => (
        <div className="min-w-0 text-xs">
          <div className="truncate erp-text">{c.phone ?? "—"}</div>
          <div className="truncate erp-text-muted">{c.email}</div>
        </div>
      ),
    },
    {
      key: "orders",
      header: <span className="block text-right">Orders</span>,
      hideBelow: "sm",
      render: (c) => <div className="text-right tabular-nums erp-text">{c.orderCount}</div>,
    },
    {
      key: "value",
      header: <span className="block text-right">Order value</span>,
      hideBelow: "sm",
      render: (c) => <div className="text-right tabular-nums erp-text">{inrMinor(c.orderValueMinor)}</div>,
    },
    {
      key: "paid",
      header: <span className="block text-right">Paid</span>,
      hideBelow: "lg",
      render: (c) => <div className="text-right tabular-nums erp-text">{inrMinor(c.paidMinor)}</div>,
    },
    {
      key: "pending",
      header: <span className="block text-right">Pending</span>,
      // Pending is always visible, so it carries the overdue signal too — the
      // Status badge is hidden on phones and this must not become the only
      // column that silently drops the one state needing action.
      render: (c) => (
        <div className={`text-right font-semibold tabular-nums ${c.overdueMinor > 0 ? "text-red-600 dark:text-red-400" : c.pendingMinor > 0 ? "erp-text" : "erp-text-muted"}`}>
          {inrMinor(c.pendingMinor)}
          {c.overdueMinor > 0 && (
            <div className="text-[11px] font-medium text-red-600 dark:text-red-400">
              {inrMinor(c.overdueMinor)} overdue
            </div>
          )}
        </div>
      ),
    },
    {
      key: "last",
      header: "Last order",
      hideBelow: "lg",
      render: (c) => <span className="text-xs erp-text-muted">{c.lastOrderAt ? relativeTime(c.lastOrderAt) : "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "sm",
      render: (c) => <Badge tone={financialTone(c.financialStatus)}>{c.financialStatus[0] + c.financialStatus.slice(1).toLowerCase()}</Badge>,
    },
    {
      key: "actions",
      header: "",
      // Hidden on phones: four always-visible columns squeeze this to nothing,
      // and the whole row already navigates to the customer.
      hideBelow: "md",
      render: (c) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOrderFor({ id: c.id, name: c.name, company: c.company, email: c.email, phone: c.phone });
            }}
          >
            New order
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customers"
        subtitle="Every buyer, with what they owe"
        actions={<Button icon={Plus} onClick={() => setAddOpen(true)}>Add customer</Button>}
      />

      {/* Business-wide figures, aggregated in the database (§20, §56). */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !summary ? (
          Array.from({ length: 4 }, (_, i) => <MetricCardSkeleton key={i} />)
        ) : summary ? (
          <>
            <MetricCard label="Customers" value={meta.total.toLocaleString("en-IN")} icon={Users} to="/admin/customers" />
            <MetricCard label="Total order value" value={inrMinor(summary.totalValueMinor)} icon={IndianRupee} detail={`${summary.orderCount} orders`} to="/admin/orders" />
            <MetricCard label="Received" value={inrMinor(summary.receivedMinor)} icon={Wallet} detail={`${inrMinor(summary.collectedTodayMinor)} today`} to="/admin/payments" />
            <MetricCard
              label="Pending"
              value={inrMinor(summary.pendingMinor)}
              icon={Wallet}
              tone={summary.overdueMinor > 0 ? "warn" : "default"}
              detail={summary.overdueMinor > 0 ? `${inrMinor(summary.overdueMinor)} overdue` : undefined}
              to="/admin/payments/outstanding"
            />
          </>
        ) : null}
      </div>

      <Panel
        title="All customers"
        action={
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Name, company, email, phone…" />
            <Select value={balance} onChange={setBalance} aria-label="Filter by balance">
              <option value="all">All balances</option>
              <option value="pending">Has pending</option>
              <option value="overdue">Has overdue</option>
            </Select>
          </Toolbar>
        }
      >
        {loading ? (
          <TableSkeleton rows={8} />
        ) : error ? (
          <EmptyState
            title="Unable to load customers"
            message={error}
            action={<Button variant="secondary" onClick={() => void load()}>Try again</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={search || balance !== "all" ? "No customers match" : "No customers yet"}
            message={search || balance !== "all" ? "Try a different search or filter." : "Add your first customer to raise an order for them."}
            action={
              search || balance !== "all" ? (
                <Button variant="secondary" onClick={() => { setSearch(""); setBalance("all"); }}>Clear filters</Button>
              ) : (
                <Button icon={Plus} onClick={() => setAddOpen(true)}>Add customer</Button>
              )
            }
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(c) => c.id}
              rowHref={(c) => `/admin/customers/${c.id}`}
              caption="Customers with order and payment totals"
            />
            {/* `hasPending` / `hasOverdue` narrow the current page server-side
                after aggregation, so the count is stated for the unfiltered
                set rather than implying a filtered total we don't have. */}
            {meta.pages > 1 && (
              <div className="mt-4">
                <Pagination page={page} pageCount={meta.pages} total={meta.total} pageSize={PAGE_SIZE} onPage={setPage} />
              </div>
            )}
          </>
        )}
      </Panel>

      <CustomerFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode={{ kind: "create" }}
        onSaved={() => void load()}
      />

      {orderFor && (
        <OrderFormDialog
          open
          onClose={() => setOrderFor(null)}
          customer={orderFor}
          onCreated={() => void load()}
        />
      )}
    </div>
  );
}
