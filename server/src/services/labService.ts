/** Lab result endpoints: released reports and clinical sign-off. */

import { api } from '@/services/api'

/** One analyte row within a report. */
export interface LabValue {
  analyte: string
  value: string
  reference: string | null
  abnormal: boolean
}

/** Matches the `LabResult` shape the Labs page already renders. */
export interface LabResult {
  id: string
  uuid: string
  patientId: string
  patientUuid: string
  patientName: string
  test: string
  reportedOn: string
  flag: 'Normal' | 'Abnormal' | 'Critical'
  summary: string | null
  values: LabValue[]
  reviewed: boolean
  /** Set by the server when signed off — never sent by the client. */
  reviewedBy: string | null
  reviewedAt: string | null
  orderedBy: string | null
}

export interface LabPage {
  items: LabResult[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ListParams {
  page?: number
  limit?: number
  /** Patient UUID or `PT-#####` code — filtered in SQL, not in the browser. */
  patient?: string
  /** `false` is the review queue. */
  reviewed?: boolean
  flag?: LabResult['flag']
}

export async function listLabs(params: ListParams = {}): Promise<LabPage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 100))
  if (params.patient) query.set('patient', params.patient)
  if (params.reviewed !== undefined) query.set('reviewed', String(params.reviewed))
  if (params.flag) query.set('flag', params.flag)

  const page = await api.get<{
    items: LabResult[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/labs?${query}`)

  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function getLab(identifier: string): Promise<LabResult> {
  return api.get<LabResult>(`/api/labs/${encodeURIComponent(identifier)}`)
}

/**
 * Sign a report off.
 *
 * `reviewedBy` and `reviewedAt` are set by the server from the authenticated
 * user, so nothing about the sign-off is sent from here.
 */
export function reviewLab(identifier: string): Promise<LabResult> {
  return api.post<LabResult>(`/api/labs/${encodeURIComponent(identifier)}/review`)
}
