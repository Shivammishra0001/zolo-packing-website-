import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Eye, ListChecks, Recycle, ScanSearch, ThumbsUp, XCircle } from "lucide-react";
import {
  adminRecyclingApi, fmtQty, RECYCLING_STATUS_LABEL, type AdminRecyclingRequest, type RecyclingCounts, type RecyclingStatus,
} from "@/lib/api/recycling";
import { describeApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, SearchInput, Tabs } from "../../components/ui";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, ErrorState } from "../../components/Panel";
import { formatDate } from "../../format";
import { FIELD, RowActions, SummaryCards } from "../marketing/shared";

// Recycling Requests — submitted by customers, verified by an admin. The
// "Eco Credits" column is always the SERVER's number: the live calculation
// while a request is under verification, the frozen award once approved.

const TONE: Record<RecyclingStatus, "warning" | "info" | "success" | "danger" | "neutral" | "primary"> = {
  PENDING: "warning", PICKUP_SCHEDULED: "info", RECEIVED: "primary", UNDER_VERIFICATION: "info", APPROVED: "success", REJECTED: "danger", CANCELLED: "neutral",
};
export function RecyclingStatusBadge({ status, label }: { status: RecyclingStatus; label?: string }) {
  return <Badge tone={TONE[status]} dot>{label ?? RECYCLING_STATUS_LABEL[status]}</Badge>;
}

type Filter = "all" | "open" | RecyclingStatus;

