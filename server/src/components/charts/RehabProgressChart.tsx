import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ProgressPoint } from '@/types'
import { AXIS_PROPS, GRID_PROPS, useChartPalette } from '@/components/charts/chart-theme'
import { ChartTooltip } from '@/components/charts/ChartTooltip'

/**
 * Pain runs 0-10 on the right axis (lower is better); mobility and strength run
 * 0-100 on the left. Keeping them on one chart makes the trade-off visible.
 */
export function RehabProgressChart({ data, height = 300 }: { data: ProgressPoint[]; height?: number }) {
  const palette = useChartPalette()

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID_PROPS} stroke={palette.border} />
        <XAxis dataKey="week" {...AXIS_PROPS} />
        <YAxis yAxisId="score" {...AXIS_PROPS} width={36} domain={[0, 100]} />
        <YAxis yAxisId="pain" orientation="right" {...AXIS_PROPS} width={28} domain={[0, 10]} />
        <Tooltip
          cursor={{ stroke: palette.border, strokeWidth: 1 }}
          content={<ChartTooltip format={(v, name) => (name === 'Pain score' ? `${v} / 10` : `${v} / 100`)} />}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: palette['muted-foreground'] }}
        />
        <Line
          yAxisId="score"
          type="monotone"
          dataKey="mobility"
          name="Mobility"
          stroke={palette['chart-1']}
          strokeWidth={2.4}
          dot={{ r: 2.5, strokeWidth: 0, fill: palette['chart-1'] }}
          activeDot={{ r: 4.5 }}
          animationDuration={900}
        />
        <Line
          yAxisId="score"
          type="monotone"
          dataKey="strength"
          name="Strength"
          stroke={palette['chart-3']}
          strokeWidth={2.4}
          dot={{ r: 2.5, strokeWidth: 0, fill: palette['chart-3'] }}
          activeDot={{ r: 4.5 }}
          animationDuration={900}
          animationBegin={120}
        />
        <Line
          yAxisId="pain"
          type="monotone"
          dataKey="pain"
          name="Pain score"
          stroke={palette['chart-4']}
          strokeWidth={2.4}
          strokeDasharray="5 4"
          dot={{ r: 2.5, strokeWidth: 0, fill: palette['chart-4'] }}
          activeDot={{ r: 4.5 }}
          animationDuration={900}
          animationBegin={240}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
