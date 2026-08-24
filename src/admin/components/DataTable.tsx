import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/utils/cn";
import { Skeleton } from "./Panel";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** Hide below this breakpoint to keep tables usable on tablets */
  hideBelow?: "sm" | "md" | "lg";
}

const HIDE_CLASS = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
} as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  rowClassName,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Makes the whole row navigate (keyboard accessible) */
  rowHref?: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  caption?: string;
}) {
  const nav = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b erp-border text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint first:pl-0 last:pr-0",
                  c.hideBelow && HIDE_CLASS[c.hideBelow],
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            return (
              <tr
                key={rowKey(row)}
                className={cn(
                  "border-b erp-border-soft last:border-0",
                  href &&
                    "cursor-pointer transition-colors erp-hover focus-visible:erp-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500",
                  rowClassName?.(row),
                )}
                {...(href
                  ? {
                      tabIndex: 0,
                      role: "link",
                      onClick: () => nav(href),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          nav(href);
                        }
                      },
                    }
                  : {})}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-3 first:pl-0 last:pr-0",
                      c.hideBelow && HIDE_CLASS[c.hideBelow],
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading table">
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-5 flex-1" />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
