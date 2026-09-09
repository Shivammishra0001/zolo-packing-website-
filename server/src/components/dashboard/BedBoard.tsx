import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BedDouble, Sparkles } from 'lucide-react'
import type { Bed } from '@/types'
import { BEDS } from '@/data/operations'
import { StatusBadge } from '@/components/ui/status'
import { cn, formatDate, groupBy, inr } from '@/lib/utils'

const STATUS_STYLE: Record<Bed['status'], string> = {
  Available: 'border-success/30 bg-success/[0.06] hover:border-success/50',
  Occupied: 'border-info/30 bg-info/[0.06] hover:border-info/50',
  Reserved: 'border-warning/35 bg-warning/[0.06] hover:border-warning/55',
  Cleaning: 'border-border bg-muted/45 hover:border-muted-foreground/35',
}

export function BedBoard({ beds = BEDS, className }: { beds?: Bed[]; className?: string }) {
  const wards = groupBy(beds, (b) => b.ward)

  return (
    <div className={cn('space-y-6', className)}>
      {Object.entries(wards).map(([ward, wardBeds]) => (
        <section key={ward}>
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-[13.5px] font-semibold">{ward}</h3>
            <p className="text-[12px] text-muted-foreground">
              {wardBeds.filter((b) => b.status === 'Occupied').length} occupied · {wardBeds.length} beds
            </p>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {wardBeds.map((bed, i) => {
              const card = (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.2), duration: 0.24 }}
                  className={cn(
                    'h-full rounded-xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevated',
                    STATUS_STYLE[bed.status],
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="num text-[13.5px] font-semibold">{bed.bed}</p>
                      <p className="text-[11.5px] text-muted-foreground">
                        Room {bed.room} · {bed.type}
                      </p>
                    </div>
                    <StatusBadge status={bed.status} showDot={false} />
                  </div>

                  <div className="mt-3 border-t border-border/70 pt-2.5">
                    {bed.patientName ? (
                      <>
                        <p className="truncate text-[13px] font-medium">{bed.patientName}</p>
                        <p className="text-[11.5px] text-muted-foreground">
                          {bed.since ? `Since ${formatDate(bed.since)}` : 'Admission scheduled'}
                        </p>
                      </>
                    ) : (
                      <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                        {bed.status === 'Cleaning' ? (
                          <>
                            <Sparkles className="size-3.5" />
                            Housekeeping in progress
                          </>
                        ) : (
                          <>
                            <BedDouble className="size-3.5" />
                            Ready for admission
                          </>
                        )}
                      </p>
                    )}
                    <p className="num mt-1.5 text-[11.5px] text-muted-foreground">{inr(bed.dailyRate)} / day</p>
                  </div>
                </motion.div>
              )

              return bed.patientId ? (
                <Link key={bed.id} to={`/patients/${bed.patientId}`} className="block rounded-xl">
                  {card}
                </Link>
              ) : (
                <div key={bed.id}>{card}</div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
