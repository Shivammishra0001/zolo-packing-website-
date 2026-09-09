/** Rehabilitation plans, milestones, progress and the therapist's caseload. */

import type { ProgressPoint, RehabTrend } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type RehabPlanStatus = 'Active' | 'On Hold' | 'Completed' | 'Cancelled'

/** One milestone. `label` and `done` are the shape the plan card already reads. */
export interface Milestone {
  id: string
  label: string
  done: boolean
  date: string | null
  description: string | null
  status: 'Pending' | 'Achieved' | 'Missed'
  completedAt: string | null
  sortOrder: number
}

/**
 * One plan.
 *
 * `trend`, `completedSessions`, `attendanceRate` and `adherenceRate` are all
 * derived server-side from therapy sessions — they are read-only here.
 */
export interface RehabPlanRecord {
  id: string
  patientId: string
  patientUuid: string
  patientName: string
  /** Avatar details, so a plan row renders without a lookup per patient. */
  patientInitials: string
  patientAvatarColor: string
  title: string
  goal: string | null
  startDate: string | null
  targetEndDate: string | null
  totalSessions: number
  completedSessions: number
  progressPercentage: number
  frequencyPerWeek: number | null
  primaryTherapist: string
  therapistId: string
  modalities: string[]
  trend: RehabTrend
  attendanceRate: number | null
  adherenceRate: number | null
  status: RehabPlanStatus
  milestones: Milestone[]
  createdAt: string | null
  updatedAt: string | null
}

export interface RehabPlanPage {
  items: RehabPlanRecord[]
  page: number
  limit: number
  total: number
  totalPages: number
}

/** One patient on the therapist's caseload, with the plan that puts them there. */
export interface CaseloadEntry {
  patientId: string
  patientUuid: string
  patientName: string
  initials: string
  avatarColor: string
  age: number | null
  primaryCondition: string | null
  planId: string
  planTitle: string
  totalSessions: number
  completedSessions: number
  progressPercentage: number
  trend: RehabTrend
  attendanceRate: number | null
  adherenceRate: number | null
  nextSessionDate: string | null
}

export interface SessionProgressPoint {
  sessionId: string
  sessionNumber: string
  sequence: number
  date: string
  painBefore: number | null
  painAfter: number | null
  mobility: number | null
  strength: number | null
  attendance: string | null
}

export interface RehabProgress {
  planId: string
  patientId: string
  /** The weekly series the charts plot. */
  progress: ProgressPoint[]
  /** The per-session clinical record behind it. */
  sessions: SessionProgressPoint[]
  summary: {
    completedSessions: number
    totalSessions: number
    completionPercentage: number
    attendedSessions: number
    missedSessions: number
    attendanceRate: number | null
    adherenceRate: number | null
    trend: RehabTrend
  }
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

export interface ListParams {
  page?: number
  limit?: number
  /** A therapist always sees their own caseload; `all` is refused for them. */
  scope?: 'auto' | 'mine' | 'all'
  patient?: string
  status?: RehabPlanStatus
  trend?: RehabTrend
}

export async function listPlans(params: ListParams = {}): Promise<RehabPlanPage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 100))
  if (params.scope) query.set('scope', params.scope)
  if (params.patient) query.set('patient', params.patient)
  if (params.status) query.set('status', params.status)
  if (params.trend) query.set('trend', params.trend)

  const page = await api.get<{
    items: RehabPlanRecord[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/rehab/plans?${query}`)

  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function getPlan(planId: string): Promise<RehabPlanRecord> {
  return api.get<RehabPlanRecord>(`/api/rehab/plans/${encodeURIComponent(planId)}`)
}

export interface RehabPlanPayload {
  /** Patient UUID or `PT-#####` code. */
  patientId: string
  /** Therapist UUID or `USR-####` code — verified server-side, not trusted. */
  therapistId: string
  title: string
  goal?: string
  startDate?: string
  targetEndDate?: string
  totalSessions: number
  frequencyPerWeek?: number
  modalities?: string[]
  milestones?: { label: string; description?: string; date?: string }[]
}

export function createPlan(payload: RehabPlanPayload): Promise<RehabPlanRecord> {
  return api.post<RehabPlanRecord>('/api/rehab/plans', payload)
}

export function updatePlan(
  planId: string,
  payload: Partial<Omit<RehabPlanPayload, 'patientId' | 'milestones'>>,
): Promise<RehabPlanRecord> {
  return api.put<RehabPlanRecord>(`/api/rehab/plans/${encodeURIComponent(planId)}`, payload)
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

function lifecycle(planId: string, verb: string): Promise<RehabPlanRecord> {
  return api.post<RehabPlanRecord>(`/api/rehab/plans/${encodeURIComponent(planId)}/${verb}`)
}

/** Explicit — filling the session budget does not finish a programme by itself. */
export const completePlan = (id: string) => lifecycle(id, 'complete')
export const holdPlan = (id: string) => lifecycle(id, 'hold')
export const resumePlan = (id: string) => lifecycle(id, 'resume')
/** The non-destructive alternative to deletion. */
export const cancelPlan = (id: string) => lifecycle(id, 'cancel')

/* -------------------------------------------------------------------------- */
/* Caseload, milestones and progress                                          */
/* -------------------------------------------------------------------------- */

/** The patients this therapist is responsible for, from their active plans. */
export function myCaseload(): Promise<CaseloadEntry[]> {
  return api.get<CaseloadEntry[]>('/api/rehab/caseload')
}

export function listMilestones(planId: string): Promise<Milestone[]> {
  return api.get<Milestone[]>(`/api/rehab/plans/${encodeURIComponent(planId)}/milestones`)
}

export function addMilestone(
  planId: string,
  payload: { label: string; description?: string; date?: string },
): Promise<Milestone> {
  return api.post<Milestone>(`/api/rehab/plans/${encodeURIComponent(planId)}/milestones`, payload)
}

/** The completion timestamp is server-set. */
export function completeMilestone(milestoneId: string): Promise<Milestone> {
  return api.post<Milestone>(`/api/rehab/milestones/${encodeURIComponent(milestoneId)}/complete`)
}

export function planProgress(planId: string): Promise<RehabProgress> {
  return api.get<RehabProgress>(`/api/rehab/plans/${encodeURIComponent(planId)}/progress`)
}

/** Record one week's review. A second submission for the same week updates it. */
export function recordProgress(
  planId: string,
  payload: { pain: number; mobility: number; strength: number; adherence: number; week?: string; weekStart?: string },
): Promise<ProgressPoint> {
  return api.post<ProgressPoint>(
    `/api/rehab/plans/${encodeURIComponent(planId)}/progress`,
    payload,
  )
}

/** The chart series for one patient, across their plans. */
export function patientProgress(patientId: string): Promise<ProgressPoint[]> {
  return api.get<ProgressPoint[]>(`/api/patients/${encodeURIComponent(patientId)}/progress`)
}

export function plansForPatient(patientId: string): Promise<RehabPlanRecord[]> {
  return api.get<RehabPlanRecord[]>(`/api/patients/${encodeURIComponent(patientId)}/rehab-plans`)
}
