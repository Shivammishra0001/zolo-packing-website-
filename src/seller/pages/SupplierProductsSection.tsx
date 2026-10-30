import { useCallback, useEffect, useState } from "react";
import { adminSellerApi, type ListingPage, type SupplierListing } from "../onboarding-api";

// ============================================================
// "Products" on the admin supplier detail page.
//
// Answers the question an admin opens a supplier to ask: what are they
// selling, what is waiting on me, and what did I already approve?
//
// Moderation happens here rather than on a separate screen, because the
// decision usually needs the supplier's context (are they verified? which
// documents?) that the rest of this page already shows.
// ============================================================

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  pending_review: "bg-amber-50 text-amber-700 ring-amber-200",
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  archived: "bg-slate-100 text-slate-500 ring-slate-200",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Live",
  pending_review: "Awaiting review",
  draft: "Draft",
  archived: "Withdrawn",
};

const inr = (minor: number) => "₹" + Math.round((minor ?? 0) / 100).toLocaleString("en-IN");

export function SupplierProductsSection({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<ListingPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      setData(await adminSellerApi.products(supplierId, { limit: 50 }));
      setState("ready");
    } catch {
      setState("error");
    }
  }, [supplierId]);

  useEffect(() => { void load(); }, [load]);

  /** Run a moderation action, then refresh so counts and statuses agree. */
  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function approve(p: SupplierListing) {
    // Commission is admin-only and set at approval (ADR-001). Blank keeps
    // whatever the product already carries rather than forcing a number.
    const input = window.prompt(
      `Approve "${p.name}" and publish it to the storefront.\n\nCommission in basis points (800 = 8%). Leave blank to keep the current rate.`,
      "",
    );
    if (input === null) return; // cancelled
    const trimmed = input.trim();
    if (trimmed && !/^\d+$/.test(trimmed)) { setError("Commission must be a whole number of basis points."); return; }
    await act(p.id, () => adminSellerApi.approveListing(p.id, trimmed ? Number(trimmed) : undefined));
  }

  async function reject(p: SupplierListing) {
    const reason = window.prompt(`Send "${p.name}" back to the supplier.\n\nWhat needs fixing? They will see this.`, "");
    if (reason === null) return;
    if (!reason.trim()) { setError("Give the supplier a reason so they can fix the listing."); return; }
    await act(p.id, () => adminSellerApi.rejectListing(p.id, reason.trim()));
  }

  if (state === "loading") return <Card><p className="text-sm text-slate-400">Loading products…</p></Card>;
  if (state === "error") {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-600">Couldn't load this supplier's products.</p>
          <button onClick={() => void load()} className="text-sm font-semibold text-orange-600 hover:underline">Try again</button>
        </div>
      </Card>
    );
  }

  const rows = data?.products ?? [];
  const counts = data?.byStatus ?? {};
  const waiting = counts.pending_review ?? 0;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Products ({data?.total ?? 0})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {(["pending_review", "active", "draft", "archived"] as const)
            .filter((k) => counts[k])
            .map((k) => (
              <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_STYLE[k]}`}>
                {counts[k]} {STATUS_LABEL[k].toLowerCase()}
              </span>
            ))}
        </div>
      </div>

      {waiting > 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          {waiting} listing{waiting === 1 ? "" : "s"} waiting on your review. Approving publishes to the storefront.
        </p>
      )}

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">{error}</p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
          This supplier hasn't listed any products yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
                {p.images?.[0]
                  ? <img src={p.images[0]} alt="" className="h-full w-full object-contain" />
                  : <span className="grid h-full w-full place-items-center text-slate-300">📦</span>}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{p.name}</span>
                <span className="block truncate font-mono text-[11px] text-slate-400">
                  {p.sku} · {p.category}
                </span>
                {p.rejectionNote && (
                  <span className="mt-0.5 block truncate text-[11px] text-red-600" title={p.rejectionNote}>
                    Sent back: {p.rejectionNote}
                  </span>
                )}
              </span>

              <span className="shrink-0 text-right text-sm">
                <span className="block font-semibold tabular-nums text-slate-800">{inr(p.basePriceMinor)}</span>
                <span className="block text-[11px] text-slate-400">MOQ {p.moq}</span>
              </span>

              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_STYLE[p.status] ?? STATUS_STYLE.draft}`}>
                {STATUS_LABEL[p.status] ?? p.status}
              </span>

              {p.status === "pending_review" && (
                <span className="flex shrink-0 gap-2">
                  <button
                    disabled={busy === p.id}
                    onClick={() => void approve(p)}
                    className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-40"
                  >
                    {busy === p.id ? "…" : "Approve"}
                  </button>
                  <button
                    disabled={busy === p.id}
                    onClick={() => void reject(p)}
                    className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-40"
                  >
                    Send back
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {(data?.pages ?? 1) > 1 && (
        <p className="mt-3 text-center text-xs text-slate-400">
          Showing the first {rows.length} of {data?.total}. Open the catalog to see them all.
        </p>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4">{children}</div>;
}
