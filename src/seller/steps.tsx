// Onboarding wizard step components. Each receives the onboarding hook state and
// renders one logical section. Profile fields autosave via updateField; child
// collections use the mutate() wrapper. Kept intentionally grouped (not one
// giant form) with sensible defaults.
import { useState } from "react";
import { onboardingApi, type OnboardingProfile } from "./onboarding-api";
import { Field, Input, Textarea, Select, Button, EmptyState, StatusPill, Alert } from "./ui";
import { fileToBase64 } from "./file";

type StepProps = {
  profile: OnboardingProfile;
  updateField: (patch: Record<string, unknown>) => void;
  mutate: <T>(fn: () => Promise<T>) => Promise<void>;
  readOnly: boolean;
};

const BUSINESS_TYPES = ["MANUFACTURER", "CONVERTER", "TRADER", "DISTRIBUTOR", "PRINTING", "PACKAGING_SPECIALIST", "OTHER"];

export function BusinessStep({ profile, updateField, readOnly }: StepProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Legal business name" required>
        <Input defaultValue={profile.legalName ?? ""} disabled={readOnly} onChange={(e) => updateField({ legalName: e.target.value })} />
      </Field>
      <Field label="Brand / display name" required>
        <Input defaultValue={profile.displayName ?? ""} disabled={readOnly} onChange={(e) => updateField({ displayName: e.target.value })} />
      </Field>
      <Field label="Business type" required>
        <Select defaultValue={profile.businessType ?? ""} disabled={readOnly} onChange={(e) => updateField({ businessType: e.target.value || null })}>
          <option value="">Select…</option>
          {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </Select>
      </Field>
      <Field label="Year established">
        <Input type="number" defaultValue={profile.yearEstablished ?? ""} disabled={readOnly} onChange={(e) => updateField({ yearEstablished: e.target.value ? Number(e.target.value) : null })} />
      </Field>
      <Field label="Registration number">
        <Input defaultValue={profile.registrationNumber ?? ""} disabled={readOnly} onChange={(e) => updateField({ registrationNumber: e.target.value })} />
      </Field>
      <Field label="Website">
        <Input defaultValue={profile.website ?? ""} disabled={readOnly} placeholder="https://…" onChange={(e) => updateField({ website: e.target.value })} />
      </Field>
      <Field label="Primary contact" required>
        <Input defaultValue={profile.contactName ?? ""} disabled={readOnly} onChange={(e) => updateField({ contactName: e.target.value })} />
      </Field>
      <Field label="Contact email" required>
        <Input type="email" defaultValue={profile.contactEmail ?? ""} disabled={readOnly} onChange={(e) => updateField({ contactEmail: e.target.value })} />
      </Field>
      <Field label="Contact phone" required>
        <Input defaultValue={profile.contactPhone ?? ""} disabled={readOnly} onChange={(e) => updateField({ contactPhone: e.target.value })} />
      </Field>
      <Field label="Employee count">
        <Input type="number" defaultValue={profile.employeeCount ?? ""} disabled={readOnly} onChange={(e) => updateField({ employeeCount: e.target.value ? Number(e.target.value) : null })} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description">
          <Textarea rows={3} defaultValue={profile.description ?? ""} disabled={readOnly} onChange={(e) => updateField({ description: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

export function LegalStep({ profile, updateField, readOnly }: StepProps) {
  return (
    <div className="space-y-4">
      <Alert tone="info">Tax IDs are format-validated and checked for duplicates, but are <b>not</b> government-verified. An admin reviews your documents manually.</Alert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="GSTIN" required hint="15-char GST number">
          <Input defaultValue={profile.gstNumber ?? ""} disabled={readOnly} className="uppercase" onChange={(e) => updateField({ gstNumber: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="PAN" required>
          <Input defaultValue={profile.panNumber ?? ""} disabled={readOnly} className="uppercase" onChange={(e) => updateField({ panNumber: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="CIN" hint="If a registered company">
          <Input defaultValue={profile.cinNumber ?? ""} disabled={readOnly} className="uppercase" onChange={(e) => updateField({ cinNumber: e.target.value.toUpperCase() })} />
        </Field>
      </div>
    </div>
  );
}

// ---- Generic collection editor ----
function CollectionEditor<T extends { id: string }>({
  items, readOnly, onRemove, renderItem, form, emptyText,
}: {
  items: T[]; readOnly: boolean; onRemove: (id: string) => Promise<void>;
  renderItem: (item: T) => React.ReactNode; form: React.ReactNode; emptyText: string;
}) {
  return (
    <div className="space-y-4">
      {items.length === 0 ? <EmptyState title={emptyText} /> : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm text-slate-700">{renderItem(it)}</div>
              {!readOnly && <Button size="sm" variant="ghost" onClick={() => onRemove(it.id)}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && form}
    </div>
  );
}

export function LocationsStep({ profile, mutate, readOnly }: StepProps) {
  const [f, setF] = useState({ locationType: "FACTORY", addressLine1: "", city: "", state: "", postalCode: "" });
  const add = () => mutate(() => onboardingApi.addLocation(f)).then(() => setF({ locationType: "FACTORY", addressLine1: "", city: "", state: "", postalCode: "" }));
  const valid = f.addressLine1 && f.city && f.state && f.postalCode;
  return (
    <CollectionEditor
      items={profile.locations} readOnly={readOnly}
      onRemove={(id) => mutate(() => onboardingApi.removeLocation(id))}
      emptyText="No locations yet — add at least one (a factory or head office)."
      renderItem={(l: any) => <><b>{l.locationType.replace(/_/g, " ")}</b> — {l.addressLine1}, {l.city}, {l.state} {l.postalCode}</>}
      form={
        <div className="grid gap-3 rounded-lg border border-dashed border-slate-300 p-4 sm:grid-cols-2">
          <Field label="Type"><Select value={f.locationType} onChange={(e) => setF({ ...f, locationType: e.target.value })}>
            {["HEAD_OFFICE", "FACTORY", "WAREHOUSE", "DISPATCH", "BILLING"].map((t) => <option key={t}>{t}</option>)}
          </Select></Field>
          <Field label="Address line 1"><Input value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} /></Field>
          <Field label="City"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="State"><Input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} /></Field>
          <Field label="Postal code"><Input value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value })} /></Field>
          <div className="flex items-end"><Button onClick={add} disabled={!valid}>Add location</Button></div>
        </div>
      }
    />
  );
}

export function CapabilitiesStep({ profile, mutate, readOnly }: StepProps) {
  const [f, setF] = useState({ category: "", subCategory: "", minimumOrderQuantity: "", leadTimeDays: "" });
  const add = () => mutate(() => onboardingApi.addCapability({
    category: f.category, subCategory: f.subCategory || undefined,
    minimumOrderQuantity: f.minimumOrderQuantity ? Number(f.minimumOrderQuantity) : undefined,
    leadTimeDays: f.leadTimeDays ? Number(f.leadTimeDays) : undefined,
  })).then(() => setF({ category: "", subCategory: "", minimumOrderQuantity: "", leadTimeDays: "" }));
  return (
    <CollectionEditor
      items={profile.capabilities} readOnly={readOnly}
      onRemove={(id) => mutate(() => onboardingApi.removeCapability(id))}
      emptyText="No capabilities yet — add the packaging categories you produce."
      renderItem={(c: any) => <><b>{c.category}</b>{c.subCategory ? ` / ${c.subCategory}` : ""} {c.minimumOrderQuantity ? `· MOQ ${c.minimumOrderQuantity}` : ""} {c.leadTimeDays ? `· ${c.leadTimeDays}d` : ""}</>}
      form={
        <div className="grid gap-3 rounded-lg border border-dashed border-slate-300 p-4 sm:grid-cols-2">
          <Field label="Category" hint="e.g. Gift Boxes, Corrugated"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label="Sub-category"><Input value={f.subCategory} onChange={(e) => setF({ ...f, subCategory: e.target.value })} /></Field>
          <Field label="Min order qty"><Input type="number" value={f.minimumOrderQuantity} onChange={(e) => setF({ ...f, minimumOrderQuantity: e.target.value })} /></Field>
          <Field label="Lead time (days)"><Input type="number" value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: e.target.value })} /></Field>
          <div className="flex items-end"><Button onClick={add} disabled={!f.category}>Add capability</Button></div>
        </div>
      }
    />
  );
}

export function CapacityStep({ profile, mutate, readOnly }: StepProps) {
  const c = profile.capacity ?? {};
  const [f, setF] = useState({
    monthlyCapacity: c.monthlyCapacity ?? "", standardLeadTimeDays: c.standardLeadTimeDays ?? "",
    minimumOrderQuantity: c.minimumOrderQuantity ?? "", productionShifts: c.productionShifts ?? "",
  });
  const save = () => mutate(() => onboardingApi.saveCapacity({
    monthlyCapacity: f.monthlyCapacity ? Number(f.monthlyCapacity) : null,
    standardLeadTimeDays: f.standardLeadTimeDays ? Number(f.standardLeadTimeDays) : null,
    minimumOrderQuantity: f.minimumOrderQuantity ? Number(f.minimumOrderQuantity) : null,
    productionShifts: f.productionShifts ? Number(f.productionShifts) : null,
  }));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Monthly capacity (units)"><Input type="number" value={f.monthlyCapacity} disabled={readOnly} onChange={(e) => setF({ ...f, monthlyCapacity: e.target.value })} /></Field>
        <Field label="Standard lead time (days)"><Input type="number" value={f.standardLeadTimeDays} disabled={readOnly} onChange={(e) => setF({ ...f, standardLeadTimeDays: e.target.value })} /></Field>
        <Field label="Minimum order quantity"><Input type="number" value={f.minimumOrderQuantity} disabled={readOnly} onChange={(e) => setF({ ...f, minimumOrderQuantity: e.target.value })} /></Field>
        <Field label="Production shifts / day"><Input type="number" value={f.productionShifts} disabled={readOnly} onChange={(e) => setF({ ...f, productionShifts: e.target.value })} /></Field>
      </div>
      {!readOnly && <Button onClick={save}>Save capacity</Button>}
    </div>
  );
}

export function CertificationsStep({ profile, mutate, readOnly }: StepProps) {
  const [f, setF] = useState({ name: "", certificateNumber: "", issuer: "", expiryDate: "" });
  const add = () => mutate(() => onboardingApi.addCertification({
    name: f.name, certificateNumber: f.certificateNumber || undefined, issuer: f.issuer || undefined,
    expiryDate: f.expiryDate ? new Date(f.expiryDate).toISOString() : undefined,
  })).then(() => setF({ name: "", certificateNumber: "", issuer: "", expiryDate: "" }));
  return (
    <CollectionEditor
      items={profile.certifications} readOnly={readOnly}
      onRemove={(id) => mutate(() => onboardingApi.removeCertification(id))}
      emptyText="No certifications added (optional — ISO, FSC, BRC, BIS…)."
      renderItem={(c: any) => <><b>{c.name}</b> {c.issuer ? `· ${c.issuer}` : ""} {c.expiryDate ? `· expires ${new Date(c.expiryDate).toLocaleDateString()}` : ""}</>}
      form={
        <div className="grid gap-3 rounded-lg border border-dashed border-slate-300 p-4 sm:grid-cols-2">
          <Field label="Name" hint="e.g. ISO 9001"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Certificate number"><Input value={f.certificateNumber} onChange={(e) => setF({ ...f, certificateNumber: e.target.value })} /></Field>
          <Field label="Issuer"><Input value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></Field>
          <Field label="Expiry date"><Input type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /></Field>
          <div className="flex items-end"><Button onClick={add} disabled={!f.name}>Add certification</Button></div>
        </div>
      }
    />
  );
}

const DOC_TYPES = ["GST_CERTIFICATE", "PAN", "COMPANY_REGISTRATION", "FACTORY_LICENSE", "ADDRESS_PROOF", "BANK_PROOF", "CANCELLED_CHEQUE", "CERTIFICATION", "QUALITY_CERTIFICATE", "FACTORY_PHOTO", "MACHINERY_DOCUMENT", "OTHER"];

export function DocumentsStep({ profile, mutate, readOnly }: StepProps) {
  const [type, setType] = useState("GST_CERTIFICATE");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    if (file.size > 10 * 1024 * 1024) { setErr("File is larger than 10 MB"); return; }
    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      await mutate(() => onboardingApi.uploadDocument({ type, fileName: file.name, mime: file.type, dataBase64 }));
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <Alert tone="info">Accepted: PDF, JPG, PNG, WebP · up to 10 MB. Upload at least one document.</Alert>
      {err && <Alert tone="error">{err}</Alert>}
      {profile.documents.length === 0 ? <EmptyState title="No documents uploaded yet." /> : (
        <ul className="space-y-2">
          {profile.documents.map((d: any) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <span className="text-slate-700"><b>{d.type.replace(/_/g, " ")}</b> · {d.fileName} <span className="text-slate-400">({Math.round(d.size / 1024)} KB)</span></span>
              <span className="flex items-center gap-3">
                <StatusPill status={d.verificationStatus} />
                {!readOnly && <Button size="sm" variant="ghost" onClick={() => mutate(() => onboardingApi.removeDocument(d.id))}>Remove</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-slate-300 p-4">
          <Field label="Document type"><Select value={type} onChange={(e) => setType(e.target.value)}>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </Select></Field>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700">
            {uploading ? "Uploading…" : "Choose file"}
            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={onFile} disabled={uploading} />
          </label>
        </div>
      )}
    </div>
  );
}

export function BankStep({ profile, mutate, readOnly }: StepProps) {
  const [f, setF] = useState({ accountHolderName: "", bankName: "", accountNumber: "", ifsc: "", branch: "" });
  const add = () => mutate(() => onboardingApi.addBankAccount({ ...f, ifsc: f.ifsc.toUpperCase() }))
    .then(() => setF({ accountHolderName: "", bankName: "", accountNumber: "", ifsc: "", branch: "" }));
  const valid = f.accountHolderName && f.bankName && f.accountNumber.length >= 6 && f.ifsc.length === 11;
  return (
    <div className="space-y-4">
      <Alert tone="warn">Your account number is encrypted and never shown again — only the last 4 digits are displayed.</Alert>
      {profile.bankAccounts.length === 0 ? <EmptyState title="No bank account added yet." /> : (
        <ul className="space-y-2">
          {profile.bankAccounts.map((b: any) => (
            <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <span className="text-slate-700"><b>{b.bankName}</b> · {b.accountHolderName} · ••••{b.accountLast4} · {b.ifsc}</span>
              {!readOnly && <Button size="sm" variant="ghost" onClick={() => mutate(() => onboardingApi.removeBankAccount(b.id))}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="grid gap-3 rounded-lg border border-dashed border-slate-300 p-4 sm:grid-cols-2">
          <Field label="Account holder"><Input value={f.accountHolderName} onChange={(e) => setF({ ...f, accountHolderName: e.target.value })} /></Field>
          <Field label="Bank name"><Input value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
          <Field label="Account number"><Input value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label="IFSC" hint="e.g. HDFC0001234"><Input value={f.ifsc} className="uppercase" onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>
          <div className="flex items-end sm:col-span-2"><Button onClick={add} disabled={!valid}>Add bank account</Button></div>
        </div>
      )}
    </div>
  );
}

export function QualityStep({ profile, mutate, readOnly }: StepProps) {
  const q = profile.quality ?? {};
  const [f, setF] = useState({ qualityProcess: q.qualityProcess ?? "", inspectionProcess: q.inspectionProcess ?? "", defectHandling: q.defectHandling ?? "" });
  return (
    <div className="space-y-4">
      <Field label="Quality process"><Textarea rows={2} value={f.qualityProcess} disabled={readOnly} onChange={(e) => setF({ ...f, qualityProcess: e.target.value })} /></Field>
      <Field label="Inspection process"><Textarea rows={2} value={f.inspectionProcess} disabled={readOnly} onChange={(e) => setF({ ...f, inspectionProcess: e.target.value })} /></Field>
      <Field label="Defect handling"><Textarea rows={2} value={f.defectHandling} disabled={readOnly} onChange={(e) => setF({ ...f, defectHandling: e.target.value })} /></Field>
      {!readOnly && <Button onClick={() => mutate(() => onboardingApi.saveQuality(f))}>Save quality</Button>}
    </div>
  );
}

export function LogisticsStep({ profile, mutate, readOnly }: StepProps) {
  const l = profile.logistics ?? {};
  const [regions, setRegions] = useState((l.serviceableRegions ?? []).join(", "));
  const [avgDispatchDays, setAvg] = useState(l.avgDispatchDays ?? "");
  const [pickupAvailable, setPickup] = useState(Boolean(l.pickupAvailable));
  return (
    <div className="space-y-4">
      <Field label="Serviceable regions" hint="Comma-separated (e.g. Karnataka, Maharashtra)">
        <Input value={regions} disabled={readOnly} onChange={(e) => setRegions(e.target.value)} />
      </Field>
      <Field label="Average dispatch time (days)"><Input type="number" value={avgDispatchDays} disabled={readOnly} onChange={(e) => setAvg(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={pickupAvailable} disabled={readOnly} onChange={(e) => setPickup(e.target.checked)} /> Pickup available
      </label>
      {!readOnly && <Button onClick={() => mutate(() => onboardingApi.saveLogistics({
        serviceableRegions: regions.split(",").map((s: string) => s.trim()).filter(Boolean),
        avgDispatchDays: avgDispatchDays ? Number(avgDispatchDays) : null, pickupAvailable,
      }))}>Save logistics</Button>}
    </div>
  );
}
