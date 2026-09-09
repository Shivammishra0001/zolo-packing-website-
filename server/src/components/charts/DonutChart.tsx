import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_SERIES_KEYS, useChartPalette } from '@/components/charts/chart-theme'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { cn } from '@/lib/utils'

export interface DonutSlice {
  label: string
  value: number
}

export function DonutChart({
  data,
  height = 220,
  format,
  centerLabel,
  centerValue,
  className,
}: {
  data: DonutSlice[]
  height?: number
  format?: (value: number) => string
  centerLabel?: string
  centerValue?: string
  className?: string
}) {
  const palette = useChartPalette()
  const total = data.reduce((acc, d) => acc + d.value, 0)
  const colors = CHART_SERIES_KEYS.map((key) => palette[key])

  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center', className)}>
      <div className="relative shrink-0" style={{ width: height, height, maxWidth: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2.5}
              strokeWidth={0}
              animationDuration={800}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip format={(v) => (format ? format(v) : String(v))} />} />
          </PieChart>
        </ResponsiveContainer>
        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue && <span className="num text-xl font-bold tracking-tight">{centerValue}</span>}
            {centerLabel && (
              <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {centerLabel}
              </span>
            )}
          </div>
        )}
      </div>

      <ul className="min-w-0 flex-1 space-y-2.5">
        {data.map((slice, i) => (
          <li key={slice.label} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: colors[i % colors.length] }}
              />
              <span className="truncate text-muted-foreground">{slice.label}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2">
              <span className="num font-semibold">{format ? format(slice.value) : slice.value}</span>
              <span className="num w-10 text-right text-[11.5px] text-muted-foreground">
                {total ? `${((slice.value / total) * 100).toFixed(1)}%` : '—'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
