import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Loader2, Search, X, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";

// ============================================================
// Shared ERP UI primitives — theme-aware, accessible, reusable.
// Every module page composes these; they define the design language.
// ============================================================

// ---------- Button ----------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-500 text-white hover:bg-primary-600 focus-visible:outline-primary-500 shadow-sm shadow-primary-500/20",
  secondary:
    "border erp-border erp-surface erp-text hover:erp-surface-2 focus-visible:outline-primary-500",
  ghost: "erp-text-muted hover:erp-surface-2 hover:erp-text focus-visible:outline-primary-500",
  danger: "bg-red-500 text-white hover:bg-red-600 focus-visible:outline-red-500",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-xs gap-1.5",
  md: "min-h-11 px-4 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className={cn(size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4", "animate-spin")} aria-hidden />
      ) : (
        Icon && <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
      )}
      {children}
    </button>
  );
}

// ---------- Badge / chip ----------

type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "erp-surface-2 erp-text-muted border-transparent",
  primary: "bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-500/10 dark:text-primary-300 dark:border-primary-500/20",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
  warning: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
  danger: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20",
  info: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  dot,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />}
      {children}
    </span>
  );
}

// ---------- Breadcrumb ----------

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs erp-text-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.to && !last ? (
                <Link to={c.to} className="hover:erp-text hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className={cn(last && "font-semibold erp-text")} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="h-3 w-3 erp-text-faint" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------- Page header ----------

export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6">
      {breadcrumb && <Breadcrumb items={breadcrumb} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-extrabold tracking-tight erp-text sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm erp-text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ---------- Tabs (in-page, controlled) ----------

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
}

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("border-b erp-border", className)} role="tablist">
      <div className="flex gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(t.key)}
              className={cn(
                "relative flex min-h-11 items-center gap-2 whitespace-nowrap px-3.5 text-sm font-semibold transition-colors",
                selected ? "erp-text" : "erp-text-muted hover:erp-text",
              )}
            >
              {t.icon && <t.icon className="h-4 w-4" aria-hidden />}
              {t.label}
              {t.count !== undefined && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    selected ? "bg-primary-100 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300" : "erp-surface-2 erp-text-faint",
                  )}
                >
                  {t.count}
                </span>
              )}
              {selected && <span className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-primary-500" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Search input ----------

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 erp-text-faint" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border erp-border erp-surface pl-9 pr-3 text-sm erp-text outline-none transition-colors placeholder:erp-text-faint focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20"
        {...rest}
      />
    </div>
  );
}

// ---------- Select (native, styled) ----------

export function Select({
  value,
  onChange,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 rounded-lg border erp-border erp-surface px-3 text-sm font-medium erp-text outline-none transition-colors focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20",
        className,
      )}
    >
      {children}
    </select>
  );
}

// ---------- Toolbar (filters row above tables) ----------

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 sm:gap-3", className)}>{children}</div>
  );
}

// ---------- Overlay (portal + scroll lock + escape) ----------

function useOverlay(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

// ---------- Drawer (side sheet) ----------

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Details"}>
      <div className="absolute inset-0 bg-dark-950/50 backdrop-blur-sm animate-[fade-up_.15s_ease-out]" onClick={onClose} aria-hidden />
      <div className={cn("absolute inset-y-0 right-0 flex w-full flex-col erp-surface shadow-2xl", width)}>
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b erp-border px-5">
          <h2 className="text-base font-bold erp-text">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="shrink-0 border-t erp-border px-5 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Dialog (centered modal) ----------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-dark-950/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md rounded-xl erp-surface p-5 shadow-2xl animate-[fade-up_.18s_ease-out]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold erp-text">{title}</h2>
            {description && <p className="mt-1 text-sm erp-text-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg erp-text-muted hover:erp-surface-2"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Pagination ----------

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t erp-border px-4 py-3">
      <p className="text-xs erp-text-muted">
        Showing <span className="font-semibold erp-text">{from}</span>–
        <span className="font-semibold erp-text">{to}</span> of{" "}
        <span className="font-semibold erp-text">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="px-2 text-xs font-semibold erp-text-muted">
          {page} / {Math.max(pageCount, 1)}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------- Timeline (audit / activity) ----------

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  meta?: ReactNode;
  time: string;
  tone?: BadgeTone;
  icon?: LucideIcon;
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const DOT_TONE: Record<BadgeTone, string> = {
    neutral: "bg-dark-300 dark:bg-dark-600",
    primary: "bg-primary-500",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
    info: "bg-sky-500",
  };
  return (
    <ol className="relative space-y-4 pl-6">
      <span className="absolute left-[7px] top-1.5 bottom-1.5 w-px erp-border border-l" aria-hidden />
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span
            className={cn(
              "absolute -left-[22px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4",
              DOT_TONE[e.tone ?? "neutral"],
            )}
            style={{ boxShadow: "0 0 0 4px var(--erp-surface)" }}
            aria-hidden
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm erp-text">{e.title}</p>
            <time className="text-xs erp-text-faint">{e.time}</time>
          </div>
          {e.meta && <p className="mt-0.5 text-xs erp-text-muted">{e.meta}</p>}
        </li>
      ))}
    </ol>
  );
}

// ---------- Stat / KV list ----------

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium erp-text-muted">{it.label}</dt>
          <dd className="text-sm font-semibold erp-text">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
