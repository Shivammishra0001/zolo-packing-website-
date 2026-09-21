import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Save } from "lucide-react";
import { adminEcoCreditsApi, type EcoRewardSettings } from "@/lib/api/recycling";
import { describeApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/utils/cn";
import { Badge, Button } from "../../components/ui";
import { ErrorState, ListSkeleton, Panel } from "../../components/Panel";
import { inrMinor } from "../../format";
import { hydrateCatalog, useCatalog } from "../../catalog-store";
import { hydrateCategories, useCategories } from "../../categories-store";
import { EntityPicker, errorsFrom, Field, FIELD, FIELD_ERR, Section, SwitchRow, type FormErrors, type PickOption } from "../marketing/shared";

// Eco Reward Settings — how Eco Credits become a coupon in the EXISTING coupon
// system. Stored in the database (one settings row); nothing here has a built-in
// value, and redemption stays off until it is switched on and filled in.

const rupees = (minor: number | null) => (minor == null ? "" : String(minor / 100));
const isInt = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1;
const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

export default function EcoRewardSettingsSection() {
  const toast = useToast();
  const products = useCatalog();
  const categories = useCategories();
  const [loaded, setLoaded] = useState<EcoRewardSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [v, setV] = useState({
    enabled: false, minCredits: "", creditsRequired: "", couponValue: "", validityDays: "", minOrder: "", usageLimit: "1", maxUnits: "1",
    allowCombine: false, appliesTo: "all" as EcoRewardSettings["appliesTo"], productIds: [] as string[], categoryIds: [] as string[], expiryEnabled: false, expiryDays: "",
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  const adopt = (s: EcoRewardSettings) => {
    setLoaded(s);
    setV({
      enabled: s.enabled, minCredits: s.minCreditsToRedeem != null ? String(s.minCreditsToRedeem) : "", creditsRequired: s.creditsRequired != null ? String(s.creditsRequired) : "",
      couponValue: rupees(s.couponValueMinor), validityDays: s.couponValidityDays != null ? String(s.couponValidityDays) : "", minOrder: rupees(s.couponMinOrderMinor),
      usageLimit: String(s.couponUsageLimit), maxUnits: String(s.maxUnitsPerRedemption), allowCombine: s.allowCombine, appliesTo: s.appliesTo,
      productIds: s.productIds, categoryIds: s.categoryIds, expiryEnabled: s.creditExpiryEnabled, expiryDays: s.creditExpiryDays != null ? String(s.creditExpiryDays) : "",
    });
  };
  const load = useCallback(async () => {
    try { setError(null); adopt(await adminEcoCreditsApi.settings()); void hydrateCatalog(); void hydrateCategories(); }
    catch (e) { setError(describeApiError(e).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const productOptions: PickOption[] = useMemo(() => products.filter((p) => p.status !== "archived").map((p) => ({ id: p.id, label: p.name, sub: p.sku })), [products]);
  const categoryOptions: PickOption[] = useMemo(() => categories.flatMap((c) => [{ id: c.id, label: c.name }, ...c.subcategories.map((s) => ({ id: s.id, label: `${c.name} › ${s.name}` }))]), [categories]);

  const save = async () => {
    const e: FormErrors = {};
    if (v.enabled || v.creditsRequired.trim()) { if (!isInt(v.creditsRequired)) e.creditsRequired = "Enter a whole number of credits."; }
    if (v.enabled || v.couponValue.trim()) { if (!isMoney(v.couponValue) || Number(v.couponValue) <= 0) e.couponValueMinor = "Enter the coupon value in rupees."; }
    if (v.enabled || v.validityDays.trim()) { if (!isInt(v.validityDays)) e.couponValidityDays = "Enter a number of days."; }
    if (v.minCredits.trim() && !isInt(v.minCredits)) e.minCreditsToRedeem = "Enter a whole number.";
    if (v.minOrder.trim() && !isMoney(v.minOrder)) e.couponMinOrderMinor = "Enter an amount in rupees.";
    if (!isInt(v.usageLimit)) e.couponUsageLimit = "Enter 1 or more.";
    if (!isInt(v.maxUnits)) e.maxUnitsPerRedemption = "Enter 1 or more.";
    if (v.expiryEnabled && !isInt(v.expiryDays)) e.creditExpiryDays = "Enter a number of days.";
    if (v.appliesTo === "products" && !v.productIds.length) e.productIds = "Select at least one product.";
    if (v.appliesTo === "categories" && !v.categoryIds.length) e.categoryIds = "Select at least one category.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      adopt(await adminEcoCreditsApi.saveSettings({
        enabled: v.enabled,
        minCreditsToRedeem: v.minCredits.trim() ? Number(v.minCredits) : null,
        creditsRequired: v.creditsRequired.trim() ? Number(v.creditsRequired) : null,
        couponValueMinor: v.couponValue.trim() ? Math.round(Number(v.couponValue) * 100) : null,
        couponValidityDays: v.validityDays.trim() ? Number(v.validityDays) : null,
        couponMinOrderMinor: v.minOrder.trim() ? Math.round(Number(v.minOrder) * 100) : null,
        couponUsageLimit: Number(v.usageLimit), maxUnitsPerRedemption: Number(v.maxUnits), allowCombine: v.allowCombine,
        appliesTo: v.appliesTo, productIds: v.appliesTo === "products" ? v.productIds : [], categoryIds: v.appliesTo === "categories" ? v.categoryIds : [],
        creditExpiryEnabled: v.expiryEnabled, creditExpiryDays: v.expiryDays.trim() ? Number(v.expiryDays) : null,
      }));
      setErrors({});
      toast.success("Eco Reward settings saved", v.enabled ? "Customers can redeem Eco Credits with these rules." : "Redemption is switched off.");
    } catch (err) { setErrors(errorsFrom(err, "Could not save the settings.")); }
    finally { setSaving(false); }
  };

  if (error) return <Panel><ErrorState message={error} onRetry={() => void load()} /></Panel>;
  if (!loaded) return <Panel><ListSkeleton rows={6} /></Panel>;

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <Panel
        title={<span className="flex flex-wrap items-center gap-2">Eco Reward Settings <Badge tone={loaded.ready ? "success" : "neutral"} dot>{loaded.ready ? "Live" : loaded.enabled ? "Incomplete" : "Off"}</Badge></span>}
      >
        <div className="space-y-7">
          <SwitchRow title="Enable Eco Rewards" hint="Lets customers turn Eco Credits into a personal coupon. Earning credits from recycling works regardless of this switch." checked={v.enabled} onChange={(x) => set("enabled", x)} />

          <Section title="Conversion" hint="These two numbers ARE the exchange rate. They are shown to customers exactly as entered.">
            <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
              <Field label="Credits required" required={v.enabled} error={errors.creditsRequired}>
                <input value={v.creditsRequired} onChange={(e) => set("creditsRequired", e.target.value)} inputMode="numeric" placeholder="e.g. 100" className={cn(FIELD, errors.creditsRequired && FIELD_ERR)} />
              </Field>
              <ArrowRight className="mb-3 hidden h-5 w-5 erp-text-faint sm:block" aria-hidden />
              <Field label="Coupon value (₹)" required={v.enabled} error={errors.couponValueMinor}>
                <input value={v.couponValue} onChange={(e) => set("couponValue", e.target.value)} inputMode="decimal" placeholder="e.g. 50" className={cn(FIELD, errors.couponValueMinor && FIELD_ERR)} />
              </Field>
            </div>
            {loaded.ready && loaded.creditsRequired && loaded.couponValueMinor && (
              <p className="text-xs erp-text-muted">Currently live: <span className="font-semibold erp-text">{loaded.creditsRequired.toLocaleString("en-IN")} Eco Credits → {inrMinor(loaded.couponValueMinor)} coupon</span></p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum credits to redeem" hint="Wallet balance needed before redeeming. Empty = the credits required." error={errors.minCreditsToRedeem}>
                <input value={v.minCredits} onChange={(e) => set("minCredits", e.target.value)} inputMode="numeric" className={cn(FIELD, errors.minCreditsToRedeem && FIELD_ERR)} />
              </Field>
              <Field label="Maximum redemption per order" hint="Rewards a customer can combine into ONE coupon (one coupon is used per order)." error={errors.maxUnitsPerRedemption}>
                <input value={v.maxUnits} onChange={(e) => set("maxUnits", e.target.value)} inputMode="numeric" className={cn(FIELD, errors.maxUnitsPerRedemption && FIELD_ERR)} />
              </Field>
            </div>
          </Section>

          <Section title="Generated coupon" hint="Each redemption creates a coupon in the normal coupon system, locked to that one customer.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Coupon validity (days)" required={v.enabled} error={errors.couponValidityDays}>
                <input value={v.validityDays} onChange={(e) => set("validityDays", e.target.value)} inputMode="numeric" placeholder="e.g. 30" className={cn(FIELD, errors.couponValidityDays && FIELD_ERR)} />
              </Field>
              <Field label="Minimum order (₹)" hint="Optional." error={errors.couponMinOrderMinor}>
                <input value={v.minOrder} onChange={(e) => set("minOrder", e.target.value)} inputMode="decimal" className={cn(FIELD, errors.couponMinOrderMinor && FIELD_ERR)} />
              </Field>
              <Field label="Usage limit" hint="Times the coupon can be used." error={errors.couponUsageLimit}>
                <input value={v.usageLimit} onChange={(e) => set("usageLimit", e.target.value)} inputMode="numeric" className={cn(FIELD, errors.couponUsageLimit && FIELD_ERR)} />
              </Field>
            </div>
            <Field label="Applicable to">
              <select value={v.appliesTo} onChange={(e) => set("appliesTo", e.target.value as EcoRewardSettings["appliesTo"])} className={FIELD}>
                <option value="all">Entire store</option>
                <option value="products">Specific products</option>
                <option value="categories">Specific categories</option>
              </select>
            </Field>
            {v.appliesTo === "products" && <Field label="Products" required error={errors.productIds}><EntityPicker multiple options={productOptions} value={v.productIds} onChange={(ids) => set("productIds", ids)} placeholder="Search products…" error={!!errors.productIds} /></Field>}
            {v.appliesTo === "categories" && <Field label="Categories" required error={errors.categoryIds}><EntityPicker multiple options={categoryOptions} value={v.categoryIds} onChange={(ids) => set("categoryIds", ids)} placeholder="Search categories…" error={!!errors.categoryIds} /></Field>}
            <SwitchRow title="Allow combining with other discounts" hint="Checkout accepts one coupon per order, so a reward coupon never stacks with another coupon. This decides whether it may discount items already priced from a bulk tier." checked={v.allowCombine} onChange={(x) => set("allowCombine", x)} />
          </Section>

          <Section title="Credit expiry" hint="Off by default: credits never expire unless you switch this on. Expired credits are recorded as ledger entries, never deleted.">
            <SwitchRow title="Enable credit expiry" checked={v.expiryEnabled} onChange={(x) => set("expiryEnabled", x)} />
            {v.expiryEnabled && (
              <Field label="Expiry days" required error={errors.creditExpiryDays} hint="Credits unused for this long expire, oldest first." className="sm:max-w-xs">
                <input value={v.expiryDays} onChange={(e) => set("expiryDays", e.target.value)} inputMode="numeric" placeholder="e.g. 365" className={cn(FIELD, errors.creditExpiryDays && FIELD_ERR)} />
              </Field>
            )}
          </Section>
        </div>
      </Panel>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {errors.form && <span role="alert" className="mr-auto text-sm font-medium text-red-600 dark:text-red-400">{errors.form}</span>}
        <Button variant="primary" icon={Save} loading={saving} type="submit">Save settings</Button>
      </div>
    </form>
  );
}
