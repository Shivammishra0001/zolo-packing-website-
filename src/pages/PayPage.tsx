// Public payment page: /pay/:token
//
// Opened from the link in a payment request (email / WhatsApp / in-app). No
// sign-in is required — the 256-bit token IS the credential — and the amount,
// allowed methods and status all come from the server. The customer pays via
// UPI/QR or bank transfer and submits the reference/screenshot; an admin then
// verifies before it is marked paid, so this page never claims "paid" itself.
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Building2, CheckCircle2, Clock, Copy, FileImage, Loader2, Lock, QrCode, ShieldCheck, XCircle } from "lucide-react";
import { paymentRequestsApi, fileToBase64, PAYMENT_METHOD_LABEL, type PaymentMethodKey, type PublicPaymentRequest } from "../lib/api/settings";

const inr = (m: number) => "₹" + (m / 100).toLocaleString("en-IN", { minimumFractionDigits: m % 100 ? 2 : 0, maximumFractionDigits: 2 });
const fmt = (s: string) => new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default function PayPage() {
  const { token = "" } = useParams();
  const [pr, setPr] = useState<PublicPaymentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethodKey | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    paymentRequestsApi.byToken(token)
      .then((r) => { if (!alive) return; setPr(r); setMethod((r.methods[0]?.key as PaymentMethodKey) ?? null); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "This payment link is not valid."); });
    return () => { alive = false; };
  }, [token]);

  const pick = (f: File) => {
    if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(f.type)) { setSubmitError("Attach a JPG, PNG, WebP or PDF."); return; }
    if (f.size > 10 * 1024 * 1024) { setSubmitError("File must be 10 MB or smaller."); return; }
    setSubmitError(null);
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const submit = async () => {
    if (!pr || !method) return;
    if (!reference.trim() && !file) { setSubmitError("Enter the transaction reference (UTR / UPI ref) or attach a payment screenshot."); return; }
    setBusy(true); setSubmitError(null);
    try {
      const updated = await paymentRequestsApi.submit(token, {
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        proof: file ? { name: file.name, mime: file.type, dataBase64: await fileToBase64(file) } : null,
      });
      setPr(updated);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not submit. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
        <XCircle className="mx-auto h-12 w-12 text-red-500" />
        <h1 className="mt-3 font-display text-2xl font-extrabold text-dark-900">Payment link not found</h1>
        <p className="mt-2 text-sm text-dark-500">{error}</p>
        <p className="mt-1 text-sm text-dark-500">The link may have been mistyped or replaced. Please use the latest link we sent you, or contact us.</p>
        <Link to="/" className="mt-6 inline-block rounded-xl bg-dark-900 px-5 py-3 text-sm font-bold text-white">Go to homepage</Link>
      </main>
    );
  }
  if (!pr) return <main className="py-24 text-center text-sm text-dark-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /> Loading payment details…</main>;

  const selected = pr.methods.find((m) => m.key === method) ?? null;
  const statusBanner = (() => {
    switch (pr.status) {
      case "PAID": return { icon: CheckCircle2, cls: "border-green-100 bg-green-50", ic: "text-green-600", title: "Payment received — thank you", body: `We verified your payment of ${inr(pr.amountMinor)}${pr.paidAt ? ` on ${fmt(pr.paidAt)}` : ""}.` };
      case "SUBMITTED": return { icon: Clock, cls: "border-amber-100 bg-amber-50", ic: "text-amber-600", title: "Payment details received", body: "Our team is verifying your payment. You'll be notified as soon as it is confirmed — this usually takes a few business hours." };
      case "EXPIRED": return { icon: XCircle, cls: "border-dark-100 bg-dark-50", ic: "text-dark-500", title: "This payment request has expired", body: "Please contact us for a fresh link." };
      case "CANCELLED": return { icon: XCircle, cls: "border-dark-100 bg-dark-50", ic: "text-dark-500", title: "This payment request was cancelled", body: "No payment is due on this link." };
      default: return null;
    }
  })();

  return (
    <main className="py-10">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        {statusBanner && (
          <div className={`mb-5 rounded-2xl border p-5 text-center ${statusBanner.cls}`}>
            <statusBanner.icon className={`mx-auto h-10 w-10 ${statusBanner.ic}`} />
            <h1 className="mt-2 font-display text-xl font-extrabold text-dark-900">{statusBanner.title}</h1>
            <p className="mt-1 text-sm text-dark-600">{statusBanner.body}</p>
          </div>
        )}
        {pr.reviewNote && pr.status === "SENT" && (
          <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
            <b>We couldn't verify your previous submission.</b> {pr.reviewNote} — please check the details and submit again below.
          </div>
        )}

        {/* Summary */}
        <section className="rounded-2xl border border-dark-100 bg-white p-5 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-dark-400">Payment request · {pr.requestNumber}</p>
          <h2 className="mt-1 font-display text-2xl font-extrabold text-dark-900">{pr.title}</h2>
          {pr.description && <p className="mt-1 text-sm text-dark-600">{pr.description}</p>}
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-dark-100 pt-4">
            <div>
              <p className="text-xs text-dark-400">Amount payable</p>
              <p className="text-3xl font-extrabold tabular-nums text-dark-900">{inr(pr.amountMinor)}</p>
            </div>
            <div className="text-right text-xs text-dark-500">
              {pr.order && <p>Order <span className="font-mono font-semibold text-dark-800">{pr.order.orderNumber}</span></p>}
              {pr.customer?.email && <p>For {pr.customer.email}</p>}
              {pr.expiresAt && pr.status !== "PAID" && <p className="text-amber-700">Pay by {fmt(pr.expiresAt)}</p>}
            </div>
          </div>
        </section>

        {pr.canSubmit && (
          <>
            {/* Method */}
            <section className="mt-5 rounded-2xl border border-dark-100 bg-white p-5 sm:p-6">
              <h3 className="font-bold text-dark-900">1. Pay using</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {pr.methods.map((m) => (
                  <label key={m.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${method === m.key ? "border-primary-500 bg-primary-50/40 ring-1 ring-primary-200" : "border-dark-200"}`}>
                    <input type="radio" name="method" className="mt-1 accent-primary-600" checked={method === m.key} onChange={() => setMethod(m.key as PaymentMethodKey)} />
                    <span>
                      <span className="flex items-center gap-2 font-bold text-dark-900">{m.key === "upi" ? <QrCode className="h-4 w-4 text-primary-600" /> : <Building2 className="h-4 w-4 text-primary-600" />}{m.displayName}</span>
                      <span className="block text-xs text-dark-500">{m.description}</span>
                    </span>
                  </label>
                ))}
              </div>

              {selected?.key === "upi" && (
                <div className="mt-4 grid gap-4 rounded-xl bg-dark-50 p-4 sm:grid-cols-[180px_1fr]">
                  {selected.config.qrUrl ? (
                    <img src={selected.config.qrUrl} alt="UPI QR code" className="mx-auto aspect-square w-44 rounded-lg bg-white object-contain p-1" />
                  ) : (
                    <div className="flex aspect-square w-44 items-center justify-center rounded-lg bg-white text-xs text-dark-400">No QR — use the UPI ID</div>
                  )}
                  <div className="text-sm text-dark-700">
                    {selected.config.upiId && (
                      <p className="flex flex-wrap items-center gap-2"><span className="text-dark-500">UPI ID:</span> <span className="font-mono font-bold text-dark-900">{selected.config.upiId}</span>
                        <button type="button" onClick={() => void navigator.clipboard?.writeText(selected.config.upiId ?? "")} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600"><Copy className="h-3 w-3" /> Copy</button></p>
                    )}
                    {selected.config.accountName && <p className="mt-1"><span className="text-dark-500">Payee:</span> {selected.config.accountName}</p>}
                    <p className="mt-1"><span className="text-dark-500">Amount:</span> <b>{inr(pr.amountMinor)}</b> (exact)</p>
                    <p className="mt-2 text-xs text-dark-500">{selected.config.instructions || "Scan the QR with any UPI app (GPay, PhonePe, Paytm, BHIM), pay the exact amount, then enter the UPI transaction ID below."}</p>
                  </div>
                </div>
              )}
              {selected?.key === "bank_transfer" && (
                <div className="mt-4 rounded-xl bg-dark-50 p-4 text-sm text-dark-700">
                  <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {selected.config.accountName && <><dt className="text-dark-500">Account name</dt><dd className="font-semibold text-dark-900">{selected.config.accountName}</dd></>}
                    {selected.config.bankName && <><dt className="text-dark-500">Bank</dt><dd className="font-semibold text-dark-900">{selected.config.bankName}</dd></>}
                    {selected.config.accountNumber && <><dt className="text-dark-500">Account number</dt><dd className="font-mono font-semibold text-dark-900">{selected.config.accountNumber}</dd></>}
                    {selected.config.ifsc && <><dt className="text-dark-500">IFSC</dt><dd className="font-mono font-semibold text-dark-900">{selected.config.ifsc}</dd></>}
                    <dt className="text-dark-500">Amount</dt><dd className="font-semibold text-dark-900">{inr(pr.amountMinor)}</dd>
                  </dl>
                  <p className="mt-2 text-xs text-dark-500">{selected.config.instructions || "Transfer via NEFT / IMPS / RTGS and enter the UTR number below."}</p>
                </div>
              )}
              {(selected?.key === "neft" || selected?.key === "cheque") && (
                <p className="mt-4 rounded-xl bg-dark-50 p-4 text-sm text-dark-600">{selected.config.instructions || `Pay by ${PAYMENT_METHOD_LABEL[selected.key]} and enter the reference number below.`}</p>
              )}
            </section>

            {/* Proof */}
            <section className="mt-5 rounded-2xl border border-dark-100 bg-white p-5 sm:p-6">
              <h3 className="font-bold text-dark-900">2. Share your payment details</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-semibold text-dark-500">Transaction reference (UTR / UPI ref no.)</span>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="w-full rounded-xl border border-dark-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" placeholder="e.g. 4123456789" />
                </label>
                <div className="text-sm">
                  <span className="mb-1 block text-xs font-semibold text-dark-500">Payment screenshot (optional)</span>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
                  <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-dark-300 px-3 py-2.5 text-left text-sm text-dark-600 hover:border-primary-400">
                    <FileImage className="h-4 w-4 text-primary-600" /> {file ? file.name : "Attach JPG, PNG or PDF"}
                  </button>
                  {preview && <img src={preview} alt="Preview" className="mt-2 max-h-40 rounded-lg border border-dark-100 object-contain" />}
                </div>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-dark-500">Note (optional)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="w-full rounded-xl border border-dark-200 px-3 py-2.5 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" placeholder="Anything we should know" />
                </label>
              </div>
              {submitError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{submitError}</p>}
              <button type="button" onClick={submit} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 py-3 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-60">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : <><ShieldCheck className="h-4 w-4" /> I have paid {inr(pr.amountMinor)}</>}
              </button>
              <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-dark-400"><Lock className="h-3 w-3" /> Amount and status are confirmed by Zolo Packaging after verification.</p>
            </section>
          </>
        )}

        {pr.proof && (pr.status === "SUBMITTED" || pr.status === "PAID") && (
          <section className="mt-5 rounded-2xl border border-dark-100 bg-white p-5 text-sm text-dark-700">
            <h3 className="font-bold text-dark-900">Your submission</h3>
            <p className="mt-1">Method: {PAYMENT_METHOD_LABEL[pr.proof.method ?? ""] ?? pr.proof.method}{pr.proof.reference && <> · Reference: <span className="font-mono">{pr.proof.reference}</span></>}{pr.proof.hasFile && " · screenshot attached"}</p>
            {pr.submittedAt && <p className="text-xs text-dark-400">Submitted {fmt(pr.submittedAt)}</p>}
          </section>
        )}

        <p className="mt-6 text-center text-xs text-dark-400">
          Questions? <Link to="/contact" className="font-semibold text-primary-600">Contact us</Link>{pr.order && <> · <Link to="/account/orders" className="font-semibold text-primary-600">View your orders</Link></>}
        </p>
      </div>
    </main>
  );
}
