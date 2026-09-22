import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, MapPin, Phone, Plus, Trash2 } from "lucide-react";
import { useToast } from "../../components/ui/Toast";
import { Badge, Breadcrumb, Button, EmptyState, Field, Input, Select, cx } from "../../components/UI";
import { CheckoutSteps, SummaryRow } from "../CartPage";
import { addressApi, orderApi, type Address, type AddressInput, type Quote } from "../../lib/api/commerce";
import { computeTotals, useCart } from "../../lib/cart-store";
import { useCheckout } from "./checkout-context";
import { useAuthSession } from "../../components/auth/AuthContext";
import { INDIAN_STATES } from "../../lib/auth/constants";

const inr = (m: number) => "₹" + Math.round(m / 100).toLocaleString("en-IN");

const EMPTY: AddressInput = {
  kind: "shipping", name: "", phone: "", line1: "", line2: "", city: "", state: "",
  postalCode: "", country: "India", isDefault: false,
};

export default function CheckoutAddress() {
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuthSession();
  const { shippingAddressId, setShippingAddressId, couponCode } = useCheckout();
  const items = useCart();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Prefill the contact fields from the signed-in profile — a saved profile
  // means not retyping your own name and phone at checkout.
  const [form, setForm] = useState<AddressInput>({
    ...EMPTY,
    name: [user?.firstName, user?.lastName].filter(Boolean).join(" "),
    phone: user?.phone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Summary panel: server totals when available, local estimate meanwhile.
  const [quote, setQuote] = useState<Quote | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (items.length === 0) { setQuote(null); return; }
    orderApi.quote(couponCode ?? null).then((q) => { if (!cancelled) setQuote(q); }).catch(() => {});
    return () => { cancelled = true; };
  }, [items, couponCode]);
  const totals = quote ?? computeTotals(items);

  const load = () =>
    addressApi.list().then((list) => {
      setAddresses(list);
      // Auto-select the default SHIPPING address (a billing-only default must
      // not be shipped to), else the first shipping one, else anything.
      if (!shippingAddressId && list.length) {
        const pick =
          list.find((a) => a.kind === "shipping" && a.isDefault) ??
          list.find((a) => a.kind === "shipping") ??
          list[0];
        setShippingAddressId(pick.id);
      }
      if (list.length === 0) setShowForm(true);
    }).catch(() => setAddresses([]));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // The session can resolve AFTER first paint; re-prefill the contact fields
  // once it does (only while the user hasn't typed anything themselves).
  useEffect(() => {
    if (!user) return;
    setForm((f) =>
      f.name || f.phone
        ? f
        : { ...f, name: [user.firstName, user.lastName].filter(Boolean).join(" "), phone: user.phone ?? "" },
    );
  }, [user]);

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
      toast.success("Address saved successfully.");
      setForm({ ...EMPTY, name: [user?.firstName, user?.lastName].filter(Boolean).join(" "), phone: user?.phone ?? "" });
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

  const unitCount = items.reduce((s, it) => s + it.quantity, 0);

  return (
    <main className="section-sm">
      <div className="shell">
        <div>
          <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Cart", to: "/cart" }, { label: "Checkout" }]} />
          <CheckoutSteps current={1} className="mt-4" />

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* Step content */}
            <div className="space-y-4">
              <section className="card p-5 sm:p-6">
                <h1 className="h3 text-dark-900">Delivery address</h1>
                <p className="mt-1 text-sm text-dark-500">Choose where we should ship your order.</p>
                {user && (
                  <p className="mt-2 text-xs text-dark-500">
                    Ordering as <span className="font-semibold text-dark-800">{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}</span>
                    {" · "}{user.email}{user.phone ? ` · +91 ${user.phone}` : ""}
                  </p>
                )}

                {/* Saved addresses */}
                <div className="mt-5 space-y-3">
                  {addresses === null ? (
                    <div className="space-y-3" aria-busy="true" aria-label="Loading addresses">
                      <div className="skeleton h-24" />
                      <div className="skeleton h-24" />
                    </div>
                  ) : addresses.length === 0 && !showForm ? (
                    <EmptyState
                      className="shadow-none"
                      icon={MapPin}
                      title="No saved addresses"
                      message="Add a delivery address to continue."
                      action={<Button variant="green" icon={Plus} onClick={() => setShowForm(true)}>Add address</Button>}
                    />
                  ) : (
                    addresses.map((a) => {
                      const selected = shippingAddressId === a.id;
                      return (
                        <label
                          key={a.id}
                          className={cx(
                            "card-flat flex cursor-pointer items-start gap-3 p-4 transition-colors",
                            selected ? "border-green-500 bg-green-50 ring-2 ring-green-200" : "hover:border-dark-300",
                          )}
                        >
                          <input
                            type="radio"
                            name="addr"
                            checked={selected}
                            onChange={() => setShippingAddressId(a.id)}
                            className="mt-1 h-4 w-4 shrink-0 accent-green-600"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-dark-900">{a.name}</span>
                              {a.label && <Badge tone="neutral">{a.label}</Badge>}
                              {a.isDefault && <Badge tone="green">Default {a.kind}</Badge>}
                            </div>
                            <p className="mt-1 text-sm text-dark-600">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} — {a.postalCode}</p>
                            <p className="mt-1 inline-flex items-center gap-1 text-xs text-dark-500"><Phone className="h-3 w-3" aria-hidden /> {a.phone}</p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); removeAddress(a.id); }}
                            className="btn btn-ghost btn-sm -mr-2 -mt-1 h-9 w-9 shrink-0 px-0 text-dark-400 hover:text-red-600"
                            aria-label={`Delete address for ${a.name}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </label>
                      );
                    })
                  )}
                </div>

                {/* Add-new toggle */}
                {addresses !== null && addresses.length > 0 && !showForm && (
                  <Button variant="secondary" size="sm" icon={Plus} className="mt-4" onClick={() => setShowForm(true)}>
                    Add a new address
                  </Button>
                )}
              </section>

              {/* New-address form */}
              {showForm && (
                <section className="card p-5 sm:p-6">
                  <h2 className="h3 text-dark-900">New address</h2>
                  <p className="mt-1 text-sm text-dark-500">We'll use these details for delivery updates.</p>

                  <form
                    className="mt-5 space-y-6"
                    onSubmit={(e) => { e.preventDefault(); void saveAddress(); }}
                    noValidate
                  >
                    {/* Contact */}
                    <fieldset>
                      <legend className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-dark-500">Contact</legend>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Full name" htmlFor="addr-name" required error={errors.name}>
                          <Input id="addr-name" value={form.name} onChange={set("name")} error={errors.name} autoComplete="name" />
                        </Field>
                        <Field label="Mobile number" htmlFor="addr-phone" required error={errors.phone}>
                          <Input id="addr-phone" value={form.phone} onChange={set("phone")} error={errors.phone} placeholder="10-digit" inputMode="numeric" autoComplete="tel-national" />
                        </Field>
                      </div>
                    </fieldset>

                    {/* Address */}
                    <fieldset>
                      <legend className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-dark-500">Address</legend>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Address line 1" htmlFor="addr-line1" required error={errors.line1} className="sm:col-span-2">
                          <Input id="addr-line1" value={form.line1} onChange={set("line1")} error={errors.line1} autoComplete="address-line1" placeholder="House / flat, building, street" />
                        </Field>
                        <Field label="Address line 2 (optional)" htmlFor="addr-line2" className="sm:col-span-2">
                          <Input id="addr-line2" value={form.line2 ?? ""} onChange={set("line2")} autoComplete="address-line2" placeholder="Area, landmark" />
                        </Field>
                        <Field label="City" htmlFor="addr-city" required error={errors.city}>
                          <Input id="addr-city" value={form.city} onChange={set("city")} error={errors.city} autoComplete="address-level2" />
                        </Field>
                        <Field label="State" htmlFor="addr-state" required error={errors.state}>
                          <Select
                            id="addr-state"
                            value={form.state}
                            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                            aria-invalid={errors.state ? true : undefined}
                            autoComplete="address-level1"
                          >
                            <option value="">Select state…</option>
                            {INDIAN_STATES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Pincode" htmlFor="addr-pin" required error={errors.postalCode}>
                          <Input id="addr-pin" value={form.postalCode} onChange={set("postalCode")} error={errors.postalCode} placeholder="6-digit" inputMode="numeric" autoComplete="postal-code" />
                        </Field>
                      </div>
                    </fieldset>

                    {/* Delivery notes */}
                    <fieldset>
                      <legend className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-dark-500">Delivery notes</legend>
                      <label className="flex items-center gap-2.5 text-sm text-dark-700">
                        <input
                          type="checkbox"
                          checked={!!form.isDefault}
                          onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                          className="h-4 w-4 accent-green-600"
                        />
                        Set as my default shipping address
                      </label>
                    </fieldset>

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      {addresses && addresses.length > 0 && (
                        <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
                      )}
                      <Button type="submit" variant="green" disabled={saving}>
                        {saving ? "Saving…" : "Save address"}
                      </Button>
                    </div>
                  </form>
                </section>
              )}
            </div>

            {/* Summary */}
            <aside className="card h-fit p-5 lg:sticky lg:top-24">
              <h2 className="h3 text-dark-900">Order summary</h2>
              <p className="mt-1 text-xs text-dark-500">{items.length} item{items.length === 1 ? "" : "s"} · {unitCount} unit{unitCount === 1 ? "" : "s"}</p>
              <dl className="mt-4 divide-y divide-dark-100 text-sm">
                <SummaryRow label="Subtotal" value={inr(totals.subtotalMinor)} />
                <SummaryRow label="Shipping" value={totals.shippingMinor > 0 ? inr(totals.shippingMinor) : <span className="font-semibold text-green-600">Free</span>} />
                <SummaryRow label="GST (18%)" value={inr(totals.taxMinor)} />
                <SummaryRow label="Discount" value={totals.discountMinor > 0 ? <span className="text-green-600">− {inr(totals.discountMinor)}</span> : inr(0)} />
                <SummaryRow
                  label={<span className="font-bold text-dark-900">Total</span>}
                  value={<span className="text-lg font-bold text-dark-900">{inr(totals.grandTotalMinor)}</span>}
                  className="pt-3"
                />
              </dl>
              <Button size="lg" className="mt-5 w-full" onClick={() => nav("/checkout/review")} disabled={!shippingAddressId}>
                Continue to Review <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
              {!shippingAddressId && <p className="mt-2 text-center text-xs text-dark-500">Select or add a delivery address to continue.</p>}
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
