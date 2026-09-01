import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { rfqApi, fileToUploadPayload } from "@/lib/api/rfq";
import { describeApiError } from "@/lib/api/client";
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
// ONE RFQ carries MANY products (catalogue picks + typed-in customs), plus
// requirement sheets (xlsx/pdf/…) and delivery details, submitted together:
//   1 Products  →  2 Requirements  →  3 Upload sheet  →  4 Delivery  →  5 Review
//
// Submission is files-first so the owner's notification can honestly say the
// sheet is attached: create the RFQ as a DRAFT, upload attachments to it, then
// finalize with /rfqs/:id/submit (which fans out admin + WhatsApp + matching).
// A failed upload never blocks submission — the RFQ still goes through.
// ============================================================

const STEPS = ["Products", "Requirements", "Upload Sheet", "Delivery", "Review & Submit"] as const;

const ACCEPT = ".xlsx,.xls,.csv,.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp";
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// The browser sometimes reports an empty MIME (e.g. csv on Windows); fall back
// to the extension so a legitimate sheet isn't refused client-side. The server
// re-validates declared type against magic bytes regardless.
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

// Per-line requirement fields stored into specs.
const SPEC_FIELDS = [
  { key: "material", label: "Material", placeholder: "5 Ply / Kraft / …" },
  { key: "color", label: "Color", placeholder: "Brown / CMYK / …" },
  { key: "printing", label: "Printing", placeholder: "2 Color / None / …" },
  { key: "customization", label: "Customization", placeholder: "Logo, foil, lamination…" },
] as const;

function DimensionsInput({ line }: { line: RfqCartLine }) {
  // Stored as one "L x W x H unit" string in specs.dimensions; edited as three
  // fields + unit, per the classic packaging spec format.
  const parsed = String(line.specs?.dimensions ?? "");
  const m = parsed.match(/^([\d.]*)\s*[x×]\s*([\d.]*)\s*(?:[x×]\s*([\d.]*))?\s*(\w*)$/i);
  const [l, w, h, unit] = m ? [m[1] ?? "", m[2] ?? "", m[3] ?? "", m[4] || "inch"] : ["", "", "", "inch"];

  const set = (nl: string, nw: string, nh: string, nu: string) => {
    const parts = [nl, nw, nh].filter(Boolean).join(" x ");
    updateRfqLine(line.productId, { specs: { ...line.specs, dimensions: parts ? `${parts} ${nu}`.trim() : "" } });
  };

  return (
    <div>
      <span className={labelCls}>Dimensions</span>
      <div className="mt-1 flex items-center gap-1.5">
        {([l, w, h] as const).map((v, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-xs text-dark-400">×</span>}
            <input
              type="text"
              inputMode="decimal"
              value={v}
              onChange={(e) => {
                const next = [l, w, h] as string[];
                next[i] = e.target.value.replace(/[^\d.]/g, "");
                set(next[0], next[1], next[2], unit);
              }}
              placeholder={["L", "W", "H"][i]}
              className="w-14 rounded-lg border border-dark-200 px-2 py-2 text-center text-sm focus:border-primary-500 focus:outline-none"
              aria-label={`${["Length", "Width", "Height"][i]} for ${line.productName || "product"}`}
            />
          </span>
        ))}
        <select
          value={unit}
          onChange={(e) => set(l, w, h, e.target.value)}
          className="rounded-lg border border-dark-200 px-2 py-2 text-sm"
          aria-label="Dimension unit"
        >
          <option value="inch">inch</option>
          <option value="cm">cm</option>
          <option value="mm">mm</option>
        </select>
      </div>
    </div>
  );
}

