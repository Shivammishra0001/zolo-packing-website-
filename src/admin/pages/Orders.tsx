import { useMemo, useRef, useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Download,
  Eye,
  LayoutGrid,
  MoreHorizontal,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  Table as TableIcon,
  Truck,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { MetricCard } from "../components/MetricCard";
import { EmptyState, Panel } from "../components/Panel";
import {
  Badge,
  Button,
  Dialog,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Tabs,
  Toolbar,
} from "../components/ui";
import { dueLabel, formatDate, inr } from "../format";
import { useNow } from "../hooks";
import { useOrders } from "../orders-store";
import { ORDER_STATUS, ORDER_STATUS_FLOW } from "../statuses";
import {
  PAYMENT_STATUS,
  PRODUCTION_STATUS,
  TRACKING_STAGE,
  TRACKING_TONE,
} from "../orders-tracking";
import { SHIPMENT_STATUS } from "../statuses-ext";
import { shipments } from "../mock-data-ext";
import type { Order, OrderType } from "../types";
import { TrackingMini } from "./orders/TrackingBar";

const PAGE_SIZE = 10;

// ---------- CSV export ----------

function buildCsv(rows: Order[]): string {
  const headers = ["Order ID", "Product", "Customer", "Date", "Amount", "Qty", "Payment", "Tracking Stage", "Status", "Tracking No"];
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((o) =>
    [
      o.id,
      o.productName ?? "",
      o.customerName,
      new Date(o.placedAt).toISOString(),
      String(o.total),
      String(o.lineItems.reduce((s, li) => s + li.quantity, 0)),
      o.paymentStatus ? PAYMENT_STATUS[o.paymentStatus].label : "",
      o.trackingStage ? TRACKING_STAGE[o.trackingStage].label : "",
      ORDER_STATUS[o.status].label,
      o.trackingNumber ?? "",
    ]
      .map(escape)
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

function downloadCsv(rows: Order[]) {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const typeTone = (t: OrderType) => (t === "ready_made" ? "info" : "primary");

// ---------- New order dialog ----------

function NewOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [customer, setCustomer] = useState("");
  const [type, setType] = useState<OrderType>("ready_made");
  const submit = () => {
    toast.success("Order created", customer ? `Draft order for ${customer} added.` : "Draft order added.");
    setCustomer("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Order"
      description="Create a draft order. Configure line items after it's saved."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Plus} onClick={submit}>Create order</Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Customer</span>
          <input
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Company name"
            className="h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold erp-text-muted">Order type</span>
          <Select value={type} onChange={(v) => setType(v as OrderType)} aria-label="Order type" className="w-full">
            <option value="ready_made">Ready-made</option>
            <option value="custom">Custom</option>
          </Select>
        </label>
      </div>
    </Dialog>
  );
}

// ---------- Pipeline (kanban) view ----------

function Pipeline({ rows }: { rows: Order[] }) {
  const now = useNow();
  const nav = useNavigate();
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="flex min-w-max gap-3">
        {ORDER_STATUS_FLOW.map((status) => {
          const meta = ORDER_STATUS[status];
          const items = rows.filter((o) => o.status === status);
          return (
            <div key={status} className="flex w-64 shrink-0 flex-col">
              <div className="flex items-center justify-between gap-2 rounded-t-xl border border-b-0 erp-border erp-surface-2 px-3 py-2.5">
                <span className="flex items-center gap-2 text-xs font-bold erp-text">
                  <span className={cn("h-2 w-2 rounded-full", meta.dot)} aria-hidden />
                  {meta.label}
                </span>
                <span className="rounded-full erp-surface px-1.5 py-0.5 text-[10px] font-bold erp-text-muted">{items.length}</span>
              </div>
              <div className="flex max-h-[520px] flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl border erp-border erp-surface p-2">
                {items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs erp-text-faint">No orders</p>
                ) : (
                  items.map((o) => {
                    const overdue = new Date(o.dueAt).getTime() < now && o.status !== "delivered";
                    return (
                      <button
                        key={o.id}
                        onClick={() => nav(`/admin/orders/${o.id}`)}
                        className="block w-full rounded-lg border erp-border-soft erp-surface p-2.5 text-left transition-colors erp-hover"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-xs font-bold erp-text">
                            <span aria-hidden>{o.productImage}</span> {o.id}
                          </span>
                          <Badge tone={typeTone(o.type)}>{o.type === "ready_made" ? "Ready" : "Custom"}</Badge>
                        </div>
                        <p className="mt-1 truncate text-xs erp-text-muted">{o.customerName}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-bold erp-text">{inr(o.total)}</span>
                          <span className={cn("text-[11px] font-semibold", overdue ? "text-red-600" : "erp-text-faint")}>
                            {dueLabel(o.dueAt, now)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Row actions menu ----------

function RowMenu({ order }: { order: Order }) {
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const item = "flex w-full min-h-10 items-center gap-2.5 px-3 py-2 text-left text-sm erp-text hover:erp-surface-2";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label={`More actions for ${order.id}`}
        className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg" onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" className={item} onClick={() => nav(`/admin/orders/${order.id}`)}>View details</button>
          <button role="menuitem" className={item} onClick={() => nav(`/admin/orders/${order.id}`)}>Edit order</button>
          <button role="menuitem" className={item} onClick={() => toast.info("Tracking", `${order.trackingNumber ?? "No AWB yet"} · ${order.customerName}`)}>Track shipment</button>
          <button role="menuitem" className={item} onClick={() => toast.success("Invoice", `Invoice for ${order.id} is being prepared.`)}>Download invoice</button>
        </div>
      )}
    </div>
  );
}

// ---------- Compact table ----------

function OrdersTable({ rows }: { rows: Order[] }) {
  const now = useNow();
  const nav = useNavigate();
  const shipmentFor = (id: string) => shipments.find((s) => s.orderId === id);
  const headers = ["Product", "Order ID", "Customer", "Date", "Amount", "Qty", "Payment", "Production", "Shipping", "Status", "Tracking", ""];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">All orders</caption>
        <thead>
          <tr className="border-b erp-border text-left">
            {headers.map((h, i) => (
              <th
                key={h || i}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint",
                  (i === 3 || i === 5) && "hidden lg:table-cell",
                  (i === 7 || i === 8) && "hidden xl:table-cell",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const qty = o.lineItems.reduce((s, li) => s + li.quantity, 0);
            const overdue = new Date(o.dueAt).getTime() < now && o.status !== "delivered";
            const ship = shipmentFor(o.id);
            const pay = o.paymentStatus ? PAYMENT_STATUS[o.paymentStatus] : null;
            const prod = o.productionStatus ? PRODUCTION_STATUS[o.productionStatus] : null;
            return (
              <tr
                key={o.id}
                tabIndex={0}
                onClick={() => nav(`/admin/orders/${o.id}`)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), nav(`/admin/orders/${o.id}`))}
                className="cursor-pointer border-b erp-border-soft last:border-0 erp-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
              >
                {/* Product */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg erp-surface-2 text-lg" aria-hidden>{o.productImage}</span>
                    <div className="min-w-0">
                      <p className="max-w-40 truncate text-xs font-semibold erp-text">{o.productName}</p>
                      <Badge tone={typeTone(o.type)}>{o.type === "ready_made" ? "Ready" : "Custom"}</Badge>
                    </div>
                  </div>
                </td>
                {/* Order ID */}
                <td className="px-3 py-2.5"><span className="font-mono text-xs font-bold text-primary-600 dark:text-primary-400">{o.id}</span></td>
                {/* Customer */}
                <td className="px-3 py-2.5"><span className="block max-w-40 truncate erp-text-muted">{o.customerName}</span></td>
                {/* Date */}
                <td className="hidden whitespace-nowrap px-3 py-2.5 erp-text-muted lg:table-cell">{formatDate(o.placedAt)}</td>
                {/* Amount */}
                <td className="whitespace-nowrap px-3 py-2.5 font-bold tabular-nums erp-text">{inr(o.total)}</td>
                {/* Qty */}
                <td className="hidden px-3 py-2.5 tabular-nums erp-text-muted lg:table-cell">{qty.toLocaleString("en-IN")}</td>
                {/* Payment */}
                <td className="px-3 py-2.5">{pay && <Badge tone={pay.tone} dot>{pay.label}</Badge>}</td>
                {/* Production */}
                <td className="hidden px-3 py-2.5 xl:table-cell">{prod && <Badge tone={prod.tone}>{prod.label}</Badge>}</td>
                {/* Shipping */}
                <td className="hidden px-3 py-2.5 xl:table-cell">
                  {ship ? <Badge tone={SHIPMENT_STATUS[ship.status].tone}>{SHIPMENT_STATUS[ship.status].label}</Badge> : <span className="text-xs erp-text-faint">—</span>}
                </td>
                {/* Status */}
                <td className="px-3 py-2.5">
                  <Badge tone={TRACKING_TONE[o.trackingStage ?? "order_received"]} dot>
                    {TRACKING_STAGE[o.trackingStage ?? "order_received"].short}
                  </Badge>
                  {overdue && <span className="ml-1 text-[10px] font-bold text-red-600">• late</span>}
                </td>
                {/* Tracking */}
                <td className="px-3 py-2.5"><TrackingMini order={o} /></td>
                {/* Actions */}
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-0.5">
                    <button onClick={() => nav(`/admin/orders/${o.id}`)} aria-label={`View ${o.id}`} className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2">
                      <Eye className="h-4 w-4" aria-hidden />
                    </button>
                    <button onClick={() => nav(`/admin/orders/${o.id}`)} aria-label={`Edit ${o.id}`} className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2">
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <RowMenu order={o} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Page ----------

export default function Orders() {
  const all = useOrders();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<"table" | "pipeline">("table");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(searchParams.get("status") ?? "all");
  const [payment, setPayment] = useState<string>("all");
  const [production, setProduction] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const metrics = useMemo(
    () => ({
      total: all.length,
      inProduction: all.filter((o) => o.productionStatus === "in_progress").length,
      awaitingDispatch: all.filter((o) => o.trackingStage === "ready_for_dispatch" || o.trackingStage === "packing").length,
      delivered: all.filter((o) => o.trackingStage === "delivered").length,
    }),
    [all],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const shipmentAwb = (id: string) => shipments.find((s) => s.orderId === id)?.awb?.toLowerCase() ?? "";
    return all.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (type !== "all" && o.type !== type) return false;
      if (payment !== "all" && o.paymentStatus !== payment) return false;
      if (production !== "all" && o.productionStatus !== production) return false;
      if (term) {
        const hay = `${o.id} ${o.customerName} ${o.phone ?? ""} ${o.productName ?? ""} ${o.lineItems.map((li) => li.productName).join(" ")} ${o.trackingNumber ?? ""} ${shipmentAwb(o.id)}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [all, search, status, payment, production, type]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const safePage = Math.min(page, Math.max(pageCount, 1));
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const resetPage = () => setPage(1);

  const exportCsv = () => {
    downloadCsv(filtered);
    toast.success("Export ready", `${filtered.length} orders exported to CSV.`);
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Orders" }]}
        title="Orders"
        subtitle="Compact order management — payment, production and shipping at a glance."
        actions={<Button variant="primary" icon={Plus} onClick={() => setDialogOpen(true)}>New Order</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard label="Total Orders" value={metrics.total} icon={Package} to="/admin/orders" />
        <MetricCard label="In Production" value={metrics.inProduction} icon={LayoutGrid} to="/admin/orders?status=in_production" />
        <MetricCard label="Awaiting Dispatch" value={metrics.awaitingDispatch} icon={Truck} tone={metrics.awaitingDispatch > 0 ? "warn" : "default"} to="/admin/orders?status=packed" />
        <MetricCard label="Delivered" value={metrics.delivered} icon={PackageCheck} to="/admin/orders?status=delivered" />
      </div>

      <div className="mb-4">
        <Tabs
          tabs={[{ key: "table", label: "Table", icon: TableIcon }, { key: "pipeline", label: "Pipeline", icon: LayoutGrid }]}
          active={view}
          onChange={(k) => setView(k as "table" | "pipeline")}
        />
      </div>

      {view === "pipeline" ? (
        <Panel bodyClassName="p-3 sm:p-4"><Pipeline rows={filtered} /></Panel>
      ) : (
        <div className="space-y-4">
          <Toolbar>
            <SearchInput
              value={search}
              onChange={(v) => { setSearch(v); resetPage(); }}
              placeholder="Search order, customer, phone, product, SKU or tracking…"
              className="w-full sm:w-80"
            />
            <Select value={status} onChange={(v) => { setStatus(v); resetPage(); }} aria-label="Order status">
              <option value="all">All statuses</option>
              {ORDER_STATUS_FLOW.map((s) => <option key={s} value={s}>{ORDER_STATUS[s].label}</option>)}
            </Select>
            <Select value={payment} onChange={(v) => { setPayment(v); resetPage(); }} aria-label="Payment status">
              <option value="all">All payments</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="pending">Pending</option>
            </Select>
            <Select value={production} onChange={(v) => { setProduction(v); resetPage(); }} aria-label="Production status">
              <option value="all">All production</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </Select>
            <Select value={type} onChange={(v) => { setType(v); resetPage(); }} aria-label="Order type">
              <option value="all">All types</option>
              <option value="ready_made">Ready-made</option>
              <option value="custom">Custom</option>
            </Select>
            <Button variant="secondary" icon={Download} onClick={exportCsv} className="sm:ml-auto" disabled={filtered.length === 0}>
              Export
            </Button>
          </Toolbar>

          <Panel bodyClassName="p-0">
            {filtered.length === 0 ? (
              <EmptyState title="No orders match" message="Try clearing filters or searching a different term." />
            ) : (
              <>
                <OrdersTable rows={paged} />
                <Pagination page={safePage} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      <NewOrderDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
