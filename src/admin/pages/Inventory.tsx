import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  IndianRupee,
  Package,
  PackageCheck,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { MetricCard } from "../components/MetricCard";
import { DataTable, TableSkeleton, type Column } from "../components/DataTable";
import { EmptyState, ErrorState, ListSkeleton, Panel, QueryState } from "../components/Panel";
import {
  Badge,
  Button,
  Dialog,
  PageHeader,
  SearchInput,
  Select,
  Tabs,
  Toolbar,
  type TabItem,
} from "../components/ui";
import { inrMinor, formatDate } from "../format";
import { useMockQuery } from "../hooks";
import { useAdminInventory, useAdminStockMovements, asMockQuery, type StockMovementRow } from "../dashboard-api";
import { useCatalog } from "../catalog-store";
import type { ProductStatus } from "../types";
import { PRODUCT_STATUS } from "../statuses-ext";
import type { InventoryItem } from "../types";

// ---------- Local helpers ----------


function daysOfCover(item: InventoryItem): number {
  return item.dailyConsumption > 0 ? Math.round(item.inStock / item.dailyConsumption) : Infinity;
}

function stockStatus(item: InventoryItem): { label: string; tone: "danger" | "warning" | "success" } {
  if (item.inStock < item.reorderLevel) return { label: "Below Reorder", tone: "danger" };
  if (daysOfCover(item) < 3) return { label: "Low Cover", tone: "warning" };
  return { label: "Healthy", tone: "success" };
}


// ---------- Raw Materials tab ----------

function RawMaterials() {
  // Real product stock from PostgreSQL. `available` is stock − reserved, so
  // units already committed to in-flight orders are not shown as sellable.
  const live = useAdminInventory();
  const inventory: InventoryItem[] = useMemo(
    () =>
      (live.data?.inventory ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category || "Uncategorised",
        unit: "pcs",
        inStock: p.available,
        reorderLevel: p.threshold ?? 0,
        // Not tracked on Product; shown as 0 rather than estimated.
        dailyConsumption: 0,
      })),
    [live.data],
  );
  const q = { ...asMockQuery(live), data: live.data ? inventory : null };
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => ["all", ...Array.from(new Set(inventory.map((i) => i.category)))], [inventory]);

  const rows = useMemo(() => {
    const data = q.data ?? [];
    const term = search.trim().toLowerCase();
    return data.filter(
      (i) =>
        (category === "all" || i.category === category) &&
        (term === "" || i.name.toLowerCase().includes(term)),
    );
  }, [q.data, search, category]);

  const columns: Column<InventoryItem>[] = [
    { key: "name", header: "Material", render: (i) => <span className="font-semibold erp-text">{i.name}</span> },
    { key: "category", header: "Category", render: (i) => <Badge tone="neutral">{i.category}</Badge>, hideBelow: "sm" },
    {
      key: "stock",
      header: "In Stock",
      render: (i) => (
        <span className="tabular-nums erp-text">
          {i.inStock.toLocaleString("en-IN")} <span className="erp-text-faint">{i.unit}</span>
        </span>
      ),
    },
    {
      key: "reorder",
      header: "Reorder Level",
      render: (i) => <span className="tabular-nums erp-text-muted">{i.reorderLevel.toLocaleString("en-IN")}</span>,
      hideBelow: "md",
    },
    {
      key: "cover",
      header: "Days of Cover",
      render: (i) => {
        const d = daysOfCover(i);
        return <span className="tabular-nums erp-text">{Number.isFinite(d) ? `${d} days` : "—"}</span>;
      },
      hideBelow: "lg",
    },
    {
      key: "status",
      header: "Status",
      render: (i) => {
        const s = stockStatus(i);
        return <Badge tone={s.tone} dot>{s.label}</Badge>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search materials…" className="w-full sm:w-64" />
        <Select value={category} onChange={setCategory} aria-label="Filter by category">
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All categories" : c}
            </option>
          ))}
        </Select>
        <span className="text-xs erp-text-faint">{rows.length} item{rows.length === 1 ? "" : "s"}</span>
      </Toolbar>
      <Panel bodyClassName="p-0">
        <QueryState query={q} skeleton={<div className="p-4"><TableSkeleton rows={8} cols={6} /></div>}>
          {() =>
            rows.length === 0 ? (
              <EmptyState icon={Boxes} title="No materials" message="Nothing matches your filters." />
            ) : (
              <div className="px-4 sm:px-5">
                <DataTable caption="Raw materials" columns={columns} rows={rows} rowKey={(i) => i.id} />
              </div>
            )
          }
        </QueryState>
      </Panel>
    </div>
  );
}

// ---------- Finished Goods tab ----------

interface FinishedRow {
  id: string;
  product: string;
  emoji: string;
  variant: string;
  sku: string;
  inStock: number;
  status: ProductStatus;
}

