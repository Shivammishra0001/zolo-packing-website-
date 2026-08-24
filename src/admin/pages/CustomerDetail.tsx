// Full customer profile — every figure comes from PostgreSQL via
// GET /admin/customers/:id. Nothing on this page is derived from mock data:
// if a field is empty it is genuinely not recorded, and says so.
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  IndianRupee,
  MapPin,
  Package,
  Users,
  Wallet,
} from "lucide-react";
import { MetricCard, MetricCardSkeleton } from "../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, Panel } from "../components/Panel";
import {
  Badge,
  Button,
  KeyValue,
  PageHeader,
  Tabs,
  type TabItem,
} from "../components/ui";
import { inrMinor, formatDate } from "../format";
import {
  useAdminCustomer,
  type AdminCustomerAddress,
  type AdminCustomerOrder,
  type AdminCustomerPayment,
  type CustomerSegmentKey,
} from "../dashboard-api";
import { SEGMENT_LABEL } from "../statuses";
import { statusTone, paymentTone, prettyStatus } from "@/lib/order-status";

const SEGMENT_TONE: Record<CustomerSegmentKey, "primary" | "info" | "success"> = {
  small_seller: "info",
  d2c_brand: "primary",
  enterprise: "success",
};

const TABS: TabItem[] = [
  { key: "overview", label: "Overview" },
  { key: "orders", label: "Order History" },
  { key: "payments", label: "Payment History" },
  { key: "addresses", label: "Addresses" },
];

const dash = <span className="erp-text-faint">—</span>;

