import { useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import {
  marketingApi, type AdminCampaign, type CampaignContentType, type CampaignCtaType, type CampaignInput,
  type CampaignPlacement, type PopupFrequency, type PopupPosition, type PopupSettings,
} from "@/lib/api/marketing";
import type { CampaignLike } from "@/components/marketing/CampaignViews";
import { fromStoreInput, STORE_TIME_ZONE_LABEL, toStoreInput } from "@/lib/store-time";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/utils/cn";
import { Button, Drawer } from "../../components/ui";
import { hydrateCatalog, useCatalog } from "../../catalog-store";
import { hydrateCategories, useCategories } from "../../categories-store";
import { CampaignPreviewModal, PLACEMENT_LABEL } from "./CampaignPreview";
import {
  AREA, CampaignImageField, EntityPicker, errorsFrom, Field, FIELD, FIELD_ERR, Section, SwitchRow,
  type FormErrors, type PickOption,
} from "./shared";

// Campaign builder. Content is STRUCTURED: the admin fills typed fields and the
// storefront renders them with its own components — there is no HTML box. The
// fields shown follow the chosen content type; the CTA is a typed destination
// picked from real products / categories rather than a hand-typed URL.

type PublishState = "active" | "paused" | "draft";

const CONTENT_TYPES: { value: CampaignContentType; label: string; hint: string }[] = [
  { value: "text", label: "Text", hint: "Headline, supporting text and a button." },
  { value: "image", label: "Image", hint: "A designed image, optionally clickable." },
  { value: "quote", label: "Quote", hint: "A quotation with its source." },
  { value: "text_image", label: "Text + Image", hint: "Copy on one side, image on the other." },
  { value: "promo_card", label: "Promotional Card", hint: "Image, badge, copy and a button." },
];

const PLACEMENTS: { value: CampaignPlacement; hint: string }[] = [
  { value: "announcement_bar", hint: "Thin bar at the very top of every storefront page (text only)." },
  { value: "homepage_hero", hint: "Full-width banner directly under the homepage hero." },
  { value: "homepage_promo_card", hint: "Card in the homepage promotions row (up to 3 show)." },
  { value: "homepage_popup", hint: "Popup on the homepage — configure its behaviour below." },
  { value: "product_listing", hint: "Strip above the product grid." },
  { value: "product_detail", hint: "Strip at the top of every product page." },
  { value: "cart", hint: "Strip on the cart page." },
  { value: "checkout", hint: "Strip on the order review step." },
];

const USES: Record<CampaignContentType, Set<string>> = {
  text: new Set(["title", "subtitle", "description"]),
  image: new Set(["image", "imageAlt"]),
  quote: new Set(["quote", "quoteAuthor", "image"]),
  text_image: new Set(["title", "subtitle", "description", "image"]),
  promo_card: new Set(["title", "subtitle", "description", "image", "badgeText"]),
};

interface FormState {
  name: string; contentType: CampaignContentType;
  title: string; subtitle: string; description: string; quote: string; quoteAuthor: string;
  imageUrl: string | null; mobileImageUrl: string | null; imageAlt: string; badgeText: string;
  buttonText: string; ctaType: CampaignCtaType; ctaProductId: string | null; ctaCategoryId: string | null; ctaUrl: string;
  placements: CampaignPlacement[]; startAt: string; endAt: string; publish: PublishState; priority: string;
  popupPosition: PopupPosition; popupFrequency: PopupFrequency; popupDelaySeconds: string; popupAllowClose: boolean; popupOverlay: boolean;
}

const blank: FormState = {
  name: "", contentType: "promo_card",
  title: "", subtitle: "", description: "", quote: "", quoteAuthor: "",
  imageUrl: null, mobileImageUrl: null, imageAlt: "", badgeText: "",
  buttonText: "", ctaType: "none", ctaProductId: null, ctaCategoryId: null, ctaUrl: "",
  placements: [], startAt: "", endAt: "", publish: "active", priority: "1",
  popupPosition: "center", popupFrequency: "once_per_session", popupDelaySeconds: "3", popupAllowClose: true, popupOverlay: true,
};

const fromCampaign = (c: AdminCampaign, asCopy: boolean): FormState => ({
  name: asCopy ? `${c.name} (copy)` : c.name, contentType: c.contentType,
  title: c.title ?? "", subtitle: c.subtitle ?? "", description: c.description ?? "", quote: c.quote ?? "", quoteAuthor: c.quoteAuthor ?? "",
  imageUrl: c.imageUrl, mobileImageUrl: c.mobileImageUrl, imageAlt: c.imageAlt ?? "", badgeText: c.badgeText ?? "",
  buttonText: c.buttonText ?? "", ctaType: c.ctaType, ctaProductId: c.ctaProductId, ctaCategoryId: c.ctaCategoryId, ctaUrl: c.ctaUrl ?? "",
  placements: c.placements, startAt: toStoreInput(c.startAt), endAt: toStoreInput(c.endAt),
  // A duplicate always starts as a draft so it cannot go live by accident.
  publish: asCopy ? "draft" : c.isDraft ? "draft" : c.isActive ? "active" : "paused",
  priority: String(c.priority),
  popupPosition: c.popup.position, popupFrequency: c.popup.frequency, popupDelaySeconds: String(c.popup.delaySeconds),
  popupAllowClose: c.popup.allowClose, popupOverlay: c.popup.overlay,
});

const NOOP = () => {};
const isHttpUrl = (v: string) => { try { const u = new URL(v.trim()); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; } };

export function CampaignFormDrawer({
  open, campaign, duplicateOf, onClose, onSaved,
}: {
  open: boolean;
  campaign: AdminCampaign | null;
  duplicateOf: AdminCampaign | null;
  onClose: () => void;
  onSaved: (c: AdminCampaign) => void;
}) {
  const toast = useToast();
  const products = useCatalog();
  const categories = useCategories();
  const [f, setF] = useState<FormState>(blank);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const uses = USES[f.contentType];
  const isPopup = f.placements.includes("homepage_popup");

  useEffect(() => {
    if (!open) return;
    void hydrateCatalog();
    void hydrateCategories();
    setF(campaign ? fromCampaign(campaign, false) : duplicateOf ? fromCampaign(duplicateOf, true) : blank);
    setErrors({});
    setSaving(false);
    setPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign?.id, duplicateOf?.id]);

  const productOptions: PickOption[] = useMemo(
    () => products.filter((p) => p.status === "active").map((p) => ({ id: p.id, label: p.name, sub: p.sku })),
    [products],
  );
  const categoryOptions: PickOption[] = useMemo(
    () => categories.flatMap((c) => [
      { id: c.id, label: c.name },
      ...c.subcategories.map((s) => ({ id: s.id, label: `${c.name} › ${s.name}` })),
    ]),
    [categories],
  );

  /** Where the button will go — mirrors the server's resolution, for the preview. */
  const previewLink = (): string | null => {
    switch (f.ctaType) {
      case "product": { const p = products.find((x) => x.id === f.ctaProductId); return p?.slug ? `/product/${p.slug}` : null; }
      case "category": {
        const all = categories.flatMap((c) => [c, ...c.subcategories]);
        const c = all.find((x) => x.id === f.ctaCategoryId);
        return c ? `/products?category=${encodeURIComponent(c.slug)}` : null;
      }
      case "shop": return "/products";
      case "cart": return "/cart";
      case "external": return isHttpUrl(f.ctaUrl) ? f.ctaUrl.trim() : null;
      default: return null;
    }
  };

  const link = previewLink();
  const previewCampaign: CampaignLike = {
    id: campaign?.id ?? "preview",
    contentType: f.contentType,
    title: uses.has("title") ? f.title.trim() || null : null,
    subtitle: uses.has("subtitle") ? f.subtitle.trim() || null : null,
    description: uses.has("description") ? f.description.trim() || null : null,
    quote: uses.has("quote") ? f.quote.trim() || null : null,
    quoteAuthor: uses.has("quoteAuthor") ? f.quoteAuthor.trim() || null : null,
    imageUrl: uses.has("image") ? f.imageUrl : null,
    mobileImageUrl: uses.has("image") ? f.mobileImageUrl : null,
    imageAlt: f.imageAlt.trim() || null,
    badgeText: uses.has("badgeText") ? f.badgeText.trim() || null : null,
    buttonText: link ? f.buttonText.trim() || null : null,
    buttonLink: link,
    buttonExternal: f.ctaType === "external",
  };
  const popup: PopupSettings = {
    position: f.popupPosition, frequency: f.popupFrequency, delaySeconds: Number(f.popupDelaySeconds) || 0,
    allowClose: f.popupAllowClose, overlay: f.popupOverlay,
  };

  const validate = (): FormErrors => {
    const e: FormErrors = {};
    if (f.name.trim().length < 2) e.name = "Give the campaign a name.";
    if (f.contentType === "image" && !f.imageUrl) e.imageUrl = "Upload an image.";
    if (f.contentType === "image" && f.imageUrl && !f.imageAlt.trim()) e.imageAlt = "Describe the image for screen readers.";
    if (f.contentType === "text_image" && !f.imageUrl) e.imageUrl = "Upload an image.";
    if (f.contentType === "quote" && !f.quote.trim()) e.quote = "Enter the quote.";
    if (["text", "text_image", "promo_card"].includes(f.contentType) && !f.title.trim()) e.title = "Enter a title.";
    if (f.ctaType !== "none" && !f.buttonText.trim()) e.buttonText = "Enter the button text.";
    if (f.ctaType === "product" && !f.ctaProductId) e.ctaProductId = "Select a product.";
    if (f.ctaType === "category" && !f.ctaCategoryId) e.ctaCategoryId = "Select a category.";
    if (f.ctaType === "external" && !isHttpUrl(f.ctaUrl)) e.ctaUrl = "Enter a full address starting with https://";
    if (f.publish !== "draft" && f.placements.length === 0) e.placements = "Choose where the campaign appears.";
    if (f.placements.includes("announcement_bar") && !(f.title.trim() || f.quote.trim() || f.description.trim()) ) e.placements = "The announcement bar needs text — use a content type with a title.";
    const s = fromStoreInput(f.startAt); const en = fromStoreInput(f.endAt);
    if (!s) e.startAt = "Choose a start date and time.";
    if (!en) e.endAt = "Choose an end date and time.";
    if (s && en && en <= s) e.endAt = "End must be after the start.";
    if (!/^\d+$/.test(f.priority.trim()) || Number(f.priority) < 1 || Number(f.priority) > 9999) e.priority = "Priority is a whole number from 1.";
    if (isPopup && (!/^\d+$/.test(f.popupDelaySeconds.trim()) || Number(f.popupDelaySeconds) > 60)) e.popupDelaySeconds = "Delay is 0–60 seconds.";
    return e;
  };

  const save = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: CampaignInput = {
      name: f.name.trim(), contentType: f.contentType,
      title: f.title, subtitle: f.subtitle, description: f.description, quote: f.quote, quoteAuthor: f.quoteAuthor,
      imageUrl: f.imageUrl, mobileImageUrl: f.mobileImageUrl, imageAlt: f.imageAlt, badgeText: f.badgeText,
      buttonText: f.buttonText, ctaType: f.ctaType,
      ctaProductId: f.ctaType === "product" ? f.ctaProductId : null,
      ctaCategoryId: f.ctaType === "category" ? f.ctaCategoryId : null,
      ctaUrl: f.ctaType === "external" ? f.ctaUrl.trim() : null,
      placements: f.placements,
      startAt: fromStoreInput(f.startAt)!, endAt: fromStoreInput(f.endAt)!,
      isActive: f.publish === "active", isDraft: f.publish === "draft",
      priority: Number(f.priority),
      popupPosition: f.popupPosition, popupFrequency: f.popupFrequency, popupDelaySeconds: Number(f.popupDelaySeconds) || 0,
      popupAllowClose: f.popupAllowClose, popupOverlay: f.popupAllowClose ? f.popupOverlay : false,
    };
    setSaving(true);
    try {
      const saved = campaign ? await marketingApi.updateCampaign(campaign.id, body) : await marketingApi.createCampaign(body);
      toast.success(campaign ? "Campaign updated" : "Campaign created", `${saved.name} is ${saved.status}.`);
      onSaved(saved);
    } catch (err) {
      setErrors(errorsFrom(err, "Could not save the campaign."));
    } finally {
      setSaving(false);
    }
  };

  const togglePlacement = (p: CampaignPlacement) =>
    set("placements", f.placements.includes(p) ? f.placements.filter((x) => x !== p) : [...f.placements, p]);

  return (
    <>
      <Drawer
        open={open}
        // While the preview is up, Esc belongs to the preview — not the form.
        onClose={preview ? NOOP : onClose}
        width="max-w-3xl"
        title={campaign ? `Edit campaign` : duplicateOf ? "Duplicate campaign" : "Create campaign"}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {errors.form && <span role="alert" className="mr-auto text-xs font-medium text-red-600 dark:text-red-400">{errors.form}</span>}
            <Button icon={Eye} onClick={() => setPreview(true)} disabled={saving}>Preview</Button>
            <Button onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={saving}>{campaign ? "Save changes" : "Create campaign"}</Button>
          </div>
        }
      >
        <form className="space-y-7" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <Section title="Campaign">
            <Field label="Campaign name" required error={errors.name} hint="Internal only — customers never see it.">
              <input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Diwali Packaging Sale 2026" maxLength={120} className={cn(FIELD, errors.name && FIELD_ERR)} aria-invalid={!!errors.name} />
            </Field>
            <div>
              <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Content type <span className="text-red-500">*</span></span>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Content type">
                {CONTENT_TYPES.map((t) => (
                  <button
                    key={t.value} type="button" role="radio" aria-checked={f.contentType === t.value} onClick={() => set("contentType", t.value)}
                    className={cn("rounded-lg border p-3 text-left transition-colors", f.contentType === t.value ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10" : "erp-border hover:erp-surface-2")}
                  >
                    <span className="block text-sm font-semibold erp-text">{t.label}</span>
                    <span className="mt-0.5 block text-[11px] erp-text-muted">{t.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Content" hint="Plain text only — formatting, HTML and scripts are removed.">
            {uses.has("title") && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title" required error={errors.title}>
                  <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Festive Packaging Sale" maxLength={120} className={cn(FIELD, errors.title && FIELD_ERR)} aria-invalid={!!errors.title} />
                </Field>
                <Field label="Subtitle" hint="Small line above the title.">
                  <input value={f.subtitle} onChange={(e) => set("subtitle", e.target.value)} placeholder="Limited time" maxLength={160} className={FIELD} />
                </Field>
              </div>
            )}
            {uses.has("description") && (
              <Field label="Description">
                <textarea value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Save more on bulk packaging orders." maxLength={600} className={AREA} />
              </Field>
            )}
            {uses.has("quote") && (
              <>
                <Field label="Quote" required error={errors.quote}>
                  <textarea value={f.quote} onChange={(e) => set("quote", e.target.value)} maxLength={400} className={cn(AREA, errors.quote && FIELD_ERR)} aria-invalid={!!errors.quote} />
                </Field>
                <Field label="Author / source">
                  <input value={f.quoteAuthor} onChange={(e) => set("quoteAuthor", e.target.value)} maxLength={120} className={FIELD} />
                </Field>
              </>
            )}
            {uses.has("badgeText") && (
              <Field label="Badge text" hint="Short label on the card, e.g. NEW or 20% OFF.">
                <input value={f.badgeText} onChange={(e) => set("badgeText", e.target.value)} placeholder="Limited offer" maxLength={30} className={FIELD} />
              </Field>
            )}
            {uses.has("image") && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <CampaignImageField
                    label={f.contentType === "quote" ? "Image (optional)" : "Image"}
                    required={f.contentType === "image" || f.contentType === "text_image"}
                    value={f.imageUrl} onChange={(u) => set("imageUrl", u)} error={errors.imageUrl}
                    hint="Desktop image · landscape works best (about 1600×700)."
                  />
                  <CampaignImageField
                    label="Mobile image (optional)" value={f.mobileImageUrl} onChange={(u) => set("mobileImageUrl", u)} error={errors.mobileImageUrl}
                    hint="Shown on phones. Without it the desktop image is used."
                  />
                </div>
                <Field label="Alt text" required={f.contentType === "image"} error={errors.imageAlt} hint="Describes the image for screen readers and when it cannot load.">
                  <input value={f.imageAlt} onChange={(e) => set("imageAlt", e.target.value)} maxLength={160} className={cn(FIELD, errors.imageAlt && FIELD_ERR)} />
                </Field>
              </>
            )}
          </Section>

          <Section title="Button" hint="Pick where the button goes — internal pages are linked for you.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="CTA action">
                <select value={f.ctaType} onChange={(e) => set("ctaType", e.target.value as CampaignCtaType)} className={FIELD}>
                  <option value="none">No button</option>
                  <option value="shop">Collection / Shop page</option>
                  <option value="product">Product</option>
                  <option value="category">Category</option>
                  <option value="cart">Cart</option>
                  <option value="external">External URL</option>
                </select>
              </Field>
              {f.ctaType !== "none" && (
                <Field label="Button text" required error={errors.buttonText}>
                  <input value={f.buttonText} onChange={(e) => set("buttonText", e.target.value)} placeholder="Shop Now" maxLength={40} className={cn(FIELD, errors.buttonText && FIELD_ERR)} aria-invalid={!!errors.buttonText} />
                </Field>
              )}
            </div>
            {f.ctaType === "product" && (
              <Field label="Product" required error={errors.ctaProductId}>
                <EntityPicker options={productOptions} value={f.ctaProductId ? [f.ctaProductId] : []} onChange={(ids) => set("ctaProductId", ids[0] ?? null)} placeholder="Search active products…" error={!!errors.ctaProductId} emptyText="No products match" />
              </Field>
            )}
            {f.ctaType === "category" && (
              <Field label="Category" required error={errors.ctaCategoryId}>
                <EntityPicker options={categoryOptions} value={f.ctaCategoryId ? [f.ctaCategoryId] : []} onChange={(ids) => set("ctaCategoryId", ids[0] ?? null)} placeholder="Search categories…" error={!!errors.ctaCategoryId} emptyText="No categories match" />
              </Field>
            )}
            {f.ctaType === "external" && (
              <Field label="External URL" required error={errors.ctaUrl} hint="Opens in a new tab. Only http(s) addresses are accepted.">
                <input type="url" value={f.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="https://" maxLength={600} className={cn(FIELD, errors.ctaUrl && FIELD_ERR)} aria-invalid={!!errors.ctaUrl} />
              </Field>
            )}
            {link && f.ctaType !== "external" && <p className="text-xs erp-text-muted">Links to <span className="font-mono erp-text">{link}</span></p>}
          </Section>

          <Section title="Placement" hint="A campaign can appear in several places.">
            <div className="grid gap-2 sm:grid-cols-2">
              {PLACEMENTS.map((p) => {
                const on = f.placements.includes(p.value);
                return (
                  <label key={p.value} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", on ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10" : "erp-border hover:erp-surface-2")}>
                    <input type="checkbox" checked={on} onChange={() => togglePlacement(p.value)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary-500" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold erp-text">{PLACEMENT_LABEL[p.value]}</span>
                      <span className="mt-0.5 block text-[11px] erp-text-muted">{p.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.placements && <span role="alert" className="block text-[11px] font-medium text-red-600 dark:text-red-400">{errors.placements}</span>}
          </Section>

          {isPopup && (
            <Section title="Popup settings">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Popup position">
                  <select value={f.popupPosition} onChange={(e) => set("popupPosition", e.target.value as PopupPosition)} className={FIELD}>
                    <option value="center">Center</option>
                    <option value="bottom_right">Bottom right</option>
                    <option value="bottom_left">Bottom left</option>
                  </select>
                </Field>
                <Field label="Display frequency">
                  <select value={f.popupFrequency} onChange={(e) => set("popupFrequency", e.target.value as PopupFrequency)} className={FIELD}>
                    <option value="once_per_session">Once per session</option>
                    <option value="once_per_day">Once per day</option>
                    <option value="once_per_campaign">Once per campaign</option>
                    <option value="every_visit">Every visit</option>
                    <option value="always">Always</option>
                  </select>
                </Field>
                <Field label="Delay before showing (s)" error={errors.popupDelaySeconds} hint="0–60 seconds.">
                  <input value={f.popupDelaySeconds} onChange={(e) => set("popupDelaySeconds", e.target.value)} inputMode="numeric" className={cn(FIELD, errors.popupDelaySeconds && FIELD_ERR)} />
                </Field>
              </div>
              {(f.popupFrequency === "always" || f.popupFrequency === "every_visit") && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                  {f.popupFrequency === "always" ? "“Always” shows the popup every time the homepage opens." : "“Every visit” shows the popup on every page load."} Most stores use “Once per session” to avoid annoying returning visitors.
                </p>
              )}
              <SwitchRow title="Allow close" hint="Shows a close button. Visitors can always dismiss with the Esc key or the button." checked={f.popupAllowClose} onChange={(v) => set("popupAllowClose", v)} />
              <SwitchRow title="Overlay" hint={f.popupAllowClose ? "Dims the page behind the popup." : "Needs “Allow close” — a popup that cannot be closed never blocks the page."} checked={f.popupAllowClose && f.popupOverlay} onChange={(v) => set("popupOverlay", v)} disabled={!f.popupAllowClose} />
            </Section>
          )}

          <Section title="Schedule" hint={`Dates and times are in store time (${STORE_TIME_ZONE_LABEL}). Scheduled, Active and Expired are worked out automatically.`}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date & time" required error={errors.startAt}>
                <input type="datetime-local" value={f.startAt} onChange={(e) => set("startAt", e.target.value)} className={cn(FIELD, errors.startAt && FIELD_ERR)} aria-invalid={!!errors.startAt} />
              </Field>
              <Field label="End date & time" required error={errors.endAt}>
                <input type="datetime-local" value={f.endAt} min={f.startAt || undefined} onChange={(e) => set("endAt", e.target.value)} className={cn(FIELD, errors.endAt && FIELD_ERR)} aria-invalid={!!errors.endAt} />
              </Field>
              <Field label="Status">
                <select value={f.publish} onChange={(e) => set("publish", e.target.value as PublishState)} className={FIELD}>
                  <option value="active">Enabled — runs on its schedule</option>
                  <option value="paused">Paused</option>
                  <option value="draft">Draft — not published</option>
                </select>
              </Field>
              <Field label="Priority" required error={errors.priority} hint="Lower number shows first when campaigns share a placement.">
                <input value={f.priority} onChange={(e) => set("priority", e.target.value)} inputMode="numeric" className={cn(FIELD, errors.priority && FIELD_ERR)} />
              </Field>
            </div>
          </Section>
        </form>
      </Drawer>

      <CampaignPreviewModal open={preview} onClose={() => setPreview(false)} campaign={previewCampaign} popup={popup} placements={f.placements} name={f.name} />
    </>
  );
}
