import { Check } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatDateTime } from "../../format";
import { TRACKING_STAGE, flowFor, stageState } from "../../orders-tracking";
import type { Order } from "../../types";

// ============================================================
// Horizontal manufacturing tracking bar.
//   ✓ completed  ● current  ○ upcoming   — orange (primary) accent.
// Scrolls horizontally on small screens; shows a per-stage timestamp when known.
// ============================================================

export function TrackingBar({ order }: { order: Order }) {
  const cancelled = order.trackingStage === "cancelled";
  const flow = flowFor(order);
  const stamps = order.stageTimestamps ?? {};

  if (cancelled) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        This order was cancelled — the normal workflow is stopped.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto no-scrollbar">
      <ol className="flex min-w-max items-start gap-0 pb-1" aria-label="Order tracking progress">
        {flow.map((stage, i) => {
          const state = stageState(order, stage);
          const meta = TRACKING_STAGE[stage];
          const at = stamps[stage];
          const isLast = i === flow.length - 1;
          return (
            <li key={stage} className="flex flex-col items-center" aria-current={state === "current" ? "step" : undefined}>
              <div className="flex items-center">
                {/* node */}
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition-colors",
                    state === "completed" && "border-primary-500 bg-primary-500 text-white",
                    state === "current" && "border-primary-500 bg-white text-primary-600 ring-4 ring-primary-100 dark:bg-dark-900 dark:text-primary-400 dark:ring-primary-500/20",
                    state === "upcoming" && "erp-border erp-surface erp-text-faint",
                  )}
                >
                  {state === "completed" ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                {/* connector */}
                {!isLast && (
                  <span
                    className={cn(
                      "h-0.5 w-12 sm:w-16",
                      state === "completed" ? "bg-primary-500" : "erp-border-soft bg-current opacity-30",
                    )}
                    aria-hidden
                  />
                )}
              </div>
              <div className="mt-1.5 w-16 px-0.5 text-center sm:w-20">
                <p
                  className={cn(
                    "text-[10px] font-semibold leading-tight",
                    state === "upcoming" ? "erp-text-faint" : "erp-text",
                  )}
                >
                  {meta.short}
                </p>
                {at && state !== "upcoming" && (
                  <p className="mt-0.5 text-[9px] leading-tight erp-text-faint">{formatDateTime(at)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Compact single-line stage indicator for list rows. */
export function TrackingMini({ order }: { order: Order }) {
  const flow = flowFor(order);
  const idx = flow.indexOf(order.trackingStage ?? "order_received");
  const pct = flow.length > 1 ? Math.round((idx / (flow.length - 1)) * 100) : 0;
  const cancelled = order.trackingStage === "cancelled";
  return (
    <div className="w-28">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] font-semibold erp-text-muted">
          {cancelled ? "Cancelled" : TRACKING_STAGE[order.trackingStage ?? "order_received"].short}
        </span>
        {!cancelled && <span className="text-[10px] tabular-nums erp-text-faint">{pct}%</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full erp-surface-2">
        <div
          className={cn("h-full rounded-full", cancelled ? "bg-red-500" : "bg-primary-500")}
          style={{ width: `${cancelled ? 100 : Math.max(pct, 4)}%` }}
        />
      </div>
    </div>
  );
}
