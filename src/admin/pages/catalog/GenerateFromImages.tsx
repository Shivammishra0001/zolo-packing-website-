import { useEffect, useMemo, useState } from "react";
import { Sparkles, CheckCircle2, AlertTriangle, XCircle, Loader2, Image as ImageIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog } from "../../components/ui";
import { hydrateCatalog } from "../../catalog-store";
import { aiProductsApi, type AiAnalysis } from "@/lib/api/ai-products";

// The repo images are served by the API at /uploads only after a copy is made;
// for the SELECTION grid we show the analysis's uploaded copy when present, else
// a neutral icon (the raw repo file isn't publicly served).
function ImgThumb({ url, size = "h-12 w-12" }: { url?: string | null; size?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    return <span className={cn(size, "flex items-center justify-center rounded-lg erp-surface-2")}><ImageIcon className="h-4 w-4 erp-text-faint" /></span>;
  }
  return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className={cn(size, "rounded-lg object-cover erp-surface-2")} />;
}

const statusMeta = (s: AiAnalysis["status"]) => {
  if (s === "ANALYZED") return { icon: CheckCircle2, tone: "success" as const, label: "Ready for review", color: "text-emerald-500" };
  if (s === "REVIEW_REQUIRED") return { icon: AlertTriangle, tone: "warning" as const, label: "Requires review", color: "text-amber-500" };
  if (s === "APPROVED") return { icon: CheckCircle2, tone: "info" as const, label: "Approved (draft created)", color: "text-sky-500" };
  if (s === "REJECTED") return { icon: XCircle, tone: "danger" as const, label: "Rejected", color: "text-red-500" };
  return { icon: AlertTriangle, tone: "neutral" as const, label: s, color: "erp-text-faint" };
};

