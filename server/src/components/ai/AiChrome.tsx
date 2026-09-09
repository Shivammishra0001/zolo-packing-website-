import * as React from 'react'
import { AlertTriangle, Info, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiMeta } from '@/services/aiService'

/**
 * The small pieces every AI surface shares.
 *
 * All of them exist to make provenance visible. A clinician reading a summary
 * needs to know, without asking, whether a person wrote it, a model wrote it,
 * or nothing wrote it and they are looking at the raw record — and whether
 * anyone has checked. Guessing wrong about that is the whole risk of putting a
 * language model near a medical record.
 *
 * Visually these are deliberately quiet: a bordered chip and a bordered strip,
 * in the same palette as the rest of the application. No glow, no gradient, no
 * animated aura. This is a hospital system.
 */

/** "AI-assisted" — never "AI-verified", which would be the opposite of true. */
export function AiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground',
        className,
      )}
    >
      <Sparkles className="size-3" aria-hidden />
      AI-assisted
    </span>
  )
}

/** Says out loud that a human still has to check. */
export function ReviewBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400',
        className,
      )}
    >
      Needs review
    </span>
  )
}

/**
 * The notice shown when the model did not run.
 *
 * Rendered as information rather than as an error, because it is not one: the
 * figures above it are correct and came from the database. What is missing is
 * the prose.
 */
export function DegradedNotice({ meta, className }: { meta: AiMeta; className?: string }) {
  if (!meta.degraded || !meta.notice) return null
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground',
        className,
      )}
      role="note"
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{meta.notice}</span>
    </div>
  )
}

/**
 * Provenance, in one line: which model, which prompt, when.
 *
 * Small print by design, but present on every AI panel — an answer that cannot
 * say where it came from should not be on a clinical screen at all.
 */
export function AiProvenance({ meta, className }: { meta: AiMeta; className?: string }) {
  const when = new Date(meta.generatedAt)
  const source = meta.provider === 'none' ? 'your records only' : `${meta.provider} · ${meta.model}`
  return (
    <p className={cn('text-[11.5px] text-muted-foreground', className)}>
      Generated {when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} from{' '}
      {source}
      {meta.promptVersion && meta.provider !== 'none' ? ` · ${meta.promptVersion}` : ''}
    </p>
  )
}

/**
 * The processing state for a document being read.
 *
 * One hairline sweeping down the page, once every couple of seconds. It stops
 * the moment the work does, and `prefers-reduced-motion` removes it entirely
 * through the global rule in index.css.
 */
export function ScanOverlay({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="h-px w-full animate-scan-line bg-accent/60" />
        </div>
      )}
    </div>
  )
}

/** Shown where an AI feature is switched off, instead of a control that fails. */
export function AiUnavailable({ reason, className }: { reason: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-[12.5px] text-muted-foreground',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{reason}</span>
    </div>
  )
}
