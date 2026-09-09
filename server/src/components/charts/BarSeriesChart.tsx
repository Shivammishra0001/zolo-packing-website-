import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS_PROPS, GRID_PROPS, useChartPalette } from '@/components/charts/chart-theme'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

export interface BarSeries {
  key: string
  name: string
  color: 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6'
}

export function BarSeriesChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 280,
  stacked = false,
  layout = 'horizontal',
  format,
  yWidth = 44,
  showLegend = true,
}: {
  data: T[]
  xKey: string
  series: BarSeries[]
  height?: number
  stacked?: boolean
  layout?: 'horizontal' | 'vertical'
  format?: (value: number) => string
  yWidth?: number
  showLegend?: boolean
}) {
  const palette = useChartPalette()
  const isVertical = layout === 'vertical'

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={layout}
        margin={{ top: 8, right: 8, left: isVertical ? 4 : 0, bottom: 0 }}
        barCategoryGap={isVertical ? '26%' : '30%'}
      >
        <CartesianGrid {...GRID_PROPS} vertical={isVertical} horizontal={!isVertical} stroke={palette.border} />
        {isVertical ? (
          <>
            <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v: number) => (format ? format(v) : String(v))} />
            <YAxis type="category" dataKey={xKey} {...AXIS_PROPS} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} width={yWidth} tickFormatter={(v: number) => (format ? format(v) : String(v))} />
          </>
        )}
        <Tooltip
          cursor={{ fill: palette.border, opacity: 0.32 }}
          content={<ChartTooltip format={(v) => (format ? format(v) : String(v))} />}
        />
        {showLegend && series.length > 1 && (
          <Legend
            verticalAlign="top"
            align="right"
            height={28}
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: palette['muted-foreground'] }}
          />
        )}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={palette[s.color]}
            stackId={stacked ? 'stack' : undefined}
            radius={
              isVertical
                ? [0, 5, 5, 0]
                : stacked && i < series.length - 1
                  ? [0, 0, 0, 0]
                  : [5, 5, 0, 0]
            }
            animationDuration={800}
            animationBegin={i * 110}
            maxBarSize={isVertical ? 22 : 46}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
