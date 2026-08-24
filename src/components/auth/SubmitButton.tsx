import { Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";

/** Primary form button with a loading spinner + disabled-until-valid support */
export function SubmitButton({
  loading,
  disabled,
  children,
  className,
}: {
  loading: boolean;
  disabled: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(
        "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-500 text-sm font-bold text-white shadow-sm shadow-primary-500/30 transition-all",
        "hover:bg-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none",
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
