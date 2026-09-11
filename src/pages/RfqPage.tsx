import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Loader2,
  Package,
  Paperclip,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { rfqApi, fileToUploadPayload, type RfqAssistResult } from "@/lib/api/rfq";
import { describeApiError } from "@/lib/api/client";
import { addressApi } from "@/lib/api/commerce";
import { useAuthSession } from "@/components/auth/AuthContext";
import { useAuthGuard } from "@/components/auth/AuthGuard";
import { ProductPickerModal } from "@/components/rfq/ProductPickerModal";
import {
  MATERIALS,
  COLORS,
  PRINTING_TYPES,
  QUANTITY_UNITS,
  DIMENSION_UNITS,
  PRODUCT_SHAPES,
  emptyDimension,
  formatDimensions,
  dimensionsComplete,
  type DimensionValue,
  type ProductShape,
} from "@/lib/rfq-options";
import {
  useRfqCart,
  updateRfqQuantity,
  updateRfqLine,
  removeFromRfq,
  addCustomRfqLine,
  clearRfqCart,
  toRfqItems,
  isCustomLine,
  type RfqCartLine,
} from "@/lib/rfq-cart-store";

// ============================================================
// Create Bulk Quote — the buyer's multi-step RFQ builder.
//
// ONE RFQ carries MANY products (store picks + typed-in customs), each with its
// own requirements (dimensions, material, colour, quantity, printing, artwork),
// plus optional requirement sheets and delivery details, submitted together:
//   1 Products → 2 Requirements → 3 Upload sheet → 4 Delivery → 5 Review
//
// Submission is files-first so the owner's notification can honestly say the
// sheet is attached: create the RFQ as a DRAFT, upload attachments to it, then
// finalize with /rfqs/:id/submit (which fans out admin + WhatsApp + matching).
// A failed upload never blocks submission — the RFQ still goes through.
// ============================================================

const STEPS = ["Products", "Requirements", "Upload Sheet", "Delivery", "Review & Submit"] as const;

const ACCEPT_SHEET = ".xlsx,.xls,.csv,.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp";
const ACCEPT_ARTWORK = ".pdf,.png,.jpg,.jpeg,.webp,.svg,.ai,.cdr";
const MAX_FILES = 5; // backend cap: total files per RFQ
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// The browser sometimes reports an empty MIME (e.g. csv on Windows) or one the
// server won't accept (ai/cdr); fall back to a supported type by extension so a
// legitimate file isn't refused client-side. The server re-validates by magic
// bytes regardless (ai→pdf and svg→image are commonly compatible containers).
const MIME_BY_EXT: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/png", // vector artwork uploaded as-is; server validates bytes
  ai: "application/pdf", // .ai files are PDF-compatible containers
  cdr: "application/pdf",
};

