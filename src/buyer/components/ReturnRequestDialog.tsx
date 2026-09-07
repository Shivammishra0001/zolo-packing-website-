import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Leaf, Paperclip, RotateCcw, X } from "lucide-react";
import { Button, Dialog, Select } from "@/admin/components/ui";
import { useToast } from "@/components/ui/Toast";
import { addressApi, type Address } from "@/lib/api/commerce";
import { describeApiError } from "@/lib/api/client";
import { fileToUploadPayload } from "@/lib/api/rfq";
import {
  returnsApi,
  RETURN_REASON_LABELS,
  RETURN_CONDITION_LABELS,
  type ReturnKind,
} from "@/lib/api/returns";

// ============================================================
// Customer "Return / Recycle" dialog — the ONLY way a request is born.
// Step 1: choose Return vs Recycle-&-earn-points.
// Step 2: quantity / reason / condition / photos / pickup address.
// Recycle shows a backend-computed points ESTIMATE (final points are decided
// by inspection of the accepted quantity — never by this screen).
// ============================================================

const INPUT = "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500";

export interface ReturnableItem {
  id: string;
  productName: string;
  quantity: number;
}

export function ReturnRequestDialog({
  item,
  onClose,
  onCreated,
}: {
  item: ReturnableItem;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<ReturnKind | null>(null);
  const [quantity, setQuantity] = useState(item.quantity);
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState("");
  const [description, setDescription] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [estimate, setEstimate] = useState<{ points: number; note: string } | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    addressApi
      .list()
      .then((list) => {
        setAddresses(list);
        const def = list.find((a) => a.isDefault) ?? list[0];
        if (def) setAddressId(def.id);
      })
      .catch(() => setAddresses([]));
  }, []);

  // Backend-computed estimate (and remaining returnable quantity).
  useEffect(() => {
    if (!quantity || quantity < 1) return;
    let stale = false;
    returnsApi
      .estimate(item.id, quantity)
      .then((e) => {
        if (stale) return;
        setRemaining(e.remaining);
        setEstimate({ points: e.estimatedPoints, note: e.note });
      })
      .catch(() => setEstimate(null));
    return () => { stale = true; };
  }, [item.id, quantity]);

  const reasons = useMemo(
    () => Object.entries(RETURN_REASON_LABELS).filter(([k]) => (kind === "RECYCLE" ? true : k !== "recycle")),
    [kind],
  );

  const valid =
    kind !== null &&
    quantity >= 1 &&
    (remaining == null || quantity <= remaining) &&
    reason !== "" &&
    condition !== "" &&
    addressId !== "";

  const submit = async () => {
    if (!valid || !kind) return;
    setBusy(true);
    try {
      const created = await returnsApi.create({
        orderItemId: item.id,
        type: kind,
        quantity,
        reason,
        condition,
        description: description.trim() || undefined,
        pickupAddressId: addressId,
      });
      // Photos attach after creation; a failed upload never sinks the request.
      for (const f of files) {
        try {
          await returnsApi.attachFile(created.id, await fileToUploadPayload(f));
        } catch (e) {
          toast.error(`Couldn't attach ${f.name}`, describeApiError(e).message);
        }
      }
      toast.success(
        kind === "RECYCLE" ? "Recycling request submitted successfully." : "Return request submitted successfully.",
        `${created.requestNumber} · ${item.productName} × ${quantity}`,
      );
      onCreated();
    } catch (e) {
      toast.error("Couldn't submit your request", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === null ? "What would you like to do?" : kind === "RECYCLE" ? "Recycle & earn points" : "Return product"}
      description={`${item.productName} — ${item.quantity.toLocaleString("en-IN")} unit(s) purchased`}
      footer={
        kind === null ? (
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setKind(null)}>Back</Button>
            <Button variant="primary" onClick={() => void submit()} disabled={!valid || busy}>
              {busy ? "Submitting…" : kind === "RECYCLE" ? "Submit Recycling Request" : "Submit Return Request"}
            </Button>
          </>
        )
      }
    >
      {kind === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => { setKind("RETURN"); setReason(""); }}
            className="rounded-xl border-2 erp-border p-4 text-left transition hover:border-primary-400"
          >
            <RotateCcw className="h-6 w-6 text-primary-500" aria-hidden />
            <p className="mt-2 text-sm font-bold erp-text">Return Product</p>
            <p className="mt-1 text-xs erp-text-muted">Damaged, defective or wrong item — request a refund or replacement.</p>
          </button>
          <button
            type="button"
            onClick={() => { setKind("RECYCLE"); setReason("recycle"); }}
            className="rounded-xl border-2 erp-border p-4 text-left transition hover:border-emerald-400"
          >
            <Leaf className="h-6 w-6 text-emerald-500" aria-hidden />
            <p className="mt-2 text-sm font-bold erp-text">Recycle & Earn Points</p>
            <p className="mt-1 text-xs erp-text-muted">Send used packaging back for recycling and earn ZP reward points.</p>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold erp-text-muted">Quantity</span>
              <input
                type="number"
                min={1}
                max={remaining ?? item.quantity}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className={`mt-1 ${INPUT}`}
              />
              {remaining != null && (
                <span className="mt-0.5 block text-[11px] erp-text-faint">{remaining.toLocaleString("en-IN")} unit(s) still eligible</span>
              )}
            </label>
            <label className="block">
              <span className="text-xs font-semibold erp-text-muted">Condition</span>
              <Select value={condition} onChange={setCondition} aria-label="Condition" className="mt-1 w-full">
                <option value="">Select…</option>
                {Object.entries(RETURN_CONDITION_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </Select>
            </label>
          </div>

          {kind === "RETURN" && (
            <label className="block">
              <span className="text-xs font-semibold erp-text-muted">Reason</span>
              <Select value={reason} onChange={setReason} aria-label="Reason" className="mt-1 w-full">
                <option value="">Select…</option>
                {reasons.map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </Select>
            </label>
          )}

          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Description (optional)</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what happened…"
              className={`mt-1 ${INPUT} h-auto py-2`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold erp-text-muted">Pickup address</span>
            {addresses.length === 0 ? (
              <p className="mt-1 text-xs erp-text-muted">
                No saved addresses — <Link to="/account/settings" className="font-bold text-primary-600 hover:underline">add one in Settings</Link> first.
              </p>
            ) : (
              <Select value={addressId} onChange={setAddressId} aria-label="Pickup address" className="mt-1 w-full">
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.line1}, {a.city} {a.postalCode}{a.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </Select>
            )}
          </label>

          {/* Photos */}
          <div>
            <span className="text-xs font-semibold erp-text-muted">Photos (optional, up to 5)</span>
            <input
              ref={fileInput}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              multiple
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).filter((f) => f.size <= 10 * 1024 * 1024);
                setFiles((cur) => [...cur, ...picked].slice(0, 5));
                if (fileInput.current) fileInput.current.value = "";
              }}
            />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" icon={Paperclip} onClick={() => fileInput.current?.click()}>
                Add photos
              </Button>
              {files.map((f) => (
                <span key={`${f.name}-${f.size}`} className="inline-flex items-center gap-1 rounded-full bg-dark-50 px-2.5 py-1 text-[11px] font-semibold erp-text-muted dark:bg-white/10">
                  {f.name}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {kind === "RECYCLE" && estimate && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <p className="font-bold text-emerald-700 dark:text-emerald-300">
                Estimated Recycling Reward: {estimate.points.toLocaleString("en-IN")} ZP points
              </p>
              <p className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-300/80">{estimate.note}</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
