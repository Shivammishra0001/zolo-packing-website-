import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * Radial occupancy indicator. Drawn with plain SVG so it stays crisp at any
 * size and animates the arc rather than re-rendering a chart library.
 */
export function OccupancyGauge({
  value,
  label = 'Occupied',
  size = 168,
  breakdown,
}: {
  value: number
  label?: string
  size?: number
  breakdown?: { label: string; count: number; tone: 'success' | 'info' | 'warning' | 'muted' }[]
}) {
  const stroke = 12
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  const dash = (clamped / 100) * circumference * 0.75 // 270-degree arc
  const trackDash = circumference * 0.75

  const tone = clamped >= 85 ? 'text-destructive' : clamped >= 60 ? 'text-accent' : 'text-warning'

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-[225deg]" role="img" aria-label={`${clamped}% ${label}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${trackDash} ${circumference}`}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className={cn('stroke-current', tone)}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${dash} ${circumference}` }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-3xl font-bold tracking-tight">{clamped}%</span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
      </div>

      {breakdown && (
        <ul className="grid w-full grid-cols-2 gap-3 sm:flex-1">
          {breakdown.map((item) => (
            <li key={item.label} className="rounded-lg border border-border bg-muted/35 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    item.tone === 'success' && 'bg-success',
                    item.tone === 'info' && 'bg-info',
                    item.tone === 'warning' && 'bg-warning',
                    item.tone === 'muted' && 'bg-muted-foreground/50',
                  )}
                />
                <span className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </span>
              </div>
              <p className="num mt-1 text-lg font-semibold">{item.count}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
