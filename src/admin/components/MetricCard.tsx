import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cn";
import { Skeleton } from "./Panel";

export function MetricCard({
  label,
  value,
  icon: Icon,
  delta,
  detail,
  tone = "default",
  to,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  /** % change vs previous period; renders green/red trend */
  delta?: number;
  /** Small line under the value, e.g. a split or a warning */
  detail?: ReactNode;
  tone?: "default" | "warn" | "danger";
  to: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex min-h-[104px] flex-col justify-between rounded-xl border erp-surface card-shadow p-4 transition-colors focus-visible:outline-2 focus-visible:outline-primary-500",
        tone === "danger"
          ? "border-red-200 dark:border-red-500/30"
          : tone === "warn"
            ? "border-amber-200 dark:border-amber-500/30"
            : "erp-border hover:border-dark-300 dark:hover:border-dark-600",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide erp-text-muted">
          {label}
        </span>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            tone === "danger"
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              : tone === "warn"
                ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                : "erp-surface-2 erp-text-muted",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-extrabold tracking-tight erp-text">
            {value}
          </span>
          {delta !== undefined && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-bold",
                delta >= 0 ? "text-emerald-600" : "text-red-600",
              )}
            >
              {delta >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" aria-hidden />
              )}
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(1)}%
              <span className="sr-only">vs yesterday</span>
            </span>
          )}
        </div>
        {detail && <div className="mt-1 text-xs erp-text-muted">{detail}</div>}
      </div>
    </Link>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="flex min-h-[104px] flex-col justify-between rounded-xl border erp-border erp-surface p-4">
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-36" />
      </div>
    </div>
  );
}
