import * as React from 'react'
import { CheckCircle2, FileScan, MessageSquare, Receipt, TrendingUp, Upload, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import {
  AiBadge,
  AiProvenance,
  AiUnavailable,
  DegradedNotice,
  ReviewBadge,
  ScanOverlay,
} from '@/components/ai/AiChrome'
import { useAuth } from '@/context/AuthContext'
import { useQuery } from '@/hooks/useApi'
import { ApiError } from '@/services/api'
import { searchPatients, type PatientSearchResult } from '@/services/patientService'
import { getInvoice } from '@/services/invoiceService'
import {
  approveMessage,
  checkInvoice,
  generateFollowUps,
  getAiStatus,
  getFinanceInsights,
  listDocuments,
  listMessages,
  reviewDocument,
  uploadDocument,
  type AiDocument,
  type BillingCheck,
  type FinanceInsights,
  type MessageDraft,
} from '@/services/aiService'
import { inr } from '@/lib/utils'

/**
 * The AI workspace.
 *
 * Four panels, each one a queue of things waiting for a person: documents to
 * check, reminders to approve, an invoice to look over, a period to read. That
 * framing is the design. None of these features acts on its own, so the screen
 * is a review desk rather than a dashboard of things that already happened.
 *
 * The header states plainly whether a model is configured. When it is not, each
 * panel still works from the database and says which part is missing — the page
 * never shows a spinner for something that is never going to arrive.
 */
export default function AiAssistant() {
  const { has } = useAuth()
  const { data: status, refetch: refetchStatus } = useQuery(() => getAiStatus(), [])

  const canDocuments = has('patient.clinical.edit')
  const canReminders = has('appointment.create')
  const canBilling = has('billing.view')
  const canFinance = has('finance.reports')

  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Drafts and checks, each waiting for someone to confirm it. Nothing here is applied on its own."
        crumbs={[{ label: 'AI assistant' }]}
        actions={<AiBadge />}
      />

      <div className="mb-6 rounded-xl border border-border bg-card px-5 py-4 shadow-card">
        {status ? (
          status.enabled ? (
            <p className="text-[13px] text-muted-foreground">
              Model <strong className="text-foreground">{status.model}</strong> via{' '}
              {status.provider}. {status.remainingThisHour} requests left this hour.
              {!status.ocrEnabled && ' No OCR engine is configured, so scanned images cannot be read.'}
              {!status.messagingEnabled && ' No messaging gateway is configured, so approved reminders queue rather than send.'}
            </p>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              <strong className="text-foreground">No AI model is configured.</strong> Every panel
              below still works: timelines, totals and dates come from your records. What is missing
              is the written summary on top of them.
            </p>
          )
        ) : (
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {canDocuments && <DocumentsPanel onDone={refetchStatus} />}
        {canReminders && <RemindersPanel messagingEnabled={status?.messagingEnabled ?? false} />}
        {canBilling && <BillingPanel />}
        {canFinance && <FinancePanel />}
      </div>

      {!canDocuments && !canReminders && !canBilling && !canFinance && (
        <AiUnavailable reason="Your role does not have access to any of the AI features. Each one needs the same permission as the records it works on." />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* 2. Clinical documentation                                                  */
/* -------------------------------------------------------------------------- */

function DocumentsPanel({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [term, setTerm] = React.useState('')
  const [patient, setPatient] = React.useState<PatientSearchResult | null>(null)
  const [matches, setMatches] = React.useState<PatientSearchResult[]>([])
  const [busy, setBusy] = React.useState(false)
  const [selected, setSelected] = React.useState<AiDocument | null>(null)
  const [nonce, setNonce] = React.useState(0)

  const { data: documents, loading } = useQuery(() => listDocuments('Pending review', 15), [nonce])

  React.useEffect(() => {
    if (term.trim().length < 2) {
      setMatches([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchPatients(term.trim(), 6)
        .then((rows) => !cancelled && setMatches(rows))
        .catch(() => !cancelled && setMatches([]))
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [term])

  const upload = async (file: File) => {
    if (!patient) return
    setBusy(true)
    try {
      const document = await uploadDocument(patient.uuid, file)
      setSelected(document)
      setNonce((n) => n + 1)
      onDone()
      toast.success('Document staged', 'Check the extraction before approving it.')
    } catch (error) {
      toast.error(
        'Upload failed',
        error instanceof ApiError ? error.message : 'The document could not be read.',
      )
    } finally {
      setBusy(false)
    }
  }

  const decide = async (approve: boolean) => {
    if (!selected) return
    setBusy(true)
    try {
      await reviewDocument(selected.id, { approve, reason: approve ? '' : 'Rejected on review' })
      toast.success(
        approve ? 'Added to the record' : 'Rejected',
        approve
          ? 'The reviewed fields are now in the patient’s medical history, under your name.'
          : 'The document is kept, marked rejected. Nothing was written to the record.',
      )
      setSelected(null)
      setNonce((n) => n + 1)
    } catch (error) {
      toast.error(
        'Could not save',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Documents"
      description="Upload a prescription or letter, check what was read off it, then decide."
      icon={<FileScan />}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium" htmlFor="ai-patient">
            Patient
          </label>
          {patient ? (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-[13px]">
                {patient.name}{' '}
                <span className="text-muted-foreground">{patient.patientNumber}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setPatient(null)}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="ai-patient"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Search by name or PT number"
                autoComplete="off"
              />
              {matches.length > 0 && (
                <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
                  {matches.map((match) => (
                    <li key={match.uuid}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted"
                        onClick={() => {
                          setPatient(match)
                          setTerm('')
                          setMatches([])
                        }}
                      >
                        {match.name}{' '}
                        <span className="text-muted-foreground">{match.patientNumber}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <label
          className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-6 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          aria-disabled={!patient || busy}
        >
          <Upload className="size-4" aria-hidden />
          {patient ? 'Choose a scan, photo, PDF or text file' : 'Pick a patient first'}
          <input
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
            disabled={!patient || busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void upload(file)
            }}
          />
        </label>

        {busy && (
          <ScanOverlay active>
            <div className="space-y-2 px-3 py-6" aria-live="polite">
              <p className="text-[12.5px] text-muted-foreground">Reading the document…</p>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-2.5 rounded bg-muted"
                  style={{ width: `${85 - i * 12}%` }}
                />
              ))}
            </div>
          </ScanOverlay>
        )}

        {selected && <ExtractionReview document={selected} onDecide={decide} busy={busy} />}

        <div>
          <h3 className="mb-2 text-[13px] font-semibold">Waiting for review</h3>
          {loading && <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />}
          {!loading && (documents?.length ?? 0) === 0 && (
            <p className="text-[13px] text-muted-foreground">Nothing waiting.</p>
          )}
          <ul className="divide-y divide-border">
            {(documents ?? []).map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{document.filename}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {document.patientName} ·{' '}
                    {new Date(document.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setSelected(document)}>
                  Review
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  )
}

/**
 * What the reader found, beside what it could not resolve.
 *
 * The `uncertain` list is given the same visual weight as the extracted fields
 * on purpose. It is the part a reviewer most needs to see, and burying it would
 * turn "this word was illegible" into "this word was not there".
 */
function ExtractionReview({
  document,
  onDecide,
  busy,
}: {
  document: AiDocument
  onDecide: (approve: boolean) => void
  busy: boolean
}) {
  const extracted = document.extracted
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{document.filename}</p>
          <p className="text-[11.5px] text-muted-foreground">
            {document.patientName}
            {document.ocrProvider ? ` · read by ${document.ocrProvider}` : ''}
          </p>
        </div>
        <ReviewBadge />
      </div>

      {document.meta && <DegradedNotice meta={document.meta} className="mb-3" />}

      {!document.ocrText && (
        <AiUnavailable
          className="mb-3"
          reason="Nothing could be read from this file automatically. It has been stored — transcribe it by hand, or reject it."
        />
      )}

      {extracted && (
        <div className="space-y-3 text-[13px]">
          <Field label="Document type" value={extracted.kind} />
          {extracted.documentDate && <Field label="Dated" value={extracted.documentDate} />}
          {extracted.prescriber && <Field label="Prescriber" value={extracted.prescriber} />}
          {extracted.diagnosis && <Field label="Diagnosis as written" value={extracted.diagnosis} />}

          {extracted.medicines.length > 0 && (
            <div>
              <p className="mb-1 text-[11.5px] uppercase tracking-wide text-muted-foreground">
                Medicines
              </p>
              <ul className="space-y-1">
                {extracted.medicines.map((medicine, index) => (
                  <li key={`${medicine.name}-${index}`}>
                    {medicine.name}
                    {medicine.strength ? ` · ${medicine.strength}` : ''}
                    {medicine.dosage ? ` · ${medicine.dosage}` : ''}
                    {medicine.duration ? ` · ${medicine.duration}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {extracted.uncertain.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Could not be read — check these against the page
              </p>
              <ul className="space-y-0.5 text-[12.5px]">
                {extracted.uncertain.map((fragment, index) => (
                  <li key={`${fragment}-${index}`} className="font-mono">
                    {fragment}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11.5px] text-muted-foreground">
            Reader confidence: {extracted.confidence}. This is a transcription, not a clinical
            opinion.
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => onDecide(true)} disabled={busy}>
          <CheckCircle2 className="mr-1.5 size-4" aria-hidden />
          Approve and add to record
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(false)} disabled={busy}>
          <XCircle className="mr-1.5 size-4" aria-hidden />
          Reject
        </Button>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 4. Reminders                                                               */
/* -------------------------------------------------------------------------- */

function RemindersPanel({ messagingEnabled }: { messagingEnabled: boolean }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [skipped, setSkipped] = React.useState<string[]>([])
  const [nonce, setNonce] = React.useState(0)

  const { data: drafts, loading } = useQuery(() => listMessages(undefined, 25), [nonce])

  const generate = async () => {
    setBusy(true)
    try {
      const run = await generateFollowUps({ horizonDays: 14, limit: 25 })
      setSkipped(run.skipped)
      setNonce((n) => n + 1)
      toast.success(
        'Drafted',
        `${run.drafts.length} reminder(s) queued. Nothing is sent until you approve each one.`,
      )
    } catch (error) {
      toast.error(
        'Could not draft reminders',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const decide = async (draft: MessageDraft, approve: boolean) => {
    setBusy(true)
    try {
      const updated = await approveMessage(draft.id, { approve })
      setNonce((n) => n + 1)
      if (!approve) {
        toast.success('Rejected', 'The message will not be sent.')
      } else if (updated.status === 'Sent') {
        toast.success('Handed to the gateway', 'Accepted for delivery. Delivery is not confirmed.')
      } else {
        toast.info('Queued', updated.failureReason || 'No gateway is configured, so it stays queued.')
      }
    } catch (error) {
      toast.error('Could not approve', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Reminders"
      description="Patients who are due back. Dates come from the clinician or the clinic's standard interval — never from a model."
      icon={<MessageSquare />}
      action={
        <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
          {busy ? 'Working…' : 'Find who is due'}
        </Button>
      }
    >
      <div className="space-y-4">
        {!messagingEnabled && (
          <AiUnavailable reason="No messaging gateway is configured. Approved reminders stay queued and are never marked as sent." />
        )}

        {skipped.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <p className="mb-1 text-[12.5px] font-medium">Due, but cannot be messaged — call these</p>
            <ul className="space-y-0.5 text-[12.5px] text-muted-foreground">
              {skipped.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {loading && <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />}
        {!loading && (drafts?.length ?? 0) === 0 && (
          <p className="text-[13px] text-muted-foreground">No reminders in the queue.</p>
        )}

        <ul className="divide-y divide-border">
          {(drafts ?? []).map((draft) => (
            <li key={draft.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{draft.patientName}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {draft.channel}
                    {draft.dueOn
                      ? ` · due ${new Date(draft.dueOn).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
                      : ''}
                    {draft.reason ? ` · ${draft.reason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {draft.aiGenerated && <AiBadge />}
                  <Badge variant="outline">{draft.status}</Badge>
                </div>
              </div>
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12.5px]">
                {draft.body}
              </p>
              {draft.failureReason && (
                <p className="text-[11.5px] text-muted-foreground">{draft.failureReason}</p>
              )}
              {draft.status === 'Draft' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(draft, true)} disabled={busy}>
                    Approve and send
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide(draft, false)} disabled={busy}>
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </SectionCard>
  )
}

/* -------------------------------------------------------------------------- */
/* 3. Billing accuracy                                                        */
/* -------------------------------------------------------------------------- */

function BillingPanel() {
  const toast = useToast()
  const [number, setNumber] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<BillingCheck | null>(null)

  const run = async () => {
    if (!number.trim()) return
    setBusy(true)
    setResult(null)
    try {
      // Resolved through the invoices API first so a human-readable number can
      // be typed; the check itself takes the id.
      const invoice = await getInvoice(number.trim())
      setResult(await checkInvoice(invoice.id))
    } catch (error) {
      toast.error(
        'Could not check that invoice',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Invoice check"
      description="Recomputes the totals, compares payments, and asks about anything delivered but not billed. It never changes the invoice."
      icon={<Receipt />}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && run()}
            placeholder="Invoice number, e.g. INV-2026-0001"
          />
          <Button onClick={run} disabled={busy || !number.trim()}>
            {busy ? 'Checking…' : 'Check'}
          </Button>
        </div>

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-semibold">{result.invoiceNumber}</p>
              {result.clean ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                  Nothing found
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                  {result.findings.length} to look at
                </Badge>
              )}
            </div>

            <DegradedNotice meta={result.meta} />
            {result.summary && <p className="text-[13px]">{result.summary}</p>}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-3">
              {Object.entries(result.stored).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{key}</dt>
                  <dd>{inr(Number(value))}</dd>
                </div>
              ))}
            </dl>

            {result.findings.length > 0 && (
              <ul className="space-y-2">
                {result.findings.map((finding, index) => (
                  <li
                    key={`${finding.code}-${index}`}
                    className="rounded-lg border border-border px-3 py-2 text-[12.5px]"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant="outline">{finding.severity}</Badge>
                      <span className="text-[11.5px] uppercase tracking-wide text-muted-foreground">
                        {finding.code.replace(/_/g, ' ')}
                      </span>
                    </div>
                    {finding.message}
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[11.5px] text-muted-foreground">
              Findings are for a person to act on. Nothing here has been applied to the invoice, and
              no charge has been added.
            </p>
            <AiProvenance meta={result.meta} />
          </div>
        )}
      </div>
    </SectionCard>
  )
}

/* -------------------------------------------------------------------------- */
/* 5. Finance insights                                                        */
/* -------------------------------------------------------------------------- */

function FinancePanel() {
  const [insights, setInsights] = React.useState<FinanceInsights | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setInsights(await getFinanceInsights())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the figures.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Finance insights"
      description="The last 30 days against the 30 before them."
      icon={<TrendingUp />}
      action={
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          {busy ? 'Working…' : insights ? 'Refresh' : 'Run'}
        </Button>
      }
    >
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      {!insights && !error && !busy && (
        <p className="text-[13px] text-muted-foreground">
          Press <strong>Run</strong> to compare the two periods.
        </p>
      )}
      {insights && (
        <div className="space-y-4">
          <p className="text-[11.5px] text-muted-foreground">
            {insights.period} · compared with {insights.comparedWith}
          </p>
          <DegradedNotice meta={insights.meta} />

          <dl className="grid gap-3 sm:grid-cols-2">
            {insights.metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-border px-3 py-2">
                <dt className="text-[11.5px] uppercase tracking-wide text-muted-foreground">
                  {metric.label}
                </dt>
                <dd className="text-[15px] font-semibold">{inr(Number(metric.current))}</dd>
                <dd className="text-[11.5px] text-muted-foreground">
                  {Number(metric.delta) === 0
                    ? 'unchanged'
                    : `${Number(metric.delta) > 0 ? '+' : '−'}${inr(Math.abs(Number(metric.delta)))}`}
                  {/* No percentage where the previous period was zero: there
                      isn't one, and printing 100% would be a made-up figure. */}
                  {metric.percent !== null ? ` (${metric.percent.toFixed(1)}%)` : ''}
                </dd>
              </div>
            ))}
          </dl>

          {insights.summary && <p className="text-[13px]">{insights.summary}</p>}

          {insights.drivers.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[13px] font-semibold">Where the movement is</h3>
              <ul className="space-y-1 text-[12.5px]">
                {insights.drivers.map((driver) => (
                  <li key={driver.label} className="flex justify-between gap-3">
                    <span>{driver.label}</span>
                    <span className="text-muted-foreground">
                      {Number(driver.delta) > 0 ? '+' : '−'}
                      {inr(Math.abs(Number(driver.delta)))} · {Math.round(driver.share * 100)}% of the
                      change
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {insights.unexplained && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
              {insights.unexplained}
            </p>
          )}

          <AiProvenance meta={insights.meta} />
        </div>
      )}
    </SectionCard>
  )
}
