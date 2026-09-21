import { useCallback, useEffect, useState } from "react";
import { Archive, Pencil, Plus, Power, PowerOff, Scale } from "lucide-react";
import { adminRecyclingApi, fmtQty, RECYCLING_UNITS, type RecyclingRule, type RecyclingUnit } from "@/lib/api/recycling";
import { describeApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/utils/cn";
import { Badge, Button, Dialog } from "../../components/ui";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, ErrorState } from "../../components/Panel";
import { errorsFrom, Field, FIELD, FIELD_ERR, RowActions, SwitchRow, type FormErrors } from "../marketing/shared";

// Recycling Rules — THE answer to "how many points do I give?". One rule per
// material + unit: credits per unit, and the quantity range it accepts. A
// material is recyclable only while it has an ACTIVE rule. Nothing is seeded:
// every number on this page was typed by an admin.

// Name suggestions only — no values are attached to them.
const MATERIAL_SUGGESTIONS = ["Cardboard", "Paper", "Plastic", "Glass", "Metal", "Other"];
const UNIT_NAME: Record<RecyclingUnit, string> = { kg: "KG", g: "Gram", piece: "Piece", litre: "Litre" };
const num = (v: string) => /^\d+(\.\d{1,3})?$/.test(v.trim());

function RuleDialog({ open, rule, onClose, onSaved }: { open: boolean; rule: RecyclingRule | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [material, setMaterial] = useState("");
  const [unit, setUnit] = useState<RecyclingUnit>("kg");
  const [credits, setCredits] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMaterial(rule?.material ?? ""); setUnit(rule?.unit ?? "kg");
    setCredits(rule ? String(rule.creditsPerUnit) : "");
    setMin(rule?.minQuantity != null ? String(rule.minQuantity) : "");
    setMax(rule?.maxQuantity != null ? String(rule.maxQuantity) : "");
    setActive(rule?.isActive ?? true); setErrors({}); setSaving(false);
  }, [open, rule]);

  const save = async () => {
    const e: FormErrors = {};
    if (material.trim().length < 2) e.material = "Enter the material.";
    if (!/^\d+(\.\d{1,2})?$/.test(credits.trim()) || Number(credits) <= 0) e.creditsPerUnit = "Enter credits greater than 0 (up to 2 decimals).";
    if (min.trim() && !num(min)) e.minQuantity = "Enter a number (up to 3 decimals).";
    if (max.trim() && !num(max)) e.maxQuantity = "Enter a number (up to 3 decimals).";
    if (!e.minQuantity && !e.maxQuantity && min.trim() && max.trim() && Number(max) < Number(min)) e.maxQuantity = "Maximum cannot be below the minimum.";
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = { material: material.trim(), unit, creditsPerUnit: Number(credits), minQuantity: min.trim() ? Number(min) : null, maxQuantity: max.trim() ? Number(max) : null, isActive: active };
    setSaving(true);
    try {
      const saved = rule ? await adminRecyclingApi.updateRule(rule.id, body) : await adminRecyclingApi.createRule(body);
      toast.success(rule ? "Rule updated" : "Rule added", `${saved.material}: ${fmtQty(saved.creditsPerUnit)} Eco Credits per ${saved.unit}.`);
      onSaved();
    } catch (err) { setErrors(errorsFrom(err, "Could not save the rule.")); }
    finally { setSaving(false); }
  };

  return (
    <Dialog
      open={open} onClose={onClose}
      title={rule ? "Edit Recycling Rule" : "Add Recycling Rule"}
      description={rule ? "Changes apply to requests approved from now on. Already-approved requests keep the rate they were approved with." : "Tells the system how many Eco Credits one unit of a material earns."}
      footer={<><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save Rule</Button></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        {errors.form && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{errors.form}</p>}
        <Field label="Material" required error={errors.material}>
          <input value={material} onChange={(e) => setMaterial(e.target.value)} list="recycling-materials" placeholder="Cardboard" maxLength={60} className={cn(FIELD, errors.material && FIELD_ERR)} />
          <datalist id="recycling-materials">{MATERIAL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unit" required error={errors.unit}>
            <select value={unit} onChange={(e) => setUnit(e.target.value as RecyclingUnit)} className={FIELD}>
              {RECYCLING_UNITS.map((u) => <option key={u} value={u}>{UNIT_NAME[u]}</option>)}
            </select>
          </Field>
          <Field label={`Credits per ${UNIT_NAME[unit]}`} required error={errors.creditsPerUnit}>
            <input value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="decimal" placeholder="10" className={cn(FIELD, errors.creditsPerUnit && FIELD_ERR)} />
          </Field>
          <Field label={`Minimum quantity (${unit})`} hint="Optional." error={errors.minQuantity}>
            <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" placeholder="1" className={cn(FIELD, errors.minQuantity && FIELD_ERR)} />
          </Field>
          <Field label={`Maximum quantity (${unit})`} hint="Optional, per request." error={errors.maxQuantity}>
            <input value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" placeholder="100" className={cn(FIELD, errors.maxQuantity && FIELD_ERR)} />
          </Field>
        </div>
        <SwitchRow title="Active" hint="Inactive rules cannot be used to approve requests, and the material is not offered to customers." checked={active} onChange={setActive} />
      </form>
    </Dialog>
  );
}

export default function RecyclingRulesSection() {
  const toast = useToast();
  const [rules, setRules] = useState<RecyclingRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RecyclingRule | null>(null);
  const [dialog, setDialog] = useState(false);
  const [archiving, setArchiving] = useState<RecyclingRule | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setError(null); setRules((await adminRecyclingApi.rules()).rules); }
    catch (e) { setError(describeApiError(e).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (r: RecyclingRule) => {
    try {
      await adminRecyclingApi.setRuleActive(r.id, !r.isActive);
      toast.success(r.isActive ? "Rule deactivated" : "Rule activated", r.isActive ? `${r.material} can no longer be submitted or approved.` : `${r.material} is accepted again.`);
      await load();
    } catch (e) { toast.error("Couldn't update the rule", describeApiError(e).message); }
  };
  const archive = async () => {
    if (!archiving) return;
    setBusy(true);
    try { await adminRecyclingApi.archiveRule(archiving.id); toast.success("Rule archived", "Past approvals keep their recorded rate."); setArchiving(null); await load(); }
    catch (e) { toast.error("Couldn't archive the rule", describeApiError(e).message); }
    finally { setBusy(false); }
  };

  const columns: Column<RecyclingRule>[] = [
    { key: "material", header: "Material", render: (r) => <span className="font-semibold erp-text">{r.material}</span> },
    { key: "unit", header: "Unit", render: (r) => <span className="erp-text-muted">{r.unit}</span> },
    { key: "credits", header: "Credits per unit", render: (r) => <Badge tone="primary">{fmtQty(r.creditsPerUnit)} credits/{r.unit}</Badge> },
    { key: "min", header: "Minimum", hideBelow: "sm", render: (r) => <span className="erp-text-muted">{r.minQuantity != null ? `${fmtQty(r.minQuantity)} ${r.unit}` : "—"}</span> },
    { key: "max", header: "Maximum", hideBelow: "sm", render: (r) => <span className="erp-text-muted">{r.maxQuantity != null ? `${fmtQty(r.maxQuantity)} ${r.unit}` : "—"}</span> },
    { key: "used", header: "Requests", hideBelow: "md", render: (r) => <span className="erp-text-muted">{r.timesUsed ?? 0}</span> },
    { key: "status", header: "Status", render: (r) => <Badge tone={r.isActive ? "success" : "neutral"} dot>{r.isActive ? "Active" : "Inactive"}</Badge> },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, className: "w-12", render: (r) => (
        <RowActions label={`Actions for ${r.material}`} actions={[
          { label: "Edit", icon: Pencil, onClick: () => { setEditing(r); setDialog(true); } },
          { label: r.isActive ? "Deactivate" : "Activate", icon: r.isActive ? PowerOff : Power, onClick: () => void toggle(r) },
          { label: "Archive", icon: Archive, danger: true, onClick: () => setArchiving(r) },
        ]} />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="erp-card card-shadow">
        <div className="flex flex-col gap-3 border-b erp-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm erp-text-muted">
            Eco Credits = <span className="font-semibold erp-text">verified quantity × credits per unit</span>, rounded down. Customers can only recycle materials that have an active rule.
          </p>
          <Button variant="primary" icon={Plus} onClick={() => { setEditing(null); setDialog(true); }}>Add Recycling Rule</Button>
        </div>
        <div className="p-4">
          {rules === null && !error && <TableSkeleton rows={4} cols={6} />}
          {error && <ErrorState message={error} onRetry={() => void load()} />}
          {rules !== null && !error && rules.length === 0 && (
            <EmptyState icon={Scale} title="No recycling rules yet" message="Add a rule for each material you accept — for example a material, its unit and the Eco Credits one unit earns. Until then, customers cannot submit recycling requests." />
          )}
          {rules !== null && !error && rules.length > 0 && <DataTable caption="Recycling rules" columns={columns} rows={rules} rowKey={(r) => r.id} />}
        </div>
      </div>

      <RuleDialog open={dialog} rule={editing} onClose={() => setDialog(false)} onSaved={() => { setDialog(false); void load(); }} />
      <Dialog
        open={!!archiving} onClose={() => setArchiving(null)}
        title={`Archive the ${archiving?.material ?? ""} rule?`}
        description="It disappears from this list and can no longer be used. Requests already approved with it keep their recorded rate and credits."
        footer={<><Button onClick={() => setArchiving(null)} disabled={busy}>Cancel</Button><Button variant="danger" icon={Archive} loading={busy} onClick={archive}>Archive</Button></>}
      />
    </div>
  );
}
