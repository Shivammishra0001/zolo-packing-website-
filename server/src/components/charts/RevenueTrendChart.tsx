import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS_PROPS, GRID_PROPS, useChartPalette } from '@/components/charts/chart-theme'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { inr } from '@/lib/utils'

interface Row {
  month: string
  revenue: number
  expenses: number
  profit: number
}

export function RevenueTrendChart({ data, height = 300 }: { data: Row[]; height?: number }) {
  const palette = useChartPalette()

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="grad-revenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette['chart-1']} stopOpacity={0.32} />
            <stop offset="100%" stopColor={palette['chart-1']} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="grad-expenses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette['chart-4']} stopOpacity={0.22} />
            <stop offset="100%" stopColor={palette['chart-4']} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="grad-profit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette['chart-2']} stopOpacity={0.26} />
            <stop offset="100%" stopColor={palette['chart-2']} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID_PROPS} stroke={palette.border} />
        <XAxis dataKey="month" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} width={52} tickFormatter={(v: number) => inr(v, { compact: true })} />
        <Tooltip
          cursor={{ stroke: palette.border, strokeWidth: 1 }}
          content={<ChartTooltip format={(v) => inr(v, { compact: true })} />}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: palette['muted-foreground'] }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke={palette['chart-1']}
          strokeWidth={2}
          fill="url(#grad-revenue)"
          animationDuration={900}
        />
        <Area
          type="monotone"
          dataKey="expenses"
          name="Expenses"
          stroke={palette['chart-4']}
          strokeWidth={2}
          fill="url(#grad-expenses)"
          animationDuration={900}
          animationBegin={120}
        />
        <Area
          type="monotone"
          dataKey="profit"
          name="Profit"
          stroke={palette['chart-2']}
          strokeWidth={2}
          fill="url(#grad-profit)"
          animationDuration={900}
          animationBegin={240}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
