import { useCallback, useEffect, useState } from "react";
import { onboardingApi, type ListingPage, type SupplierListing } from "../onboarding-api";

// ============================================================
// Supplier → My products.
//
// The page a supplier sees after approval: what they have listed, where each
// listing sits in review, and what an admin asked them to fix.
//
// The honesty rule here is that the supplier is told, before they submit and
// again after every edit, that a listing goes to review and leaves the
// storefront until it is approved. Discovering that silently would feel like
// the product had vanished.
// ============================================================

const STATUS: Record<string, { label: string; cls: string; note?: string }> = {
  active: { label: "Live", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  pending_review: { label: "In review", cls: "bg-amber-50 text-amber-700 ring-amber-200", note: "Waiting for Zolo to approve. Not visible to buyers yet." },
  draft: { label: "Needs changes", cls: "bg-red-50 text-red-700 ring-red-200" },
  archived: { label: "Withdrawn", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};

const inr = (m: number) => "₹" + Math.round((m ?? 0) / 100).toLocaleString("en-IN");
const BLANK = { name: "", sku: "", category: "", basePrice: "", moq: "1", stock: "0", description: "" };

export default function SellerProducts() {
  const [data, setData] = useState<ListingPage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState<SupplierListing | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try { setData(await onboardingApi.products({ limit: 50 })); setState("ready"); }
    catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setForm(BLANK); setEditing(null); setCreating(true); setError(null);
  }
  function openEdit(p: SupplierListing) {
    setForm({
      name: p.name, sku: p.sku, category: p.category,
      basePrice: String(Math.round(p.basePriceMinor / 100)),
      moq: String(p.moq), stock: String(p.stock), description: "",
    });
    setEditing(p); setCreating(false); setError(null);
  }
  function close() { setCreating(false); setEditing(null); setError(null); }

  async function save() {
    setSaving(true); setError(null);
    // Rupees in the form, paise on the wire — the API is minor units
    // throughout, and a float here would drift every total.
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      category: form.category.trim(),
      basePriceMinor: Math.round(Number(form.basePrice || 0) * 100),
      moq: Number(form.moq || 1),
      stock: Number(form.stock || 0),
    };
    if (form.description.trim()) body.description = form.description.trim();
    if (!editing) body.sku = form.sku.trim();
    try {
      if (editing) await onboardingApi.updateProduct(editing.id, body);
      else await onboardingApi.createProduct(body);
      close();
      await load();
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Couldn't save this product. Please try again.");
    } finally { setSaving(false); }
  }

  async function withdraw(p: SupplierListing) {
    if (!window.confirm(`Take "${p.name}" off sale?\n\nBuyers will no longer see it. Past orders are unaffected.`)) return;
    try { await onboardingApi.withdrawProduct(p.id); await load(); }
    catch (e) { setError((e as { message?: string })?.message ?? "Couldn't withdraw this product."); }
  }

  const rows = data?.products ?? [];
  const canSave = form.name.trim() && form.category.trim() && Number(form.basePrice) > 0 && (editing || form.sku.trim());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My products</h1>
          <p className="text-sm text-slate-500">Listings you offer through Zolo. New products and edits are reviewed before they go live.</p>
        </div>
        <button onClick={openCreate} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">
          Add product
        </button>
      </div>

      {error && !creating && !editing && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">{error}</p>
      )}

      {state === "loading" && <p className="text-sm text-slate-400">Loading…</p>}

      {state === "error" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm text-slate-600">Couldn't load your products.</p>
          <button onClick={() => void load()} className="mt-3 text-sm font-semibold text-orange-600 hover:underline">Try again</button>
        </div>
      )}

      {state === "ready" && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-semibold text-slate-700">No products yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Add your first product. Zolo reviews each listing before it appears to buyers.
          </p>
          <button onClick={openCreate} className="mt-4 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700">Add product</button>
        </div>
      )}

      {state === "ready" && rows.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {rows.map((p) => {
            const st = STATUS[p.status] ?? STATUS.draft;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
                  {p.images?.[0]
                    ? <img src={p.images[0]} alt="" className="h-full w-full object-contain" />
                    : <span className="grid h-full w-full place-items-center text-slate-300">📦</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-800">{p.name}</span>
                  <span className="block truncate font-mono text-xs text-slate-400">{p.sku} · {p.category}</span>
                  {p.status === "draft" && p.rejectionNote && (
                    <span className="mt-1 block text-xs font-medium text-red-600">Zolo asked for a change: {p.rejectionNote}</span>
                  )}
                  {p.status === "pending_review" && <span className="mt-1 block text-xs text-amber-700">{st.note}</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums text-slate-800">{inr(p.basePriceMinor)}</span>
                  <span className="block text-xs text-slate-400">MOQ {p.moq}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${st.cls}`}>{st.label}</span>
                <span className="flex shrink-0 gap-3">
                  <button onClick={() => openEdit(p)} className="text-xs font-semibold text-slate-600 hover:underline">Edit</button>
                  {p.status !== "archived" && (
                    <button onClick={() => void withdraw(p)} className="text-xs font-semibold text-red-600 hover:underline">Withdraw</button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {(creating || editing) && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl">
            <h2 className="text-base font-bold text-slate-900">{editing ? "Edit product" : "Add product"}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {editing
                ? "Saving sends this listing back to Zolo for review. It won't be visible to buyers until approved again."
                : "Zolo reviews new listings before they appear to buyers."}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field className="col-span-2" label="Product name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              {!editing && <Field label="SKU *" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} />}
              <Field label="Category *" value={form.category} onChange={(v) => setForm({ ...form, category: v })} placeholder="e.g. Boxes" />
              <Field label="Price (₹) *" value={form.basePrice} onChange={(v) => setForm({ ...form, basePrice: v })} inputMode="decimal" />
              <Field label="Minimum order qty" value={form.moq} onChange={(v) => setForm({ ...form, moq: v })} inputMode="numeric" />
              <Field label="Stock" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} inputMode="numeric" />
              <Field className="col-span-2" label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
            </div>

            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={close} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={() => void save()} disabled={!canSave || saving} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40">
                {saving ? "Saving…" : editing ? "Save and resubmit" : "Submit for review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, className = "", ...rest }: {
  label: string; value: string; onChange: (v: string) => void; className?: string;
  placeholder?: string; inputMode?: "numeric" | "decimal";
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-orange-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </label>
  );
}
