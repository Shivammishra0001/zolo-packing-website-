import { motion } from 'framer-motion'
import { Activity, HeartPulse, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

const METRICS = [
  { label: 'Mobility', value: 82, delay: 0.1 },
  { label: 'Strength', value: 76, delay: 0.2 },
  { label: 'Adherence', value: 88, delay: 0.3 },
]

const SPARK = [38, 44, 41, 52, 58, 55, 66, 71, 68, 78, 82]

/**
 * Abstract "recovery" visual used on the login and landing pages: a compact
 * rehabilitation progress card rather than a stock medical illustration.
 */
export function RehabVisual({ className }: { className?: string }) {
  const width = 320
  const height = 78
  const max = Math.max(...SPARK)
  const min = Math.min(...SPARK)
  const points = SPARK.map((v, i) => {
    const x = (i / (SPARK.length - 1)) * width
    const y = height - ((v - min) / (max - min || 1)) * (height - 10) - 5
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const path = `M ${points.join(' L ')}`
  const area = `${path} L ${width},${height} L 0,${height} Z`

  return (
    <div className={cn('w-full max-w-[26rem]', className)}>
      <div className="rounded-2xl border border-white/12 bg-white/[0.07] p-5 shadow-pop backdrop-blur-sm dark:border-border dark:bg-card/70">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/55 dark:text-muted-foreground">
              Rehabilitation progress
            </p>
            <p className="mt-1 text-[15px] font-semibold">Raj Kumar · PT-10248</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 dark:bg-success/12 dark:text-success">
            <TrendingUp className="size-3" />
            On Track
          </span>
        </div>

        <div className="mt-4 flex items-baseline gap-2">
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.4 }}
            className="num text-[34px] font-bold leading-none tracking-tight"
          >
            75%
          </motion.span>
          <span className="text-[12.5px] text-white/55 dark:text-muted-foreground">18 of 24 sessions complete</span>
        </div>

        {/* Sparkline */}
        <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-[78px] w-full" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="rv-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path
            d={area}
            className="text-emerald-300 dark:text-accent"
            fill="url(#rv-area)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.6 }}
          />
          <motion.path
            d={path}
            fill="none"
            className="text-emerald-300 dark:text-accent"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.3, duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>

        {/* Metric bars */}
        <div className="mt-3 space-y-2.5">
          {METRICS.map((metric) => (
            <div key={metric.label}>
              <div className="mb-1 flex items-center justify-between text-[11.5px]">
                <span className="text-white/60 dark:text-muted-foreground">{metric.label}</span>
                <span className="num font-semibold">{metric.value}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/12 dark:bg-muted">
                <motion.div
                  className="h-full rounded-full bg-white/85 dark:bg-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${metric.value}%` }}
                  transition={{ delay: 0.4 + metric.delay, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating status chips */}
      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { icon: HeartPulse, label: 'Pain 7 → 4 / 10', delay: 0.55 },
          { icon: Activity, label: 'Attendance 94%', delay: 0.65 },
        ].map(({ icon: Icon, label, delay }) => (
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay, duration: 0.4 }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.07] px-2.5 py-1.5 text-[12px] font-medium backdrop-blur-sm dark:border-border dark:bg-card/70"
          >
            <Icon className="size-3.5 text-emerald-300 dark:text-accent" />
            {label}
          </motion.span>
        ))}
      </div>
    </div>
  )
}
