import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Archive, CalendarClock, CheckCircle2, Copy, Pause, Pencil, Play, Plus, Tag, TimerOff } from "lucide-react";
import { marketingApi, type AdminCoupon, type CouponStatus, type StatusCounts } from "@/lib/api/marketing";
import { formatStoreDate, formatStoreDateTime } from "@/lib/store-time";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, SearchInput, Tabs } from "../../components/ui";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, ErrorState } from "../../components/Panel";
import { inrMinor } from "../../format";
import { CouponFormDrawer } from "./CouponForm";
import { RowActions, StatusBadge, SummaryCards } from "./shared";

type Filter = "all" | "active" | "scheduled" | "expired" | "paused" | "draft";

export const discountLabel = (c: Pick<AdminCoupon, "discountType" | "discountValue">) =>
  c.discountType === "percent" ? `${c.discountValue / 100}% OFF` : `${inrMinor(c.discountValue)} OFF`;

export default function CouponsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<{ status: "loading" | "error" | "success"; coupons: AdminCoupon[]; counts: StatusCounts<CouponStatus> | null; error?: string }>({ status: "loading", coupons: [], counts: null });
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [duplicating, setDuplicating] = useState<AdminCoupon | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [archiving, setArchiving] = useState<AdminCoupon | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await marketingApi.listCoupons();
      setState({ status: "success", coupons: d.coupons, counts: d.counts });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : "Could not load coupons." }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // "+ Create Coupon" quick action on the overview lands here with ?new=1.
  useEffect(() => {
    if (params.get("new") !== "1") return;
    setEditing(null); setDuplicating(null); setFormOpen(true);
    params.delete("new");
    setParams(params, { replace: true });
  }, [params, setParams]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.coupons.filter((c) => {
      // "Expired" groups everything that can no longer be redeemed.
      const bucket = c.status === "usage_limit_reached" ? "expired" : c.status;
      if (filter !== "all" && bucket !== filter) return false;
      return !q || c.code.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q);
    });
  }, [state.coupons, filter, search]);

  const setActive = async (c: AdminCoupon, on: boolean) => {
    try {
      const saved = await marketingApi.updateCoupon(c.id, on ? { isActive: true, isDraft: false } : { isActive: false });
      toast.success(on ? "Coupon activated" : "Coupon paused", `${saved.code} is now ${saved.status.replace(/_/g, " ")}.`);
      await load();
    } catch (e) {
      toast.error("Couldn't update the coupon", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const archive = async () => {
    if (!archiving) return;
    setBusy(true);
    try {
      await marketingApi.archiveCoupon(archiving.id);
      toast.success("Coupon archived", `${archiving.code} can no longer be used. Past orders keep their discount.`);
      setArchiving(null);
      await load();
    } catch (e) {
      toast.error("Couldn't archive the coupon", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminCoupon>[] = [
    { key: "code", header: "Code", render: (c) => <span className="font-mono font-bold erp-text">{c.code}</span> },
    { key: "name", header: "Name", hideBelow: "md", render: (c) => <span className="block max-w-[220px] truncate erp-text-muted">{c.name ?? "—"}</span> },
    {
      key: "discount", header: "Discount", render: (c) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone="primary">{discountLabel(c)}</Badge>
          {c.maxDiscountMinor != null && <span className="text-[11px] erp-text-faint">up to {inrMinor(c.maxDiscountMinor)}</span>}
          {c.appliesTo !== "all" && <span className="text-[11px] erp-text-faint">{c.appliesTo === "products" ? `${c.products.length} product${c.products.length === 1 ? "" : "s"}` : `${c.categories.length} categor${c.categories.length === 1 ? "y" : "ies"}`}</span>}
        </div>
      ),
    },
    { key: "min", header: "Minimum order", hideBelow: "lg", render: (c) => <span className="erp-text-muted">{c.minOrderMinor ? inrMinor(c.minOrderMinor) : "—"}</span> },
    {
      key: "usage", header: "Usage", hideBelow: "sm", render: (c) => (
        <div className="min-w-[96px]">
          <div className="text-xs font-semibold erp-text">{c.usageCount.toLocaleString("en-IN")} / {c.usageLimit != null ? c.usageLimit.toLocaleString("en-IN") : "∞"}</div>
          {c.usageLimit != null && (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full erp-surface-2">
              <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min((c.usageCount / c.usageLimit) * 100, 100)}%` }} />
            </div>
          )}
        </div>
      ),
    },
    { key: "start", header: "Start", hideBelow: "lg", render: (c) => <span className="whitespace-nowrap erp-text-muted" title={formatStoreDateTime(c.startAt)}>{formatStoreDate(c.startAt)}</span> },
    { key: "end", header: "End", hideBelow: "md", render: (c) => <span className="whitespace-nowrap erp-text-muted" title={formatStoreDateTime(c.endAt)}>{formatStoreDate(c.endAt)}</span> },
    { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, className: "w-12", render: (c) => (
        <RowActions
          label={`Actions for ${c.code}`}
          actions={[
            { label: "Edit", icon: Pencil, onClick: () => { setDuplicating(null); setEditing(c); setFormOpen(true); } },
            { label: "Pause", icon: Pause, onClick: () => void setActive(c, false), hidden: !c.isActive || c.isDraft || c.status === "expired" },
            { label: c.isDraft ? "Publish" : "Activate", icon: Play, onClick: () => void setActive(c, true), hidden: c.isActive && !c.isDraft },
            { label: "Duplicate", icon: Copy, onClick: () => { setEditing(null); setDuplicating(c); setFormOpen(true); } },
            { label: "Archive", icon: Archive, danger: true, onClick: () => setArchiving(c) },
          ]}
        />
      ),
    },
  ];

  const counts = state.counts;
  const tabs = [
    { key: "all", label: "All", count: counts?.total },
    { key: "active", label: "Active", count: counts?.active },
    { key: "scheduled", label: "Scheduled", count: counts?.scheduled },
    { key: "expired", label: "Expired", count: counts ? counts.expired + counts.usage_limit_reached : undefined },
    { key: "paused", label: "Paused", count: counts?.paused },
    { key: "draft", label: "Draft", count: counts?.draft },
  ];

  return (
    <div className="space-y-5">
      <SummaryCards
        items={[
          { label: "Total coupons", value: counts?.total ?? 0, icon: Tag, onClick: () => setFilter("all"), active: filter === "all" },
          { label: "Active", value: counts?.active ?? 0, icon: CheckCircle2, tone: "success", onClick: () => setFilter("active"), active: filter === "active" },
          { label: "Scheduled", value: counts?.scheduled ?? 0, icon: CalendarClock, tone: "info", onClick: () => setFilter("scheduled"), active: filter === "scheduled" },
          { label: "Expired", value: counts ? counts.expired + counts.usage_limit_reached : 0, icon: TimerOff, tone: "danger", onClick: () => setFilter("expired"), active: filter === "expired" },
        ]}
      />

      <div className="erp-card card-shadow">
        <div className="flex flex-col gap-3 border-b erp-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by coupon code or name…" className="w-full sm:max-w-sm" aria-label="Search coupons" />
          <Button variant="primary" icon={Plus} onClick={() => { setEditing(null); setDuplicating(null); setFormOpen(true); }}>Create coupon</Button>
        </div>
        <div className="overflow-x-auto px-4 pt-2"><Tabs tabs={tabs} active={filter} onChange={(k) => setFilter(k as Filter)} /></div>
        <div className="p-4">
          {state.status === "loading" && <TableSkeleton rows={5} cols={6} />}
          {state.status === "error" && <ErrorState message={state.error ?? "Could not load coupons."} onRetry={() => void load()} />}
          {state.status === "success" && rows.length === 0 && (
            <EmptyState
              icon={Tag}
              title={state.coupons.length === 0 ? "No coupons yet" : "No coupons match"}
              message={state.coupons.length === 0 ? "Create your first coupon — customers can apply it at checkout as soon as its schedule starts." : "Try another filter or search term."}
            />
          )}
          {state.status === "success" && rows.length > 0 && <DataTable caption="Coupons" columns={columns} rows={rows} rowKey={(c) => c.id} />}
        </div>
      </div>

      <CouponFormDrawer
        open={formOpen}
        coupon={editing}
        duplicateOf={duplicating}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <Dialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.code ?? "coupon"}?`}
        description="Customers will no longer be able to use this code. Orders that already used it keep their discount, and the code stays reserved."
        footer={<><Button onClick={() => setArchiving(null)} disabled={busy}>Cancel</Button><Button variant="danger" icon={Archive} loading={busy} onClick={archive}>Archive</Button></>}
      />
    </div>
  );
}