function FinishedGoods() {
  const catalogProducts = useCatalog(); // reactive — reflects stock/status edits
  const flattened: FinishedRow[] = useMemo(
    () =>
      catalogProducts.flatMap((p) =>
        p.variants.map((v) => ({
          id: v.sku,
          product: p.name,
          emoji: p.imageEmoji,
          variant: v.label,
          sku: v.sku,
          inStock: v.inStock,
          status: p.status,
        })),
      ),
    [catalogProducts],
  );
  const q = useMockQuery(flattened, 500);

  const columns: Column<FinishedRow>[] = [
    {
      key: "product",
      header: "Product",
      render: (r) => (
        <span className="flex items-center gap-2 font-semibold erp-text">
          <span aria-hidden>{r.emoji}</span> {r.product}
        </span>
      ),
    },
    { key: "variant", header: "Variant", render: (r) => <span className="erp-text-muted">{r.variant}</span>, hideBelow: "sm" },
    { key: "sku", header: "SKU", render: (r) => <span className="font-mono text-xs erp-text-muted">{r.sku}</span>, hideBelow: "md" },
    {
      key: "stock",
      header: "In Stock",
      render: (r) => (
        <span className={cn("tabular-nums font-semibold", r.inStock === 0 ? "text-red-600 dark:text-red-400" : "erp-text")}>
          {r.inStock.toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const m = PRODUCT_STATUS[r.status];
        return <Badge tone={m.tone}>{m.label}</Badge>;
      },
    },
  ];

  return (
    <Panel bodyClassName="p-0">
      <QueryState query={q} skeleton={<div className="p-4"><TableSkeleton rows={8} cols={5} /></div>}>
        {(data) => (
          <div className="px-4 sm:px-5">
            <DataTable caption="Finished goods" columns={columns} rows={data} rowKey={(r) => r.id} />
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

// ---------- Stock Movement tab ----------

const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Receipt",
  CONSUMPTION: "Consumption",
  PRODUCTION_OUTPUT: "Production",
  DISPATCH: "Dispatch",
  RETURN: "Return",
  ADJUSTMENT: "Adjustment",
  DAMAGE: "Damage",
};

const MOVEMENT_TONE_BY_TYPE: Record<string, "success" | "danger" | "info" | "warning"> = {
  RECEIPT: "success",
  PRODUCTION_OUTPUT: "success",
  RETURN: "success",
  CONSUMPTION: "warning",
  DISPATCH: "info",
  DAMAGE: "danger",
  ADJUSTMENT: "info",
};

/**
 * Stock movement ledger — real StockMovement rows from
 * GET /admin/inventory/movements. Every line explains one change to on-hand
 * stock, and `balance` is the quantity after that change.
 */
function StockMovementTab() {
  const live = useAdminStockMovements(null, 100);
  const q = asMockQuery(live);

  const columns: Column<StockMovementRow>[] = [
    {
      key: "item",
      header: "Item",
      render: (m) => (
        <span className="flex items-center gap-2 font-semibold erp-text">
          <span aria-hidden>{m.emoji ?? "\u{1F4E6}"}</span>
          <span className="min-w-0">
            <span className="block truncate">{m.productName ?? "—"}</span>
            <span className="block font-mono text-xs font-normal erp-text-muted">{m.sku}</span>
          </span>
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (m) => (
        <Badge tone={MOVEMENT_TONE_BY_TYPE[m.type] ?? "info"} dot>
          {MOVEMENT_LABEL[m.type] ?? m.type}
        </Badge>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      className: "text-right",
      render: (m) => (
        <span
          className={cn(
            "tabular-nums font-semibold",
            m.quantity >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
          )}
        >
          {m.quantity >= 0 ? "+" : ""}
          {m.quantity.toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right",
      render: (m) => <span className="tabular-nums erp-text">{m.balance.toLocaleString("en-IN")}</span>,
      hideBelow: "sm",
    },
    {
      key: "reason",
      header: "Reason",
      render: (m) => <span className="erp-text-muted">{m.reason ?? "—"}</span>,
      hideBelow: "md",
    },
    {
      key: "at",
      header: "When",
      render: (m) => <span className="erp-text-muted">{formatDate(m.createdAt)}</span>,
      hideBelow: "sm",
    },
    { key: "by", header: "By", render: (m) => <span className="erp-text-muted">{m.actor}</span>, hideBelow: "lg" },
  ];

  return (
    <Panel bodyClassName="p-0">
      <QueryState
        query={q}
        skeleton={<div className="p-4"><TableSkeleton rows={6} cols={6} /></div>}
        isEmpty={(d) => d.movements.length === 0}
        empty={
          <EmptyState
            icon={PackageCheck}
            title="No stock movements yet"
            message="Receipts, dispatches and adjustments appear here as they happen."
          />
        }
      >
        {(data) => (
          <div className="px-4 sm:px-5">
            <DataTable caption="Stock movements" columns={columns} rows={data.movements} rowKey={(m) => m.id} />
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

// ---------- Low Stock tab ----------

function LowStockTab() {
  // REAL data: the same /admin/inventory endpoint the dashboard tile uses,
  // filtered to low/out-of-stock. The previous version read a mock array that
  // was permanently empty, so this tab always claimed "All healthy" while the
  // dashboard showed genuine low-stock products.
  const live = useAdminInventory(true);
  const alerts = useMemo(() => live.data?.inventory ?? [], [live.data]);

  if (live.status === "loading") return <ListSkeleton rows={4} />;
  if (live.status === "error") return <ErrorState message={live.error} onRetry={live.refetch} />;
  if (alerts.length === 0) {
    return <EmptyState icon={PackageCheck} title="All healthy" message="No products are below their low-stock threshold." />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {alerts.map((item) => {
        const critical = item.available <= 0;
        return (
          <div key={item.id} className="flex flex-col gap-3 rounded-xl border erp-border erp-surface card-shadow p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold erp-text">{item.name}</p>
                <p className="mt-0.5 text-xs erp-text-faint">
                  {item.available.toLocaleString("en-IN")} available ({item.stock.toLocaleString("en-IN")} on hand
                  {item.reserved > 0 ? `, ${item.reserved.toLocaleString("en-IN")} reserved` : ""})
                  {item.threshold != null && ` · threshold ${item.threshold.toLocaleString("en-IN")}`}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold whitespace-nowrap",
                  critical
                    ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
                )}
              >
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                {critical ? "Out of stock" : "Low stock"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Purchase Request dialog ----------

function PurchaseRequestButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Material options come from the real product list.
  const live = useAdminInventory();
  const inventory = useMemo(() => live.data?.inventory ?? [], [live.data]);
  const [material, setMaterial] = useState("");
  const [qty, setQty] = useState("1000");

  return (
    <>
      <Button variant="primary" icon={Package} onClick={() => setOpen(true)}>
        Purchase Request
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New purchase request"
        description="Raise a request for materials running low."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                toast.success("Request submitted", `${qty} units of ${material} requested.`);
                setOpen(false);
              }}
            >
              Submit request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Material</span>
            <Select value={material} onChange={setMaterial} className="w-full" aria-label="Material">
              {inventory.map((i) => (
                <option key={i.id} value={i.name}>
                  {i.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Quantity</span>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20"
            />
          </label>
        </div>
      </Dialog>
    </>
  );
}

// ---------- Page ----------

export default function Inventory() {
  const [tab, setTab] = useState("raw");
  const catalogProducts = useCatalog();
  // Real stock rows drive the tab counts and headline figures.
  const live = useAdminInventory();
  const inventory = useMemo(() => live.data?.inventory ?? [], [live.data]);

  const totalSkus = catalogProducts.reduce((s, p) => s + p.variants.length, 0) + inventory.length;
  const lowCount = inventory.filter((p) => p.state === "low_stock").length;
  const outOfStock = inventory.filter((p) => p.state === "out_of_stock").length;

  const tabs: TabItem[] = [
    { key: "raw", label: "Raw Materials", count: inventory.length, icon: Boxes },
    { key: "finished", label: "Finished Goods", icon: PackageCheck },
    { key: "movement", label: "Stock Movement", icon: ArrowUpRight },
    { key: "low", label: "Low Stock", count: lowCount, icon: TriangleAlert },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Inventory" }]}
        title="Inventory"
        subtitle="Raw materials, finished goods, stock movement and reorder alerts."
        actions={<PurchaseRequestButton />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total SKUs" value={totalSkus} icon={Boxes} detail="materials + variants" to="/admin/inventory" />
        <MetricCard
          label="Low Stock"
          value={lowCount}
          icon={TriangleAlert}
          tone={lowCount > 0 ? "danger" : "default"}
          detail={lowCount > 0 ? <span className="font-bold text-red-600 dark:text-red-400">need reorder</span> : "all healthy"}
          to="/admin/inventory"
        />
        <MetricCard
          label="Out of Stock"
          value={outOfStock}
          icon={ArrowDownRight}
          tone={outOfStock > 0 ? "warn" : "default"}
          detail="finished variants"
          to="/admin/inventory"
        />
        {/* Real valuation: sum of stock x costMinor. Products without a cost
            can't be valued, so the caption says how many are covered rather
            than implying the figure spans the whole catalogue. */}
        <MetricCard
          label="Stock Value"
          value={live.data ? inrMinor(live.data.valuation.stockValueMinor) : "—"}
          icon={IndianRupee}
          detail={
            live.data
              ? live.data.valuation.pricedProducts === 0
                ? "no unit costs recorded"
                : `${live.data.valuation.pricedProducts} of ${live.data.valuation.totalProducts} products costed`
              : "loading"
          }
          to="/admin/inventory"
        />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "raw" && <RawMaterials />}
      {tab === "finished" && <FinishedGoods />}
      {tab === "movement" && <StockMovementTab />}
      {tab === "low" && <LowStockTab />}
    </div>
  );
}
