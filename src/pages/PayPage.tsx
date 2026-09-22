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
import { Breadcrumb, Button, ButtonLink, Field, Input, cx } from "../components/UI";
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
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const copyUpi = (id: string) => {
    void navigator.clipboard?.writeText(id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
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

  const crumbs = [{ label: "Home", to: "/" }, { label: "Payment" }];

  if (error) {
    return (
      <main className="section-sm">
        <div className="shell">
          <div className="mx-auto max-w-2xl">
            <Breadcrumb items={crumbs} />
            <section className="card mt-4 flex flex-col items-center px-6 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"><XCircle className="h-6 w-6" aria-hidden /></span>
              <h1 className="h3 mt-4 text-dark-900">Payment link not found</h1>
              <p className="mt-1.5 max-w-sm text-sm text-dark-500">{error}</p>
              <p className="mt-1 max-w-sm text-sm text-dark-500">The link may have been mistyped or replaced. Please use the latest link we sent you, or contact us.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <ButtonLink to="/contact" variant="outline">Contact us</ButtonLink>
                <ButtonLink to="/" variant="ghost">Go to homepage</ButtonLink>
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }
  if (!pr) {
    return (
      <main className="section-sm">
        <div className="shell">
          <div className="mx-auto max-w-2xl space-y-4" aria-busy="true" aria-label="Loading payment details">
            <Breadcrumb items={crumbs} />
            <div className="skeleton h-40" />
            <div className="skeleton h-64" />
            <div className="skeleton h-56" />
          </div>
        </div>
      </main>
    );
  }

  const selected = pr.methods.find((m) => m.key === method) ?? null;
  const statusBanner = (() => {
    switch (pr.status) {
      case "PAID": return { icon: CheckCircle2, cls: "border-green-200 bg-green-50", ic: "bg-green-100 text-green-600", title: "Payment received — thank you", body: `We verified your payment of ${inr(pr.amountMinor)}${pr.paidAt ? ` on ${fmt(pr.paidAt)}` : ""}.` };
      case "SUBMITTED": return { icon: Clock, cls: "border-amber-200 bg-amber-50", ic: "bg-amber-100 text-amber-700", title: "Payment details received", body: "Our team is verifying your payment. You'll be notified as soon as it is confirmed — this usually takes a few business hours." };
      case "EXPIRED": return { icon: XCircle, cls: "border-dark-200 bg-dark-50", ic: "bg-dark-100 text-dark-500", title: "This payment request has expired", body: "Please contact us for a fresh link." };
      case "CANCELLED": return { icon: XCircle, cls: "border-dark-200 bg-dark-50", ic: "bg-dark-100 text-dark-500", title: "This payment request was cancelled", body: "No payment is due on this link." };
      default: return null;
    }
  })();

  return (
    <main className="section-sm">
      <div className="shell">
        <div className="mx-auto max-w-2xl space-y-4">
          <Breadcrumb items={crumbs} />

          {statusBanner && (
            <section className={cx("card p-5 text-center sm:p-6", statusBanner.cls)} role="status">
              <span className={cx("mx-auto flex h-12 w-12 items-center justify-center rounded-full", statusBanner.ic)}>
                <statusBanner.icon className="h-6 w-6" aria-hidden />
              </span>
              <h1 className="h3 mt-3 text-dark-900">{statusBanner.title}</h1>
              <p className="mt-1 text-sm text-dark-600">{statusBanner.body}</p>
            </section>
          )}
          {pr.reviewNote && pr.status === "SENT" && (
            <div className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
              <p className="font-semibold">We couldn't verify your previous submission.</p>
              <p className="mt-0.5">{pr.reviewNote} — please check the details and submit again below.</p>
            </div>
          )}

          {/* Summary */}
          <section className="card p-5 sm:p-6">
            <p className="eyebrow">Payment request · {pr.requestNumber}</p>
            <h2 className="h3 mt-2 text-dark-900">{pr.title}</h2>
            {pr.description && <p className="mt-1 text-sm text-dark-600">{pr.description}</p>}
            <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-dark-100 pt-4">
              <div>
                <p className="text-xs text-dark-500">Amount payable</p>
                <p className="text-3xl font-bold tabular-nums text-dark-900">{inr(pr.amountMinor)}</p>
              </div>
              <div className="text-xs text-dark-500 sm:text-right">
                {pr.order && <p>Order <span className="font-mono font-semibold text-dark-800">{pr.order.orderNumber}</span></p>}
                {pr.customer?.email && <p>For {pr.customer.email}</p>}
                {pr.expiresAt && pr.status !== "PAID" && <p className="font-semibold text-amber-700">Pay by {fmt(pr.expiresAt)}</p>}
              </div>
            </div>
          </section>

          {pr.canSubmit && (
            <>
              {/* Method */}
              <section className="card p-5 sm:p-6">
                <h3 className="h3 text-dark-900">1. Pay using</h3>
                <p className="mt-1 text-sm text-dark-500">Pick a method, then pay the exact amount shown above.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {pr.methods.map((m) => {
                    const active = method === m.key;
                    const Icon = m.key === "upi" ? QrCode : Building2;
                    return (
                      <label
                        key={m.key}
                        className={cx(
                          "card-flat flex cursor-pointer items-start gap-3 p-4 transition-colors",
                          active ? "border-green-500 bg-green-50 ring-2 ring-green-200" : "hover:border-dark-300",
                        )}
                      >
                        <input type="radio" name="method" className="mt-1 h-4 w-4 shrink-0 accent-green-600" checked={active} onChange={() => setMethod(m.key as PaymentMethodKey)} />
                        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", active ? "bg-green-100 text-green-600" : "bg-dark-100 text-dark-600")}>
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-dark-900">{m.displayName}</span>
                          <span className="mt-0.5 block text-xs text-dark-500">{m.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {selected?.key === "upi" && (
                  <div className="card-flat mt-4 grid gap-4 bg-cream-50 p-4 sm:grid-cols-[176px_1fr]">
                    {selected.config.qrUrl ? (
                      <img src={selected.config.qrUrl} alt="UPI QR code" className="mx-auto aspect-square w-44 max-w-full rounded-[8px] border border-dark-200 bg-white object-contain p-1" />
                    ) : (
                      <div className="mx-auto flex aspect-square w-44 max-w-full items-center justify-center rounded-[8px] border border-dark-200 bg-white p-3 text-center text-xs text-dark-500">No QR — use the UPI ID</div>
                    )}
                    <div className="min-w-0 text-sm text-dark-700">
                      {selected.config.upiId && (
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-dark-500">UPI ID:</span>
                          <span className="break-all font-mono font-bold text-dark-900">{selected.config.upiId}</span>
                          <button type="button" onClick={() => copyUpi(selected.config.upiId ?? "")} className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline">
                            <Copy className="h-3 w-3" aria-hidden /> {copied ? "Copied" : "Copy"}
                          </button>
                        </p>
                      )}
                      {selected.config.accountName && <p className="mt-1"><span className="text-dark-500">Payee:</span> {selected.config.accountName}</p>}
                      <p className="mt-1"><span className="text-dark-500">Amount:</span> <b className="text-dark-900">{inr(pr.amountMinor)}</b> (exact)</p>
                      <p className="mt-2 text-xs text-dark-500">{selected.config.instructions || "Scan the QR with any UPI app (GPay, PhonePe, Paytm, BHIM), pay the exact amount, then enter the UPI transaction ID below."}</p>
                    </div>
                  </div>
                )}
                {selected?.key === "bank_transfer" && (
                  <div className="card-flat mt-4 bg-cream-50 p-4 text-sm text-dark-700">
                    <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
                      {selected.config.accountName && <><dt className="text-dark-500">Account name</dt><dd className="font-semibold text-dark-900">{selected.config.accountName}</dd></>}
                      {selected.config.bankName && <><dt className="text-dark-500">Bank</dt><dd className="font-semibold text-dark-900">{selected.config.bankName}</dd></>}
                      {selected.config.accountNumber && <><dt className="text-dark-500">Account number</dt><dd className="break-all font-mono font-semibold text-dark-900">{selected.config.accountNumber}</dd></>}
                      {selected.config.ifsc && <><dt className="text-dark-500">IFSC</dt><dd className="font-mono font-semibold text-dark-900">{selected.config.ifsc}</dd></>}
                      <dt className="text-dark-500">Amount</dt><dd className="font-bold text-dark-900">{inr(pr.amountMinor)}</dd>
                    </dl>
                    <p className="mt-2 text-xs text-dark-500">{selected.config.instructions || "Transfer via NEFT / IMPS / RTGS and enter the UTR number below."}</p>
                  </div>
                )}
                {(selected?.key === "neft" || selected?.key === "cheque") && (
                  <p className="card-flat mt-4 bg-cream-50 p-4 text-sm text-dark-600">{selected.config.instructions || `Pay by ${PAYMENT_METHOD_LABEL[selected.key]} and enter the reference number below.`}</p>
                )}
              </section>

              {/* Proof */}
              <section className="card p-5 sm:p-6">
                <h3 className="h3 text-dark-900">2. Share your payment details</h3>
                <p className="mt-1 text-sm text-dark-500">Enter the reference number or attach a screenshot so we can verify quickly.</p>
                <form
                  className="mt-4 grid gap-4 sm:grid-cols-2"
                  onSubmit={(e) => { e.preventDefault(); void submit(); }}
                  noValidate
                >
                  <Field label="Transaction reference (UTR / UPI ref no.)" htmlFor="pay-ref">
                    <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="font-mono" placeholder="e.g. 4123456789" autoComplete="off" />
                  </Field>
                  <Field label="Note (optional)" htmlFor="pay-note">
                    <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Anything we should know" />
                  </Field>

                  <div className="sm:col-span-2">
                    <span className="label">Payment screenshot (optional)</span>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); }} />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f); }}
                      className={cx(
                        "flex w-full flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-4 py-6 text-center text-sm transition-colors",
                        dragging ? "border-green-500 bg-green-50" : "border-dark-300 bg-white hover:border-green-500 hover:bg-green-50",
                      )}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600"><FileImage className="h-5 w-5" aria-hidden /></span>
                      {file ? (
                        <span className="break-all font-semibold text-dark-900">{file.name}</span>
                      ) : (
                        <>
                          <span className="font-semibold text-dark-900">Drop a file here or click to attach</span>
                          <span className="text-xs text-dark-500">JPG, PNG, WebP or PDF · up to 10 MB</span>
                        </>
                      )}
                    </button>
                    {preview && <img src={preview} alt="Preview" className="mt-3 max-h-40 rounded-[8px] border border-dark-200 object-contain" />}
                    {file && (
                      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={clearFile}>Remove file</Button>
                    )}
                  </div>

                  {submitError && (
                    <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 sm:col-span-2" role="alert">
                      {submitError}
                    </div>
                  )}

                  <div className="sm:col-span-2">
                    <Button type="submit" size="lg" className="w-full" disabled={busy}>
                      {busy
                        ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Submitting…</>
                        : <><ShieldCheck className="h-4 w-4" aria-hidden /> I have paid {inr(pr.amountMinor)}</>}
                    </Button>
                    <p className="mt-2 flex items-center justify-center gap-1 text-center text-[11px] text-dark-500"><Lock className="h-3 w-3 shrink-0" aria-hidden /> Amount and status are confirmed by Zolo Packaging after verification.</p>
                  </div>
                </form>
              </section>
            </>
          )}

          {pr.proof && (pr.status === "SUBMITTED" || pr.status === "PAID") && (
            <section className="card p-5 text-sm text-dark-700 sm:p-6">
              <h3 className="h3 text-dark-900">Your submission</h3>
              <p className="mt-2">Method: <span className="font-semibold text-dark-900">{PAYMENT_METHOD_LABEL[pr.proof.method ?? ""] ?? pr.proof.method}</span>{pr.proof.reference && <> · Reference: <span className="font-mono font-semibold text-dark-900">{pr.proof.reference}</span></>}{pr.proof.hasFile && " · screenshot attached"}</p>
              {pr.submittedAt && <p className="mt-1 text-xs text-dark-500">Submitted {fmt(pr.submittedAt)}</p>}
            </section>
          )}

          <p className="text-center text-xs text-dark-500">
            Questions? <Link to="/contact" className="font-semibold text-green-600 hover:underline">Contact us</Link>{pr.order && <> · <Link to="/account/orders" className="font-semibold text-green-600 hover:underline">View your orders</Link></>}
          </p>
        </div>
      </div>
    </main>
  );
}
