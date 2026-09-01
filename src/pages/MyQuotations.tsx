import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Download, FileText, Loader2, MapPin, Paperclip, Plus, RefreshCw, Users } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { rfqApi, type Rfq, type Quotation } from "@/lib/api/rfq";
import { describeApiError, saveBlob } from "@/lib/api/client";
import { inrMinor } from "@/admin/format";

// The buyer's quotation history: every RFQ they sent, the quotations received
// (house + competing sellers), a comparison view, and accept / reject /
// request-changes. Rendered inside the buyer portal at /account/quotations.
export default function MyQuotations() {
  const [rfqs, setRfqs] = useState<Rfq[] | null>(null);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await rfqApi.list();
      setRfqs(res.rfqs);
    } catch (e) {
      // Distinguish "session expired" from "server broke" from "offline" —
      // never collapse errors into an empty list or a fake not-found.
      setError(describeApiError(e));
      setRfqs(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, id: string, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error("That didn't work", describeApiError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const downloadFile = async (rfqId: string, fileId: string, fileName: string) => {
    try {
      saveBlob(await rfqApi.downloadFile(rfqId, fileId), fileName);
    } catch (e) {
      toast.error("Download failed", describeApiError(e).message);
    }
  };

  if (error) {
    return (
      <div className="py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <p className="text-sm font-semibold text-red-600">{error.message}</p>
          {error.kind === "unauthorized" ? (
            <Link to="/" className="mt-4 inline-block rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-bold text-white">
              Go to sign in
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-dark-200 px-4 py-2 text-sm font-bold"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  if (rfqs === null) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-dark-300" />
        <p className="text-xs erp-text-muted">Loading your quotation requests…</p>
      </div>
    );
  }

  if (rfqs.length === 0) {
    return (
      <div className="py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <FileText className="mx-auto h-12 w-12 text-dark-300" />
          <h1 className="mt-4 text-2xl font-bold erp-text">No quotation requests yet</h1>
          <p className="mt-2 text-sm erp-text-muted">Request a bulk quote and the sellers' offers will appear here.</p>
          <Link to="/rfq" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary-500 px-5 py-3 text-sm font-bold text-white">
            <Plus className="h-4 w-4" /> Create Bulk Quote
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold erp-text">My Quotes</h1>
        <Link to="/rfq" className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-600">
          <Plus className="h-4 w-4" /> Create Bulk Quote
        </Link>
      </div>

      <div className="mt-6 space-y-4">
        {rfqs.map((r) => {
          const sent = r.quotations.filter((q) => q.status === "SENT");
          return (
            <section key={r.id} className="rounded-xl border erp-border erp-surface p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold erp-text">{r.rfqNumber}</p>
                  <p className="text-xs erp-text-muted">
                    {r.itemCount} product{r.itemCount === 1 ? "" : "s"} · {r.totalQuantity.toLocaleString("en-IN")} units
                    {r.ship.city && (
                      <span className="ml-2 inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" aria-hidden /> {[r.ship.city, r.ship.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.matchCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-dark-50 px-2.5 py-1 text-[11px] font-bold erp-text-muted dark:bg-white/5">
                      <Users className="h-3 w-3" aria-hidden /> {r.matchCount} seller{r.matchCount === 1 ? "" : "s"} matched
                    </span>
                  )}
                  <span className="rounded-full bg-dark-50 px-3 py-1 text-xs font-bold erp-text dark:bg-white/10">
                    {r.status.replace(/_/g, " ").toLowerCase()}
                  </span>
                </div>
              </header>

              <ul className="mt-3 space-y-1 text-sm erp-text-muted">
                {r.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-4">
                    <span className="min-w-0">
                      <span className="truncate">{i.productName}</span>
                      {Object.entries(i.specs ?? {}).filter(([, v]) => v).length > 0 && (
                        <span className="block truncate text-xs erp-text-faint">
                          {Object.entries(i.specs ?? {})
                            .filter(([, v]) => v)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 erp-text-faint">
                      {i.quantity.toLocaleString("en-IN")} {i.unit}
                    </span>
                  </li>
                ))}
              </ul>

              {r.files.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.files.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => void downloadFile(r.id, f.id, f.fileName)}
                      className="inline-flex items-center gap-1.5 rounded-lg border erp-border px-2.5 py-1.5 text-xs font-semibold erp-text-muted hover:erp-surface-2"
                    >
                      <Paperclip className="h-3.5 w-3.5" aria-hidden /> {f.fileName}
                      <Download className="h-3 w-3" aria-hidden />
                    </button>
                  ))}
                </div>
              )}

              {/* Comparison strip when several sellers are competing. */}
              {sent.length > 1 && (
                <div className="mt-4 overflow-x-auto rounded-lg border erp-border">
                  <table className="w-full min-w-[32rem] text-left text-xs">
                    <caption className="sr-only">Compare quotations for {r.rfqNumber}</caption>
                    <thead>
                      <tr className="border-b erp-border-soft erp-text-muted">
                        <th className="px-3 py-2 font-bold">Seller</th>
                        <th className="px-3 py-2 font-bold">Total</th>
                        <th className="px-3 py-2 font-bold">Shipping</th>
                        <th className="px-3 py-2 font-bold">Tax</th>
                        <th className="px-3 py-2 font-bold">Lead time</th>
                        <th className="px-3 py-2 font-bold">Valid until</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sent.map((q) => (
                        <tr key={q.id} className="border-b erp-border-soft last:border-0">
                          <td className="px-3 py-2 font-semibold erp-text">{q.seller?.name ?? "Zolo Packaging"}</td>
                          <td className="px-3 py-2 font-bold erp-text">{inrMinor(q.grandTotalMinor)}</td>
                          <td className="px-3 py-2 erp-text-muted">{inrMinor(q.shippingMinor)}</td>
                          <td className="px-3 py-2 erp-text-muted">{inrMinor(q.taxMinor)}</td>
                          <td className="px-3 py-2 erp-text-muted">{q.leadTimeDays != null ? `${q.leadTimeDays} days` : "—"}</td>
                          <td className="px-3 py-2 erp-text-muted">{q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-IN") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {r.quotations.map((q) => (
                <QuotationCard key={q.id} q={q} busy={busy} act={act} toast={toast} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function QuotationCard({
  q,
  busy,
  act,
  toast,
}: {
  q: Quotation;
  busy: string | null;
  act: (fn: () => Promise<unknown>, id: string, done: string) => Promise<void>;
  toast: ReturnType<typeof useToast>;
}) {
  return (
    <div className="mt-4 rounded-lg border erp-border bg-dark-50/50 p-3 dark:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold erp-text">
            {q.quotationNumber}
            {q.version > 1 && <span className="ml-1 text-xs erp-text-faint">v{q.version}</span>}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs erp-text-muted">
            {q.seller?.name ?? "Zolo Packaging"}
            {(q.seller == null || q.seller.verificationStatus === "VERIFIED") && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified
              </span>
            )}
          </p>
        </div>
        <p className="text-sm font-bold erp-text">{inrMinor(q.grandTotalMinor)}</p>
      </div>

      {q.items.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs erp-text-muted">
          {q.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span className="truncate">{i.productName} × {i.quantity.toLocaleString("en-IN")}</span>
              <span className="shrink-0">{inrMinor(i.unitPriceMinor)}/{i.unit} · {inrMinor(i.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs erp-text-muted">
        {q.leadTimeDays != null && <span>Lead time {q.leadTimeDays} days</span>}
        {q.shippingMinor > 0 && <span>Shipping {inrMinor(q.shippingMinor)}</span>}
        {q.taxMinor > 0 && <span>Tax {inrMinor(q.taxMinor)}</span>}
        {q.paymentTerms && <span>{q.paymentTerms}</span>}
        {q.validUntil && <span>Valid until {new Date(q.validUntil).toLocaleDateString("en-IN")}</span>}
      </div>

      {q.status === "SENT" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === q.id}
            onClick={() =>
              act(
                async () => {
                  const { order } = await rfqApi.accept(q.id);
                  toast.success(`Order ${order.orderNumber} created`);
                },
                q.id,
                "Quotation accepted",
              )
            }
            className="rounded-lg bg-primary-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            Accept &amp; create order
          </button>
          <button
            type="button"
            disabled={busy === q.id}
            onClick={() => act(() => rfqApi.respond(q.id, "request_changes"), q.id, "Changes requested")}
            className="rounded-lg border erp-border px-4 py-2 text-xs font-bold erp-text disabled:opacity-50"
          >
            Request changes
          </button>
          <button
            type="button"
            disabled={busy === q.id}
            onClick={() => act(() => rfqApi.respond(q.id, "reject"), q.id, "Quotation rejected")}
            className="rounded-lg border erp-border px-4 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
      {q.status !== "SENT" && (
        <p className="mt-2 text-xs font-semibold erp-text-muted">{q.status.replace(/_/g, " ").toLowerCase()}</p>
      )}
    </div>
  );
}
