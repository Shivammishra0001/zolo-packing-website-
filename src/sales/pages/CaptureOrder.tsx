import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, UserPlus, Plus, Trash2, Camera, Check, ChevronLeft, Loader2, History } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { salesApi, type CustomerHit, type RecentItem } from "@/lib/api/sales";
import { describeApiError } from "@/lib/api/client";
import { useBuyerProducts } from "@/lib/products";
import {
  useDraft, selectCustomer, addLine, removeLine, setNotes, setPayment,
  addSample, removeSample, clearDraft, subtotalMinor, type DraftLine,
} from "../capture-store";
import { Field, TextInput, NumberInput, TextArea, Select, ChoiceTile, PrimaryButton, GhostButton, Steps, Card, inrMinor } from "../ui";

// Guided order capture. One decision per screen, so a routine order takes
// 1-3 minutes: Who? -> What? -> Sample? -> Payment? -> Review -> Done.
const STEPS = ["Customer", "Items", "Sample", "Payment", "Review"];

export default function CaptureOrder() {
  const draft = useDraft();
  const [step, setStep] = useState(0);
  const nav = useNavigate();
  const toast = useToast();

  // Resume where the rep left off if the draft survived a reload.
  useEffect(() => {
    if (draft.customerId && step === 0) setStep(draft.lines.length ? 1 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canAdvance =
    (step === 0 && !!draft.customerId) ||
    (step === 1 && draft.lines.length > 0) ||
    step === 2 ||
    step === 3 ||
    step === 4;

  return (
    <div className="pb-28">
      <header className="sticky top-0 z-20 border-b border-dark-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} aria-label="Back"
              className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg text-dark-600 active:bg-dark-50">
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-lg font-bold text-dark-900">New order</h1>
        </div>
        <Steps current={step} labels={STEPS} />
      </header>

      <div className="px-4 py-4">
        {step === 0 && <CustomerStep />}
        {step === 1 && <ItemsStep />}
        {step === 2 && <SampleStep />}
        {step === 3 && <PaymentStep />}
        {step === 4 && <ReviewStep onPlaced={(n) => { toast.success(`Order ${n} created`); clearDraft(); nav("/sales/orders"); }} />}
      </div>

      {step < 4 && (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-dark-200 bg-white px-4 py-3">
          <PrimaryButton disabled={!canAdvance} onClick={() => setStep(step + 1)}>
            {step === 2 && draft.samples.length === 0 ? "Skip — no sample" : "Continue"}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

// ---- 1. Who is this order for? -------------------------------------------

function CustomerStep() {
  const draft = useDraft();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  // Debounced so typing a phone number doesn't fire a request per keystroke.
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        setHits((await salesApi.searchCustomers(q)).customers);
      } catch (e) {
        toast.error("Search failed", describeApiError(e).message);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, toast]);

  const pick = async (c: CustomerHit) => {
    try {
      const snap = await salesApi.snapshot(c.id);
      selectCustomer(c.id, c.company || c.name, snap);
    } catch {
      selectCustomer(c.id, c.company || c.name, null); // history is a bonus, not a blocker
    }
  };

  if (draft.customerId) return <SelectedCustomer />;
  if (creating) return <NewCustomerForm onCancel={() => setCreating(false)} />;

  return (
    <div className="space-y-4">
      <Field label="Who is this order for?">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-dark-400" />
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, phone or business"
            autoFocus
            className="pl-12"
          />
        </div>
      </Field>

      {busy && <p className="text-sm text-dark-500">Searching…</p>}

      <div className="space-y-2">
        {hits.map((c) => (
          <button key={c.id} type="button" onClick={() => pick(c)}
            className="w-full rounded-xl border border-dark-200 bg-white p-4 text-left active:bg-dark-50">
            <p className="font-bold text-dark-900">{c.company || c.name}</p>
            <p className="text-sm text-dark-500">{c.name} · {c.phone ?? c.email}</p>
          </button>
        ))}
      </div>

      <GhostButton className="w-full" onClick={() => setCreating(true)}>
        <UserPlus className="h-4 w-4" /> New customer
      </GhostButton>
    </div>
  );
}

function SelectedCustomer() {
  const draft = useDraft();
  const s = draft.snapshot;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-dark-900">{draft.customerName}</p>
          {s && <p className="text-sm text-dark-500">{s.customer.phone ?? s.customer.email}</p>}
        </div>
        <GhostButton onClick={() => selectCustomer("", "", null)}>Change</GhostButton>
      </div>
      {s && s.orderCount > 0 && (
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-dark-100 pt-3 text-center">
          <div><dt className="text-[11px] text-dark-500">Orders</dt><dd className="font-bold text-dark-900">{s.orderCount}</dd></div>
          <div><dt className="text-[11px] text-dark-500">Business</dt><dd className="font-bold text-dark-900">{inrMinor(s.totalBusinessMinor)}</dd></div>
          <div><dt className="text-[11px] text-dark-500">Outstanding</dt>
            <dd className={`font-bold ${s.outstandingMinor > 0 ? "text-red-600" : "text-dark-900"}`}>{inrMinor(s.outstandingMinor)}</dd></div>
        </dl>
      )}
    </Card>
  );
}

function NewCustomerForm({ onCancel }: { onCancel: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", company: "", email: "", gstin: "" });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    setBusy(true);
    try {
      // Email is optional: the API generates a non-deliverable placeholder when
      // a rep has only a phone number. Synthesising one here too would give the
      // same customer a different address depending on which screen created
      // them.
      const created = await salesApi.createCustomer({ ...f, email: f.email.trim() });
      const snap = await salesApi.snapshot(created.id).catch(() => null);
      selectCustomer(created.id, f.company || f.name, snap);
    } catch (e) {
      toast.error("Couldn't save customer", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Customer name" required>
        <TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
      </Field>
      <Field label="Mobile number" required>
        <TextInput value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </Field>
      <Field label="Business / brand name">
        <TextInput value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
      </Field>
      <Field label="Email" hint="Optional">
        <TextInput value={f.email} inputMode="email" onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="GSTIN" hint="Optional">
        <TextInput value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
      </Field>
      <div className="flex gap-2">
        <GhostButton className="flex-1" onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton className="flex-1" disabled={busy || !f.name.trim() || !f.phone.trim()} onClick={save}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save customer"}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---- 2. What do they want? -----------------------------------------------

function ItemsStep() {
  const draft = useDraft();
  const [adding, setAdding] = useState(draft.lines.length === 0);
  return (
    <div className="space-y-4">
      {draft.lines.map((l, i) => (
        <Card key={i}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-bold text-dark-900">{l.displayName}</p>
              <p className="text-sm text-dark-500">
                {l.quantity.toLocaleString("en-IN")} {l.unit} × {inrMinor(l.unitPriceMinor)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold text-dark-900">{inrMinor(l.quantity * l.unitPriceMinor)}</p>
              <button type="button" onClick={() => removeLine(i)} aria-label={`Remove ${l.displayName}`}
                className="mt-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-dark-400 active:bg-dark-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Card>
      ))}

      {draft.lines.length > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-dark-50 px-4 py-3">
          <span className="text-sm font-bold text-dark-700">Subtotal</span>
          <span className="text-lg font-bold text-dark-900">{inrMinor(subtotalMinor(draft))}</span>
        </div>
      )}

      {adding ? (
        <AddItem onDone={() => setAdding(false)} />
      ) : (
        <GhostButton className="w-full" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add another item
        </GhostButton>
      )}
    </div>
  );
}

function AddItem({ onDone }: { onDone: () => void }) {
  const draft = useDraft();
  const products = useBuyerProducts();
  const [mode, setMode] = useState<"catalog" | "custom">("catalog");
  const [q, setQ] = useState("");
  const [line, setLine] = useState<Partial<DraftLine>>({ quantity: 0, unitPriceMinor: 0, unit: "pcs" });
  const [rupees, setRupees] = useState("");

  // Reordering a previous line is the fastest path — "wahi pichli baar wala".
  const previous: RecentItem[] = draft.snapshot?.recentItems ?? [];
  const matches = q.trim().length > 1
    ? products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : [];

  const commit = () => {
    const quantity = Math.max(1, Math.round(Number(line.quantity) || 0));
    // Rupees in, paise out — the whole system stores integer minor units.
    const unitPriceMinor = Math.round(Number(rupees || 0) * 100);
    if (!quantity || !unitPriceMinor || !line.displayName) return;
    addLine({
      displayName: line.displayName,
      productId: line.productId,
      itemName: line.productId ? undefined : line.displayName,
      quantity,
      unitPriceMinor,
      unit: line.unit ?? "pcs",
      specs: line.specs,
    });
    setLine({ quantity: 0, unitPriceMinor: 0, unit: "pcs" });
    setRupees("");
    setQ("");
    onDone();
  };

  return (
    <Card className="space-y-4">
      <div className="flex gap-2">
        <ChoiceTile selected={mode === "catalog"} onClick={() => setMode("catalog")}>Catalog</ChoiceTile>
        <ChoiceTile selected={mode === "custom"} onClick={() => setMode("custom")}>Custom</ChoiceTile>
      </div>

      {previous.length > 0 && !line.displayName && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-dark-500">
            <History className="h-3.5 w-3.5" /> Ordered before
          </p>
          <div className="space-y-2">
            {previous.slice(0, 3).map((p, i) => (
              <button key={i} type="button"
                onClick={() => { setLine({ displayName: p.productName, quantity: p.quantity, unit: "pcs", specs: p.specs }); setRupees(String(p.unitPriceMinor / 100)); }}
                className="w-full rounded-lg border border-dark-200 p-3 text-left active:bg-dark-50">
                <p className="truncate text-sm font-bold text-dark-900">{p.productName}</p>
                <p className="text-xs text-dark-500">{p.quantity.toLocaleString("en-IN")} × {inrMinor(p.unitPriceMinor)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "catalog" ? (
        <Field label="Product">
          <TextInput value={line.displayName ?? q} placeholder="Search products"
            onChange={(e) => { setQ(e.target.value); setLine({ ...line, displayName: undefined, productId: undefined }); }} />
          {matches.length > 0 && !line.displayName && (
            <div className="mt-2 space-y-1">
              {matches.map((p) => (
                <button key={p.id} type="button"
                  onClick={() => { setLine({ ...line, displayName: p.name, productId: p.id }); setRupees(p.priceMinor ? String(p.priceMinor / 100) : ""); }}
                  className="w-full rounded-lg border border-dark-200 p-3 text-left text-sm active:bg-dark-50">
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </Field>
      ) : (
        <Field label="Item name" required>
          <TextInput value={line.displayName ?? ""} placeholder="Custom printed corrugated box"
            onChange={(e) => setLine({ ...line, displayName: e.target.value, productId: undefined })} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity" required>
          <NumberInput value={line.quantity || ""} onChange={(e) => setLine({ ...line, quantity: Number(e.target.value.replace(/\D/g, "")) })} />
        </Field>
        <Field label="Unit">
          <Select value={line.unit} onChange={(e) => setLine({ ...line, unit: e.target.value })}>
            {["pcs", "boxes", "bags", "rolls", "sets", "kg", "meter"].map((u) => <option key={u}>{u}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Price per unit (₹)" required>
        <NumberInput value={rupees} onChange={(e) => setRupees(e.target.value.replace(/[^\d.]/g, ""))} placeholder="12.50" />
      </Field>

      {Number(line.quantity) > 0 && Number(rupees) > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-green-50 px-4 py-3">
          <span className="text-sm text-green-800">
            {Number(line.quantity).toLocaleString("en-IN")} × ₹{rupees}
          </span>
          <span className="text-lg font-bold text-green-800">
            {inrMinor(Math.round(Number(line.quantity) * Number(rupees) * 100))}
          </span>
        </div>
      )}

      <PrimaryButton onClick={commit} disabled={!line.displayName || !line.quantity || !Number(rupees)}>
        Add item
      </PrimaryButton>
    </Card>
  );
}

// ---- 3. Sample ------------------------------------------------------------

function SampleStep() {
  const draft = useDraft();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const onFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("Too large", `${file.name} is over 10 MB.`);
        continue;
      }
      const dataBase64 = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.readAsDataURL(file);
      });
      addSample({ fileName: file.name, mime: file.type, dataBase64 });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-dark-600">Photograph the customer&apos;s sample or reference. Optional.</p>

      {/* capture="environment" opens the rear camera directly on Android/iOS. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => onFiles(e.target.files)} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
        onChange={(e) => onFiles(e.target.files)} />

      <div className="grid grid-cols-2 gap-3">
        <GhostButton className="min-h-20 flex-col" onClick={() => cameraRef.current?.click()}>
          <Camera className="h-6 w-6 text-green-600" /> Take photo
        </GhostButton>
        <GhostButton className="min-h-20 flex-col" onClick={() => fileRef.current?.click()}>
          <Plus className="h-6 w-6 text-green-600" /> Upload file
        </GhostButton>
      </div>

      {draft.samples.map((s, i) => (
        <div key={i} className="flex items-center justify-between rounded-xl border border-dark-200 bg-white px-4 py-3">
          <span className="truncate text-sm font-semibold text-dark-800">{s.fileName}</span>
          <button type="button" onClick={() => removeSample(i)} aria-label={`Remove ${s.fileName}`}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-dark-400 active:bg-dark-50">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- 4. Payment -----------------------------------------------------------

function PaymentStep() {
  const draft = useDraft();
  const total = subtotalMinor(draft);
  const [rupees, setRupees] = useState(draft.payment.amountMinor ? String(draft.payment.amountMinor / 100) : "");

  const setMode = (mode: "full" | "advance" | "later") => {
    const amountMinor = mode === "full" ? total : mode === "later" ? 0 : draft.payment.amountMinor;
    setPayment({ mode, amountMinor });
    setRupees(mode === "full" ? String(total / 100) : mode === "later" ? "" : rupees);
  };

  const paidMinor = draft.payment.mode === "full" ? total : Math.round(Number(rupees || 0) * 100);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <span className="text-sm text-dark-600">Order total</span>
          <span className="text-2xl font-bold text-dark-900">{inrMinor(total)}</span>
        </div>
      </Card>

      <Field label="Payment">
        <div className="flex gap-2">
          <ChoiceTile selected={draft.payment.mode === "full"} onClick={() => setMode("full")}>Full</ChoiceTile>
          <ChoiceTile selected={draft.payment.mode === "advance"} onClick={() => setMode("advance")}>Advance</ChoiceTile>
          <ChoiceTile selected={draft.payment.mode === "later"} onClick={() => setMode("later")}>Pay later</ChoiceTile>
        </div>
      </Field>

      {draft.payment.mode === "advance" && (
        <Field label="Advance received (₹)" required>
          <NumberInput value={rupees}
            onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ""); setRupees(v); setPayment({ amountMinor: Math.round(Number(v || 0) * 100) }); }} />
        </Field>
      )}

      {draft.payment.mode !== "later" && (
        <>
          <Field label="Method">
            <div className="grid grid-cols-3 gap-2">
              {(["cash", "upi", "bank_transfer", "cheque", "card", "other"] as const).map((m) => (
                <ChoiceTile key={m} selected={draft.payment.method === m} onClick={() => setPayment({ method: m })}>
                  {m === "bank_transfer" ? "Bank" : m.toUpperCase()}
                </ChoiceTile>
              ))}
            </div>
          </Field>
          {draft.payment.method !== "cash" && (
            <Field label="Reference" hint="UTR, transaction or cheque number — admin verifies it later">
              <TextInput value={draft.payment.reference} onChange={(e) => setPayment({ reference: e.target.value })} />
            </Field>
          )}
        </>
      )}

      <div className="rounded-xl bg-dark-50 px-4 py-3 text-sm">
        <div className="flex justify-between py-0.5"><span className="text-dark-600">Paid</span><span className="font-bold text-dark-900">{inrMinor(paidMinor)}</span></div>
        <div className="flex justify-between py-0.5"><span className="text-dark-600">Balance</span>
          <span className="font-bold text-dark-900">{inrMinor(Math.max(0, total - paidMinor))}</span></div>
      </div>

      <Field label="Notes for the office">
        <TextArea rows={3} value={draft.notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </div>
  );
}

// ---- 5. Review and place --------------------------------------------------

function ReviewStep({ onPlaced }: { onPlaced: (orderNumber: string) => void }) {
  const draft = useDraft();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const total = subtotalMinor(draft);

  const place = async () => {
    setBusy(true);
    try {
      const order = await salesApi.createOrder({
        customerId: draft.customerId!,
        notes: draft.notes || undefined,
        items: draft.lines.map((l) => ({
          productId: l.productId,
          itemName: l.productId ? undefined : l.displayName,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          specs: l.specs,
        })),
      });
      // Samples upload after the order exists, since they attach to its id. A
      // failed upload must not void a placed order, so it only warns.
      for (const s of draft.samples) {
        await salesApi.addSample(order.id, s).catch(() =>
          toast.error("Sample not attached", `${s.fileName} could not be uploaded.`));
      }
      onPlaced(order.orderNumber);
    } catch (e) {
      toast.error("Couldn't place the order", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-bold uppercase tracking-wide text-dark-500">Customer</p>
        <p className="mt-1 font-bold text-dark-900">{draft.customerName}</p>
      </Card>

      <Card>
        <p className="text-xs font-bold uppercase tracking-wide text-dark-500">Items</p>
        <ul className="mt-2 space-y-2">
          {draft.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-dark-700">
                {l.displayName}<br />
                <span className="text-xs text-dark-500">{l.quantity.toLocaleString("en-IN")} {l.unit} × {inrMinor(l.unitPriceMinor)}</span>
              </span>
              <span className="shrink-0 font-bold text-dark-900">{inrMinor(l.quantity * l.unitPriceMinor)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-dark-100 pt-3">
          <span className="font-bold text-dark-700">Total</span>
          <span className="text-lg font-bold text-dark-900">{inrMinor(total)}</span>
        </div>
        <p className="mt-1 text-[11px] text-dark-400">Tax and shipping are confirmed by the office.</p>
      </Card>

      <Card>
        <p className="text-xs font-bold uppercase tracking-wide text-dark-500">Payment</p>
        <p className="mt-1 text-sm text-dark-700">
          {draft.payment.mode === "later" ? "Pay later" : `${draft.payment.method.replace("_", " ").toUpperCase()} · ${inrMinor(draft.payment.mode === "full" ? total : draft.payment.amountMinor)}`}
        </p>
        {draft.samples.length > 0 && <p className="mt-2 text-sm text-dark-700">{draft.samples.length} sample(s) attached</p>}
      </Card>

      <PrimaryButton onClick={place} disabled={busy || !draft.customerId || draft.lines.length === 0}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
        {busy ? "Placing…" : "Place order"}
      </PrimaryButton>
    </div>
  );
}
