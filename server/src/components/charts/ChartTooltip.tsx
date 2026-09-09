import type { TooltipProps } from 'recharts'
import { cn } from '@/lib/utils'

interface Props extends TooltipProps<number, string> {
  /** Formats each value, e.g. `inr` or `(v) => `${v}%`` */
  format?: (value: number, name: string) => string
  labelFormat?: (label: string) => string
  className?: string
}

export function ChartTooltip({ active, payload, label, format, labelFormat, className }: Props) {
  if (!active || !payload?.length) return null

  return (
    <div
      className={cn(
        'min-w-[9rem] rounded-lg border border-border bg-popover/97 p-2.5 shadow-pop backdrop-blur',
        className,
      )}
    >
      {label !== undefined && (
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {labelFormat ? labelFormat(String(label)) : String(label)}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4 text-[12.5px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="size-2 shrink-0 rounded-[3px]"
                style={{ backgroundColor: entry.color ?? entry.payload?.fill }}
              />
              {entry.name}
            </span>
            <span className="num font-semibold">
              {format ? format(Number(entry.value), String(entry.name)) : String(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
