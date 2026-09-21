import { useEffect, useMemo, useState } from "react";
import { marketingApi, type AdminCoupon, type CouponInput, type CouponScope } from "@/lib/api/marketing";
import { fromStoreInput, STORE_TIME_ZONE_LABEL, toStoreInput } from "@/lib/store-time";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/utils/cn";
import { Button, Drawer } from "../../components/ui";
import { hydrateCatalog, useCatalog } from "../../catalog-store";
import { hydrateCategories, useCategories } from "../../categories-store";
import { AREA, EntityPicker, errorsFrom, Field, FIELD, FIELD_ERR, Section, SwitchRow, type FormErrors, type PickOption } from "./shared";

// Create / edit a coupon. The form only collects RULES — whether the coupon is
// scheduled, active or expired is derived by the server from the dates, and the
// discount a customer gets is always computed by the server at checkout.

type PublishState = "active" | "paused" | "draft";

const rupees = (minor: number | null | undefined) => (minor == null ? "" : String(minor / 100));
const toMinor = (v: string) => Math.round(Number(v) * 100);
const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const isCount = (v: string) => /^\d+$/.test(v.trim()) && Number(v) >= 1;

export function CouponFormDrawer({
  open, coupon, duplicateOf, onClose, onSaved,
}: {
  open: boolean;
  /** Edit this coupon… */
  coupon: AdminCoupon | null;
  /** …or start a NEW coupon pre-filled from this one. */
  duplicateOf: AdminCoupon | null;
  onClose: () => void;
  onSaved: (c: AdminCoupon) => void;
}) {
  const toast = useToast();
  const products = useCatalog();
  const categories = useCategories();
  const editing = Boolean(coupon);
  const source = coupon ?? duplicateOf;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [publish, setPublish] = useState<PublishState>("active");
  const [discountType, setDiscountType] = useState<"percent" | "flat">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomer, setPerCustomer] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [appliesTo, setAppliesTo] = useState<CouponScope>("all");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [allowSaleItems, setAllowSaleItems] = useState(true);
  const [allowOtherDiscounts, setAllowOtherDiscounts] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void hydrateCatalog();
    void hydrateCategories();
    const s = source;
    setCode(coupon ? coupon.code : "");
    setName(s?.name ? (duplicateOf ? `${s.name} (copy)` : s.name) : "");
    setDescription(s?.description ?? "");
    // A duplicate always starts as a draft so it cannot go live by accident.
    setPublish(duplicateOf ? "draft" : s ? (s.isDraft ? "draft" : s.isActive ? "active" : "paused") : "active");
    setDiscountType(s?.discountType ?? "percent");
    setDiscountValue(s ? String(s.discountValue / 100) : "");
    setMaxDiscount(rupees(s?.maxDiscountMinor));
    setMinOrder(rupees(s?.minOrderMinor));
    setUsageLimit(s?.usageLimit != null ? String(s.usageLimit) : "");
    setPerCustomer(s ? (s.usageLimitPerCustomer != null ? String(s.usageLimitPerCustomer) : "") : "1");
    setStartAt(toStoreInput(s?.startAt));
    setEndAt(toStoreInput(s?.endAt));
    setAppliesTo(s?.appliesTo ?? "all");
    setProductIds(s?.products.map((p) => p.id) ?? []);
    setCategoryIds(s?.categories.map((c) => c.id) ?? []);
    setAllowSaleItems(s?.allowSaleItems ?? true);
    setAllowOtherDiscounts(s?.allowOtherDiscounts ?? true);
    setErrors({});
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coupon?.id, duplicateOf?.id]);

  const productOptions: PickOption[] = useMemo(
    () => products.filter((p) => p.status !== "archived").map((p) => ({ id: p.id, label: p.name, sub: p.sku })),
    [products],
  );
  const categoryOptions: PickOption[] = useMemo(
    () => categories.flatMap((c) => [
      { id: c.id, label: c.name, sub: `${c.productCount} products` },
      ...c.subcategories.map((s) => ({ id: s.id, label: `${c.name} › ${s.name}`, sub: `${s.productCount} products` })),
    ]),
    [categories],
  );

  const validate = (): FormErrors => {
    const e: FormErrors = {};
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(code.trim())) e.code = "3–40 letters, numbers, - or _ (no spaces).";
    if (!isMoney(discountValue) || Number(discountValue) <= 0) e.discountValue = "Enter a discount greater than 0.";
    else if (discountType === "percent" && Number(discountValue) > 100) e.discountValue = "A percentage cannot exceed 100.";
    if (maxDiscount.trim() && !isMoney(maxDiscount)) e.maxDiscountMinor = "Enter an amount in rupees.";
    if (minOrder.trim() && !isMoney(minOrder)) e.minOrderMinor = "Enter an amount in rupees.";
    if (usageLimit.trim() && !isCount(usageLimit)) e.usageLimit = "Enter a whole number of 1 or more.";
    if (perCustomer.trim() && !isCount(perCustomer)) e.usageLimitPerCustomer = "Enter a whole number of 1 or more.";
    const s = fromStoreInput(startAt); const en = fromStoreInput(endAt);
    if (!s) e.startAt = "Choose a start date and time.";
    if (!en) e.endAt = "Choose an end date and time.";
    if (s && en && en <= s) e.endAt = "End must be after the start.";
    if (appliesTo === "products" && productIds.length === 0) e.productIds = "Select at least one product.";
    if (appliesTo === "categories" && categoryIds.length === 0) e.categoryIds = "Select at least one category.";
    return e;
  };

  const save = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: CouponInput = {
      code: code.trim(),
      name: name.trim() || null,
      description: description.trim() || null,
      discountType,
      discountValue: toMinor(discountValue), // percent → basis points, flat → paise (both ×100)
      maxDiscountMinor: discountType === "percent" && maxDiscount.trim() ? toMinor(maxDiscount) : null,
      minOrderMinor: minOrder.trim() ? toMinor(minOrder) : null,
      usageLimit: usageLimit.trim() ? Number(usageLimit) : null,
      usageLimitPerCustomer: perCustomer.trim() ? Number(perCustomer) : null,
      startAt: fromStoreInput(startAt)!,
      endAt: fromStoreInput(endAt)!,
      isActive: publish === "active",
      isDraft: publish === "draft",
      appliesTo,
      productIds: appliesTo === "products" ? productIds : [],
      categoryIds: appliesTo === "categories" ? categoryIds : [],
      allowSaleItems,
      allowOtherDiscounts,
    };
    setSaving(true);
    try {
      const saved = coupon ? await marketingApi.updateCoupon(coupon.id, body) : await marketingApi.createCoupon(body);
      toast.success(coupon ? "Coupon updated" : "Coupon created", `${saved.code} is ${saved.status.replace(/_/g, " ")}.`);
      onSaved(saved);
    } catch (err) {
      setErrors(errorsFrom(err, "Could not save the coupon."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={editing ? `Edit coupon ${coupon!.code}` : duplicateOf ? `Duplicate ${duplicateOf.code}` : "Create coupon"}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {errors.form && <span role="alert" className="mr-auto text-xs font-medium text-red-600 dark:text-red-400">{errors.form}</span>}
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>{editing ? "Save changes" : "Create coupon"}</Button>
        </div>
      }
    >
      <form className="space-y-7" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <Section title="Basic information">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Coupon code" required error={errors.code} hint="Customers can type it in any case — it is stored as upper case.">
              <input
                value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
                placeholder="PACK10" maxLength={40} autoCapitalize="characters"
                className={cn(FIELD, "font-mono font-bold tracking-wide", errors.code && FIELD_ERR)} aria-invalid={!!errors.code}
              />
            </Field>
            <Field label="Coupon name" error={errors.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Festive 10% off" maxLength={120} className={FIELD} />
            </Field>
          </div>
          <Field label="Description" hint="Internal note — what is this coupon for?">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className={AREA} />
          </Field>
          <Field label="Status" hint="Scheduled, Active and Expired are worked out automatically from the dates below.">
            <select value={publish} onChange={(e) => setPublish(e.target.value as PublishState)} className={FIELD}>
              <option value="active">Enabled — runs on its schedule</option>
              <option value="paused">Paused</option>
              <option value="draft">Draft — not published</option>
            </select>
          </Field>
        </Section>

        <Section title="Discount">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discount type" required>
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value as "percent" | "flat")} className={FIELD}>
                <option value="percent">Percentage (%)</option>
                <option value="flat">Fixed amount (₹)</option>
              </select>
            </Field>
            <Field label={discountType === "percent" ? "Discount value (%)" : "Discount value (₹)"} required error={errors.discountValue}>
              <input value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} inputMode="decimal" placeholder={discountType === "percent" ? "10" : "500"} className={cn(FIELD, errors.discountValue && FIELD_ERR)} aria-invalid={!!errors.discountValue} />
            </Field>
            {discountType === "percent" && (
              <Field label="Maximum discount amount (₹)" hint="Optional cap for percentage coupons." error={errors.maxDiscountMinor}>
                <input value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} inputMode="decimal" placeholder="300" className={cn(FIELD, errors.maxDiscountMinor && FIELD_ERR)} />
              </Field>
            )}
            <Field label="Minimum order amount (₹)" hint="Checked against the cart subtotal." error={errors.minOrderMinor}>
              <input value={minOrder} onChange={(e) => setMinOrder(e.target.value)} inputMode="decimal" placeholder="999" className={cn(FIELD, errors.minOrderMinor && FIELD_ERR)} />
            </Field>
          </div>
        </Section>

        <Section title="Usage">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Total usage limit" hint="Leave empty for unlimited." error={errors.usageLimit}>
              <input value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} inputMode="numeric" placeholder="500" className={cn(FIELD, errors.usageLimit && FIELD_ERR)} />
            </Field>
            <Field label="Usage limit per customer" hint="Leave empty for unlimited." error={errors.usageLimitPerCustomer}>
              <input value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} inputMode="numeric" placeholder="1" className={cn(FIELD, errors.usageLimitPerCustomer && FIELD_ERR)} />
            </Field>
          </div>
          {editing && <p className="text-xs erp-text-muted">Used {coupon!.usageCount.toLocaleString("en-IN")} time{coupon!.usageCount === 1 ? "" : "s"} so far.</p>}
        </Section>

        <Section title="Validity" hint={`Dates and times are in store time (${STORE_TIME_ZONE_LABEL}).`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date & time" required error={errors.startAt}>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className={cn(FIELD, errors.startAt && FIELD_ERR)} aria-invalid={!!errors.startAt} />
            </Field>
            <Field label="End date & time" required error={errors.endAt}>
              <input type="datetime-local" value={endAt} min={startAt || undefined} onChange={(e) => setEndAt(e.target.value)} className={cn(FIELD, errors.endAt && FIELD_ERR)} aria-invalid={!!errors.endAt} />
            </Field>
          </div>
        </Section>

        <Section title="Restrictions">
          <Field label="Applicable to">
            <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as CouponScope)} className={FIELD}>
              <option value="all">Entire store</option>
              <option value="products">Specific products</option>
              <option value="categories">Specific categories</option>
            </select>
          </Field>
          {appliesTo === "products" && (
            <Field label="Products" required error={errors.productIds} hint="Only these products are discounted.">
              <EntityPicker multiple options={productOptions} value={productIds} onChange={setProductIds} placeholder="Search products by name or SKU…" error={!!errors.productIds} emptyText="No products match" />
            </Field>
          )}
          {appliesTo === "categories" && (
            <Field label="Categories" required error={errors.categoryIds} hint="A category also covers its subcategories.">
              <EntityPicker multiple options={categoryOptions} value={categoryIds} onChange={setCategoryIds} placeholder="Search categories…" error={!!errors.categoryIds} emptyText="No categories match" />
            </Field>
          )}
          <SwitchRow title="Allow coupon with sale products" hint="Off: products that already have a sale price are not discounted." checked={allowSaleItems} onChange={setAllowSaleItems} />
          <SwitchRow title="Allow coupon with other discounts" hint="Off: lines already priced from a bulk/volume tier are not discounted." checked={allowOtherDiscounts} onChange={setAllowOtherDiscounts} />
        </Section>
      </form>
    </Drawer>
  );
}
