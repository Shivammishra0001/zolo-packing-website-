import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileText, Trash2, ArrowRight, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  useRfqCart,
  updateRfqQuantity,
  removeFromRfq,
  submitRfq,
} from "@/lib/rfq-cart-store";

// Review and submit a quotation request.
//
// The whole point of this page: ONE RFQ carries MANY products. Everything the
// buyer collected is submitted together as a single request, so admin sees
// "RFQ-1001 — 3 products" rather than three unrelated requests.
export default function RfqPage() {
  const lines = useRfqCart();
  const nav = useNavigate();
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const totalQuantity = lines.reduce((s, l) => s + l.quantity, 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const rfq = await submitRfq({
        notes: notes.trim() || undefined,
        requiredBy: requiredBy || undefined,
      });
      toast.success(`Request ${rfq.rfqNumber} sent`, "Our team will send your quotation shortly.");
      nav("/account/quotations");
    } catch (err) {
      // Keep the cart intact so the buyer can retry without re-adding.
      const msg = err instanceof Error ? err.message : "Please try again.";
      toast.error("Couldn't send your request", msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (lines.length === 0) {
    return (
      <main className="py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <FileText className="mx-auto h-12 w-12 text-dark-300" />
          <h1 className="mt-4 text-2xl font-bold text-dark-900">No products in your quotation request</h1>
          <p className="mt-2 text-sm text-dark-500">
            Browse the catalogue and choose &ldquo;Request Quote&rdquo; on any product. You can add several
            products to one request.
          </p>
          <Link
            to="/shop"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary-500 px-5 py-3 text-sm font-bold text-white hover:bg-primary-600"
          >
            Browse products <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="py-8">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h1 className="text-2xl font-bold text-dark-900">Request a quotation</h1>
        <p className="mt-1 text-sm text-dark-500">
          {lines.length} product{lines.length === 1 ? "" : "s"} · {totalQuantity.toLocaleString("en-IN")} units in
          one request
        </p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr,20rem]">
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.productId} className="flex items-start gap-4 rounded-xl border border-dark-100 bg-white p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-dark-900">{l.productName}</p>
                  {l.sku && <p className="text-xs text-dark-400">SKU {l.sku}</p>}
                  {l.specs && Object.keys(l.specs).length > 0 && (
                    <p className="mt-1 text-xs text-dark-500">
                      {Object.entries(l.specs)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${k}: ${String(v)}`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`qty-${l.productId}`}>
                    Quantity for {l.productName}
                  </label>
                  <input
                    id={`qty-${l.productId}`}
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) => updateRfqQuantity(l.productId, Number(e.target.value))}
                    className="w-24 rounded-lg border border-dark-200 px-2 py-1.5 text-right text-sm"
                  />
                  <span className="text-xs text-dark-400">{l.unit || "pcs"}</span>
                  <button
                    type="button"
                    onClick={() => removeFromRfq(l.productId)}
                    aria-label={`Remove ${l.productName}`}
                    className="rounded-lg p-2 text-dark-400 hover:bg-dark-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <aside className="h-fit rounded-xl border border-dark-100 bg-white p-4">
            <label className="block text-xs font-bold text-dark-700" htmlFor="rfq-required-by">
              Required by
            </label>
            <input
              id="rfq-required-by"
              type="date"
              value={requiredBy}
              onChange={(e) => setRequiredBy(e.target.value)}
              className="mt-1 w-full rounded-lg border border-dark-200 px-3 py-2 text-sm"
            />

            <label className="mt-4 block text-xs font-bold text-dark-700" htmlFor="rfq-notes">
              Notes for our team
            </label>
            <textarea
              id="rfq-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Printing, finish, delivery location…"
              className="mt-1 w-full rounded-lg border border-dark-200 px-3 py-2 text-sm"
            />

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 py-3 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {submitting ? "Sending…" : "Send quotation request"}
            </button>
            <p className="mt-2 text-center text-[11px] text-dark-400">
              All {lines.length} product{lines.length === 1 ? "" : "s"} are sent as one request.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
