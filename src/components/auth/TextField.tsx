import { forwardRef, useId } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  icon?: LucideIcon;
}

/** Labelled text/email/tel input shared by both auth forms */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, error, icon: Icon, id, className, ...props }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;
    return (
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="block text-sm font-semibold text-dark-700 dark:text-dark-200">
          {label}
        </label>
        <div className="relative">
          {Icon && (
            <Icon
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400"
              aria-hidden
            />
          )}
          <input
            {...props}
            ref={ref}
            id={inputId}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "h-11 w-full rounded-xl border bg-white/70 pr-3.5 text-sm text-dark-900 outline-none transition-all placeholder:text-dark-400",
              Icon ? "pl-10" : "pl-3.5",
              "focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
              "dark:bg-dark-800/60 dark:text-white dark:placeholder:text-dark-500 dark:focus:ring-primary-500/20",
              error
                ? "border-red-400 focus:border-red-500 focus:ring-red-100 dark:focus:ring-red-500/20"
                : "border-dark-200 dark:border-dark-700",
              className,
            )}
          />
        </div>
        {error && (
          <p id={errorId} className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  icon?: LucideIcon;
  placeholder?: string;
  options: readonly string[];
}

/** Labelled select — used for the State field */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField({ label, error, icon: Icon, placeholder, options, id, className, ...props }, ref) {
    const autoId = useId();
    const selectId = id ?? autoId;
    const errorId = `${selectId}-error`;
    return (
      <div className="space-y-1.5">
        <label htmlFor={selectId} className="block text-sm font-semibold text-dark-700 dark:text-dark-200">
          {label}
        </label>
        <div className="relative">
          {Icon && (
            <Icon
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400"
              aria-hidden
            />
          )}
          <select
            {...props}
            ref={ref}
            id={selectId}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            defaultValue=""
            className={cn(
              "h-11 w-full appearance-none rounded-xl border bg-white/70 pr-9 text-sm text-dark-900 outline-none transition-all",
              Icon ? "pl-10" : "pl-3.5",
              "focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
              "dark:bg-dark-800/60 dark:text-white dark:focus:ring-primary-500/20",
              error
                ? "border-red-400 focus:border-red-500 focus:ring-red-100 dark:focus:ring-red-500/20"
                : "border-dark-200 dark:border-dark-700",
              className,
            )}
          >
            <option value="" disabled>
              {placeholder ?? "Select…"}
            </option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden
          >
            <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {error && (
          <p id={errorId} className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