function resolveMime(file: File): string | null {
  if (file.type && Object.values(MIME_BY_EXT).includes(file.type)) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

const prettySize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const inputCls = "w-full rounded-lg border border-dark-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none";
const labelCls = "block text-xs font-bold text-dark-700";

// ---- Spec helpers --------------------------------------------------------

const patchSpecs = (line: RfqCartLine, patch: Record<string, unknown>) =>
  updateRfqLine(line.productId, { specs: { ...line.specs, ...patch } });

const getDimension = (line: RfqCartLine): DimensionValue => {
  const d = line.specs?.dimension as DimensionValue | undefined;
  return d && typeof d === "object" ? { ...emptyDimension(), ...d } : emptyDimension();
};

const getColors = (line: RfqCartLine): string[] => {
  const c = line.specs?.colors;
  return Array.isArray(c) ? (c as string[]) : [];
};

/** Materials/colours/printing/dimensions → the canonical `specs.*` strings the
 *  backend reads (WhatsApp + admin), kept in sync with the rich UI values. */
function writeDimension(line: RfqCartLine, next: DimensionValue) {
  patchSpecs(line, { dimension: next, productType: next.shape, dimensions: formatDimensions(next) });
}
function writeMaterial(line: RfqCartLine, choice: string, other: string) {
  patchSpecs(line, { materialChoice: choice, materialOther: other, material: choice === "Other" ? other : choice });
}
function writeColors(line: RfqCartLine, colors: string[], custom: string, pantone: string) {
  const label = colors
    .filter((c) => c !== "Custom Colour")
    .concat(colors.includes("Custom Colour") && custom ? [custom] : [])
    .join(", ");
  patchSpecs(line, { colors, colorCustom: custom, pantone, color: label + (pantone ? ` (${pantone})` : "") });
}
function writePrinting(line: RfqCartLine, required: "yes" | "no", type: string) {
  patchSpecs(line, { printingRequired: required, printingType: type, printing: required === "yes" ? type || "Printing required" : "No printing" });
}

// ---- Adaptive dimensions -------------------------------------------------

function DimensionsInput({ line }: { line: RfqCartLine }) {
  const d = getDimension(line);
  const set = (patch: Partial<DimensionValue>) => writeDimension(line, { ...d, ...patch });
  const num = (v: string) => v.replace(/[^\d.]/g, "");

  const field = (key: keyof DimensionValue, label: string) => (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-dark-400">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={String(d[key] ?? "")}
        onChange={(e) => set({ [key]: num(e.target.value) } as Partial<DimensionValue>)}
        className="w-full rounded-lg border border-dark-200 px-2 py-2 text-center text-sm focus:border-primary-500 focus:outline-none"
        aria-label={`${label} for ${line.productName || "product"}`}
      />
    </div>
  );

  return (
    <div className="sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={labelCls}>Dimensions</span>
        <select
          value={d.shape}
          onChange={(e) => set({ shape: e.target.value as ProductShape })}
          className="rounded-lg border border-dark-200 px-2 py-1 text-xs"
          aria-label="Product shape"
        >
          {PRODUCT_SHAPES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {d.shape === "na" ? (
        <p className="mt-2 rounded-lg bg-dark-50 px-3 py-2 text-xs text-dark-500">No dimensions needed for this product.</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(d.shape === "box" || d.shape === "flat") && field("length", "Length")}
          {(d.shape === "box" || d.shape === "flat") && field("width", "Width")}
          {(d.shape === "circular" || d.shape === "bottle") && field("diameter", "Diameter")}
          {(d.shape === "box" || d.shape === "circular" || d.shape === "bottle") && field("height", "Height")}
          {d.shape === "bottle" && field("capacity", "Capacity")}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-dark-400">Unit</label>
            <select
              value={d.unit}
              onChange={(e) => set({ unit: e.target.value as DimensionValue["unit"] })}
              className="w-full rounded-lg border border-dark-200 px-2 py-2 text-sm"
              aria-label="Dimension unit"
            >
              {DIMENSION_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RfqPage() {
  const lines = useRfqCart();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuthSession();
  const guard = useAuthGuard();

  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  // Per-line artwork files, keyed by the line's productId.
  const [artwork, setArtwork] = useState<Record<string, File[]>>({});
  const [notes, setNotes] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [ship, setShip] = useState({ city: "", state: "", postalCode: "", country: "India" });
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const shipPrefilled = useRef(false);
  const contactPrefilled = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // AI assistant panel state.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<RfqAssistResult | null>(null);

  // Prefill delivery from the buyer's saved DEFAULT address (once, while the
  // fields are untouched). The RFQ keeps its own snapshot; the saved address
  // is never modified.
  useEffect(() => {
    if (shipPrefilled.current) return;
    shipPrefilled.current = true;
    addressApi
      .list()
      .then((list) => {
        const def = list.find((a) => a.isDefault) ?? list[0];
        if (!def) return;
        setShip((s) =>
          s.city || s.state || s.postalCode
            ? s
            : { city: def.city, state: def.state, postalCode: def.postalCode, country: def.country || "India" },
        );
      })
      .catch(() => {/* guest or offline — fields start empty */});
  }, []);

  // Prefill contact from the signed-in profile (editable, never re-asked).
  useEffect(() => {
    if (contactPrefilled.current || !user) return;
    contactPrefilled.current = true;
    setContact((c) => ({
      name: c.name || [user.firstName, user.lastName].filter(Boolean).join(" ").trim(),
      phone: c.phone || user.phone || "",
      email: c.email || user.email || "",
    }));
  }, [user]);

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const totalQuantity = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);
  const totalFileCount = files.length + Object.values(artwork).reduce((n, a) => n + a.length, 0);
  const addedIds = useMemo(() => new Set(lines.filter((l) => !isCustomLine(l)).map((l) => l.productId)), [lines]);

  // ---- Validation ----------------------------------------------------------
  const productsValid = lines.length > 0 && lines.every((l) => l.productName.trim() && l.quantity > 0);
  const requirementsValid = lines.every((l) => dimensionsComplete(getDimension(l)));
  const deliveryValid = ship.city.trim().length > 0 && ship.state.trim().length > 0;
  const canNext = step === 0 ? productsValid : step === 1 ? requirementsValid : step === 3 ? deliveryValid : true;

  const nextBlockedReason =
    step === 0 && !productsValid
      ? lines.length === 0
        ? "Add at least one product"
        : "Every product needs a name and a quantity"
      : step === 1 && !requirementsValid
        ? "Fill the dimensions for each product (or set the shape to Not applicable)"
        : step === 3 && !deliveryValid
          ? "Delivery city and state are required"
          : null;

  // ---- Files ---------------------------------------------------------------
  const validateFile = (f: File): string | null => {
    if (f.size > MAX_FILE_BYTES) return `${f.name} is too large (max 10 MB).`;
    if (!resolveMime(f)) return `${f.name} is not a supported type.`;
    return null;
  };

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (next.length + Object.values(artwork).reduce((n, a) => n + a.length, 0) >= MAX_FILES) {
        toast.error(`At most ${MAX_FILES} files per request`, "Remove one before adding another.");
        break;
      }
      const err = validateFile(f);
      if (err) { toast.error("Couldn't add file", err); continue; }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  };

  const addArtwork = (lineId: string, picked: FileList | null) => {
    if (!picked) return;
    setArtwork((prev) => {
      const cur = prev[lineId] ?? [];
      const next = [...cur];
      for (const f of Array.from(picked)) {
        if (totalFileCount >= MAX_FILES) { toast.error(`At most ${MAX_FILES} files per request`); break; }
        const err = validateFile(f);
        if (err) { toast.error("Couldn't add artwork", err); continue; }
        if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
      }
      return { ...prev, [lineId]: next };
    });
  };

  const removeArtwork = (lineId: string, file: File) =>
    setArtwork((prev) => ({ ...prev, [lineId]: (prev[lineId] ?? []).filter((x) => x !== file) }));

  // ---- AI assistant --------------------------------------------------------
  const runAssist = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      setAiResult(await rfqApi.assist(aiPrompt.trim()));
    } catch (e) {
      toast.error("Assistant unavailable", describeApiError(e).message);
    } finally {
      setAiLoading(false);
    }
  };

  // Turn the (edited) AI suggestion into a new custom product line.
  const applyAssist = () => {
    if (!aiResult) return;
    const key = addCustomRfqLine();
    const dim = aiResult.dimensions ? { ...emptyDimension(), dimensions: aiResult.dimensions } : undefined;
    updateRfqLine(key, {
      productName: aiResult.productType ? `${aiResult.productType[0].toUpperCase()}${aiResult.productType.slice(1)} packaging` : "Custom packaging",
      quantity: aiResult.quantity ?? 1000,
      unit: aiResult.unit ?? "pcs",
      specs: {
        category: aiResult.category ?? undefined,
        material: aiResult.material ?? undefined,
        materialChoice: aiResult.material && (MATERIALS as readonly string[]).includes(aiResult.material) ? aiResult.material : aiResult.material ? "Other" : undefined,
        materialOther: aiResult.material && !(MATERIALS as readonly string[]).includes(aiResult.material) ? aiResult.material : undefined,
        color: aiResult.color ?? undefined,
        dimensions: aiResult.dimensions ?? undefined,
        description: aiPrompt.trim(),
        ...(dim ? { dimension: dim } : {}),
        ...(aiResult.printing ? { printingRequired: "yes", printing: aiResult.printing } : {}),
      },
    });
    toast.success("Added to your quote", "Review and fine-tune the requirements.");
    setAiOpen(false);
    setAiResult(null);
    setAiPrompt("");
  };

  // ---- Submission ----------------------------------------------------------
  const buildPayload = (submit: boolean) => {
    const contactChanged =
      contact.name || contact.phone || contact.email
        ? [
            contact.name && contact.name !== [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ? `Name: ${contact.name}` : "",
            contact.phone && contact.phone !== (user?.phone ?? "") ? `Phone: ${contact.phone}` : "",
            contact.email && contact.email !== (user?.email ?? "") ? `Email: ${contact.email}` : "",
          ].filter(Boolean).join(" · ")
        : "";
    const composedNotes = [notes.trim(), contactChanged ? `Preferred contact — ${contactChanged}` : ""].filter(Boolean).join("\n");
    return {
      items: toRfqItems(),
      notes: composedNotes || undefined,
      requiredBy: requiredBy || undefined,
      ship: {
        city: ship.city.trim(),
        state: ship.state.trim(),
        postalCode: ship.postalCode.trim() || undefined,
        country: ship.country.trim() || undefined,
      },
      submit,
    };
  };

  const uploadAll = async (draftId: string) => {
    const all: File[] = [...files, ...Object.values(artwork).flat()];
    for (const f of all) {
      try {
        const payload = await fileToUploadPayload(f);
        payload.mime = resolveMime(f) ?? payload.mime;
        await rfqApi.attachFile(draftId, payload);
      } catch (e) {
        toast.error(`Couldn't attach ${f.name}`, describeApiError(e).message);
      }
    }
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      let draftId = pendingDraftId;
      if (!draftId) {
        const draft = await rfqApi.create(buildPayload(false));
        draftId = draft.id;
        setPendingDraftId(draft.id);
        await uploadAll(draft.id);
      }
      const rfq = await rfqApi.submit(draftId);
      clearRfqCart();
      setPendingDraftId(null);
      toast.success(`Request ${rfq.rfqNumber} sent`, "Our team will send your quotation shortly.");
      nav("/account/quotations");
    } catch (err) {
      toast.error("Couldn't send your request", describeApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Guest → login → resume submit with the (localStorage-persisted) cart intact.
  const handleSubmit = () => guard(doSubmit, { label: "submit your quote request" });

  const handleSaveDraft = () => {
    guard(
      async () => {
        setSavingDraft(true);
        try {
          if (pendingDraftId) {
            toast.success("Draft saved", "Your products are kept — finish anytime.");
          } else {
            const draft = await rfqApi.create(buildPayload(false));
            setPendingDraftId(draft.id);
            await uploadAll(draft.id);
            toast.success("Draft saved", "Your request is kept as a draft — submit when ready.");
          }
        } catch (err) {
          toast.error("Couldn't save draft", describeApiError(err).message);
        } finally {
          setSavingDraft(false);
        }
      },
      { label: "save your quote draft" },
    );
  };

  // ---- Stepper -------------------------------------------------------------
  const stepper = (
    <ol className="flex flex-wrap items-center gap-1 text-xs sm:gap-2" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-1 sm:gap-2">
          {i > 0 && <span className="h-px w-3 bg-dark-200 sm:w-6" aria-hidden />}
          <button
            type="button"
            onClick={() => i < step && setStep(i)}
            disabled={i > step}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-bold transition sm:px-3 ${
              i === step ? "bg-primary-500 text-white" : i < step ? "bg-primary-50 text-primary-700 hover:bg-primary-100" : "bg-dark-50 text-dark-400"
            }`}
            aria-current={i === step ? "step" : undefined}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px]">
              {i < step ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        </li>
      ))}
    </ol>
  );

  // ---- Product card (step 1) ----------------------------------------------
  const productCard = (l: RfqCartLine, index: number) => (
    <div key={l.productId} className="rounded-xl border border-dark-100 bg-white p-4">
      <div className="flex items-start gap-3">
        {l.image && /^(blob:|\/|https?:|data:)/.test(l.image) && (
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dark-50 sm:flex">
            <img src={l.image} alt="" className="h-full w-full object-contain" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-dark-400">Product {index + 1}</p>
          {isCustomLine(l) ? (
            <input
              type="text"
              value={l.productName}
              onChange={(e) => updateRfqLine(l.productId, { productName: e.target.value })}
              placeholder="e.g. Custom Pizza Box *"
              className={`mt-1 ${inputCls} font-semibold`}
              aria-label={`Name for product ${index + 1}`}
            />
          ) : (
            <p className="mt-0.5 truncate font-semibold text-dark-900">{l.productName}</p>
          )}
          {l.sku && <p className="text-xs text-dark-400">SKU {l.sku}</p>}
          {isCustomLine(l) && (
            <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Custom request</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => removeFromRfq(l.productId)}
          aria-label={`Remove ${l.productName || `product ${index + 1}`}`}
          className="rounded-lg p-2 text-dark-400 hover:bg-dark-50 hover:text-red-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor={`qty-${l.productId}`}>Quantity *</label>
          <input
            id={`qty-${l.productId}`}
            type="number"
            min={1}
            value={l.quantity}
            onChange={(e) => updateRfqQuantity(l.productId, Number(e.target.value))}
            className={`mt-1 ${inputCls}`}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor={`unit-${l.productId}`}>Unit</label>
          <select
            id={`unit-${l.productId}`}
            value={l.unit || "pcs"}
            onChange={(e) => updateRfqLine(l.productId, { unit: e.target.value })}
            className={`mt-1 ${inputCls}`}
          >
            {QUANTITY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
    </div>
  );

  // ---- Requirements card (step 2) -----------------------------------------
  const requirementsCard = (l: RfqCartLine, index: number) => {
    const materialChoice = String(l.specs?.materialChoice ?? "");
    const materialOther = String(l.specs?.materialOther ?? "");
    const colors = getColors(l);
    const colorCustom = String(l.specs?.colorCustom ?? "");
    const pantone = String(l.specs?.pantone ?? "");
    const printingRequired = (l.specs?.printingRequired as "yes" | "no") ?? "no";
    const printingType = String(l.specs?.printingType ?? "");
    const lineArt = artwork[l.productId] ?? [];

    return (
      <div key={l.productId} className="rounded-xl border border-dark-100 bg-white p-4">
        <p className="font-semibold text-dark-900">
          <span className="text-[11px] font-bold uppercase tracking-wide text-dark-400">Product {index + 1} · </span>
          {l.productName || "Untitled product"}
          <span className="ml-2 text-xs font-normal text-dark-400">{l.quantity.toLocaleString("en-IN")} {l.unit || "pcs"}</span>
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Description */}
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor={`desc-${l.productId}`}>Product description{isCustomLine(l) ? " *" : ""}</label>
            <textarea
              id={`desc-${l.productId}`}
              rows={3}
              value={String(l.specs?.description ?? "")}
              onChange={(e) => patchSpecs(l, { description: e.target.value })}
              placeholder="Describe exactly what you need — material feel, finish, closure, use case…"
              className={`mt-1 ${inputCls}`}
            />
          </div>

          <DimensionsInput line={l} />

          {/* Material */}
          <div>
            <label className={labelCls} htmlFor={`mat-${l.productId}`}>Material</label>
            <select
              id={`mat-${l.productId}`}
              value={materialChoice}
              onChange={(e) => writeMaterial(l, e.target.value, materialOther)}
              className={`mt-1 ${inputCls}`}
            >
              <option value="">Select material…</option>
              {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {materialChoice === "Other" && (
              <input
                type="text"
                value={materialOther}
                onChange={(e) => writeMaterial(l, "Other", e.target.value)}
                placeholder="Enter material"
                className={`mt-2 ${inputCls}`}
                aria-label="Custom material"
              />
            )}
          </div>

          {/* Printing */}
          <div>
            <label className={labelCls}>Printing required?</label>
            <div className="mt-1 flex gap-2">
              {(["no", "yes"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => writePrinting(l, v, printingType)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold capitalize transition ${
                    printingRequired === v ? "border-primary-500 bg-primary-50 text-primary-700" : "border-dark-200 text-dark-600 hover:bg-dark-50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            {printingRequired === "yes" && (
              <select
                value={printingType}
                onChange={(e) => writePrinting(l, "yes", e.target.value)}
                className={`mt-2 ${inputCls}`}
                aria-label="Printing type"
              >
                <option value="">Select printing type…</option>
                {PRINTING_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          {/* Colours */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Colour</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {COLORS.map((c) => {
                const on = colors.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      const next = on ? colors.filter((x) => x !== c) : [...colors, c];
                      writeColors(l, next, colorCustom, pantone);
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      on ? "border-primary-500 bg-primary-50 text-primary-700" : "border-dark-200 text-dark-600 hover:bg-dark-50"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            {colors.includes("Custom Colour") && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={colorCustom}
                  onChange={(e) => writeColors(l, colors, e.target.value, pantone)}
                  placeholder="Colour name (e.g. Royal Blue)"
                  className={inputCls}
                  aria-label="Custom colour name"
                />
                <input
                  type="text"
                  value={pantone}
                  onChange={(e) => writeColors(l, colors, colorCustom, e.target.value)}
                  placeholder="Pantone / HEX (optional)"
                  className={inputCls}
                  aria-label="Pantone or HEX"
                />
              </div>
            )}
          </div>

          {/* Artwork upload */}
          <div className="sm:col-span-2">
            <label className={labelCls}>Logo / artwork <span className="font-normal text-dark-400">(PDF, AI, CDR, SVG, PNG, JPG)</span></label>
            <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-dark-200 py-3 text-sm font-bold text-dark-600 hover:border-primary-400 hover:text-primary-600">
              <ImagePlus className="h-4 w-4" /> Upload artwork
              <input type="file" accept={ACCEPT_ARTWORK} multiple className="sr-only" onChange={(e) => addArtwork(l.productId, e.target.files)} />
            </label>
            {lineArt.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {lineArt.map((f) => (
                  <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 rounded-lg border border-dark-100 px-3 py-1.5 text-xs">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary-500" />
                    <span className="min-w-0 flex-1 truncate text-dark-800">{f.name}</span>
                    <span className="shrink-0 text-dark-400">{prettySize(f.size)}</span>
                    <button type="button" onClick={() => removeArtwork(l.productId, f)} aria-label={`Remove ${f.name}`} className="rounded p-0.5 text-dark-400 hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="py-8">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <h1 className="text-2xl font-bold text-dark-900">Create Bulk Quote</h1>
        <p className="mt-1 text-sm text-dark-500">
          {lines.length > 0
            ? `${lines.length} product${lines.length === 1 ? "" : "s"} · ${totalQuantity.toLocaleString("en-IN")} units — sent as one request`
            : "Add the products you need quoted — they all go out as one request."}
        </p>

        <div className="mt-5">{stepper}</div>

        <div className="mt-6 space-y-3">
          {/* Step 1 — Products */}
          {step === 0 && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex items-center justify-center gap-2 rounded-xl bg-primary-500 py-3 text-sm font-bold text-white hover:bg-primary-600"
                >
                  <Package className="h-4 w-4" /> Select Product From Store
                </button>
                <button
                  type="button"
                  onClick={() => addCustomRfqLine()}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-dark-200 bg-white py-3 text-sm font-bold text-dark-600 hover:border-primary-400 hover:text-primary-600"
                >
                  <Plus className="h-4 w-4" /> Add Custom Product
                </button>
              </div>

              {/* AI assistant */}
              <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4">
                <button
                  type="button"
                  onClick={() => setAiOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-sm font-bold text-primary-700"
                >
                  <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Ask AI to help</span>
                  <span className="text-xs font-normal text-primary-600">{aiOpen ? "Hide" : "Describe what you need"}</span>
                </button>
                {aiOpen && (
                  <div className="mt-3">
                    <textarea
                      rows={2}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder='e.g. "I need packaging for 500 glass bottles with a printed label"'
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={runAssist}
                      disabled={aiLoading || !aiPrompt.trim()}
                      className="mt-2 flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                      {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Suggest
                    </button>

                    {aiResult && (
                      <div className="mt-3 rounded-lg border border-primary-100 bg-white p-3 text-sm">
                        <p className="text-dark-600">{aiResult.note}</p>
                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          {aiResult.category && <div><dt className="inline font-bold text-dark-700">Category: </dt><dd className="inline text-dark-600">{aiResult.category}</dd></div>}
                          {aiResult.material && <div><dt className="inline font-bold text-dark-700">Material: </dt><dd className="inline text-dark-600">{aiResult.material}</dd></div>}
                          {aiResult.dimensions && <div><dt className="inline font-bold text-dark-700">Size: </dt><dd className="inline text-dark-600">{aiResult.dimensions}</dd></div>}
                          {aiResult.quantity != null && <div><dt className="inline font-bold text-dark-700">Qty: </dt><dd className="inline text-dark-600">{aiResult.quantity.toLocaleString("en-IN")} {aiResult.unit}</dd></div>}
                          {aiResult.printing && <div><dt className="inline font-bold text-dark-700">Printing: </dt><dd className="inline text-dark-600">{aiResult.printing}</dd></div>}
                        </dl>
                        {aiResult.products.length > 0 && (
                          <p className="mt-2 text-xs text-dark-500">
                            Matching products: {aiResult.products.map((p) => p.name).join(", ")}
                          </p>
                        )}
                        <p className="mt-2 text-[11px] italic text-dark-400">Suggestions only — you can edit everything after adding.</p>
                        <button
                          type="button"
                          onClick={applyAssist}
                          className="mt-2 flex items-center gap-2 rounded-lg bg-dark-900 px-4 py-2 text-sm font-bold text-white hover:bg-dark-800"
                        >
                          <Plus className="h-4 w-4" /> Add as a product
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {lines.length === 0 ? (
                <div className="rounded-xl border border-dashed border-dark-200 bg-white p-8 text-center">
                  <FileText className="mx-auto h-10 w-10 text-dark-300" />
                  <p className="mt-3 text-sm text-dark-500">
                    Pick products from the store, add a custom request, or choose &ldquo;Request Quote&rdquo; on any{" "}
                    <Link to="/products" className="font-bold text-primary-600 hover:underline">catalogue product</Link>.
                  </p>
                </div>
              ) : (
                lines.map(productCard)
              )}
            </>
          )}

          {/* Step 2 — Requirements */}
          {step === 1 && lines.map(requirementsCard)}

          {/* Step 3 — Upload requirement sheet */}
          {step === 2 && (
            <div className="rounded-xl border border-dark-100 bg-white p-5">
              <p className="font-semibold text-dark-900">Product requirement sheet</p>
              <p className="mt-1 text-sm text-dark-500">
                Optional — attach a specification sheet (Excel, CSV, PDF, Word or images). Counts toward the {MAX_FILES}-file,
                10 MB-each limit shared with artwork. It goes to our team with your products.
              </p>
              <input ref={fileInput} type="file" accept={ACCEPT_SHEET} multiple onChange={(e) => addFiles(e.target.files)} className="sr-only" id="rfq-file-input" />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-dark-200 py-6 text-sm font-bold text-dark-600 hover:border-primary-400 hover:text-primary-600"
              >
                <Upload className="h-4 w-4" /> Choose files…
              </button>
              {files.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {files.map((f) => (
                    <li key={`${f.name}-${f.size}`} className="flex items-center gap-3 rounded-lg border border-dark-100 px-3 py-2 text-sm">
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary-500" />
                      <span className="min-w-0 flex-1 truncate text-dark-800">{f.name}</span>
                      <span className="shrink-0 text-xs text-dark-400">{prettySize(f.size)}</span>
                      <button type="button" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remove ${f.name}`} className="rounded p-1 text-dark-400 hover:text-red-500">
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-dark-400">{totalFileCount}/{MAX_FILES} files used (sheets + artwork).</p>
            </div>
          )}

          {/* Step 4 — Delivery + contact */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-dark-100 bg-white p-5">
                <p className="font-semibold text-dark-900">Your contact details</p>
                <p className="mt-1 text-xs text-dark-500">Pre-filled from your profile — edit if this request needs a different contact.</p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className={labelCls} htmlFor="c-name">Name</label>
                    <input id="c-name" type="text" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} className={`mt-1 ${inputCls}`} placeholder="Full name" />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="c-phone">Phone</label>
                    <input id="c-phone" type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} className={`mt-1 ${inputCls}`} placeholder="Phone" />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="c-email">Email</label>
                    <input id="c-email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} className={`mt-1 ${inputCls}`} placeholder="Email" />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-dark-100 bg-white p-5">
                <p className="font-semibold text-dark-900">Delivery details</p>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls} htmlFor="ship-city">City *</label>
                    <input id="ship-city" type="text" value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} placeholder="Mumbai" className={`mt-1 ${inputCls}`} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="ship-state">State *</label>
                    <input id="ship-state" type="text" value={ship.state} onChange={(e) => setShip({ ...ship, state: e.target.value })} placeholder="Maharashtra" className={`mt-1 ${inputCls}`} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="ship-postal">PIN code</label>
                    <input id="ship-postal" type="text" inputMode="numeric" value={ship.postalCode} onChange={(e) => setShip({ ...ship, postalCode: e.target.value })} placeholder="400001" className={`mt-1 ${inputCls}`} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="rfq-required-by">Required by</label>
                    <input id="rfq-required-by" type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} className={`mt-1 ${inputCls}`} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelCls} htmlFor="rfq-notes">Notes for our team</label>
                    <textarea id="rfq-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Timelines, budget, delivery constraints…" className={`mt-1 ${inputCls}`} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 5 — Review & submit */}
          {step === 4 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-dark-100 bg-white p-5">
                <p className="font-semibold text-dark-900">{lines.length} product{lines.length === 1 ? "" : "s"} · {totalQuantity.toLocaleString("en-IN")} units</p>
                <ul className="mt-3 space-y-3 text-sm">
                  {lines.map((l, i) => {
                    const summary = [
                      formatDimensions(getDimension(l)),
                      String(l.specs?.material ?? ""),
                      String(l.specs?.color ?? ""),
                      String(l.specs?.printing ?? ""),
                    ].filter(Boolean).join(" · ");
                    const art = (artwork[l.productId] ?? []).length;
                    return (
                      <li key={l.productId} className="border-b border-dark-50 pb-3 last:border-0 last:pb-0">
                        <div className="flex justify-between gap-4">
                          <span className="font-semibold text-dark-900">{i + 1}. {l.productName || "Untitled"}</span>
                          <span className="shrink-0 text-dark-600">{l.quantity.toLocaleString("en-IN")} {l.unit || "pcs"}</span>
                        </div>
                        {summary && <p className="mt-0.5 text-xs text-dark-500">{summary}</p>}
                        {l.specs?.description ? <p className="mt-0.5 text-xs italic text-dark-400">“{String(l.specs.description).slice(0, 120)}”</p> : null}
                        {art > 0 && <p className="mt-0.5 text-xs text-primary-600">{art} artwork file{art === 1 ? "" : "s"}</p>}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="rounded-xl border border-dark-100 bg-white p-5 text-sm">
                {(contact.name || contact.phone || contact.email) && (
                  <p><span className="font-bold text-dark-700">Contact:</span> <span className="text-dark-600">{[contact.name, contact.phone, contact.email].filter(Boolean).join(" · ")}</span></p>
                )}
                <p className="mt-1"><span className="font-bold text-dark-700">Delivery:</span> <span className="text-dark-600">{[ship.city, ship.state, ship.postalCode].filter(Boolean).join(", ")}</span></p>
                {requiredBy && <p className="mt-1"><span className="font-bold text-dark-700">Required by:</span> <span className="text-dark-600">{requiredBy}</span></p>}
                <p className="mt-1 flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5 text-dark-400" />
                  <span className="text-dark-600">{totalFileCount > 0 ? `${totalFileCount} file${totalFileCount === 1 ? "" : "s"} attached` : "No attachments"}</span>
                </p>
                {notes.trim() && <p className="mt-1"><span className="font-bold text-dark-700">Notes:</span> <span className="text-dark-600">{notes}</span></p>}
              </div>
              {!user && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  You'll be asked to sign in when you submit — your products and details are kept.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0 || submitting}
            className="flex items-center gap-2 rounded-xl border border-dark-200 px-4 py-2.5 text-sm font-bold text-dark-700 hover:bg-dark-50 disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          <div className="flex items-center gap-2">
            {lines.length > 0 && (
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={savingDraft || submitting}
                className="hidden items-center gap-2 rounded-xl border border-dark-200 px-4 py-2.5 text-sm font-bold text-dark-700 hover:bg-dark-50 disabled:opacity-40 sm:flex"
              >
                {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <div className="flex items-center gap-3">
                {nextBlockedReason && <span className="hidden text-xs text-dark-400 sm:inline">{nextBlockedReason}</span>}
                <button
                  type="button"
                  onClick={() => canNext && setStep(step + 1)}
                  disabled={!canNext}
                  className="flex items-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-50"
                >
                  Next <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || lines.length === 0}
                className="flex items-center gap-2 rounded-xl bg-primary-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {submitting ? "Sending…" : pendingDraftId ? "Retry submit" : "Submit Bulk Quote Request"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-right text-[11px] text-dark-400">All products are sent together as one quotation request.</p>
      </div>

      <ProductPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} addedIds={addedIds} />
    </main>
  );
}
