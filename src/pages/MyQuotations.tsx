import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { rfqApi, type Rfq } from "@/lib/api/rfq";
import { inrMinor } from "@/admin/format";

// The buyer's quotation history: every RFQ they sent, the quotations received,
// and the accept / reject / request-changes actions.
export default function MyQuotations() {
  const [rfqs, setRfqs] = useState<Rfq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await rfqApi.list();
      setRfqs(res.rfqs);
    } catch (e) {
      // No mock fallback: an error must read as an error, not an empty list.
      setError(e instanceof Error ? e.message : "Could not load your quotation requests");
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
      toast.error("That didn't work", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <main className="py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-dark-200 px-4 py-2 text-sm font-bold"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      </main>
    );
  }

  if (rfqs === null) {
    return (
      <main className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-dark-300" />
      </main>
    );
  }

  if (rfqs.length === 0) {
    return (
      <main className="py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <FileText className="mx-auto h-12 w-12 text-dark-300" />
          <h1 className="mt-4 text-2xl font-bold text-dark-900">No quotation requests yet</h1>
          <Link to="/shop" className="mt-6 inline-block rounded-xl bg-primary-500 px-5 py-3 text-sm font-bold text-white">
            Browse products
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="py-8">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h1 className="text-2xl font-bold text-dark-900">My quotation requests</h1>

        <div className="mt-6 space-y-4">
          {rfqs.map((r) => (
            <section key={r.id} className="rounded-xl border border-dark-100 bg-white p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-dark-900">{r.rfqNumber}</p>
                  <p className="text-xs text-dark-500">
                    {r.itemCount} product{r.itemCount === 1 ? "" : "s"} ·{" "}
                    {r.totalQuantity.toLocaleString("en-IN")} units
                  </p>
                </div>
                <span className="rounded-full bg-dark-50 px-3 py-1 text-xs font-bold text-dark-700">
                  {r.status.replace(/_/g, " ").toLowerCase()}
                </span>
              </header>

              <ul className="mt-3 space-y-1 text-sm text-dark-600">
                {r.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-4">
                    <span className="truncate">{i.productName}</span>
                    <span className="shrink-0 text-dark-400">
                      {i.quantity.toLocaleString("en-IN")} {i.unit}
                    </span>
                  </li>
                ))}
              </ul>

              {r.quotations.map((q) => (
                <div key={q.id} className="mt-4 rounded-lg border border-dark-100 bg-dark-50/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-dark-900">
                      {q.quotationNumber}
                      {q.version > 1 && <span className="ml-1 text-xs text-dark-400">v{q.version}</span>}
                    </p>
                    <p className="text-sm font-bold text-dark-900">{inrMinor(q.grandTotalMinor)}</p>
                  </div>
                  {q.leadTimeDays != null && (
                    <p className="mt-1 text-xs text-dark-500">Lead time {q.leadTimeDays} days</p>
                  )}
                  {q.paymentTerms && <p className="text-xs text-dark-500">{q.paymentTerms}</p>}

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
                        className="rounded-lg border border-dark-200 px-4 py-2 text-xs font-bold disabled:opacity-50"
                      >
                        Request changes
                      </button>
                      <button
                        type="button"
                        disabled={busy === q.id}
                        onClick={() => act(() => rfqApi.respond(q.id, "reject"), q.id, "Quotation rejected")}
                        className="rounded-lg border border-dark-200 px-4 py-2 text-xs font-bold text-red-600 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {q.status !== "SENT" && (
                    <p className="mt-2 text-xs font-semibold text-dark-500">
                      {q.status.replace(/_/g, " ").toLowerCase()}
                    </p>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
