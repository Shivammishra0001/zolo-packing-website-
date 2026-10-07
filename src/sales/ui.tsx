import type { ReactNode } from "react";

// Shared primitives for the field-sales portal.
//
// Designed for one-handed use on an Android phone in a warehouse: every
// control is at least 44px tall (WCAG 2.2 AA 2.5.8), labels sit above inputs
// rather than beside them, and numeric fields open the numeric keypad.
// Colours come from the design-system tokens in index.css — no new palette.

/**
 * Money: paise -> "₹62,500". Never does arithmetic; the server owns totals.
 *
 * Paise are shown only when they are non-zero, so a total reads "₹62,500" but
 * a unit price reads "₹12.50" — rounding the latter to ₹13 misrepresents the
 * price the rep just quoted to the customer.
 */
export const inrMinor = (minor: number) => {
  const paise = Math.round(minor ?? 0);
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

export function Field({
  label, hint, children, required,
}: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-dark-800">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-dark-500">{hint}</span>}
    </label>
  );
}

const inputBase =
  "w-full rounded-xl border border-dark-200 bg-white px-4 text-[16px] text-dark-900 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-100 disabled:bg-dark-50";

/**
 * 16px text is deliberate: iOS Safari zooms the whole page when a focused
 * input is smaller, which throws off a one-handed flow.
 */
export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} h-12 ${props.className ?? ""}`} />;
}

/** Numeric entry — opens the phone's number pad, not the full keyboard. */
export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      className={`${inputBase} h-14 text-right text-lg font-bold tabular-nums ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} py-3 ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputBase} h-12 pr-10 ${props.className ?? ""}`} />;
}

/** Large tap-to-choose tile. Replaces dropdowns wherever the options are few. */
export function ChoiceTile({
  selected, onClick, children, sub,
}: { selected: boolean; onClick: () => void; children: ReactNode; sub?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center rounded-xl border-2 px-3 py-3 text-sm font-bold transition ${
        selected
          ? "border-green-500 bg-green-50 text-green-700"
          : "border-dark-200 bg-white text-dark-700 active:bg-dark-50"
      }`}
    >
      {children}
      {sub && <span className="mt-0.5 text-xs font-medium opacity-70">{sub}</span>}
    </button>
  );
}

export function PrimaryButton({
  children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 text-base font-bold text-white shadow-[var(--shadow-cta)] transition active:bg-primary-600 disabled:opacity-50 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border border-dark-200 bg-white px-4 text-sm font-bold text-dark-700 transition active:bg-dark-50 disabled:opacity-50 ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

/** Step progress. Tells the rep how much is left — the spec's 1–3 minute goal. */
export function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Step ${current + 1} of ${labels.length}`}>
      {labels.map((l, i) => (
        <li key={l} className="flex-1">
          <div
            className={`h-1.5 rounded-full ${i <= current ? "bg-green-500" : "bg-dark-200"}`}
            // The bar is decorative; the <ol> label carries the real status.
            aria-hidden
          />
          <span className={`mt-1 block truncate text-[10px] font-semibold ${i === current ? "text-green-700" : "text-dark-400"}`}>
            {l}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

export function Empty({ icon, title, body }: { icon: ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="text-dark-300">{icon}</div>
      <p className="mt-3 text-base font-bold text-dark-800">{title}</p>
      {body && <p className="mt-1 text-sm text-dark-500">{body}</p>}
    </div>
  );
}