export default function RfqPage() {
  const lines = useRfqCart();
  const nav = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [ship, setShip] = useState({ city: "", state: "", postalCode: "", country: "India" });
  const [submitting, setSubmitting] = useState(false);
  // Set when the draft was created but final submission failed — retry skips recreation.
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const totalQuantity = useMemo(() => lines.reduce((s, l) => s + l.quantity, 0), [lines]);

  // ---- Step validation -----------------------------------------------------
  const productsValid = lines.length > 0 && lines.every((l) => l.productName.trim() && l.quantity > 0);
  const deliveryValid = ship.city.trim().length > 0 && ship.state.trim().length > 0;
  const canNext = step === 0 ? productsValid : step === 3 ? deliveryValid : true;

  const nextBlockedReason =
    step === 0 && !productsValid
      ? lines.length === 0
        ? "Add at least one product"
        : "Every product needs a name and a quantity"
      : step === 3 && !deliveryValid
        ? "Delivery city and state are required"
        : null;

  // ---- Files ---------------------------------------------------------------
  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (next.length >= MAX_FILES) {
        toast.error(`At most ${MAX_FILES} files`, "Remove one before adding another.");
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name} is too large`, "Files must be 10 MB or smaller.");
        continue;
      }
      if (!resolveMime(f)) {
        toast.error(`${f.name} is not a supported type`, "Use Excel, CSV, PDF, Word or an image.");
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  };

  // ---- Submission ----------------------------------------------------------
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // 1. Create (or reuse) the draft holding every product line.
      let draftId = pendingDraftId;
      if (!draftId) {
        const draft = await rfqApi.create({
          items: toRfqItems(),
          notes: notes.trim() || undefined,
          requiredBy: requiredBy || undefined,
          ship: {
            city: ship.city.trim(),
            state: ship.state.trim(),
            postalCode: ship.postalCode.trim() || undefined,
            country: ship.country.trim() || undefined,
          },
          submit: false,
        });
        draftId = draft.id;
        setPendingDraftId(draft.id);

        // 2. Attach requirement sheets. A failed upload must not sink the RFQ —
        // report it and continue.
        for (const f of files) {
          try {
            const payload = await fileToUploadPayload(f);
            payload.mime = resolveMime(f) ?? payload.mime;
            await rfqApi.attachFile(draft.id, payload);
          } catch (e) {
            toast.error(`Couldn't attach ${f.name}`, describeApiError(e).message);
          }
        }
      }

      // 3. Finalize — this is what notifies our team (and the owner's WhatsApp).
      const rfq = await rfqApi.submit(draftId);
      clearRfqCart();
      setPendingDraftId(null);
      toast.success(`Request ${rfq.rfqNumber} sent`, "Our team will send your quotation shortly.");
      nav("/account/quotations");
    } catch (err) {
      const d = describeApiError(err);
      toast.error("Couldn't send your request", d.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Steps UI ------------------------------------------------------------
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
              i === step
                ? "bg-primary-500 text-white"
                : i < step
                  ? "bg-primary-50 text-primary-700 hover:bg-primary-100"
                  : "bg-dark-50 text-dark-400"
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

  const productCard = (l: RfqCartLine, index: number) => (
    <div key={l.productId} className="rounded-xl border border-dark-100 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-dark-400">Product {index + 1}</p>
          {isCustomLine(l) ? (
            <input
              type="text"
              value={l.productName}
              onChange={(e) => updateRfqLine(l.productId, { productName: e.target.value })}
              placeholder="e.g. Corrugated Box"
              className={`mt-1 ${inputCls} font-semibold`}
              aria-label={`Name for product ${index + 1}`}
            />
          ) : (
            <p className="mt-0.5 truncate font-semibold text-dark-900">{l.productName}</p>
          )}
          {l.sku && <p className="text-xs text-dark-400">SKU {l.sku}</p>}
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

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls} htmlFor={`qty-${l.productId}`}>Quantity</label>
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
            <option value="pcs">pcs</option>
            <option value="rolls">rolls</option>
            <option value="sheets">sheets</option>
            <option value="kg">kg</option>
            <option value="boxes">boxes</option>
          </select>
        </div>
      </div>
    </div>
  );

  const requirementsCard = (l: RfqCartLine, index: number) => (
    <div key={l.productId} className="rounded-xl border border-dark-100 bg-white p-4">
      <p className="font-semibold text-dark-900">
        <span className="text-[11px] font-bold uppercase tracking-wide text-dark-400">Product {index + 1} · </span>
        {l.productName || "Untitled product"}
        <span className="ml-2 text-xs font-normal text-dark-400">
          {l.quantity.toLocaleString("en-IN")} {l.unit || "pcs"}
        </span>
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DimensionsInput line={l} />
        {SPEC_FIELDS.map((f) => (
          <div key={f.key}>
            <label className={labelCls} htmlFor={`${f.key}-${l.productId}`}>{f.label}</label>
            <input
              id={`${f.key}-${l.productId}`}
              type="text"
              value={String(l.specs?.[f.key] ?? "")}
              onChange={(e) => updateRfqLine(l.productId, { specs: { ...l.specs, [f.key]: e.target.value } })}
              placeholder={f.placeholder}
              className={`mt-1 ${inputCls}`}
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor={`notes-${l.productId}`}>Notes</label>
          <input
            id={`notes-${l.productId}`}
            type="text"
            value={l.notes ?? ""}
            onChange={(e) => updateRfqLine(l.productId, { notes: e.target.value })}
            placeholder="Anything else about this product…"
            className={`mt-1 ${inputCls}`}
          />
        </div>
      </div>
    </div>
  );

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
              {lines.length === 0 && (
                <div className="rounded-xl border border-dashed border-dark-200 bg-white p-8 text-center">
                  <FileText className="mx-auto h-10 w-10 text-dark-300" />
                  <p className="mt-3 text-sm text-dark-500">
                    Add a product below, or choose &ldquo;Request Quote&rdquo; on any{" "}
                    <Link to="/products" className="font-bold text-primary-600 hover:underline">catalogue product</Link>.
                  </p>
                </div>
              )}
              {lines.map(productCard)}
              <button
                type="button"
                onClick={() => addCustomRfqLine()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-dark-200 bg-white py-3 text-sm font-bold text-dark-600 hover:border-primary-400 hover:text-primary-600"
              >
                <Plus className="h-4 w-4" /> Add Another Product
              </button>
            </>
          )}

          {/* Step 2 — Requirements */}
          {step === 1 && lines.map(requirementsCard)}

          {/* Step 3 — Upload requirement sheet */}
          {step === 2 && (
            <div className="rounded-xl border border-dark-100 bg-white p-5">
              <p className="font-semibold text-dark-900">Product requirement sheet</p>
              <p className="mt-1 text-sm text-dark-500">
                Optional — attach your specification sheet (Excel, CSV, PDF, Word or images). Up to {MAX_FILES} files,
                10 MB each. It goes to our team along with your products.
              </p>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                multiple
                onChange={(e) => addFiles(e.target.files)}
                className="sr-only"
                id="rfq-file-input"
              />
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
                      <button
                        type="button"
                        onClick={() => setFiles(files.filter((x) => x !== f))}
                        aria-label={`Remove ${f.name}`}
                        className="rounded p-1 text-dark-400 hover:text-red-500"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Step 4 — Delivery */}
          {step === 3 && (
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
          )}

          {/* Step 5 — Review & submit */}
          {step === 4 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-dark-100 bg-white p-5">
                <p className="font-semibold text-dark-900">
                  {lines.length} product{lines.length === 1 ? "" : "s"} · {totalQuantity.toLocaleString("en-IN")} units
                </p>
                <ul className="mt-3 space-y-2 text-sm">
                  {lines.map((l, i) => (
                    <li key={l.productId} className="flex justify-between gap-4 border-b border-dark-50 pb-2 last:border-0 last:pb-0">
                      <span className="min-w-0">
                        <span className="font-semibold text-dark-900">{i + 1}. {l.productName}</span>
                        {Object.entries(l.specs ?? {}).filter(([, v]) => v).length > 0 && (
                          <span className="block text-xs text-dark-500">
                            {Object.entries(l.specs ?? {})
                              .filter(([, v]) => v)
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-dark-600">{l.quantity.toLocaleString("en-IN")} {l.unit || "pcs"}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-dark-100 bg-white p-5 text-sm">
                <p><span className="font-bold text-dark-700">Delivery:</span> <span className="text-dark-600">{[ship.city, ship.state, ship.postalCode].filter(Boolean).join(", ")}</span></p>
                {requiredBy && <p className="mt-1"><span className="font-bold text-dark-700">Required by:</span> <span className="text-dark-600">{requiredBy}</span></p>}
                <p className="mt-1 flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5 text-dark-400" />
                  <span className="text-dark-600">
                    {files.length > 0 ? `${files.length} requirement file${files.length === 1 ? "" : "s"} attached` : "No requirement sheet"}
                  </span>
                </p>
                {notes.trim() && <p className="mt-1"><span className="font-bold text-dark-700">Notes:</span> <span className="text-dark-600">{notes}</span></p>}
              </div>
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
              {submitting ? "Sending…" : pendingDraftId ? "Retry submit" : "Submit RFQ"}
            </button>
          )}
        </div>
        <p className="mt-2 text-right text-[11px] text-dark-400">
          All products are sent together as one quotation request.
        </p>
      </div>
    </main>
  );
}
