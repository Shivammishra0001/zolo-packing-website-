import { Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";

/** Primary form button (the one conversion action) with a loading spinner + disabled-until-valid support */
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
      className={cn("btn btn-primary w-full", className)}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
