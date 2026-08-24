import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { cn } from "@/utils/cn";

interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
  /** Wired to aria-describedby so SR users hear the strength meter / rules */
  describedById?: string;
}

/**
 * Accessible password field with a show/hide toggle. Forwards its ref so
 * React Hook Form's `register` can control it. The value is never read or
 * stored outside the form — it flows straight to the submit handler.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ label, error, describedById, id, className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;

    return (
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="block text-sm font-semibold text-dark-700 dark:text-dark-200">
          {label}
        </label>
        <div className="relative">
          <Lock
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400"
            aria-hidden
          />
          <input
            {...props}
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            autoComplete={props.autoComplete ?? "current-password"}
            aria-invalid={!!error}
            aria-describedby={cn(error && errorId, describedById) || undefined}
            className={cn(
              "h-11 w-full rounded-xl border bg-white/70 pl-10 pr-11 text-sm text-dark-900 outline-none transition-all placeholder:text-dark-400",
              "focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
              "dark:bg-dark-800/60 dark:text-white dark:placeholder:text-dark-500 dark:focus:ring-primary-500/20",
              error
                ? "border-red-400 focus:border-red-500 focus:ring-red-100 dark:focus:ring-red-500/20"
                : "border-dark-200 dark:border-dark-700",
              className,
            )}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-dark-400 transition-colors hover:bg-dark-50 hover:text-dark-600 dark:hover:bg-dark-700"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            tabIndex={-1}
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
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
