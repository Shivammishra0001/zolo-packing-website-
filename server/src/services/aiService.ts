/**
 * The AI layer's client.
 *
 * Every response carries a `meta` block, and the screens read it rather than
 * assuming. `meta.degraded` means the answer came from the database alone and
 * no model ran — the figures are real, the narrative is missing, and the UI
 * says so instead of showing a template as though it were generated.
 *
 * Nothing here can send a message or write a clinical record on its own. The
 * two mutating calls (`reviewDocument`, `approveMessage`) carry a person's
 * decision, which is the only way either happens.
 */

import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Shared                                                                     */
/* -------------------------------------------------------------------------- */

export interface AiMeta {
  agent: string
  status: string
  /** "none" when nothing was called. Never a key. */
  provider: string
  model: string
  promptVersion: string
  generatedAt: string
  /** True whenever the deterministic half answered alone. */
  degraded: boolean
  /** Plain-language reason, shown to the user when degraded. */
  notice: string
  requiresReview: boolean
}

export interface AiStatus {
  enabled: boolean
  provider: string
  model: string
  ocrEnabled: boolean
  messagingEnabled: boolean
  /** Only the agents this caller's permissions allow. */
  agents: string[]
  remainingThisHour: number
}

export function getAiStatus(): Promise<AiStatus> {
  return api.get<AiStatus>('/api/ai/status')
}

/* -------------------------------------------------------------------------- */
/* 1. Patient recap                                                           */
/* -------------------------------------------------------------------------- */

export interface TimelineEvent {
  kind: string
  date: string
  title: string
  detail: string
  by: string
}

export interface PatientRecap {
  meta: AiMeta
  patientId: string
  patientName: string
  since: string
  /** Built in SQL. Present whether or not a model ran. */
  timeline: TimelineEvent[]
  counts: Record<string, number>
  summary: string
  watchPoints: string[]
  gaps: string[]
}

export function generateRecap(patientId: string): Promise<PatientRecap> {
  return api.post<PatientRecap>(`/api/ai/patients/${encodeURIComponent(patientId)}/recap`)
}

/* -------------------------------------------------------------------------- */
/* 2. Clinical documentation                                                  */
/* -------------------------------------------------------------------------- */

export interface ExtractedMedicine {
  name: string
  strength: string
  dosage: string
  frequency: string
  duration: string
  instructions: string
}

export interface DocumentExtraction {
  kind: string
  patientNameOnDocument: string
  documentDate: string | null
  prescriber: string
  medicines: ExtractedMedicine[]
  diagnosis: string
  notes: string
  /** Fragments the reader could not resolve, kept exactly as written. */
  uncertain: string[]
  confidence: 'high' | 'medium' | 'low'
}

export interface AiDocument {
  id: string
  patientId: string
  patientName: string
  kind: string
  filename: string
  contentType: string
  sizeBytes: number
  ocrText: string
  ocrProvider: string
  extracted: DocumentExtraction | null
  reviewStatus: string
  applied: boolean
  uploadedBy: string
  reviewedBy: string
  reviewedAt: string | null
  createdAt: string
  meta: AiMeta | null
}

export function listDocuments(reviewStatus?: string, limit = 25): Promise<AiDocument[]> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (reviewStatus) query.set('review_status', reviewStatus)
  return api.get<AiDocument[]>(`/api/ai/documents?${query.toString()}`)
}

export function getDocument(id: string): Promise<AiDocument> {
  return api.get<AiDocument>(`/api/ai/documents/${encodeURIComponent(id)}`)
}

/**
 * Upload goes through `fetch` directly rather than the JSON client: the body is
 * multipart, and letting the client set `Content-Type` would strip the boundary
 * the server needs to parse it.
 */
export async function uploadDocument(
  patientId: string,
  file: File,
  kind?: string,
): Promise<AiDocument> {
  const form = new FormData()
  form.append('patientId', patientId)
  form.append('file', file)
  if (kind) form.append('kind', kind)
  return api.upload<AiDocument>('/api/ai/documents', form)
}

