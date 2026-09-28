import { useEffect, useState } from "react";
import { Button, Dialog, Select } from "../components/ui";
import { useToast } from "@/components/ui/Toast";
import { adminCrmApi, type CustomerInput } from "@/lib/api/admin-crm";
import { friendlyError } from "./money";

// ============================================================
// Add / edit customer (§3, §4).
//
// Sectioned exactly as the brief specifies — customer, contact, address,
// business — with only name / email / phone required. Everything else is
// genuinely optional, and the form says so rather than rejecting a walk-in
// customer for having no GSTIN.
//
// A customer created here is a `User(role=buyer)` with no usable password
// (see services/crm.mjs). We never invent a password and never imply one was
// emailed: the person sets their own through the normal reset flow if they
// ever need to log in.
// ============================================================

type Mode = { kind: "create" } | { kind: "edit"; customer: EditableCustomer };

export interface EditableCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  gstin: string | null;
  customerType: string | null;
}

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  alternatePhone: "",
  company: "",
  gstin: "",
  customerType: "business",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "India",
};

export function CustomerFormDialog({
  open,
  onClose,
  mode,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  /** Called with the customer id after a successful save. */
  onSaved?: (id: string, created: boolean) => void;
}) {
  const toast = useToast();
  const isEdit = mode.kind === "edit";
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode.kind === "edit") {
      const c = mode.customer;
      setForm({
        ...EMPTY,
        name: c.name ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
        company: c.company ?? "",
        gstin: c.gstin ?? "",
        customerType: c.customerType || "business",
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, mode]);

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  /** Select hands back the value itself, not a change event. */
  const setValue = (k: keyof typeof EMPTY) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const canSubmit =
    form.name.trim() !== "" &&
    form.email.trim() !== "" &&
    form.phone.replace(/\D/g, "").length >= 10 &&
    !saving;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const base: CustomerInput = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        company: form.company.trim() || undefined,
        gstin: form.gstin.trim() || undefined,
        alternatePhone: form.alternatePhone.trim() || undefined,
        customerType: form.customerType as "individual" | "business",
      };

      if (mode.kind === "edit") {
        const res = await adminCrmApi.updateCustomer(mode.customer.id, base);
        toast.success("Customer updated", form.name.trim());
        onSaved?.(res.customer.id, false);
      } else {
        // Only send an address when one was actually entered — an empty
        // address object would create a blank default address row.
        const hasAddress = form.line1.trim() !== "";
        const res = await adminCrmApi.createCustomer({
          ...base,
          address: hasAddress
            ? {
                line1: form.line1.trim(),
                line2: form.line2.trim() || undefined,
                city: form.city.trim() || undefined,
                state: form.state.trim() || undefined,
                postalCode: form.postalCode.trim() || undefined,
                country: form.country.trim() || "India",
              }
            : undefined,
        });
        toast.success("Customer created", form.name.trim());
        onSaved?.(res.customer.id, true);
      }
      onClose();
    } catch (err) {
      setError(friendlyError(err, isEdit ? "Unable to save customer. Please try again." : "Unable to create customer. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border erp-border erp-surface px-3 py-2 text-sm erp-text outline-none focus:border-primary-500";
  const label = "mb-1 block text-xs font-semibold erp-text-muted";

  return (
    <Dialog
      open={open}
      onClose={saving ? () => {} : onClose}
      title={isEdit ? "Edit customer" : "Add customer"}
      description={isEdit ? undefined : "Only name, email and phone are required."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit} loading={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save customer"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Section title="Customer information">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={label} htmlFor="c-name">Customer name *</label>
              <input id="c-name" className={field} value={form.name} onChange={set("name")} autoFocus />
            </div>
            <div>
              <label className={label} htmlFor="c-company">Company name</label>
              <input id="c-company" className={field} value={form.company} onChange={set("company")} />
            </div>
            <div>
              <label className={label} htmlFor="c-type">Customer type</label>
              <Select id="c-type" value={form.customerType} onChange={setValue("customerType")}>
                <option value="business">Business</option>
                <option value="individual">Individual</option>
              </Select>
            </div>
          </div>
        </Section>

        <Section title="Contact information">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={label} htmlFor="c-email">Email *</label>
              <input id="c-email" type="email" className={field} value={form.email} onChange={set("email")} />
            </div>
            <div>
              <label className={label} htmlFor="c-phone">Phone *</label>
              <input id="c-phone" inputMode="tel" className={field} value={form.phone} onChange={set("phone")} placeholder="10-digit number" />
            </div>
            <div>
              <label className={label} htmlFor="c-alt">Alternate phone</label>
              <input id="c-alt" inputMode="tel" className={field} value={form.alternatePhone} onChange={set("alternatePhone")} />
            </div>
          </div>
        </Section>

        {/* Address is create-only: editing an existing customer's address book
            belongs on their profile, where each saved address can be managed
            individually rather than silently overwritten from here. */}
        {!isEdit && (
          <Section title="Billing / address" hint="Optional — saved as the default address">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={label} htmlFor="c-line1">Address</label>
                <input id="c-line1" className={field} value={form.line1} onChange={set("line1")} />
              </div>
              <div className="col-span-2">
                <label className={label} htmlFor="c-line2">Address line 2</label>
                <input id="c-line2" className={field} value={form.line2} onChange={set("line2")} />
              </div>
              <div>
                <label className={label} htmlFor="c-city">City</label>
                <input id="c-city" className={field} value={form.city} onChange={set("city")} />
              </div>
              <div>
                <label className={label} htmlFor="c-state">State</label>
                <input id="c-state" className={field} value={form.state} onChange={set("state")} />
              </div>
              <div>
                <label className={label} htmlFor="c-pin">Pincode</label>
                <input id="c-pin" inputMode="numeric" className={field} value={form.postalCode} onChange={set("postalCode")} />
              </div>
              <div>
                <label className={label} htmlFor="c-country">Country</label>
                <input id="c-country" className={field} value={form.country} onChange={set("country")} />
              </div>
            </div>
          </Section>
        )}

        <Section title="Business information">
          <label className={label} htmlFor="c-gstin">GSTIN</label>
          <input id="c-gstin" className={`${field} uppercase`} value={form.gstin} onChange={set("gstin")} placeholder="27AAPFU0939F1ZV" />
        </Section>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide erp-text-faint">
        {title}
        {hint && <span className="ml-2 font-medium normal-case tracking-normal erp-text-muted">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}
