import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronRight, PackageSearch, type LucideIcon } from "lucide-react";

// ============================================================
// Zolo storefront primitives.
//
// Every visual rule lives in src/index.css (@theme tokens + @utility classes:
// btn / btn-primary…, input, card, section, h1/h2/h3, eyebrow, skeleton).
// These components only compose those classes so a page never invents its own
// button, input or card. Colour intent: green = brand/selected/success,
// orange = conversion CTA, navy = dark bands, cream/mint = supporting surfaces.
// ============================================================

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Section heading block: eyebrow + H2 + optional lead. Compact, left by default. */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "left",
  action,
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
  /** Optional right-aligned action (e.g. "View all →") on desktop. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35 }}
      className={cx("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", align === "center" && "sm:flex-col sm:items-center text-center", className)}
    >
      <div className={cx("max-w-2xl", align === "center" && "mx-auto")}>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 className="h2 text-dark-900">{title}</h2>
        {subtitle && <p className="lead mt-2">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </motion.div>
  );
}

export type ButtonVariant = "primary" | "secondary" | "green" | "navy" | "outline" | "ghost" | "white";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  green: "btn-green",
  navy: "btn-navy",
  outline: "btn-outline",
  ghost: "btn-ghost",
  white: "btn-white",
};
const SIZE: Record<ButtonSize, string> = { sm: "btn-sm", md: "", lg: "btn-lg" };

/** Class string for a button-styled element (use on <Link>/<a>). */
export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") =>
  cx("btn", VARIANT[variant], SIZE[size], className);

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  icon: Icon,
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  icon?: LucideIcon;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </button>
  );
}

/** Router link styled as a button. */
export function ButtonLink({
  to,
  children,
  variant = "primary",
  size = "md",
  className = "",
  icon: Icon,
  ...rest
}: {
  to: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  icon?: LucideIcon;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)} {...rest}>
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </Link>
  );
}

export function Chip({
  active,
  onClick,
  children,
  className = "",
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cx("chip", active && "chip-active", className)}>
      {children}
    </button>
  );
}

// ---------- Forms ----------

export function Label({ children, htmlFor, required, className = "" }: { children: ReactNode; htmlFor?: string; required?: boolean; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cx("label", className)}>
      {children}{required && <span className="ml-0.5 text-primary-600">*</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: string }>(function Input({ className = "", error, ...rest }, ref) {
  return <input ref={ref} className={cx("input", className)} aria-invalid={error ? true : rest["aria-invalid"]} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }>(function Textarea({ className = "", error, ...rest }, ref) {
  return <textarea ref={ref} className={cx("input min-h-28 resize-y", className)} aria-invalid={error ? true : rest["aria-invalid"]} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = "", children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx("input appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px_16px] bg-[right_0.75rem_center] bg-no-repeat pr-9", className)} {...rest}>
      {children}
    </select>
  );
});

/** Label + control + error, stacked. */
export function Field({ label, htmlFor, required, error, hint, children, className = "" }: { label: ReactNode; htmlFor?: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} required={required}>{label}</Label>
      {children}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="mt-1.5 text-xs text-dark-500">{hint}</p> : null}
    </div>
  );
}

// ---------- Surfaces ----------

export function Card({ children, className = "", hover = false, as: Tag = "div" }: { children: ReactNode; className?: string; hover?: boolean; as?: "div" | "article" | "section" | "aside" }) {
  return <Tag className={cx("card", hover && "card-hover", className)}>{children}</Tag>;
}

export function Badge({ children, tone = "green", className = "" }: { children: ReactNode; tone?: "green" | "orange" | "navy" | "neutral" | "red" | "amber"; className?: string }) {
  const tones = {
    green: "bg-green-100 text-green-600",
    orange: "bg-primary-500 text-white",
    navy: "bg-navy-900 text-white",
    neutral: "bg-dark-100 text-dark-600",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return <span className={cx("badge", tones[tone], className)}>{children}</span>;
}

export function Breadcrumb({ items, className = "" }: { items: { label: string; to?: string }[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cx("flex flex-wrap items-center gap-1 text-xs text-dark-500", className)}>
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-dark-300" aria-hidden />}
          {it.to && i < items.length - 1
            ? <Link to={it.to} className="hover:text-green-600">{it.label}</Link>
            : <span className="font-semibold text-dark-800">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function EmptyState({ icon: Icon = PackageSearch, title, message, action, className = "" }: { icon?: LucideIcon; title: string; message?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("card flex flex-col items-center px-6 py-10 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600"><Icon className="h-6 w-6" aria-hidden /></span>
      <h3 className="mt-4 text-base font-bold text-dark-900">{title}</h3>
      {message && <p className="mt-1.5 max-w-sm text-sm text-dark-500">{message}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry, className = "" }: { title?: string; message?: ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <div className={cx("card flex flex-col items-center border-red-200 bg-red-50/40 px-6 py-8 text-center", className)} role="alert">
      <h3 className="text-base font-bold text-dark-900">{title}</h3>
      {message && <p className="mt-1.5 max-w-sm text-sm text-dark-500">{message}</p>}
      {onRetry && <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Product-card shaped skeleton (image, title, spec lines, price). */
export function ProductCardSkeleton() {
  return (
    <div className="card-flat overflow-hidden" aria-hidden>
      <div className="skeleton aspect-[4/3] rounded-none" />
      <div className="space-y-2 p-4">
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton h-4 w-4/5" />
        <div className="skeleton h-3 w-2/3" />
        <div className="skeleton h-3 w-1/2" />
        <div className="mt-3 flex items-center justify-between">
          <div className="skeleton h-5 w-16" />
          <div className="skeleton h-9 w-24" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid-cards">
      {Array.from({ length: count }, (_, i) => <ProductCardSkeleton key={i} />)}
    </div>
  );
}

// Legacy ProductCard wrapper that uses NewProductCard
export { ProductCard } from "./NewProductCard";