export default function CustomerDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState("overview");
  const q = useAdminCustomer(id ?? null);

  if (q.status === "loading") {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader
          breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Customers", to: "/admin/customers" }, { label: "Loading…" }]}
          title="Customer"
        />
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)}
        </div>
        <Panel><TableSkeleton rows={6} cols={4} /></Panel>
      </div>
    );
  }

  if (q.status === "error") {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader
          breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Customers", to: "/admin/customers" }, { label: "Error" }]}
          title="Couldn't load this customer"
        />
        <Panel>
          <EmptyState
            icon={Users}
            title="The profile didn't load"
            message={q.error}
            action={
              <Link to="/admin/customers">
                <Button variant="secondary" icon={ArrowLeft}>Back to customers</Button>
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const { customer, totals, orders, payments, addresses } = q.data;
  const title = customer.company || customer.name;

  const orderColumns: Column<AdminCustomerOrder>[] = [
    { key: "orderNumber", header: "Order", render: (o) => <span className="font-mono font-semibold erp-text">{o.orderNumber}</span> },
    { key: "placed", header: "Placed", render: (o) => <span className="erp-text-muted">{formatDate(o.createdAt)}</span>, hideBelow: "md" },
    { key: "items", header: "Items", className: "text-right", render: (o) => <span className="tabular-nums erp-text-muted">{o.itemCount}</span>, hideBelow: "sm" },
    { key: "payment", header: "Payment", render: (o) => <Badge tone={paymentTone(o.paymentStatus)}>{prettyStatus(o.paymentStatus)}</Badge>, hideBelow: "sm" },
    { key: "status", header: "Status", render: (o) => <Badge tone={statusTone(o.status)}>{prettyStatus(o.status)}</Badge> },
    { key: "total", header: "Total", className: "text-right", render: (o) => <span className="font-semibold tabular-nums erp-text">{inrMinor(o.grandTotalMinor)}</span> },
  ];

  const paymentColumns: Column<AdminCustomerPayment>[] = [
    { key: "paymentNumber", header: "Payment", render: (p) => <span className="font-mono font-semibold erp-text">{p.paymentNumber}</span> },
    { key: "orderNumber", header: "Order", render: (p) => <span className="font-mono erp-text-muted">{p.orderNumber ?? "—"}</span>, hideBelow: "md" },
    { key: "method", header: "Method", render: (p) => <span className="uppercase erp-text-muted">{p.method ?? "—"}</span>, hideBelow: "sm" },
    {
      key: "date",
      header: "Date",
      render: (p) => <span className="erp-text-muted">{formatDate(p.paidAt ?? p.createdAt)}</span>,
      hideBelow: "md",
    },
    { key: "status", header: "Status", render: (p) => <Badge tone={paymentTone(p.status)}>{prettyStatus(p.status)}</Badge> },
    {
      key: "amount",
      header: "Amount",
      className: "text-right",
      render: (p) => (
        <div>
          <span className="font-semibold tabular-nums erp-text">{inrMinor(p.amountMinor)}</span>
          {p.refundedMinor > 0 && (
            <span className="block text-xs tabular-nums text-rose-500">−{inrMinor(p.refundedMinor)} refunded</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[
          { label: "Home", to: "/admin" },
          { label: "Customers", to: "/admin/customers" },
          { label: title },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title}
            <Badge tone={SEGMENT_TONE[customer.segment]}>{SEGMENT_LABEL[customer.segment]}</Badge>
            {!customer.isActive && <Badge tone="danger">Inactive</Badge>}
          </span>
        }
        subtitle={[customer.company ? customer.name : null, customer.city, customer.email]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Order Value" value={inrMinor(customer.lifetimeValueMinor)} icon={IndianRupee} detail="lifetime, excl. cancelled" to="#" />
        <MetricCard label="Orders" value={customer.totalOrders} icon={Package} detail={customer.cancelledOrders ? `${customer.cancelledOrders} cancelled` : "none cancelled"} to="#" />
        <MetricCard label="Paid" value={inrMinor(totals.paidMinor)} icon={Wallet} detail={totals.refundedMinor ? `${inrMinor(totals.refundedMinor)} refunded` : "no refunds"} to="#" />
        <MetricCard
          label="Outstanding"
          value={inrMinor(totals.outstandingMinor)}
          icon={Wallet}
          tone={totals.outstandingMinor > 0 ? "warn" : "default"}
          detail="awaiting payment"
          to="#"
        />
      </div>

      <Panel bodyClassName="p-0">
        <div className="px-4 sm:px-5">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>

        <div className="p-4 sm:p-5">
          {tab === "overview" && (
            <KeyValue
              items={[
                { label: "Name", value: customer.name },
                { label: "Company", value: customer.company ?? dash },
                { label: "Phone", value: customer.phone ?? dash },
                { label: "Email", value: customer.email },
                { label: "City", value: customer.city ?? dash },
                { label: "State", value: customer.state ?? dash },
                { label: "Saved addresses", value: customer.addressCount },
                { label: "Segment", value: SEGMENT_LABEL[customer.segment] },
                { label: "Total orders", value: customer.totalOrders },
                { label: "Order value", value: inrMinor(customer.lifetimeValueMinor) },
                { label: "Average order", value: inrMinor(customer.averageOrderMinor) },
                { label: "Last order", value: customer.lastOrderAt ? formatDate(customer.lastOrderAt) : dash },
                { label: "Customer since", value: formatDate(customer.createdAt) },
                { label: "Last login", value: customer.lastLoginAt ? formatDate(customer.lastLoginAt) : "Never" },
                { label: "Status", value: customer.isActive ? "Active" : "Inactive" },
                { label: "Customer ID", value: customer.id },
              ]}
            />
          )}

          {tab === "orders" &&
            (orders.length ? (
              <DataTable
                caption="Order history"
                columns={orderColumns}
                rows={orders}
                rowKey={(o) => o.id}
                rowHref={(o) => `/admin/orders/${o.id}`}
              />
            ) : (
              <EmptyState icon={Package} title="No orders yet" message="This customer hasn't placed an order." />
            ))}

          {tab === "payments" &&
            (payments.length ? (
              <DataTable
                caption="Payment history"
                columns={paymentColumns}
                rows={payments}
                rowKey={(p) => p.id}
                // Every payment belongs to an order; fall back to the list if a
                // legacy row ever lacks the link rather than rendering a dead cell.
                rowHref={(p) => (p.orderId ? `/admin/orders/${p.orderId}` : "/admin/orders")}
              />
            ) : (
              <EmptyState icon={Wallet} title="No payments yet" message="No payment has been recorded for this customer." />
            ))}

          {tab === "addresses" &&
            (addresses.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {addresses.map((a: AdminCustomerAddress) => (
                  <div key={a.id} className="rounded-xl border erp-border p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-primary-500" aria-hidden />
                      <span className="text-xs font-bold uppercase tracking-wide erp-text-muted">{a.kind}</span>
                      {a.isDefault && <Badge tone="success">Default</Badge>}
                    </div>
                    <p className="text-sm font-semibold erp-text">{a.name}</p>
                    <p className="text-sm erp-text-muted">{a.line1}</p>
                    {a.line2 && <p className="text-sm erp-text-muted">{a.line2}</p>}
                    <p className="text-sm erp-text-muted">
                      {a.city}, {a.state} {a.postalCode}
                    </p>
                    <p className="text-sm erp-text-muted">{a.country}</p>
                    {a.phone && <p className="mt-1 text-xs erp-text-faint">{a.phone}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={MapPin} title="No saved addresses" message="This customer hasn't saved a delivery address." />
            ))}
        </div>
      </Panel>
    </div>
  );
}
