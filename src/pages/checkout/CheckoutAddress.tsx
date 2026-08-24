import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, MapPin, Plus, Trash2 } from "lucide-react";
import { useToast } from "../../components/ui/Toast";
import { CheckoutSteps } from "../CartPage";
import { addressApi, type Address, type AddressInput } from "../../lib/api/commerce";
import { useCheckout } from "./checkout-context";

const EMPTY: AddressInput = {
  kind: "shipping", name: "", phone: "", line1: "", line2: "", city: "", state: "",
  postalCode: "", country: "India", isDefault: false,
};

export default function CheckoutAddress() {
  const nav = useNavigate();
  const toast = useToast();
  const { shippingAddressId, setShippingAddressId } = useCheckout();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddressInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = () =>
    addressApi.list().then((list) => {
      setAddresses(list);
      // Auto-select default (or first) when nothing chosen yet.
      if (!shippingAddressId && list.length) setShippingAddressId((list.find((a) => a.isDefault) ?? list[0]).id);
      if (list.length === 0) setShowForm(true);
    }).catch(() => setAddresses([]));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const set = (k: keyof AddressInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Enter the full name";
    if (!/^[6-9]\d{9}$/.test(form.phone.replace(/\D/g, "").slice(-10))) e.phone = "Enter a valid 10-digit mobile";
    if (form.line1.trim().length < 3) e.line1 = "Enter the address";
    if (!form.city.trim()) e.city = "Enter the city";
    if (!form.state.trim()) e.state = "Enter the state";
    if (!/^[1-9][0-9]{5}$/.test(form.postalCode)) e.postalCode = "Enter a valid 6-digit pincode";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const saveAddress = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const created = await addressApi.create({ ...form, phone: form.phone.replace(/\D/g, "").slice(-10) });
      toast.success("Address saved", "");
      setForm(EMPTY);
      setShowForm(false);
      setShippingAddressId(created.id);
      await load();
    } catch (err) {
      toast.error("Couldn't save address", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const removeAddress = async (id: string) => {
    try {
      await addressApi.remove(id);
      if (shippingAddressId === id) setShippingAddressId(null);
      await load();
    } catch (err) {
      toast.error("Couldn't delete", err instanceof Error ? err.message : "Please try again.");
    }
  };

  return (
    <main className="py-10">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <CheckoutSteps current={1} />
        <h1 className="font-display text-2xl font-extrabold text-dark-900">Delivery address</h1>
        <p className="mt-0.5 text-sm text-dark-500">Choose where we should ship your order.</p>

        {/* Saved addresses */}
        <div className="mt-6 space-y-3">
          {addresses === null ? (
            <div className="text-sm text-dark-400">Loading addresses…</div>
          ) : addresses.length === 0 && !showForm ? (
            <div className="rounded-2xl border border-dashed border-dark-200 p-8 text-center">
              <MapPin className="mx-auto h-8 w-8 text-dark-300" />
              <p className="mt-2 font-semibold text-dark-900">No saved addresses</p>
              <button onClick={() => setShowForm(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-600">
                <Plus className="h-4 w-4" /> Add address
              </button>
            </div>
          ) : (
            addresses.map((a) => (
              <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4 ${shippingAddressId === a.id ? "border-primary-500 ring-1 ring-primary-200" : "border-dark-100"}`}>
                <input type="radio" name="addr" checked={shippingAddressId === a.id} onChange={() => setShippingAddressId(a.id)} className="mt-1 accent-primary-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-dark-900">{a.name}</span>
                    {a.isDefault && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700">Default</span>}
                  </div>
                  <p className="text-sm text-dark-600">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} — {a.postalCode}</p>
                  <p className="text-xs text-dark-400">☎ {a.phone}</p>
                </div>
                <button onClick={(e) => { e.preventDefault(); removeAddress(a.id); }} className="text-dark-300 hover:text-red-500" aria-label="Delete address">
                  <Trash2 className="h-4 w-4" />
                </button>
              </label>
            ))
          )}
        </div>

        {/* Add-new toggle */}
        {addresses !== null && addresses.length > 0 && !showForm && (
          <button onClick={() => setShowForm(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-primary-600 hover:underline">
            <Plus className="h-4 w-4" /> Add a new address
          </button>
        )}

        {/* New-address form */}
        {showForm && (
          <div className="mt-5 rounded-2xl border border-dark-100 bg-white p-5">
            <h2 className="font-bold text-dark-900">New address</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Full name" error={errors.name}><input value={form.name} onChange={set("name")} className="inp" /></Field>
              <Field label="Mobile number" error={errors.phone}><input value={form.phone} onChange={set("phone")} className="inp" placeholder="10-digit" /></Field>
              <Field label="Address line 1" error={errors.line1} full><input value={form.line1} onChange={set("line1")} className="inp" /></Field>
              <Field label="Address line 2 (optional)" full><input value={form.line2 ?? ""} onChange={set("line2")} className="inp" /></Field>
              <Field label="City" error={errors.city}><input value={form.city} onChange={set("city")} className="inp" /></Field>
              <Field label="State" error={errors.state}><input value={form.state} onChange={set("state")} className="inp" /></Field>
              <Field label="Pincode" error={errors.postalCode}><input value={form.postalCode} onChange={set("postalCode")} className="inp" placeholder="6-digit" /></Field>
              <label className="col-span-full mt-1 flex items-center gap-2 text-sm text-dark-600">
                <input type="checkbox" checked={!!form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} className="accent-primary-600" />
                Set as default address
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {addresses && addresses.length > 0 && <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-dark-600 hover:bg-dark-50">Cancel</button>}
              <button onClick={saveAddress} disabled={saving} className="rounded-lg bg-primary-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-60">
                {saving ? "Saving…" : "Save address"}
              </button>
            </div>
          </div>
        )}

        {/* Continue */}
        <div className="mt-8 flex justify-end">
          <button
            onClick={() => nav("/checkout/review")}
            disabled={!shippingAddressId}
            className="inline-flex items-center gap-2 rounded-xl bg-dark-900 px-6 py-3 text-sm font-bold text-white hover:bg-dark-800 disabled:opacity-50"
          >
            Continue to Review <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <style>{`.inp{width:100%;border:1px solid var(--tw-dark-200,#e5e7eb);border-radius:.5rem;padding:.6rem .75rem;font-size:.875rem;outline:none}.inp:focus{border-color:#f97316}`}</style>
    </main>
  );
}

function Field({ label, error, full, children }: { label: string; error?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "col-span-full" : ""}`}>
      <span className="mb-1 block text-xs font-semibold text-dark-600">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
