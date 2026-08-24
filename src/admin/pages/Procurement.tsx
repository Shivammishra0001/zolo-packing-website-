import { useMemo, useState } from "react";
import { ClipboardList, IndianRupee, PackageCheck, Plus, Star, TriangleAlert, Truck } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, PageHeader, SearchInput, Select, Tabs, Toolbar } from "../components/ui";
import { DataTable, type Column } from "../components/DataTable";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/Panel";
import { formatDate, inr } from "../format";
import { purchaseOrders, suppliers } from "../mock-data-ext";
import { PO_STATUS } from "../statuses-ext";
import type { PurchaseOrder, Supplier } from "../types";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${rating} out of 5`}>
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
      <span className="text-xs font-semibold erp-text">{rating.toFixed(1)}</span>
    </span>
  );
}

function POTab() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);

  const metrics = useMemo(() => {
    const openPOs = purchaseOrders.filter((p) => p.status === "sent" || p.status === "partial");
    const value = openPOs.reduce((s, p) => s + p.amount, 0);
    const received = purchaseOrders.filter((p) => p.status === "received").length;
    const now = Date.now();
    const overdue = openPOs.filter((p) => new Date(p.expectedAt).getTime() < now).length;
    return { open: openPOs.length, value, received, overdue };
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return purchaseOrders.filter((p) => {
      if (status !== "all" && p.status !== status) return false;
      if (!s) return true;
      return [p.id, p.supplierName, p.material].some((f) => f.toLowerCase().includes(s));
    });
  }, [search, status]);

  const columns: Column<PurchaseOrder>[] = [
    { key: "id", header: "PO", render: (p) => <span className="font-semibold erp-text">{p.id}</span> },
    { key: "supplier", header: "Supplier", render: (p) => <span className="block max-w-40 truncate erp-text">{p.supplierName}</span> },
    { key: "material", header: "Material", render: (p) => <span className="erp-text-muted">{p.material}</span>, hideBelow: "md" },
    { key: "qty", header: "Qty", render: (p) => <span className="tabular-nums erp-text-muted">{p.quantity.toLocaleString("en-IN")} {p.unit}</span>, hideBelow: "sm" },
    { key: "amount", header: "Amount", render: (p) => <span className="font-semibold tabular-nums erp-text">{inr(p.amount)}</span> },
    { key: "status", header: "Status", render: (p) => <Badge tone={PO_STATUS[p.status].tone}>{PO_STATUS[p.status].label}</Badge> },
    { key: "raised", header: "Raised", render: (p) => <span className="erp-text-faint">{formatDate(p.raisedAt)}</span>, hideBelow: "lg" },
    { key: "expected", header: "Expected", render: (p) => <span className="erp-text-muted">{formatDate(p.expectedAt)}</span>, hideBelow: "sm" },
  ];

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Open POs" value={metrics.open} icon={ClipboardList} to="/admin/procurement" detail="sent or partial" />
        <MetricCard label="Open Value" value={inr(metrics.value)} icon={IndianRupee} to="/admin/procurement" detail="committed spend" />
        <MetricCard label="Received" value={metrics.received} icon={PackageCheck} to="/admin/procurement" detail="fully delivered" />
        <MetricCard label="Overdue" value={metrics.overdue} icon={TriangleAlert} tone={metrics.overdue ? "danger" : "default"} to="/admin/procurement" detail="past expected date" />
      </div>

      <Toolbar className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search POs, suppliers, material…" className="w-full sm:w-80" />
        <Select value={status} onChange={setStatus} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {Object.entries(PO_STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <Button variant="primary" icon={Plus} className="sm:ml-auto" onClick={() => setOpen(true)}>New PO</Button>
      </Toolbar>

      <div className="erp-card card-shadow p-4 sm:p-5">
        {filtered.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No purchase orders" message="Nothing matches the filters." />
        ) : (
          <DataTable caption="Purchase orders" columns={columns} rows={filtered} rowKey={(p) => p.id} />
        )}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Raise Purchase Order"
        description="Order material from a supplier."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setOpen(false); toast.success("Purchase order raised", "Draft PO created and ready to send."); }}>Raise PO</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Supplier</span>
            <Select value={suppliers[0].id} onChange={() => {}} className="mt-1 w-full">
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Material</span>
            <input placeholder="e.g. Kraft Paper 320 GSM" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Quantity</span>
            <input type="number" placeholder="0" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
          </label>
        </div>
      </Dialog>
    </>
  );
}

function SuppliersTab() {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return suppliers.filter((sup) => !s || [sup.name, sup.category, sup.city, sup.contact].some((f) => f.toLowerCase().includes(s)));
  }, [search]);

  const columns: Column<Supplier>[] = [
    { key: "name", header: "Supplier", render: (s) => <div><div className="font-semibold erp-text">{s.name}</div><div className="text-xs erp-text-faint">{s.category}</div></div> },
    { key: "contact", header: "Contact", render: (s) => <div><div className="erp-text">{s.contact}</div><div className="text-xs erp-text-faint">{s.phone}</div></div>, hideBelow: "sm" },
    { key: "city", header: "City", render: (s) => <span className="erp-text-muted">{s.city}</span>, hideBelow: "md" },
    { key: "gstin", header: "GSTIN", render: (s) => <span className="font-mono text-xs erp-text-muted">{s.gstin}</span>, hideBelow: "lg" },
    { key: "rating", header: "Rating", render: (s) => <Stars rating={s.rating} /> },
    { key: "pos", header: "Active POs", render: (s) => <Badge tone={s.activePOs > 0 ? "primary" : "neutral"}>{s.activePOs}</Badge> },
  ];

  return (
    <>
      <Toolbar className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search suppliers…" className="w-full sm:w-72" />
      </Toolbar>
      <div className="erp-card card-shadow p-4 sm:p-5">
        {filtered.length === 0 ? (
          <EmptyState icon={Truck} title="No suppliers" message="Nothing matches your search." />
        ) : (
          <DataTable caption="Suppliers" columns={columns} rows={filtered} rowKey={(s) => s.id} />
        )}
      </div>
    </>
  );
}

function GoodsReceiptTab() {
  const toast = useToast();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const receivable = purchaseOrders.filter((p) => p.status === "sent" || p.status === "partial" || p.status === "received");

  return (
    <>
      <p className="mb-4 text-sm erp-text-muted">Record inward stock against open purchase orders.</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {receivable.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 erp-card card-shadow p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold erp-text">{p.id}</span>
                <Badge tone={PO_STATUS[p.status].tone}>{PO_STATUS[p.status].label}</Badge>
              </div>
              <div className="mt-0.5 truncate text-sm erp-text-muted">{p.material}</div>
              <div className="mt-0.5 text-xs erp-text-faint">{p.supplierName} · {p.quantity.toLocaleString("en-IN")} {p.unit} · exp. {formatDate(p.expectedAt)}</div>
            </div>
            <Button size="sm" variant="secondary" icon={PackageCheck} onClick={() => setPo(p)} disabled={p.status === "received"}>
              {p.status === "received" ? "Received" : "Record Receipt"}
            </Button>
          </div>
        ))}
      </div>

      <Dialog
        open={!!po}
        onClose={() => setPo(null)}
        title={`Record Receipt · ${po?.id ?? ""}`}
        description={po?.material}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPo(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => { toast.success("Goods received", `Stock recorded against ${po?.id}.`); setPo(null); }}>Confirm Receipt</Button>
          </>
        }
      >
        <label className="block">
          <span className="text-xs font-semibold erp-text-muted">Quantity received ({po?.unit})</span>
          <input type="number" defaultValue={po?.quantity} className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
        </label>
      </Dialog>
    </>
  );
}

const TABS = [
  { key: "po", label: "Purchase Orders", icon: ClipboardList },
  { key: "suppliers", label: "Suppliers", icon: Truck },
  { key: "receipt", label: "Goods Receipt", icon: PackageCheck },
];

export default function Procurement() {
  const [tab, setTab] = useState("po");
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Procurement" }]}
        title="Procurement"
        subtitle="Purchase orders, suppliers and goods receipt for raw materials."
      />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      {tab === "po" && <POTab />}
      {tab === "suppliers" && <SuppliersTab />}
      {tab === "receipt" && <GoodsReceiptTab />}
    </div>
  );
}
