import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Archive, CalendarClock, CheckCircle2, Copy, Eye, Image as ImageIcon, Megaphone, Pause, Pencil, Play, Plus, TimerOff } from "lucide-react";
import { marketingApi, type AdminCampaign, type CampaignContentType, type CampaignStatus, type StatusCounts } from "@/lib/api/marketing";
import { formatStoreDate, formatStoreDateTime } from "@/lib/store-time";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, SearchInput, Tabs } from "../../components/ui";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, ErrorState } from "../../components/Panel";
import { CampaignFormDrawer } from "./CampaignForm";
import { CampaignPreviewModal, PLACEMENT_LABEL } from "./CampaignPreview";
import { RowActions, StatusBadge, SummaryCards } from "./shared";

type Filter = "all" | CampaignStatus;

export const CONTENT_TYPE_LABEL: Record<CampaignContentType, string> = {
  text: "Text", image: "Image", quote: "Quote", text_image: "Text + Image", promo_card: "Promotional Card",
};

export default function CampaignsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<{ status: "loading" | "error" | "success"; campaigns: AdminCampaign[]; counts: StatusCounts<CampaignStatus> | null; error?: string }>({ status: "loading", campaigns: [], counts: null });
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminCampaign | null>(null);
  const [duplicating, setDuplicating] = useState<AdminCampaign | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [previewing, setPreviewing] = useState<AdminCampaign | null>(null);
  const [archiving, setArchiving] = useState<AdminCampaign | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await marketingApi.listCampaigns();
      setState({ status: "success", campaigns: d.campaigns, counts: d.counts });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : "Could not load campaigns." }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // "+ Create Campaign" quick action on the overview lands here with ?new=1.
  useEffect(() => {
    if (params.get("new") !== "1") return;
    setEditing(null); setDuplicating(null); setFormOpen(true);
    params.delete("new");
    setParams(params, { replace: true });
  }, [params, setParams]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.campaigns.filter((c) => (filter === "all" || c.status === filter) && (!q || c.name.toLowerCase().includes(q)));
  }, [state.campaigns, filter, search]);

  const setActive = async (c: AdminCampaign, on: boolean) => {
    try {
      const saved = await marketingApi.updateCampaign(c.id, on ? { isActive: true, isDraft: false } : { isActive: false });
      toast.success(
        on ? "Campaign activated" : "Campaign paused",
        saved.status === "scheduled" ? `${saved.name} goes live on ${formatStoreDateTime(saved.startAt)}.` : `${saved.name} is now ${saved.status}.`,
      );
      await load();
    } catch (e) {
      toast.error("Couldn't update the campaign", e instanceof Error ? e.message : "Please try again.");
    }
  };

  const archive = async () => {
    if (!archiving) return;
    setBusy(true);
    try {
      await marketingApi.archiveCampaign(archiving.id);
      toast.success("Campaign archived", `${archiving.name} was removed from the storefront.`);
      setArchiving(null);
      await load();
    } catch (e) {
      toast.error("Couldn't archive the campaign", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminCampaign>[] = [
    {
      key: "campaign", header: "Campaign", render: (c) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md erp-surface-2">
            {c.imageUrl ? <img src={c.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon className="h-4 w-4 erp-text-faint" aria-hidden />}
          </div>
          <div className="min-w-0">
            <div className="max-w-[240px] truncate font-semibold erp-text">{c.name}</div>
            <div className="max-w-[240px] truncate text-xs erp-text-muted">{c.title ?? c.quote ?? c.imageAlt ?? "—"}</div>
          </div>
        </div>
      ),
    },
    { key: "type", header: "Type", hideBelow: "md", render: (c) => <span className="whitespace-nowrap erp-text-muted">{CONTENT_TYPE_LABEL[c.contentType]}</span> },
    {
      key: "placement", header: "Placement", hideBelow: "sm", render: (c) => (
        <div className="flex max-w-[260px] flex-wrap gap-1">
          {c.placements.length ? c.placements.map((p) => <Badge key={p}>{PLACEMENT_LABEL[p]}</Badge>) : <span className="erp-text-faint">—</span>}
        </div>
      ),
    },
    { key: "start", header: "Start", hideBelow: "lg", render: (c) => <span className="whitespace-nowrap erp-text-muted" title={formatStoreDateTime(c.startAt)}>{formatStoreDate(c.startAt)}</span> },
    { key: "end", header: "End", hideBelow: "lg", render: (c) => <span className="whitespace-nowrap erp-text-muted" title={formatStoreDateTime(c.endAt)}>{formatStoreDate(c.endAt)}</span> },
    { key: "priority", header: "Priority", hideBelow: "md", render: (c) => <span className="font-mono font-semibold erp-text">{c.priority}</span> },
    { key: "status", header: "Status", render: (c) => <StatusBadge status={c.status} /> },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, className: "w-12", render: (c) => (
        <RowActions
          label={`Actions for ${c.name}`}
          actions={[
            { label: "Edit", icon: Pencil, onClick: () => { setDuplicating(null); setEditing(c); setFormOpen(true); } },
            { label: "Preview", icon: Eye, onClick: () => setPreviewing(c) },
            { label: c.isDraft ? "Publish" : "Activate", icon: Play, onClick: () => void setActive(c, true), hidden: c.isActive && !c.isDraft },
            { label: "Pause", icon: Pause, onClick: () => void setActive(c, false), hidden: !c.isActive || c.isDraft || c.status === "expired" },
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
    { key: "paused", label: "Paused", count: counts?.paused },
    { key: "expired", label: "Expired", count: counts?.expired },
    { key: "draft", label: "Draft", count: counts?.draft },
  ];

  return (
    <div className="space-y-5">
      <SummaryCards
        items={[
          { label: "Total campaigns", value: counts?.total ?? 0, icon: Megaphone, onClick: () => setFilter("all"), active: filter === "all" },
          { label: "Active", value: counts?.active ?? 0, icon: CheckCircle2, tone: "success", onClick: () => setFilter("active"), active: filter === "active" },
          { label: "Scheduled", value: counts?.scheduled ?? 0, icon: CalendarClock, tone: "info", onClick: () => setFilter("scheduled"), active: filter === "scheduled" },
          { label: "Expired", value: counts?.expired ?? 0, icon: TimerOff, tone: "danger", onClick: () => setFilter("expired"), active: filter === "expired" },
        ]}
      />

      <div className="erp-card card-shadow">
        <div className="flex flex-col gap-3 border-b erp-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by campaign name…" className="w-full sm:max-w-sm" aria-label="Search campaigns" />
          <Button variant="primary" icon={Plus} onClick={() => { setEditing(null); setDuplicating(null); setFormOpen(true); }}>Create campaign</Button>
        </div>
        <div className="overflow-x-auto px-4 pt-2"><Tabs tabs={tabs} active={filter} onChange={(k) => setFilter(k as Filter)} /></div>
        <div className="p-4">
          {state.status === "loading" && <TableSkeleton rows={5} cols={6} />}
          {state.status === "error" && <ErrorState message={state.error ?? "Could not load campaigns."} onRetry={() => void load()} />}
          {state.status === "success" && rows.length === 0 && (
            <EmptyState
              icon={Megaphone}
              title={state.campaigns.length === 0 ? "No campaigns yet" : "No campaigns match"}
              message={state.campaigns.length === 0 ? "Create a campaign to publish a banner, card, popup or announcement to the storefront — no developer needed." : "Try another filter or search term."}
            />
          )}
          {state.status === "success" && rows.length > 0 && <DataTable caption="Campaigns" columns={columns} rows={rows} rowKey={(c) => c.id} />}
        </div>
      </div>

      <CampaignFormDrawer
        open={formOpen}
        campaign={editing}
        duplicateOf={duplicating}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <CampaignPreviewModal
        open={!!previewing}
        onClose={() => setPreviewing(null)}
        campaign={previewing}
        popup={previewing?.popup ?? { position: "center", frequency: "once_per_session", delaySeconds: 0, allowClose: true, overlay: true }}
        placements={previewing?.placements ?? []}
        name={previewing?.name ?? ""}
      />

      <Dialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        title={`Archive “${archiving?.name ?? "campaign"}”?`}
        description="It disappears from the storefront immediately and from this list. This cannot be undone from the dashboard."
        footer={<><Button onClick={() => setArchiving(null)} disabled={busy}>Cancel</Button><Button variant="danger" icon={Archive} loading={busy} onClick={archive}>Archive</Button></>}
      />
    </div>
  );
}
