import * as React from 'react'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AiBadge, AiProvenance, DegradedNotice, ReviewBadge } from '@/components/ai/AiChrome'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/services/api'
import { generateRecap, type PatientRecap } from '@/services/aiService'
import { cn } from '@/lib/utils'

/**
 * The recap card on Patient 360.
 *
 * Opt-in: nothing is generated until the clinician asks. A card that summarised
 * every patient on page load would send a clinical record to a third party for
 * every casual click through a patient list.
 *
 * The timeline is drawn from the response's own `timeline`, which the backend
 * builds in SQL. When no model is configured, the timeline is still there and
 * the narrative section is simply absent, under a notice saying why — which is
 * the honest version of "degraded" and, on a busy ward, still useful.
 */

const KIND_LABEL: Record<string, string> = {
  appointment: 'Appointment',
  consultation: 'Consultation',
  therapy: 'Therapy',
  lab: 'Lab',
  prescription: 'Prescription',
  admission: 'Admission',
}

export function PatientRecapCard({ patientId, className }: { patientId: string; className?: string }) {
  const { has } = useAuth()
  const [recap, setRecap] = React.useState<PatientRecap | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // The same key that reading the notes needs. Hiding the control from anyone
  // else keeps the UI honest about what the API will allow.
  if (!has('patient.clinical.view')) return null

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      setRecap(await generateRecap(patientId))
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'The recap could not be generated. Try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      className={cn('rounded-xl border border-border bg-card shadow-card', className)}
      aria-label="Patient recap"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            Recap
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            The last six months of this record, in order, with a written summary where one is
            available.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AiBadge />
          <Button size="sm" variant="outline" onClick={run} disabled={loading}>
            {loading ? 'Reading the record…' : recap ? 'Refresh' : 'Generate recap'}
          </Button>
        </div>
      </header>

      <div className="p-5">
        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        )}

        {!recap && !error && !loading && (
          <p className="text-[13px] text-muted-foreground">
            Nothing is generated until you ask. Press <strong>Generate recap</strong> to build the
            timeline for this patient.
          </p>
        )}

        {loading && !recap && (
          <div className="space-y-2" aria-live="polite">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${90 - i * 18}%` }} />
            ))}
          </div>
        )}

        {recap && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4"
          >
            <DegradedNotice meta={recap.meta} />

            {recap.summary && (
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold">Summary</h3>
                  {recap.meta.requiresReview && <ReviewBadge />}
                </div>
                <p className="text-[13px] leading-relaxed text-foreground">{recap.summary}</p>
              </div>
            )}

            {recap.watchPoints.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold">Worth a look</h3>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
                  {recap.watchPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {recap.gaps.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[13px] font-semibold">Not in the record</h3>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
                  {recap.gaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-[13px] font-semibold">
                Timeline{' '}
                <span className="font-normal text-muted-foreground">
                  since {new Date(recap.since).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </span>
              </h3>
              {recap.timeline.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No recorded activity in this window.</p>
              ) : (
                <ol className="relative space-y-3 border-l border-border pl-4">
                  {recap.timeline
                    .slice()
                    .reverse()
                    .map((event, index) => (
                      <li key={`${event.kind}-${event.date}-${index}`} className="relative">
                        <span
                          className="absolute -left-[21px] top-1.5 size-2 rounded-full border border-border bg-card"
                          aria-hidden
                        />
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-[12.5px] font-medium">{event.title}</span>
                          <span className="text-[11.5px] text-muted-foreground">
                            {KIND_LABEL[event.kind] ?? event.kind} ·{' '}
                            {new Date(event.date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                            {event.by ? ` · ${event.by}` : ''}
                          </span>
                        </div>
                        {event.detail && (
                          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{event.detail}</p>
                        )}
                      </li>
                    ))}
                </ol>
              )}
            </div>

            <AiProvenance meta={recap.meta} className="border-t border-border pt-3" />
          </motion.div>
        )}
      </div>
    </section>
  )
}
