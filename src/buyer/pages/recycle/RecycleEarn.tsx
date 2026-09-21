import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Coins, ImagePlus, Leaf, PackagePlus, Recycle, ShoppingBag, Ticket, X } from "lucide-react";
import { Button, Dialog } from "@/admin/components/ui";
import { EmptyState, Panel } from "@/admin/components/Panel";
import { inrMinor } from "@/admin/format";
import { AREA, Field, FIELD, FIELD_ERR, type FormErrors } from "@/admin/pages/marketing/shared";
import { useToast } from "@/components/ui/Toast";
import { ApiError, describeApiError } from "@/lib/api/client";
import { addressApi, type Address } from "@/lib/api/commerce";
import { fmtQty, recyclingApi, type ProgramMaterial, type RecyclingProgram, type RecyclingRequest } from "@/lib/api/recycling";
import { cn } from "@/utils/cn";

// "Recycle your packaging and earn Eco Credits."
//
// Every number on this page — credits per unit, the quantity limits, how many
// credits make a coupon and what that coupon is worth — is read from the API
// (the admin's active Recycling Rules + Eco Reward Settings). Nothing is
// promised in code, because the admin can change any of it.

const STEPS = [
  { icon: PackagePlus, title: "Submit your recyclable packaging", text: "Tell us the material and roughly how much. Add photos and a pickup address." },
  { icon: BadgeCheck, title: "We verify the quantity", text: "After pickup we weigh or count what arrived. Credits are based on the verified quantity, not the estimate." },
  { icon: Coins, title: "Receive Eco Credits", text: "Verified quantity × the material's rate is added to your Eco Credit wallet." },
  { icon: Ticket, title: "Redeem credits for coupons", text: "Turn credits into a personal coupon whenever you have enough." },
  { icon: ShoppingBag, title: "Use the coupon at checkout", text: "Enter the code on your next order." },
];

const limits = (m: ProgramMaterial) =>
  m.minQuantity != null && m.maxQuantity != null ? `${fmtQty(m.minQuantity)}–${fmtQty(m.maxQuantity)} ${m.unit} per request`
    : m.minQuantity != null ? `from ${fmtQty(m.minQuantity)} ${m.unit}` : m.maxQuantity != null ? `up to ${fmtQty(m.maxQuantity)} ${m.unit} per request` : "any quantity";

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- new request ----------

export function NewRecyclingDialog({ open, program, onClose, onCreated }: {
  open: boolean; program: RecyclingProgram | null; onClose: () => void; onCreated: (r: RecyclingRequest) => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [ruleId, setRuleId] = useState("");
  const [qty, setQty] = useState("");
  const [description, setDescription] = useState("");
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressId, setAddressId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const materials = program?.materials ?? [];
  const chosen = materials.find((m) => m.ruleId === ruleId) ?? null;

  useEffect(() => {
    if (!open) return;
    setRuleId(materials.length === 1 ? materials[0].ruleId : ""); setQty(""); setDescription(""); setFiles([]); setErrors({}); setBusy(false);
    addressApi.list().then((list) => { setAddresses(list); const def = list.find((a) => a.isDefault) ?? list[0]; setAddressId(def?.id ?? ""); }).catch(() => setAddresses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { toast.error("Photo skipped", `${f.name} is not a JPG, PNG or WebP image.`); continue; }
      if (f.size > 10 * 1024 * 1024) { toast.error("Photo skipped", `${f.name} is larger than 10 MB.`); continue; }
      if (next.length >= 5) { toast.error("Photo skipped", "You can attach up to 5 photos."); break; }
      next.push(f);
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async () => {
    const e: FormErrors = {};
    if (!chosen) e.material = "Choose the material.";
    if (!/^\d+(\.\d{1,3})?$/.test(qty.trim()) || Number(qty) <= 0) e.estimatedQuantity = "Enter your estimated quantity.";
    if (!addressId) e.pickupAddressId = "Choose a pickup address.";
    setErrors(e);
    if (Object.keys(e).length || !chosen) return;
    setBusy(true);
    try {
      const created = await recyclingApi.create({ material: chosen.material, unit: chosen.unit, estimatedQuantity: Number(qty), description: description.trim() || null, pickupAddressId: addressId });
      let failed = 0;
      for (const f of files) {
        try { await recyclingApi.attachFile(created.id, { fileName: f.name, mime: f.type, dataBase64: await fileToBase64(f) }); } catch { failed += 1; }
      }
      toast.success("Recycling request submitted", failed ? `${created.requestNumber} was created, but ${failed} photo(s) could not be uploaded.` : `${created.requestNumber} — we'll schedule a pickup and verify the quantity.`);
      onCreated(created);
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        const out: FormErrors = {};
        for (const i of err.issues) out[i.path.split(".")[0]] ??= i.message;
        setErrors(out);
      } else setErrors({ form: describeApiError(err).message });
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open} onClose={onClose} title="Submit recyclable packaging"
      description="Give us your best estimate — Eco Credits are calculated on the quantity we verify after pickup."
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" icon={Recycle} loading={busy} disabled={!materials.length} onClick={submit}>Submit request</Button></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        {errors.form && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{errors.form}</p>}
        <Field label="Material type" required error={errors.material} hint={chosen ? `${fmtQty(chosen.creditsPerUnit)} Eco Credits per ${chosen.unit} · ${limits(chosen)}` : "Only materials we currently accept are listed."}>
          <select value={ruleId} onChange={(e) => setRuleId(e.target.value)} className={cn(FIELD, errors.material && FIELD_ERR)}>
            <option value="">Select a material…</option>
            {materials.map((m) => <option key={m.ruleId} value={m.ruleId}>{m.material} (per {m.unit})</option>)}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estimated quantity" required error={errors.estimatedQuantity}>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="10" className={cn(FIELD, errors.estimatedQuantity && FIELD_ERR)} />
          </Field>
          <Field label="Unit" hint="Set by the material."><input value={chosen?.unit ?? "—"} readOnly disabled className={FIELD} /></Field>
        </div>
        <Field label="Description" hint="Optional — e.g. flattened boxes, clean and dry.">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} className={AREA} />
        </Field>
        <div>
          <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Images <span className="font-normal erp-text-faint">(up to 5)</span></span>
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md border erp-border erp-surface-2 py-1 pl-2 pr-1 text-xs erp-text">
                <span className="max-w-40 truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="flex h-5 w-5 items-center justify-center rounded hover:erp-surface"><X className="h-3 w-3" aria-hidden /></button>
              </span>
            ))}
            {files.length < 5 && <Button type="button" size="sm" icon={ImagePlus} onClick={() => fileInput.current?.click()}>Add photos</Button>}
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} aria-label="Recycling photos" />
        </div>
        <Field label="Pickup address" required error={errors.pickupAddressId}>
          {addresses !== null && addresses.length === 0 ? (
            <p className="rounded-lg border erp-border p-3 text-sm erp-text-muted">You have no saved address. <Link to="/account/addresses" className="font-semibold text-primary-600 hover:underline dark:text-primary-400">Add an address</Link> first.</p>
          ) : (
            <select value={addressId} onChange={(e) => setAddressId(e.target.value)} className={cn(FIELD, errors.pickupAddressId && FIELD_ERR)}>
              {(addresses ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} — {a.line1}, {a.city} {a.postalCode}</option>)}
            </select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}