export interface DocumentReview {
  approve: boolean
  kind?: string
  medicines?: ExtractedMedicine[]
  diagnosis?: string
  notes?: string
  reason?: string
}

export function reviewDocument(id: string, payload: DocumentReview): Promise<AiDocument> {
  return api.post<AiDocument>(`/api/ai/documents/${encodeURIComponent(id)}/review`, payload)
}

/* -------------------------------------------------------------------------- */
/* 3. Billing accuracy                                                        */
/* -------------------------------------------------------------------------- */

export interface BillingFinding {
  code: string
  severity: 'high' | 'medium' | 'low'
  message: string
  delta: string | null
  reference: string
}

export interface BillingCheck {
  meta: AiMeta
  invoiceId: string
  invoiceNumber: string
  /** Recomputed from the stored lines, in the backend, in Decimal. */
  recomputed: Record<string, string>
  stored: Record<string, string>
  findings: BillingFinding[]
  clean: boolean
  summary: string
}

export function checkInvoice(invoiceId: string): Promise<BillingCheck> {
  return api.post<BillingCheck>(`/api/ai/invoices/${encodeURIComponent(invoiceId)}/check`)
}

/* -------------------------------------------------------------------------- */
/* 4. Follow-ups and reminders                                                */
/* -------------------------------------------------------------------------- */

export interface FollowUpSuggestion {
  patientId: string
  patientName: string
  /** Where the date came from. Never a model — see the backend agent. */
  source: 'clinician' | 'rule' | 'model'
  dueOn: string
  reason: string
  lastSeen: string | null
}

export interface MessageDraft {
  id: string
  patientId: string
  patientName: string
  channel: string
  body: string
  reason: string
  dueOn: string | null
  status: string
  aiGenerated: boolean
  approvedBy: string
  approvedAt: string | null
  /** A gateway accepted it. Not a delivery receipt. */
  sentAt: string | null
  deliveredAt: string | null
  failureReason: string
  createdAt: string
}

export interface FollowUpRun {
  meta: AiMeta
  suggestions: FollowUpSuggestion[]
  drafts: MessageDraft[]
  /** Patients who are due but cannot be messaged, and why. */
  skipped: string[]
}

export function generateFollowUps(
  payload: { horizonDays?: number; channel?: string; limit?: number } = {},
): Promise<FollowUpRun> {
  return api.post<FollowUpRun>('/api/ai/followups/generate', {
    horizonDays: payload.horizonDays ?? 14,
    channel: payload.channel ?? 'SMS',
    limit: payload.limit ?? 25,
  })
}

export function listMessages(status?: string, limit = 50): Promise<MessageDraft[]> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (status) query.set('message_status', status)
  return api.get<MessageDraft[]>(`/api/ai/messages?${query.toString()}`)
}

export function approveMessage(
  id: string,
  payload: { approve: boolean; body?: string; reason?: string },
): Promise<MessageDraft> {
  return api.post<MessageDraft>(`/api/ai/messages/${encodeURIComponent(id)}/approve`, payload)
}

/* -------------------------------------------------------------------------- */
/* 5. Finance insights                                                        */
/* -------------------------------------------------------------------------- */

export interface FinanceMetric {
  label: string
  current: string
  previous: string
  delta: string
  /** Null where the previous period was zero — not Infinity, not 100%. */
  percent: number | null
}

export interface FinanceDriver {
  label: string
  delta: string
  share: number
}

export interface FinanceInsights {
  meta: AiMeta
  period: string
  comparedWith: string
  metrics: FinanceMetric[]
  /** Where the movement happened. */
  drivers: FinanceDriver[]
  /** Present whenever the records show where but not why. */
  unexplained: string
  summary: string
}

export function getFinanceInsights(startDate?: string, endDate?: string): Promise<FinanceInsights> {
  const query = new URLSearchParams()
  if (startDate) query.set('start_date', startDate)
  if (endDate) query.set('end_date', endDate)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return api.post<FinanceInsights>(`/api/ai/finance/insights${suffix}`)
}
