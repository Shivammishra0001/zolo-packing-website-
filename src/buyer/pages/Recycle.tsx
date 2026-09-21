import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, Coins, Download, Leaf, Paperclip, RotateCcw, XCircle } from "lucide-react";
import { Badge, Button, PageHeader, Tabs } from "@/admin/components/ui";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "@/admin/components/Panel";
import { formatDateTime, inrMinor } from "@/admin/format";
import { useToast } from "@/components/ui/Toast";
import { describeApiError, saveBlob } from "@/lib/api/client";
import {
  returnsApi,
  prettyReturnStatus,
  RETURN_REASON_LABELS,
  RETURN_CONDITION_LABELS,
  type ReturnRequest,
  type ReturnStatus,
} from "@/lib/api/returns";
import { ecoCreditsApi, recyclingApi, type EcoWallet as EcoWalletData, type RecyclingProgram, type RecyclingRequest } from "@/lib/api/recycling";
import RecycleEarn, { NewRecyclingDialog } from "./recycle/RecycleEarn";
import RecyclingRequests from "./recycle/RecyclingRequests";
import EcoWallet from "./recycle/EcoWallet";

// ============================================================
// Returns & Recycling (customer). Recycling and product returns are separate
// workflows on separate tabs; the components below this comment render the
// PRODUCT RETURN cards (created from Order Details → item → Return).
// ============================================================

const TONE: Partial<Record<ReturnStatus, "success" | "warning" | "danger" | "info" | "neutral">> = {
  SUBMITTED: "warning",
  UNDER_REVIEW: "info",
  APPROVED: "info",
  REJECTED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "success",
  REPLACEMENT_DELIVERED: "success",
  POINTS_CREDITED: "success",
  CLOSED: "success",
};