// ---------- programme explainer ----------

export default function RecycleEarn({ program, balance, onStart, onOpenWallet }: {
  program: RecyclingProgram | null; balance: number | null; onStart: () => void; onOpenWallet: () => void;
}) {
  const reward = program?.reward;
  const materials = program?.materials ?? [];
  // One worked example, built ONLY from live values (the first accepted material).
  const example = useMemo(() => materials[0] ?? null, [materials]);

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-transparent sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"><Leaf className="h-3.5 w-3.5" aria-hidden /> Recycle &amp; Earn</div>
            <h2 className="mt-3 font-display text-2xl font-extrabold erp-text sm:text-3xl">Recycle your packaging and earn Eco Credits.</h2>
            <p className="mt-2 max-w-2xl text-sm erp-text-muted">Send back used packaging, we verify the quantity, and Eco Credits land in your wallet — ready to turn into coupons for your next order.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="primary" icon={Recycle} onClick={onStart} disabled={!materials.length}>Submit recyclable packaging</Button>
            {balance != null && <Button icon={Coins} onClick={onOpenWallet}>{balance.toLocaleString("en-IN")} Eco Credits</Button>}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="What you can recycle right now">
          {materials.length === 0 ? (
            <EmptyState icon={Recycle} title="Recycling isn't open yet" message="No materials are being accepted at the moment. Please check back soon." />
          ) : (
            <ul className="divide-y erp-border">
              {materials.map((m) => (
                <li key={m.ruleId} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0"><span className="block font-semibold erp-text">{m.material}</span><span className="block text-xs erp-text-muted">{limits(m)}</span></span>
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    1 {m.unit} <ArrowRight className="inline h-3.5 w-3.5" aria-hidden /> {fmtQty(m.creditsPerUnit)} Eco Credits
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs erp-text-faint">Rates are set by Zolo and can change. Your credits are calculated with the rate in force when your request is approved.</p>
        </Panel>

        <Panel title="What Eco Credits are worth">
          {reward?.enabled && reward.creditsRequired && reward.couponValueMinor ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border erp-border erp-surface-2 p-5 text-center">
                <span className="font-display text-2xl font-extrabold erp-text">{reward.creditsRequired.toLocaleString("en-IN")} Eco Credits</span>
                <ArrowRight className="h-5 w-5 erp-text-faint" aria-hidden />
                <span className="font-display text-2xl font-extrabold text-primary-600 dark:text-primary-400">{inrMinor(reward.couponValueMinor)} Coupon</span>
              </div>
              <ul className="space-y-1 text-xs erp-text-muted">
                {reward.couponValidityDays && <li>• The coupon is valid for {reward.couponValidityDays} days and belongs to your account only.</li>}
                {reward.couponMinOrderMinor ? <li>• Minimum order {inrMinor(reward.couponMinOrderMinor)}.</li> : null}
                {reward.minCreditsToRedeem && reward.minCreditsToRedeem > reward.creditsRequired ? <li>• You need at least {reward.minCreditsToRedeem.toLocaleString("en-IN")} Eco Credits in your wallet to redeem.</li> : null}
                {reward.creditExpiryDays ? <li>• Eco Credits expire if unused for {reward.creditExpiryDays} days.</li> : null}
              </ul>
            </div>
          ) : (
            <EmptyState icon={Ticket} title="Coupon rewards aren't open yet" message="You can still earn Eco Credits now — they stay in your wallet until redemption opens." />
          )}
        </Panel>
      </div>

      <Panel title="How it works">
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border erp-border p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{i + 1}</span>
                <s.icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              </div>
              <p className="mt-2 text-sm font-semibold erp-text">{s.title}</p>
              <p className="mt-1 text-xs erp-text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
        {example && (
          <p className="mt-4 rounded-lg erp-surface-2 p-3 text-xs erp-text-muted">
            <span className="font-semibold erp-text">How credits are calculated:</span> verified quantity × credits per {example.unit}, rounded down to a whole credit. With today's {example.material.toLowerCase()} rate of {fmtQty(example.creditsPerUnit)} per {example.unit}, the exact working is shown on every approved request.
          </p>
        )}
      </Panel>
    </div>
  );
}
