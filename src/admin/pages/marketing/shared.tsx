// Shared building blocks for the Marketing admin pages (Coupons + Campaigns).
// Composed from the existing ERP primitives/tokens so both pages look native.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ImageOff, MoreHorizontal, Search, Upload, X, type LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { ApiError } from "@/lib/api/client";
import { catalogApi } from "@/lib/catalog-api";
import type { CampaignStatus, CouponStatus } from "@/lib/api/marketing";
import { Badge, Button } from "../../components/ui";

export const FIELD =
  "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20 disabled:opacity-60";
export const AREA = cn(FIELD, "h-auto min-h-[84px] py-2 leading-relaxed");
export const FIELD_ERR = "border-red-500 focus:border-red-500 focus:ring-red-100";
const LABEL = "mb-1.5 block text-xs font-semibold erp-text-muted";

export type FormErrors = Record<string, string | undefined>;

/** Server validation issues → a field-keyed error map (+ a form-level message). */
export function errorsFrom(e: unknown, fallback: string): FormErrors {
  const out: FormErrors = {};
  if (e instanceof ApiError && e.issues?.length) {
    for (const i of e.issues) out[i.path.split(".")[0] || "form"] ??= i.message;
    out.form = "Please fix the highlighted fields.";
    return out;
  }
  out.form = e instanceof Error ? e.message : fallback;
  if (e instanceof ApiError && e.code === "COUPON_CODE_EXISTS") out.code = e.message;
  return out;
}

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide erp-text-faint">{title}</h3>
        {hint && <p className="mt-1 text-xs erp-text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label, required, hint, error, children, className,
}: { label: string; required?: boolean; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className={LABEL}>{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-[11px] font-medium text-red-600 dark:text-red-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] erp-text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

/** On/off switch in the admin style (role=switch, keyboard operable). */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary-500" : "bg-dark-300 dark:bg-dark-600",
      )}
    >
      <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

export function SwitchRow({ title, hint, checked, onChange, disabled }: { title: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border erp-border p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold erp-text">{title}</div>
        {hint && <div className="mt-0.5 text-xs erp-text-muted">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

// ---------- status ----------

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
const STATUS_META: Record<CouponStatus | CampaignStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  usage_limit_reached: { label: "Usage limit reached", tone: "danger" },
};

export function StatusBadge({ status }: { status: CouponStatus | CampaignStatus }) {
  const m = STATUS_META[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={m.tone} dot>{m.label}</Badge>;
}

/** Summary tiles: Total / Active / Scheduled / Expired (+ optional extras). */
export function SummaryCards({ items }: { items: { label: string; value: number; icon: LucideIcon; tone?: "default" | "success" | "info" | "danger"; onClick?: () => void; active?: boolean }[] }) {
  const tones = {
    default: "bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300",
    success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
    info: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300",
    danger: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
  };
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) => {
        const body = (
          <>
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tones[it.tone ?? "default"])}>
              <it.icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-xs font-semibold erp-text-muted">{it.label}</span>
              <span className="block font-display text-2xl font-extrabold leading-tight erp-text">{it.value.toLocaleString("en-IN")}</span>
            </span>
          </>
        );
        const cls = cn("flex items-center gap-3 rounded-xl border erp-border erp-surface card-shadow p-4", it.active && "ring-2 ring-primary-500");
        return it.onClick
          ? <button key={it.label} type="button" onClick={it.onClick} aria-pressed={it.active} className={cn(cls, "transition-colors hover:erp-surface-2")}>{body}</button>
          : <div key={it.label} className={cls}>{body}</div>;
      })}
    </div>
  );
}

// ---------- row actions ----------

export interface RowAction { label: string; icon: LucideIcon; onClick: () => void; danger?: boolean; hidden?: boolean }

// Only one row menu may be open at a time: opening another closes it.
const closeOpenMenu = { current: null as null | (() => void) };

