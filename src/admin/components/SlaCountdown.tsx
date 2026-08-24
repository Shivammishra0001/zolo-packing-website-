import { Timer } from "lucide-react";
import { cn } from "@/utils/cn";
import { countdown } from "../format";
import { useNow } from "../hooks";
import { SLA_AMBER_MS, SLA_RED_MS } from "../statuses";

/**
 * Live countdown to an SLA deadline.
 * green → amber under 2h → red under 1h (and when overdue).
 */
export function SlaCountdown({ dueAt }: { dueAt: string }) {
  const now = useNow(15_000);
  const remaining = new Date(dueAt).getTime() - now;
  const tone =
    remaining < SLA_RED_MS
      ? "bg-red-50 text-red-700 border-red-200"
      : remaining < SLA_AMBER_MS
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold tabular-nums whitespace-nowrap",
        tone,
      )}
      title="Time left on 4-business-hour quote SLA"
    >
      <Timer className="h-3.5 w-3.5" aria-hidden />
      {remaining < 0 ? countdown(remaining) : `${countdown(remaining)} left`}
    </span>
  );
}
