import { forwardRef, useId } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  icon?: LucideIcon;
}

/** Labelled text/email/tel input shared by both auth forms (design-system `input`). */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, error, icon: Icon, id, className, ...props }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;
    return (
      <div>
        <label htmlFor={inputId} className="label">
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
            className={cn("input", Icon && "pl-10", className)}
          />
        </div>
        {error && (
          <p id={errorId} className="field-error" role="alert">
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
      <div>
        <label htmlFor={selectId} className="label">
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
            className={cn("input appearance-none pr-9", Icon && "pl-10", className)}
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
          <p id={errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);
