import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye } from "lucide-react";
import { cn } from "@/utils/cn";
import { Badge, PageHeader, Pagination, SearchInput, Select, Toolbar } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { formatDate, inr } from "@/admin/format";
import { PAYMENT_STATUS, TRACKING_STAGE, TRACKING_TONE } from "@/admin/orders-tracking";
import { SHIPMENT_STATUS } from "@/admin/statuses-ext";
import { useBuyerOrders, useBuyerShipments } from "@/buyer/data";
import type { Order, PaymentStatus } from "@/buyer/types";

const PAGE_SIZE = 10;

/** Buyer-friendly order buckets derived from the tracking stage. */
type StatusBucket = "all" | "active" | "delivered";

function bucketFor(o: Order): Exclude<StatusBucket, "all"> {
  return o.trackingStage === "delivered" || o.status === "delivered" ? "delivered" : "active";
}

export default function Orders() {
  const nav = useNavigate();
  const orders = useBuyerOrders();
  const shipments = useBuyerShipments();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusBucket>("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentStatus>("all");
  const [page, setPage] = useState(1);

  // Map orderId → shipment for the shipping-status column (buyer-scoped).
  const shipmentByOrder = useMemo(() => {
    const map = new Map<string, (typeof shipments)[number]>();
    for (const s of shipments) map.set(s.orderId, s);
    return map;
  }, [shipments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (q) {
        const hay = [o.id, o.productName, ...o.lineItems.map((li) => li.productName)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== "all" && bucketFor(o) !== statusFilter) return false;
      if (paymentFilter !== "all" && (o.paymentStatus ?? "pending") !== paymentFilter) return false;
      return true;
    });
  }, [orders, search, statusFilter, paymentFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const resetPage = () => setPage(1);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Account", to: "/account/dashboard" }, { label: "Orders" }]}
        title="My Orders"
        subtitle="Track every order you've placed with Zolo."
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); resetPage(); }}
          placeholder="Search order ID or product…"
          className="w-full sm:max-w-xs"
          aria-label="Search orders"
        />
        <Select
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v as StatusBucket); resetPage(); }}
          aria-label="Filter by order status"
        >
          <option value="all">All orders</option>
          <option value="active">Active</option>
          <option value="delivered">Delivered</option>
        </Select>
        <Select
          value={paymentFilter}
          onChange={(v) => { setPaymentFilter(v as typeof paymentFilter); resetPage(); }}
          aria-label="Filter by payment status"
        >
          <option value="all">All payments</option>
          <option value="paid">Paid</option>
          <option value="partial">Partial</option>
          <option value="pending">Pending</option>
        </Select>
      </Toolbar>

      <Panel bodyClassName="p-0">
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No orders found"
              message={
                orders.length === 0
                  ? "You haven't placed any orders yet. Once you do, they'll show up here."
                  : "No orders match your current filters. Try adjusting your search."
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b erp-border text-left text-xs font-bold uppercase tracking-wide erp-text-faint">
                    <th className="px-4 py-2.5">Order ID</th>
                    <th className="hidden px-3 py-2.5 sm:table-cell">Date</th>
                    <th className="px-3 py-2.5">Products</th>
                    <th className="hidden px-3 py-2.5 text-right md:table-cell">Qty</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                    <th className="hidden px-3 py-2.5 lg:table-cell">Payment</th>
                    <th className="px-3 py-2.5">Order Status</th>
                    <th className="hidden px-3 py-2.5 lg:table-cell">Shipping</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((o) => {
                    const href = `/account/orders/${o.id}`;
                    const qty = o.lineItems.reduce((s, li) => s + li.quantity, 0);
                    const extra = o.lineItems.length - 1;
                    const stage = o.trackingStage ?? "order_received";
                    const shipment = shipmentByOrder.get(o.id);
                    return (
                      <tr
                        key={o.id}
                        role="link"
                        tabIndex={0}
                        onClick={() => nav(href)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            nav(href);
                          }
                        }}
                        className="cursor-pointer border-b erp-border-soft align-middle transition-colors erp-hover last:border-0 focus-visible:erp-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                      >
                        <td className="px-4 py-3 font-mono text-xs font-semibold erp-text">{o.id}</td>
                        <td className="hidden whitespace-nowrap px-3 py-3 erp-text-muted sm:table-cell">
                          {formatDate(o.placedAt)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg erp-surface-2 text-base" aria-hidden>
                              {o.productImage ?? "📦"}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold erp-text">
                                {o.productName ?? o.lineItems[0]?.productName ?? "—"}
                              </p>
                              {extra > 0 && <p className="text-[11px] erp-text-faint">+{extra} more</p>}
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-3 py-3 text-right tabular-nums erp-text-muted md:table-cell">
                          {qty.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums erp-text">{inr(o.total)}</td>
                        <td className="hidden px-3 py-3 lg:table-cell">
                          {o.paymentStatus ? (
                            <Badge tone={PAYMENT_STATUS[o.paymentStatus].tone}>{PAYMENT_STATUS[o.paymentStatus].label}</Badge>
                          ) : (
                            <span className="erp-text-faint">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={TRACKING_TONE[stage]}>{TRACKING_STAGE[stage].short}</Badge>
                        </td>
                        <td className="hidden px-3 py-3 lg:table-cell">
                          {shipment ? (
                            <Badge tone={SHIPMENT_STATUS[shipment.status].tone}>{SHIPMENT_STATUS[shipment.status].label}</Badge>
                          ) : (
                            <span className="erp-text-faint">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={href}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`View order ${o.id}`}
                            className={cn(
                              "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors",
                              "erp-border erp-surface erp-text hover:erp-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
                            )}
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden /> View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > PAGE_SIZE && (
              <Pagination
                page={safePage}
                pageCount={pageCount}
                total={filtered.length}
                pageSize={PAGE_SIZE}
                onPage={setPage}
              />
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
