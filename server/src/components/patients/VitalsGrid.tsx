import { Activity, Droplets, HeartPulse, Thermometer, Wind } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Vitals } from '@/types'
import { cn } from '@/lib/utils'

type Tone = 'normal' | 'watch' | 'alert'

/**
 * A reading that was never taken has no tone.
 *
 * Without this a null SpO2 compares as `null < 92` — which is true — and an
 * observation nobody recorded would render as a red alert.
 */
function toneFor(kind: string, vitals: Vitals): Tone {
  switch (kind) {
    case 'bp':
      if (vitals.systolic == null || vitals.diastolic == null) return 'normal'
      if (vitals.systolic >= 160 || vitals.diastolic >= 100) return 'alert'
      if (vitals.systolic >= 140 || vitals.diastolic >= 90) return 'watch'
      return 'normal'
    case 'hr':
      if (vitals.heartRate == null) return 'normal'
      if (vitals.heartRate > 100 || vitals.heartRate < 55) return 'watch'
      return 'normal'
    case 'temp':
      if (vitals.temperature == null) return 'normal'
      if (vitals.temperature >= 38) return 'alert'
      if (vitals.temperature >= 37.5) return 'watch'
      return 'normal'
    case 'spo2':
      if (vitals.spo2 == null) return 'normal'
      if (vitals.spo2 < 92) return 'alert'
      if (vitals.spo2 < 95) return 'watch'
      return 'normal'
    case 'rr':
      if (vitals.respiratoryRate == null) return 'normal'
      if (vitals.respiratoryRate > 20 || vitals.respiratoryRate < 12) return 'watch'
      return 'normal'
    default:
      return 'normal'
  }
}

const TONE_CLASS: Record<Tone, string> = {
  normal: 'border-border bg-card',
  watch: 'border-warning/30 bg-warning/[0.06]',
  alert: 'border-destructive/30 bg-destructive/[0.06]',
}

const ICON_CLASS: Record<Tone, string> = {
  normal: 'bg-muted text-muted-foreground',
  watch: 'bg-warning/12 text-warning',
  alert: 'bg-destructive/12 text-destructive',
}

export function VitalsGrid({ vitals, className }: { vitals: Vitals; className?: string }) {
  /** An em dash reads as "not taken"; "null" and a crash do not. */
  const shown = (value: number | null, digits = 0) =>
    value == null ? '—' : digits ? value.toFixed(digits) : String(value)

  const cards = [
    {
      kind: 'bp',
      label: 'Blood pressure',
      value:
        vitals.systolic == null && vitals.diastolic == null
          ? '—'
          : `${shown(vitals.systolic)}/${shown(vitals.diastolic)}`,
      unit: 'mmHg',
      icon: Activity,
    },
    { kind: 'hr', label: 'Heart rate', value: shown(vitals.heartRate), unit: 'bpm', icon: HeartPulse },
    { kind: 'temp', label: 'Temperature', value: shown(vitals.temperature, 1), unit: '°C', icon: Thermometer },
    { kind: 'spo2', label: 'SpO₂', value: shown(vitals.spo2), unit: '%', icon: Droplets },
    { kind: 'rr', label: 'Respiratory rate', value: shown(vitals.respiratoryRate), unit: '/min', icon: Wind },
  ]

  return (
    <div className={cn('grid gap-3 sm:grid-cols-3 lg:grid-cols-5', className)}>
      {cards.map((card, i) => {
        const tone = toneFor(card.kind, vitals)
        const Icon = card.icon
        return (
          <motion.div
            key={card.kind}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.26 }}
            className={cn('rounded-xl border p-3.5 transition-colors', TONE_CLASS[tone])}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{card.label}</p>
              <span className={cn('flex size-7 items-center justify-center rounded-lg', ICON_CLASS[tone])}>
                <Icon className="size-3.5" />
              </span>
            </div>
            <p className="num mt-2 text-xl font-bold tracking-tight">
              {card.value}
              <span className="ml-1 text-[11.5px] font-medium text-muted-foreground">{card.unit}</span>
            </p>
          </motion.div>
        )
      })}
    </div>
  )
}
