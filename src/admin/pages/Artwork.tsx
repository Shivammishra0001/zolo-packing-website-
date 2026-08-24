import { useMemo, useState } from "react";
import { CheckCircle2, Image as ImageIcon, PenSquare, Rocket, XCircle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Drawer, PageHeader, SearchInput, Tabs, Timeline, Toolbar, type TimelineEntry } from "../components/ui";
import { TableSkeleton } from "../components/DataTable";
import { MetricCard } from "../components/MetricCard";
import { EmptyState, QueryState } from "../components/Panel";
import { formatDateTime, relativeTime } from "../format";
import { useMockQuery } from "../hooks";
import { artworkJobs } from "../mock-data-ext";
import { ARTWORK_STATUS } from "../statuses-ext";
import type { ArtworkJob, ArtworkStatus } from "../types";

const TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "changes_requested", label: "Changes" },
  { key: "approved", label: "Approved" },
  { key: "released", label: "Released" },
  { key: "rejected", label: "Rejected" },
];

function ArtworkDrawer({ job, onClose, onAction }: { job: ArtworkJob | null; onClose: () => void; onAction: (label: string, job: ArtworkJob) => void }) {
  if (!job) return null;
  const meta = ARTWORK_STATUS[job.status];
  const entries: TimelineEntry[] = [...job.versions]
    .reverse()
    .map((v) => ({
      id: `v${v.version}`,
      title: <span><span className="font-semibold">v{v.version}</span> · {v.fileName}</span>,
      meta: (
        <>
          <span className="block">{v.uploadedBy}</span>
          {v.note && <span className="mt-0.5 block italic">“{v.note}”</span>}
          <span className="mt-1 inline-block"><Badge tone={ARTWORK_STATUS[v.status].tone}>{ARTWORK_STATUS[v.status].label}</Badge></span>
        </>
      ),
      time: formatDateTime(v.uploadedAt),
      tone: ARTWORK_STATUS[v.status].tone,
    }));

  return (
    <Drawer
      open={!!job}
      onClose={onClose}
      title={`${job.id} · ${job.customerName}`}
      width="max-w-xl"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => onAction("Approved", job)}>Approve</Button>
          <Button size="sm" variant="secondary" icon={PenSquare} onClick={() => onAction("Changes requested for", job)}>Request Changes</Button>
          <Button size="sm" variant="danger" icon={XCircle} onClick={() => onAction("Rejected", job)}>Reject</Button>
          <Button size="sm" variant="secondary" icon={Rocket} onClick={() => onAction("Released to production", job)}>Release</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="erp-text-muted">Order {job.orderId}</span>
          <span className="erp-text-faint">·</span>
          <span className="erp-text-muted">{job.product}</span>
        </div>

        <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed erp-border erp-surface-2">
          <div className="flex flex-col items-center gap-2 erp-text-faint">
            <ImageIcon className="h-8 w-8" aria-hidden />
            <span className="text-xs font-medium">Preview · {job.versions[job.versions.length - 1]?.fileName}</span>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold erp-text">Version history</h3>
          <Timeline entries={entries} />
        </div>
      </div>
    </Drawer>
  );
}

export default function Artwork() {
  const q = useMockQuery(artworkJobs, 500);
  const toast = useToast();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ArtworkJob | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of artworkJobs) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return artworkJobs.filter((j) => {
      if (tab !== "all" && j.status !== (tab as ArtworkStatus)) return false;
      if (!s) return true;
      return [j.id, j.orderId, j.customerName, j.product].some((f) => f.toLowerCase().includes(s));
    });
  }, [tab, search]);

  function handleAction(label: string, job: ArtworkJob) {
    setSelected(null);
    toast.success("Artwork updated", `${label} ${job.id}.`);
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Artwork" }]}
        title="Artwork Management"
        subtitle="Review, approve and release print-ready artwork to production."
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Pending Review" value={counts.pending ?? 0} icon={ImageIcon} tone={counts.pending ? "warn" : "default"} to="/admin/artwork" detail="awaiting first look" />
        <MetricCard label="Changes Requested" value={counts.changes_requested ?? 0} icon={PenSquare} to="/admin/artwork" detail="back with design" />
        <MetricCard label="Approved" value={counts.approved ?? 0} icon={CheckCircle2} to="/admin/artwork" detail="ready to release" />
        <MetricCard label="Released" value={counts.released ?? 0} icon={Rocket} to="/admin/artwork" detail="in production" />
      </div>

      <div className="mb-4">
        <Tabs tabs={TABS.map((t) => ({ ...t, count: t.key === "all" ? artworkJobs.length : counts[t.key] ?? 0 }))} active={tab} onChange={setTab} />
      </div>

      <Toolbar className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by order, customer, product…" className="w-full sm:w-80" />
      </Toolbar>

      <div className="erp-card card-shadow p-4 sm:p-5">
        <QueryState
          query={q}
          skeleton={<TableSkeleton rows={5} cols={6} />}
          isEmpty={() => filtered.length === 0}
          empty={<EmptyState icon={ImageIcon} title="No artwork here" message="Nothing matches the current filters." />}
        >
          {() => (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Artwork jobs</caption>
                <thead>
                  <tr className="border-b erp-border text-left">
                    {["Artwork", "Order", "Customer", "Product", "Status", "Version", "Updated"].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint first:pl-0 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((j) => (
                    <tr
                      key={j.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => setSelected(j)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(j); } }}
                      className="cursor-pointer border-b erp-border-soft last:border-0 transition-colors erp-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
                    >
                      <td className="px-3 py-3 first:pl-0"><span className="font-semibold erp-text">{j.id}</span></td>
                      <td className="hidden px-3 py-3 sm:table-cell"><span className="erp-text-muted">{j.orderId}</span></td>
                      <td className="px-3 py-3"><span className="block max-w-44 truncate erp-text">{j.customerName}</span></td>
                      <td className="hidden px-3 py-3 md:table-cell"><span className="erp-text-muted">{j.product}</span></td>
                      <td className="px-3 py-3"><Badge tone={ARTWORK_STATUS[j.status].tone}>{ARTWORK_STATUS[j.status].label}</Badge></td>
                      <td className="hidden px-3 py-3 sm:table-cell"><span className="tabular-nums erp-text-muted">v{j.currentVersion}</span></td>
                      <td className="hidden px-3 py-3 last:pr-0 lg:table-cell"><span className="erp-text-faint" title={formatDateTime(j.updatedAt)}>{relativeTime(j.updatedAt)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </div>

      <ArtworkDrawer job={selected} onClose={() => setSelected(null)} onAction={handleAction} />
    </div>
  );
}
