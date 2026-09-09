/** Therapy session endpoints: the therapist's diary and the delivery workflow. */

import type { TherapySession, TherapyType } from '@/types'
import { api } from '@/services/api'

/** One exercise performed, with its prescribed dose. */
export interface SessionExercise {
  id: string
  exerciseId: string | null
  name: string
  sets: number | null
  repetitions: number | null
  duration: number | null
  notes: string | null
}

/**
 * The API's session row: the frontend `TherapySession` shape plus the fields
 * that tie it to a rehabilitation plan.
 */
export interface TherapySessionRecord extends TherapySession {
  uuid: string
  patientUuid: string
  patientInitials: string
  patientAvatarColor: string
  exerciseDetail: SessionExercise[]
  planId: string | null
  planTitle: string | null
  /** How the patient tolerated it, recorded alongside the notes. */
  tolerance: string | null
  attendance: 'Attended' | 'Late' | 'No Show' | 'Cancelled' | null
  nextSessionDate: string | null
  /** Position within the plan, e.g. session 7 of 24. */
  sequence: number | null
  createdAt: string | null
  updatedAt: string | null
}

export interface TherapySessionPage {
  items: TherapySessionRecord[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ListParams {
  page?: number
  limit?: number
  /** A therapist always sees their own diary; `all` is refused for them. */
  scope?: 'auto' | 'mine' | 'all'
  patient?: string
  plan?: string
  date?: string
  dateFrom?: string
  dateTo?: string
  status?: TherapySession['status'][]
  type?: TherapyType
}

export async function listSessions(params: ListParams = {}): Promise<TherapySessionPage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 100))
  if (params.scope) query.set('scope', params.scope)
  if (params.patient) query.set('patient', params.patient)
  if (params.plan) query.set('plan', params.plan)
  if (params.date) query.set('date', params.date)
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)
  if (params.type) query.set('type', params.type)
  for (const status of params.status ?? []) query.append('status', status)

  const page = await api.get<{
    items: TherapySessionRecord[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/therapy/sessions?${query}`)

  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function getSession(identifier: string): Promise<TherapySessionRecord> {
  return api.get<TherapySessionRecord>(`/api/therapy/sessions/${encodeURIComponent(identifier)}`)
}

export function sessionsForPlan(planId: string): Promise<TherapySessionRecord[]> {
  return api.get<TherapySessionRecord[]>(
    `/api/rehab/plans/${encodeURIComponent(planId)}/sessions`,
  )
}

export function sessionsForPatient(patientId: string): Promise<TherapySessionRecord[]> {
  return api.get<TherapySessionRecord[]>(
    `/api/patients/${encodeURIComponent(patientId)}/therapy-sessions`,
  )
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface SessionExercisePayload {
  exerciseId?: string
  name?: string
  sets?: number
  repetitions?: number
  duration?: number
  notes?: string
}

export interface SessionPayload {
  /** A session belongs to a plan — that link is what makes progress countable. */
  planId: string
  date: string
  time?: string
  durationMinutes?: number
  type?: TherapyType
  room?: string
  painBefore?: number
  painAfter?: number
  mobilityScore?: number
  strengthScore?: number
  notes?: string
  tolerance?: string
  nextSessionDate?: string
  exercises?: SessionExercisePayload[]
}

/** The therapist is the signed-in user — no therapist id is sent. */
export function createSession(payload: SessionPayload): Promise<TherapySessionRecord> {
  return api.post<TherapySessionRecord>('/api/therapy/sessions', payload)
}

export function updateSession(
  identifier: string,
  payload: Partial<Omit<SessionPayload, 'planId'>>,
): Promise<TherapySessionRecord> {
  return api.put<TherapySessionRecord>(
    `/api/therapy/sessions/${encodeURIComponent(identifier)}`,
    payload,
  )
}

/* -------------------------------------------------------------------------- */
/* Workflow                                                                   */
/* -------------------------------------------------------------------------- */

export type SessionCompletePayload = Omit<
  SessionPayload,
  'planId' | 'date' | 'time' | 'type' | 'room'
>

function action(identifier: string, verb: string, body?: unknown) {
  return api.post<TherapySessionRecord>(
    `/api/therapy/sessions/${encodeURIComponent(identifier)}/${verb}`,
    body,
  )
}

/** Scheduled → In Progress. */
export const startSession = (id: string) => action(id, 'start')

/**
 * In Progress → Completed, with the final measurements.
 *
 * The owning plan's progress moves in the same transaction, so the plan's
 * counters can never disagree with its sessions.
 */
export const completeSession = (id: string, payload: SessionCompletePayload = {}) =>
  action(id, 'complete', payload)

/** The patient did not attend — counts against attendance, not delivery. */
export const markNoShow = (id: string) => action(id, 'no-show')

/** The identifier the action endpoints want, preferring the database id. */
export function sessionKey(session: TherapySession & { uuid?: string }): string {
  return session.uuid ?? session.id
}