export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = actions.filter((a) => !a.hidden);

  // The menu is portalled with fixed coordinates: tables scroll horizontally
  // (overflow-x-auto), which would otherwise clip a dropdown on the last rows.
  const toggle = () => {
    if (pos) return setPos(null);
    closeOpenMenu.current?.();
    closeOpenMenu.current = () => setPos(null);
    const r = btnRef.current!.getBoundingClientRect();
    const height = visible.length * 40 + 10;
    const up = r.bottom + height + 8 > window.innerHeight && r.top > height;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, right: Math.max(window.innerWidth - r.right, 8), up });
  };

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [pos]);

  return (
    <div className="flex justify-end">
      <button
        ref={btnRef} type="button" onClick={toggle} aria-label={label} aria-expanded={!!pos} aria-haspopup="menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {pos && createPortal(
        <div
          ref={menuRef} role="menu"
          style={{ position: "fixed", right: pos.right, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          className="z-[55] w-48 overflow-hidden rounded-lg border erp-border erp-surface py-1 shadow-lg"
        >
          {visible.map((a) => (
            <button
              key={a.label} role="menuitem" type="button"
              onClick={() => { setPos(null); a.onClick(); }}
              className={cn("flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:erp-surface-2", a.danger ? "text-red-600 dark:text-red-400" : "erp-text")}
            >
              <a.icon className={cn("h-4 w-4", !a.danger && "erp-text-faint")} aria-hidden /> {a.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------- searchable pickers (existing products / categories) ----------

export interface PickOption { id: string; label: string; sub?: string }

/**
 * Search + select from real catalog rows. `multiple` keeps a chip list; single
 * mode replaces the selection. Options come from the existing stores — nothing
 * is typed by hand, so an admin can never point at a product that doesn't exist.
 */
export function EntityPicker({
  options, value, onChange, multiple, placeholder, error, emptyText = "Nothing found",
}: {
  options: PickOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  placeholder: string;
  error?: boolean;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle ? options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(needle)) : options;
    return pool.slice(0, 40);
  }, [options, q]);

  const toggle = (id: string) => {
    if (!multiple) { onChange([id]); setOpen(false); setQ(""); return; }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <div ref={ref} className="relative">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md border erp-border erp-surface-2 py-0.5 pl-2 pr-1 text-xs font-semibold erp-text">
              <span className="truncate">{byId.get(id)?.label ?? id}</span>
              <button type="button" onClick={() => onChange(value.filter((v) => v !== id))} aria-label={`Remove ${byId.get(id)?.label ?? id}`} className="flex h-5 w-5 items-center justify-center rounded hover:erp-surface">
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 erp-text-faint" aria-hidden />
        <input
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={placeholder} role="combobox" aria-expanded={open} aria-autocomplete="list"
          className={cn(FIELD, "pl-9", error && FIELD_ERR)}
        />
      </div>
      {open && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border erp-border erp-surface py-1 shadow-lg">
          {matches.length === 0 && <li className="px-3 py-2 text-sm erp-text-muted">{emptyText}</li>}
          {matches.map((o) => {
            const on = value.includes(o.id);
            return (
              <li key={o.id} role="option" aria-selected={on}>
                <button type="button" onClick={() => toggle(o.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm erp-text hover:erp-surface-2">
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border erp-border", on && "border-primary-500 bg-primary-500 text-white")}>
                    {on && <Check className="h-3 w-3" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.sub && <span className="shrink-0 font-mono text-[11px] erp-text-faint">{o.sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- image upload (existing /uploads storage pipeline) ----------

const ACCEPT = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // matches the server's IMAGE_MAX_BYTES
const MIN_WIDTH = 320;
const MAX_EDGE = 6000;

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const dimensionsOf = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This file is not a readable image.")); };
    img.src = url;
  });

/**
 * One campaign image. Validates type, size and dimensions, uploads through the
 * existing storage pipeline (the DB only ever stores the returned URL), shows
 * a preview, and lets the admin replace or remove it.
 */
export function CampaignImageField({
  label, value, onChange, hint, error, required,
}: { label: string; value: string | null; onChange: (url: string | null) => void; hint?: string; error?: string; required?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setLocalError(null);
    try {
      if (!ACCEPT.includes(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
      if (file.size > MAX_BYTES) throw new Error("The image is larger than 10 MB.");
      const { width, height } = await dimensionsOf(file);
      if (width < MIN_WIDTH) throw new Error(`The image is only ${width}px wide — use at least ${MIN_WIDTH}px.`);
      if (width > MAX_EDGE || height > MAX_EDGE) throw new Error(`The image is ${width}×${height}px — keep each side under ${MAX_EDGE}px.`);
      setBusy(true);
      const url = await catalogApi.uploadImage(file.name, file.type, await fileToBase64(file));
      setMeta(`${width}×${height}px · ${(file.size / 1024).toFixed(0)} KB`);
      onChange(url);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const shown = localError ?? error;
  return (
    <div className="min-w-0">
      <span className={LABEL}>{label}{required && <span className="text-red-500"> *</span>}</span>
      <div className={cn("flex flex-col gap-3 rounded-lg border border-dashed erp-border p-3 sm:flex-row sm:items-center", shown && "border-red-500")}>
        <div className="flex h-24 w-full shrink-0 items-center justify-center overflow-hidden rounded-md erp-surface-2 sm:w-40">
          {value
            ? <img src={value} alt="" className="h-full w-full object-cover" />
            : <ImageOff className="h-6 w-6 erp-text-faint" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" icon={Upload} loading={busy} onClick={() => inputRef.current?.click()}>
              {value ? "Replace image" : "Upload image"}
            </Button>
            {value && <Button type="button" size="sm" variant="ghost" icon={X} onClick={() => { onChange(null); setMeta(null); }}>Remove</Button>}
          </div>
          <p className="mt-2 text-[11px] erp-text-faint">{meta ?? hint ?? "JPG, PNG or WebP · up to 10 MB · at least 320px wide"}</p>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} aria-label={label} />
      </div>
      {shown && <span role="alert" className="mt-1 block text-[11px] font-medium text-red-600 dark:text-red-400">{shown}</span>}
    </div>
  );
}