export function GenerateFromImagesButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"select" | "review">("select");
  const [images, setImages] = useState<{ filename: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [analyses, setAnalyses] = useState<AiAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // per-card admin edits (name/sku/category) keyed by analysis id
  const [edits, setEdits] = useState<Record<string, { name?: string; sku?: string; category?: string }>>({});

  const load = () => {
    setLoading(true);
    aiProductsApi.listImages()
      .then((r) => setImages(r.images))
      .catch((e) => toast.error("Couldn't scan images", e instanceof Error ? e.message : ""))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (open && step === "select") load(); /* eslint-disable-next-line */ }, [open]);

  const reset = () => { setStep("select"); setSelected(new Set()); setAnalyses([]); setEdits({}); };
  const close = () => { setOpen(false); reset(); };

  const toggle = (f: string) => setSelected((prev) => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });
  const selectAll = () => setSelected(new Set(images.map((i) => i.filename)));

  const runAnalyze = async () => {
    if (selected.size === 0) return;
    setLoading(true);
    try {
      const res = await aiProductsApi.analyze([...selected]);
      // Show only the analyses for the images we just selected.
      const wanted = new Set(selected);
      setAnalyses(res.analyses.filter((a) => wanted.has(a.sourceName)));
      setStep("review");
    } catch (e) {
      toast.error("Analysis failed", e instanceof Error ? e.message : "");
    } finally { setLoading(false); }
  };

  const editOf = (a: AiAnalysis) => ({
    name: edits[a.id]?.name ?? a.name ?? "",
    sku: edits[a.id]?.sku ?? a.suggestedSku ?? "",
    category: edits[a.id]?.category ?? a.category ?? "",
  });
  const setEdit = (id: string, patch: Partial<{ name: string; sku: string; category: string }>) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  const approve = async (a: AiAnalysis) => {
    const e = editOf(a);
    if (!e.name.trim()) { toast.error("Name required", "Enter a product name before approving."); return; }
    setBusyId(a.id);
    try {
      const r = await aiProductsApi.approve(a.id, { name: e.name.trim(), sku: e.sku.trim() || undefined, category: e.category.trim() || undefined });
      setAnalyses((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: "APPROVED", productId: r.product?.id ?? null } : x)));
      toast.success("Draft created", `${r.sku} added as a DRAFT for review.`);
      await hydrateCatalog();
    } catch (err) {
      toast.error("Couldn't approve", err instanceof Error ? err.message : "");
    } finally { setBusyId(null); }
  };

  const reject = async (a: AiAnalysis) => {
    setBusyId(a.id);
    try {
      await aiProductsApi.reject(a.id);
      setAnalyses((prev) => prev.map((x) => (x.id === a.id ? { ...x, status: "REJECTED" } : x)));
    } catch (err) {
      toast.error("Couldn't reject", err instanceof Error ? err.message : "");
    } finally { setBusyId(null); }
  };

  // Bulk approve — only the high-confidence ANALYZED cards (never REVIEW_REQUIRED).
  const approvable = analyses.filter((a) => a.status === "ANALYZED");
  const approveAll = async () => {
    if (approvable.length === 0) return;
    if (!window.confirm(`Create ${approvable.length} draft product(s)? They stay in DRAFT until you publish them.`)) return;
    for (const a of approvable) await approve(a);
  };

  const counts = useMemo(() => ({
    ready: analyses.filter((a) => a.status === "ANALYZED").length,
    review: analyses.filter((a) => a.status === "REVIEW_REQUIRED").length,
    approved: analyses.filter((a) => a.status === "APPROVED").length,
  }), [analyses]);

  return (
    <>
      <Button variant="secondary" icon={Sparkles} onClick={() => setOpen(true)}>Generate from Images</Button>
      <Dialog
        open={open}
        onClose={close}
        title="Generate products from images"
        description="Analyze existing catalog images to create DRAFT products. Nothing is published — you review and approve each one."
        footer={
          step === "select" ? (
            <>
              <span className="mr-auto text-xs erp-text-muted">{selected.size} selected · {images.length} images</span>
              <Button variant="ghost" onClick={selectAll} disabled={images.length === 0}>Select all</Button>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button variant="primary" icon={Sparkles} disabled={selected.size === 0} loading={loading} onClick={runAnalyze}>
                Analyze {selected.size || ""} Image{selected.size === 1 ? "" : "s"}
              </Button>
            </>
          ) : (
            <>
              <span className="mr-auto text-xs erp-text-muted">
                {counts.ready} ready · {counts.review} need review · {counts.approved} approved
              </span>
              <Button variant="ghost" onClick={() => { setStep("select"); setAnalyses([]); }}>Back</Button>
              <Button variant="secondary" disabled={approvable.length === 0} onClick={approveAll}>Approve all ready ({approvable.length})</Button>
              <Button variant="primary" onClick={close}>Done</Button>
            </>
          )
        }
      >
        {step === "select" ? (
          <div className="space-y-3">
            {loading ? (
              <div className="py-10 text-center text-sm erp-text-muted"><Loader2 className="mx-auto h-5 w-5 animate-spin" /> Scanning images…</div>
            ) : images.length === 0 ? (
              <div className="py-10 text-center text-sm erp-text-muted">No product images found in the image library.</div>
            ) : (
              <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {images.map((img) => {
                  const on = selected.has(img.filename);
                  return (
                    <button
                      key={img.filename}
                      onClick={() => toggle(img.filename)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors",
                        on ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10" : "erp-border erp-surface-2 hover:erp-surface",
                      )}
                    >
                      <span className={cn("flex h-10 w-10 items-center justify-center rounded-md erp-surface", on && "ring-2 ring-primary-500")}>
                        {on ? <CheckCircle2 className="h-5 w-5 text-primary-500" /> : <ImageIcon className="h-4 w-4 erp-text-faint" />}
                      </span>
                      <span className="w-full truncate text-[10px] erp-text-muted" title={img.filename}>{img.filename}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-xs erp-text-faint">
              Analysis is rule-based (from filename + your catalog categories) — no external AI, no cost. Images with unclear names are flagged “Requires review”.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {analyses.map((a) => {
              const m = statusMeta(a.status);
              const e = editOf(a);
              const done = a.status === "APPROVED" || a.status === "REJECTED";
              return (
                <div key={a.id} className={cn("rounded-xl border p-3", done ? "erp-border-soft opacity-70" : "erp-border")}>
                  <div className="flex gap-3">
                    <ImgThumb url={a.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <m.icon className={cn("h-4 w-4 shrink-0", m.color)} />
                        <Badge tone={m.tone}>{m.label}</Badge>
                        {typeof a.confidence?.overall === "number" && (
                          <span className="text-[11px] erp-text-muted">Confidence {a.confidence.overall}%</span>
                        )}
                        {a.isNewCategory && a.category && <Badge tone="warning">New category</Badge>}
                        <span className="ml-auto truncate text-[11px] erp-text-faint" title={a.sourceName}>{a.sourceName}</span>
                      </div>

                      {a.reviewReason && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{a.reviewReason}</p>}

                      {!done && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className="block">
                            <span className="mb-0.5 block text-[10px] font-bold uppercase erp-text-faint">Name</span>
                            <input value={e.name} onChange={(ev) => setEdit(a.id, { name: ev.target.value })} placeholder="Product name" className="w-full rounded-md border erp-border erp-surface px-2 py-1 text-xs erp-text" />
                          </label>
                          <label className="block">
                            <span className="mb-0.5 block text-[10px] font-bold uppercase erp-text-faint">SKU</span>
                            <input value={e.sku} onChange={(ev) => setEdit(a.id, { sku: ev.target.value })} placeholder="auto" className="w-full rounded-md border erp-border erp-surface px-2 py-1 font-mono text-xs erp-text" />
                          </label>
                          <label className="block">
                            <span className="mb-0.5 block text-[10px] font-bold uppercase erp-text-faint">Category</span>
                            <input value={e.category} onChange={(ev) => setEdit(a.id, { category: ev.target.value })} placeholder="Category" className="w-full rounded-md border erp-border erp-surface px-2 py-1 text-xs erp-text" />
                          </label>
                        </div>
                      )}

                      {(a.material || a.tags.length > 0) && (
                        <p className="mt-1.5 text-[11px] erp-text-muted">
                          {a.material && <>Material: <span className="erp-text">{a.material}</span> · </>}
                          {a.tags.slice(0, 4).join(", ")}
                        </p>
                      )}

                      {!done && (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="primary" disabled={busyId === a.id} onClick={() => approve(a)}>Approve → Draft</Button>
                          <Button size="sm" variant="ghost" disabled={busyId === a.id} onClick={() => reject(a)}>Reject</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-xs erp-text-faint">
              Approved items become <strong>DRAFT</strong> products in the catalog. Nothing is published until you set a product to Active.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