export default function RecyclingRequestsSection() {
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{ requests: AdminRecyclingRequest[]; counts: RecyclingCounts } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<AdminRecyclingRequest | null>(null);
  const [rejecting, setRejecting] = useState<AdminRecyclingRequest | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const d = await adminRecyclingApi.requests({ status: filter === "all" ? undefined : filter, q: search.trim() || undefined });
      setData({ requests: d.requests, counts: d.counts });
    } catch (e) {
      setError(describeApiError(e).message);
    }
  }, [filter, search]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  const open = (r: AdminRecyclingRequest) => navigate(`/admin/returns/recycling/${r.requestNumber}`);

  const approve = async () => {
    if (!approving?.calculation?.credits) return;
    setBusy(true);
    try {
      const done = await adminRecyclingApi.approve(approving.id, approving.calculation.credits);
      toast.success("Eco Credits awarded", `${done.creditsAwarded} Eco Credits → ${done.customer?.name ?? "customer"} (${done.requestNumber}).`);
      setApproving(null);
      await load();
    } catch (e) {
      toast.error("Couldn't approve", describeApiError(e).message);
      await load();
    } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!rejecting) return;
    setBusy(true);
    try {
      await adminRecyclingApi.reject(rejecting.id, reason.trim());
      toast.success("Request rejected", `${rejecting.requestNumber} — no credits were awarded.`);
      setRejecting(null); setReason("");
      await load();
    } catch (e) {
      toast.error("Couldn't reject", describeApiError(e).message);
    } finally { setBusy(false); }
  };

  const isOpen = (r: AdminRecyclingRequest) => ["PENDING", "PICKUP_SCHEDULED", "RECEIVED", "UNDER_VERIFICATION"].includes(r.status);
  const columns: Column<AdminRecyclingRequest>[] = [
    { key: "id", header: "Request ID", render: (r) => <button type="button" onClick={() => open(r)} className="font-mono font-bold erp-text hover:underline">{r.requestNumber}</button> },
    { key: "customer", header: "Customer", hideBelow: "md", render: (r) => <span className="block max-w-44 truncate erp-text-muted" title={r.customer?.email}>{r.customer?.name ?? "—"}</span> },
    { key: "material", header: "Material", render: (r) => <span className="erp-text">{r.material}</span> },
    { key: "est", header: "Estimated qty", hideBelow: "sm", render: (r) => <span className="whitespace-nowrap erp-text-muted">{fmtQty(r.estimatedQuantity)} {r.unit}</span> },
    { key: "ver", header: "Verified qty", hideBelow: "sm", render: (r) => r.verifiedQuantity != null ? <span className="whitespace-nowrap font-semibold erp-text">{fmtQty(r.verifiedQuantity)} {r.unit}</span> : <span className="erp-text-faint">—</span> },
    {
      key: "credits", header: "Eco Credits", render: (r) =>
        r.creditsAwarded != null ? <span className="font-bold text-emerald-600 dark:text-emerald-400">+{r.creditsAwarded.toLocaleString("en-IN")}</span>
          : r.calculation?.credits != null ? <span className="erp-text-muted" title="Calculated — not awarded yet">{r.calculation.credits.toLocaleString("en-IN")} <span className="text-[11px] erp-text-faint">pending</span></span>
            : <span className="erp-text-faint">—</span>,
    },
    { key: "status", header: "Status", render: (r) => <RecyclingStatusBadge status={r.status} /> },
    { key: "date", header: "Submitted", hideBelow: "lg", render: (r) => <span className="whitespace-nowrap erp-text-muted">{formatDate(r.createdAt)}</span> },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, className: "w-12", render: (r) => (
        <RowActions
          label={`Actions for ${r.requestNumber}`}
          actions={[
            { label: "View", icon: Eye, onClick: () => open(r) },
            { label: "Verify", icon: ScanSearch, onClick: () => open(r), hidden: !["RECEIVED", "UNDER_VERIFICATION"].includes(r.status) },
            { label: "Approve", icon: ThumbsUp, onClick: () => setApproving(r), hidden: !(r.status === "UNDER_VERIFICATION" && (r.calculation?.credits ?? 0) > 0) },
            { label: "Reject", icon: XCircle, danger: true, onClick: () => { setReason(""); setRejecting(r); }, hidden: !isOpen(r) },
          ]}
        />
      ),
    },
  ];

  const c = data?.counts;
  const openCount = c ? c.PENDING + c.PICKUP_SCHEDULED + c.RECEIVED + c.UNDER_VERIFICATION : 0;
  return (
    <div className="space-y-5">
      <SummaryCards items={[
        { label: "Awaiting action", value: openCount, icon: ListChecks, tone: "info", onClick: () => setFilter("open"), active: filter === "open" },
        { label: "Under verification", value: c?.UNDER_VERIFICATION ?? 0, icon: ScanSearch, onClick: () => setFilter("UNDER_VERIFICATION"), active: filter === "UNDER_VERIFICATION" },
        { label: "Approved", value: c?.APPROVED ?? 0, icon: CheckCircle2, tone: "success", onClick: () => setFilter("APPROVED"), active: filter === "APPROVED" },
        { label: "Rejected", value: c?.REJECTED ?? 0, icon: XCircle, tone: "danger", onClick: () => setFilter("REJECTED"), active: filter === "REJECTED" },
      ]} />

      <div className="erp-card card-shadow">
        <div className="border-b erp-border p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Search request ID, customer or material…" className="w-full sm:max-w-sm" aria-label="Search recycling requests" />
        </div>
        <div className="overflow-x-auto px-4 pt-2">
          <Tabs
            tabs={[
              { key: "open", label: "Awaiting action", count: c ? openCount : undefined },
              { key: "PENDING", label: "Pending", count: c?.PENDING },
              { key: "PICKUP_SCHEDULED", label: "Scheduled pickup", count: c?.PICKUP_SCHEDULED },
              { key: "RECEIVED", label: "Received", count: c?.RECEIVED },
              { key: "UNDER_VERIFICATION", label: "Under verification", count: c?.UNDER_VERIFICATION },
              { key: "APPROVED", label: "Approved", count: c?.APPROVED },
              { key: "REJECTED", label: "Rejected", count: c?.REJECTED },
              { key: "all", label: "All", count: c?.total },
            ]}
            active={filter}
            onChange={(k) => setFilter(k as Filter)}
          />
        </div>
        <div className="p-4">
          {data === null && !error && <TableSkeleton rows={5} cols={7} />}
          {error && <ErrorState message={error} onRetry={() => void load()} />}
          {data !== null && !error && data.requests.length === 0 && (
            <EmptyState icon={Recycle} title="No recycling requests here" message="Customers submit recyclable packaging from their account. Requests need an active recycling rule for the material." />
          )}
          {data !== null && !error && data.requests.length > 0 && <DataTable caption="Recycling requests" columns={columns} rows={data.requests} rowKey={(r) => r.id} />}
        </div>
      </div>

      <Dialog
        open={!!approving}
        onClose={() => setApproving(null)}
        title={`Approve ${approving?.requestNumber ?? ""}?`}
        description="The credits below were calculated by the system from the verified quantity and the recycling rule."
        footer={<>
          <Button onClick={() => setApproving(null)} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon={ThumbsUp} loading={busy} onClick={approve}>Approve &amp; Award {approving?.calculation?.credits ?? 0} Credits</Button>
        </>}
      >
        <div className="rounded-lg border erp-border erp-surface-2 p-4 text-center">
          <div className="text-sm erp-text-muted">{approving?.calculation?.formula}</div>
          <div className="mt-1 font-display text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">{approving?.calculation?.credits ?? 0} Eco Credits</div>
          <div className="mt-1 text-xs erp-text-faint">to {approving?.customer?.name}</div>
        </div>
      </Dialog>

      <Dialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.requestNumber ?? ""}?`}
        description="No Eco Credits are awarded. The customer sees this reason."
        footer={<>
          <Button onClick={() => setRejecting(null)} disabled={busy}>Cancel</Button>
          <Button variant="danger" icon={XCircle} loading={busy} disabled={reason.trim().length < 3} onClick={reject}>Reject request</Button>
        </>}
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Reason <span className="text-red-500">*</span></span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Material contaminated with food waste" maxLength={300} className={FIELD} />
        </label>
      </Dialog>
    </div>
  );
}