// The expected milestones per branch — used to render the ○/✓ timeline.
function expectedFlow(r: ReturnRequest): ReturnStatus[] {
  const head: ReturnStatus[] = ["SUBMITTED", "UNDER_REVIEW", "APPROVED"];
  if (r.status === "REJECTED") return ["SUBMITTED", "UNDER_REVIEW", "REJECTED"];
  if (r.status === "CANCELLED") return ["SUBMITTED", "CANCELLED"];
  if (r.resolution === "REFUND") return [...head, "REFUND_PROCESSING", "REFUNDED"];
  if (r.resolution === "REPLACEMENT") return [...head, "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "REPLACEMENT_DELIVERED"];
  if (r.resolution === "RECYCLE" || r.type === "RECYCLE")
    return [...head, "PICKUP_SCHEDULED", "RECEIVED", "INSPECTED", "RECYCLE_PROCESSING", "RECYCLED", "POINTS_CREDITED"];
  return head;
}

function Timeline({ r }: { r: ReturnRequest }) {
  const reached = new Map(r.timeline.map((t) => [t.status, t.at]));
  return (
    <ol className="mt-3 space-y-1.5">
      {expectedFlow(r).map((s) => {
        const at = reached.get(s);
        const failed = s === "REJECTED" || s === "CANCELLED";
        return (
          <li key={s} className="flex items-center gap-2 text-sm">
            {at ? (
              failed ? <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
            ) : (
              <Circle className="h-4 w-4 shrink-0 erp-text-faint" aria-hidden />
            )}
            <span className={at ? "font-semibold erp-text" : "erp-text-faint"}>{prettyReturnStatus(s)}</span>
            <span className="ml-auto text-xs erp-text-faint">{at ? formatDateTime(at) : "Pending"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function RequestCard({ r, onCancelled }: { r: ReturnRequest; onCancelled: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const cancellable = r.status === "SUBMITTED" || r.status === "UNDER_REVIEW";

  const cancel = async () => {
    if (!window.confirm(`Cancel ${r.requestNumber}?`)) return;
    setBusy(true);
    try {
      await returnsApi.cancel(r.id);
      toast.success("Request cancelled");
      onCancelled();
    } catch (e) {
      toast.error("Couldn't cancel", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border erp-border erp-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {r.type === "RECYCLE" ? <Leaf className="h-4 w-4 text-emerald-500" aria-hidden /> : <RotateCcw className="h-4 w-4 text-primary-500" aria-hidden />}
          <span className="font-mono text-sm font-bold erp-text">{r.requestNumber}</span>
          <Badge tone={TONE[r.status] ?? "info"}>{prettyReturnStatus(r.status)}</Badge>
        </div>
        <span className="text-xs erp-text-faint">{formatDateTime(r.createdAt)}</span>
      </div>

      <p className="mt-2 text-sm erp-text">
        <span className="font-semibold">{r.item?.productName}</span>
        <span className="erp-text-muted"> · {r.quantity.toLocaleString("en-IN")} unit(s) · order </span>
        <Link to={`/account/orders/${r.order?.id}`} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">
          {r.order?.orderNumber}
        </Link>
      </p>
      <p className="mt-0.5 text-xs erp-text-muted">
        {RETURN_REASON_LABELS[r.reason] ?? r.reason} · {RETURN_CONDITION_LABELS[r.condition] ?? r.condition}
      </p>

      {r.status === "REJECTED" && r.rejectionReason && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
          Rejected: {r.rejectionReason}
        </p>
      )}
      {r.refund && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          Refund {r.refund.refundNumber}: {inrMinor(r.refund.amountMinor)}{r.refund.processedAt ? ` · ${formatDateTime(r.refund.processedAt)}` : ""}
        </p>
      )}
      {r.pointsAwarded != null && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Coins className="h-3.5 w-3.5" aria-hidden /> {r.pointsAwarded.toLocaleString("en-IN")} Eco Credits credited
          {r.recycle?.acceptedQuantity != null && ` on ${r.recycle.acceptedQuantity.toLocaleString("en-IN")} accepted unit(s)`}
        </p>
      )}

      {open && <Timeline r={r} />}
      {open && r.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() =>
                returnsApi.downloadFile(r.id, f.id).then((b) => saveBlob(b, f.fileName)).catch((e) => toast.error("Download failed", describeApiError(e).message))
              }
              className="inline-flex items-center gap-1.5 rounded-lg border erp-border px-2.5 py-1.5 text-xs font-semibold erp-text-muted hover:erp-surface-2"
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden /> {f.fileName}
              <Download className="h-3 w-3" aria-hidden />
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
          {open ? "Hide timeline" : "View timeline"}
        </Button>
        {cancellable && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel()}>
            Cancel request
          </Button>
        )}
      </div>
    </div>
  );
}

function ProductReturns({ requests, onChanged }: { requests: ReturnRequest[]; onChanged: () => void }) {
  if (requests.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={RotateCcw}
          title="No return requests yet"
          message="Open a delivered order and choose Return on an item to request a refund or replacement."
          action={<Link to="/account/orders" className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-bold text-white hover:bg-primary-600">Go to my orders</Link>}
        />
      </Panel>
    );
  }
  return <div className="space-y-3">{requests.map((r) => <RequestCard key={r.id} r={r} onCancelled={onChanged} />)}</div>;
}

type TabKey = "earn" | "requests" | "wallet" | "returns";
const TAB_KEYS: TabKey[] = ["earn", "requests", "wallet", "returns"];

/**
 * Two separate things live here, on separate tabs:
 *   Recycling  — material + quantity → verified by Zolo → Eco Credits → coupons
 *   Returns    — refund / replacement of an order item (never earns credits)
 */
export default function Recycle() {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TAB_KEYS.includes(params.get("tab") as TabKey) ? (params.get("tab") as TabKey) : "earn";
  const setTab = (k: TabKey) => { const next = new URLSearchParams(params); next.set("tab", k); next.delete("new"); setParams(next, { replace: true }); };

  const [returns, setReturns] = useState<ReturnRequest[] | null>(null);
  const [recycling, setRecycling] = useState<RecyclingRequest[] | null>(null);
  const [wallet, setWallet] = useState<EcoWalletData | null>(null);
  const [program, setProgram] = useState<RecyclingProgram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [ret, rec, w, prog] = await Promise.all([returnsApi.list(), recyclingApi.list(), ecoCreditsApi.wallet(), recyclingApi.program()]);
      setReturns(ret.requests); setRecycling(rec.requests); setWallet(w); setProgram(prog);
    } catch (e) {
      setError(describeApiError(e).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // "Recycle & Earn" from an order (or a notification) opens the form directly.
  useEffect(() => {
    if (params.get("new") !== "1" || !program) return;
    if (program.materials.length) setCreating(true);
    const next = new URLSearchParams(params); next.delete("new"); setParams(next, { replace: true });
  }, [params, program, setParams]);

  const loading = !error && (returns === null || recycling === null || wallet === null);
  const openRecycling = (recycling ?? []).filter((r) => ["PENDING", "PICKUP_SCHEDULED", "RECEIVED", "UNDER_VERIFICATION"].includes(r.status)).length;

  return (
    <div className="shell-form space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Account", to: "/account/dashboard" }, { label: "Returns & Recycling" }]}
        title="Returns & Recycling"
        subtitle="Recycle packaging to earn Eco Credits, redeem them for coupons, and track your product returns."
        actions={
          wallet && (
            <button type="button" onClick={() => setTab("wallet")} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Coins className="h-4 w-4" aria-hidden /> {wallet.balance.toLocaleString("en-IN")} Eco Credits
            </button>
          )
        }
      />

      <Tabs
        tabs={[
          { key: "earn", label: "Recycle & Earn", icon: Leaf },
          { key: "requests", label: "My recycling requests", count: openRecycling || undefined },
          { key: "wallet", label: "Eco Credits", icon: Coins },
          { key: "returns", label: "Product returns", icon: RotateCcw },
        ]}
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      {loading && <Panel><ListSkeleton rows={4} /></Panel>}
      {error && <Panel><ErrorState message={error} onRetry={() => void load()} /></Panel>}
      {!loading && !error && (
        <>
          {tab === "earn" && <RecycleEarn program={program} balance={wallet?.balance ?? null} onStart={() => setCreating(true)} onOpenWallet={() => setTab("wallet")} />}
          {tab === "requests" && <RecyclingRequests requests={recycling ?? []} onChanged={() => void load()} onStart={() => setCreating(true)} canStart={Boolean(program?.materials.length)} />}
          {tab === "wallet" && wallet && <EcoWallet wallet={wallet} onChanged={() => void load()} />}
          {tab === "returns" && <ProductReturns requests={returns ?? []} onChanged={() => void load()} />}
        </>
      )}

      <NewRecyclingDialog open={creating} program={program} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setTab("requests"); void load(); }} />
    </div>
  );
}
