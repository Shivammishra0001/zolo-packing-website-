import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Inbox, Loader2, MapPin, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { sellerRfqApi, type SellerLead } from "../rfq-api";
import { ApiError } from "../api";

// ============================================================
// Seller RFQ inbox — the leads this supplier was matched to, with the full
// customer requirement (all products, specs, requirement sheets, delivery),
// plus quote submission. One quotation covers the whole RFQ; line totals and
// grand totals are computed by the backend from the unit prices entered here.
// ============================================================

const inr = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const prettySize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const STATUS_STYLE: Record<SellerLead["status"], string> = {
  INVITED: "bg-amber-50 text-amber-700",
  VIEWED: "bg-sky-50 text-sky-700",
  QUOTED: "bg-emerald-50 text-emerald-700",
  DECLINED: "bg-slate-100 text-slate-500",
};

function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Your session has expired — please sign in again.";
    if (e.status === 403) return "Your seller account does not have access to this yet.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

function QuoteForm({ lead, onDone, onCancel }: { lead: SellerLead; onDone: () => void; onCancel: () => void }) {
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [shipping, setShipping] = useState("");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [validDays, setValidDays] = useState("15");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toPaise = (r: string) => Math.round(Number(r) * 100);
  const priced = lead.rfq.items.filter((i) => (prices[i.id] ?? "").trim() !== "" && Number(prices[i.id]) >= 0);
  const subtotal = priced.reduce((s, i) => s + i.quantity * toPaise(prices[i.id]), 0);

  const submit = async () => {
    if (priced.length === 0) {
      setError("Enter a unit price for at least one product.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sellerRfqApi.quote(lead.rfq.id, {
        items: priced.map((i) => ({ rfqItemId: i.id, unitPriceMinor: toPaise(prices[i.id]) })),
        shippingMinor: Number(shipping) ? toPaise(shipping) : 0,
        leadTimeDays: leadTimeDays ? Number(leadTimeDays) : undefined,
        paymentTerms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        validUntil: new Date(Date.now() + (Number(validDays) || 15) * 86400_000).toISOString(),
      });
      onDone();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  };

  const inputCls = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-orange-500 focus:outline-none";

  return (
    <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-900">Your quote for {lead.rfq.rfqNumber}</p>
        <button onClick={onCancel} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Close quote form">
          <X className="h-4 w-4" />
        </button>
      </div>

      <table className="mt-3 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-orange-200/60 text-xs text-slate-500">
            <th className="py-1.5 pr-2 font-bold">Product</th>
            <th className="py-1.5 pr-2 font-bold">Qty</th>
            <th className="py-1.5 pr-2 font-bold">Unit price (₹)</th>
            <th className="py-1.5 text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {lead.rfq.items.map((i) => (
            <tr key={i.id} className="border-b border-orange-100 last:border-0">
              <td className="py-2 pr-2 text-slate-800">{i.productName}</td>
              <td className="py-2 pr-2 text-slate-500">{i.quantity.toLocaleString("en-IN")} {i.unit}</td>
              <td className="py-2 pr-2">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={prices[i.id] ?? ""}
                  onChange={(e) => setPrices({ ...prices, [i.id]: e.target.value })}
                  placeholder="0.00"
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm focus:border-orange-500 focus:outline-none"
                  aria-label={`Unit price for ${i.productName}`}
                />
              </td>
              <td className="py-2 text-right font-semibold text-slate-800">
                {(prices[i.id] ?? "").trim() !== "" ? inr(i.quantity * toPaise(prices[i.id])) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block text-xs font-semibold text-slate-600">
          Shipping (₹)
          <input type="number" min={0} value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Production time (days)
          <input type="number" min={0} value={leadTimeDays} onChange={(e) => setLeadTimeDays(e.target.value)} placeholder="14" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Quote valid for (days)
          <input type="number" min={1} value={validDays} onChange={(e) => setValidDays(e.target.value)} className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Payment terms
          <input type="text" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="50% advance" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="col-span-2 block text-xs font-semibold text-slate-600 sm:col-span-4">
          Notes to the customer
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={`mt-1 ${inputCls}`} />
        </label>
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">{error}</p>}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Subtotal <span className="font-bold text-slate-900">{inr(subtotal)}</span>
          <span className="ml-2 text-xs text-slate-400">(final totals are computed by the server)</span>
        </p>
        <button
          onClick={submit}
          disabled={sending}
          className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {lead.status === "QUOTED" ? "Send revised quote" : "Submit quote"}
        </button>
      </div>
    </div>
  );
}

export default function SellerRfqs() {
  const [leads, setLeads] = useState<SellerLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null); // matchId
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await sellerRfqApi.leads();
      setLeads(res.leads);
    } catch (e) {
      setLeads(null);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const open = (lead: SellerLead) => {
    setQuoting(lead.matchId);
    // First open stamps VIEWED server-side; refresh quietly afterwards.
    if (lead.status === "INVITED") void sellerRfqApi.markViewed(lead.rfq.id).then(() => load()).catch(() => {});
  };

  const decline = async (lead: SellerLead) => {
    try {
      await sellerRfqApi.decline(lead.rfq.id);
      setBanner(`You passed on ${lead.rfq.rfqNumber}.`);
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const download = async (lead: SellerLead, fileId: string, fileName: string) => {
    try {
      const blob = await sellerRfqApi.downloadFile(lead.rfq.id, fileId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(describeError(e));
    }
  };

  if (error && leads === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-sm font-semibold text-red-600">{error}</p>
        <button onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (leads === null) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2">
        <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
        <p className="text-xs text-slate-400">Loading your RFQ leads…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">RFQ leads</h1>
          <p className="mt-0.5 text-sm text-slate-500">Quotation requests matched to your capabilities. One quote covers the whole request.</p>
        </div>
        <button onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {banner && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700" role="status">{banner}</p>
      )}
      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{error}</p>}

      {leads.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Inbox className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No leads yet</p>
          <p className="mt-1 text-sm text-slate-500">
            You'll be invited to quote when a customer's request matches your approved capabilities.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {leads.map((lead) => (
            <section key={lead.matchId} className="rounded-xl border border-slate-200 bg-white p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900">
                    {lead.rfq.rfqNumber}
                    <span className={`ml-2 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLE[lead.status]}`}>
                      {lead.status.toLowerCase()}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {lead.rfq.itemCount} product{lead.rfq.itemCount === 1 ? "" : "s"} · {lead.rfq.totalQuantity.toLocaleString("en-IN")} units
                    {lead.rfq.ship.city && (
                      <span className="ml-2 inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" /> {[lead.rfq.ship.city, lead.rfq.ship.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {lead.rfq.requiredBy && <span className="ml-2">Needed by {new Date(lead.rfq.requiredBy).toLocaleDateString("en-IN")}</span>}
                  </p>
                  {lead.reasons.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-slate-400">Matched because: {lead.reasons.join(", ")}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {lead.status !== "DECLINED" && lead.rfq.status !== "ACCEPTED" && (
                    <>
                      <button
                        onClick={() => open(lead)}
                        className="rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-orange-700"
                      >
                        {lead.status === "QUOTED" ? "Revise quote" : "Quote this RFQ"}
                      </button>
                      {lead.status !== "QUOTED" && (
                        <button
                          onClick={() => void decline(lead)}
                          className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
                        >
                          Decline
                        </button>
                      )}
                    </>
                  )}
                </div>
              </header>

              {/* Customer requirement: every product with its specs */}
              <ul className="mt-3 space-y-2 text-sm">
                {lead.rfq.items.map((i, idx) => {
                  const specs = Object.entries(i.specs ?? {}).filter(([, v]) => v && String(v).trim() !== "");
                  return (
                    <li key={i.id} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex justify-between gap-3">
                        <span className="font-semibold text-slate-800">{idx + 1}. {i.productName}</span>
                        <span className="shrink-0 text-slate-500">{i.quantity.toLocaleString("en-IN")} {i.unit}</span>
                      </div>
                      {specs.length > 0 && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {specs.map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                        </p>
                      )}
                      {i.notes && <p className="mt-0.5 text-xs text-slate-400">Note: {i.notes}</p>}
                    </li>
                  );
                })}
              </ul>

              {lead.rfq.notes && <p className="mt-2 text-xs text-slate-500">Customer notes: {lead.rfq.notes}</p>}

              {lead.rfq.files.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {lead.rfq.files.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => void download(lead, f.id, f.fileName)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <Paperclip className="h-3.5 w-3.5" /> {f.fileName}
                      <span className="text-slate-400">({prettySize(f.size)})</span>
                      <Download className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}

              {quoting === lead.matchId && (
                <QuoteForm
                  lead={lead}
                  onCancel={() => setQuoting(null)}
                  onDone={() => {
                    setQuoting(null);
                    setBanner(`Your quote for ${lead.rfq.rfqNumber} was sent to the customer.`);
                    void load();
                  }}
                />
              )}
            </section>
          ))}
        </div>
      )}

      <p className="mt-8 flex items-center gap-1.5 text-xs text-slate-400">
        <FileText className="h-3.5 w-3.5" /> Line totals and grand totals are always computed by Zolo's server from your unit prices.
      </p>
    </div>
  );
}
