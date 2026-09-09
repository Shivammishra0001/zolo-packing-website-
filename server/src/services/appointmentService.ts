/** Appointment endpoints: the diary, the reception queue and the visit workflow. */

import type { Appointment, AppointmentStatus, AppointmentType, Gender } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

/** One appointment as the API returns it. */
export interface ApiAppointment {
  id: string
  uuid: string
  patientId: string
  patientUuid: string
  patientName: string
  patientAge: number | null
  patientGender: Gender
  patientInitials: string
  patientAvatarColor: string
  doctor: string
  doctorId: string
  therapist: string
  therapistId: string
  date: string
  time: string
  endTime: string
  type: AppointmentType
  department: string
  status: AppointmentStatus
  tokenNumber: number | null
  checkedInAt: string | null
  notes: string | null
  room: string | null
  createdAt: string | null
  updatedAt: string | null
}

interface ApiPage {
  items: ApiAppointment[]
  page: number
  limit: number
  total: number
  total_pages: number
}

export interface AppointmentPage {
  items: Appointment[]
  page: number
  limit: number
  total: number
  totalPages: number
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

/** Map onto the frontend's existing `Appointment` type, so screens are unchanged. */
export function toAppointment(row: ApiAppointment): Appointment {
  return {
    id: row.id,
    uuid: row.uuid,
    patientId: row.patientId,
    patientUuid: row.patientUuid,
    patientName: row.patientName,
    patientAge: row.patientAge ?? 0,
    patientGender: row.patientGender,
    patientInitials: row.patientInitials,
    patientAvatarColor: row.patientAvatarColor,
    time: row.time,
    endTime: row.endTime,
    date: row.date,
    doctor: row.doctor,
    doctorId: row.doctorId,
    therapist: row.therapist || undefined,
    therapistId: row.therapistId || undefined,
    type: row.type,
    department: row.department,
    status: row.status,
    checkedInAt: row.checkedInAt ?? undefined,
    tokenNumber: row.tokenNumber ?? 0,
    notes: row.notes ?? undefined,
    room: row.room ?? undefined,
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface ListParams {
  page?: number
  limit?: number
  /**
   * `auto` narrows a doctor or therapist to their own diary — what their
   * dashboard shows. `branch` is the whole clinic diary, for reception.
   */
  scope?: 'auto' | 'mine' | 'branch'
  date?: string
  dateFrom?: string
  dateTo?: string
  /** Patient UUID or `PT-#####` code. */
  patient?: string
  status?: AppointmentStatus[]
  type?: AppointmentType
}

function toQuery(params: ListParams): string {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 100))
  if (params.scope) query.set('scope', params.scope)
  if (params.date) query.set('date', params.date)
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)
  if (params.patient) query.set('patient', params.patient)
  if (params.type) query.set('type', params.type)
  // Repeated key — the API accepts several statuses.
  for (const status of params.status ?? []) query.append('status', status)
  return query.toString()
}

export async function listAppointments(params: ListParams = {}): Promise<AppointmentPage> {
  const page = await api.get<ApiPage>(`/api/appointments?${toQuery(params)}`)
  return {
    items: page.items.map(toAppointment),
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export async function getAppointment(identifier: string): Promise<Appointment> {
  return toAppointment(
    await api.get<ApiAppointment>(`/api/appointments/${encodeURIComponent(identifier)}`),
  )
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface AppointmentPayload {
  /** Patient UUID or `PT-#####` code. */
  patientId: string
  doctorId?: string | null
  therapistId?: string | null
  date: string
  time: string
  endTime?: string
  durationMinutes?: number
  type: AppointmentType
  notes?: string
  room?: string
}

export async function createAppointment(payload: AppointmentPayload): Promise<Appointment> {
  return toAppointment(await api.post<ApiAppointment>('/api/appointments', payload))
}

/** Reschedule or amend. Status is not settable here — use the workflow calls. */
export async function updateAppointment(
  identifier: string,
  payload: Partial<Omit<AppointmentPayload, 'patientId'>>,
): Promise<Appointment> {
  return toAppointment(
    await api.put<ApiAppointment>(`/api/appointments/${encodeURIComponent(identifier)}`, payload),
  )
}

/* -------------------------------------------------------------------------- */
/* Workflow                                                                   */
/* -------------------------------------------------------------------------- */

function action(identifier: string, verb: string, body?: unknown): Promise<Appointment> {
  return api
    .post<ApiAppointment>(`/api/appointments/${encodeURIComponent(identifier)}/${verb}`, body)
    .then(toAppointment)
}

/** Scheduled → Waiting. The arrival time is stamped by the server. */
export const checkIn = (id: string) => action(id, 'check-in')

/** Waiting → In Consultation. The assigned clinician or front-desk staff. */
export const startAppointment = (id: string) => action(id, 'start')

/** In Consultation → Completed. The assigned clinician or front-desk staff. */
export const completeAppointment = (id: string) => action(id, 'complete')

/** Cancels rather than deletes — the row stays as history, the slot is freed. */
export const cancelAppointment = (id: string, reason?: string) =>
  action(id, 'cancel', { reason: reason ?? null })

export const markNoShow = (id: string) => action(id, 'no-show')

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The identifier the action endpoints want, preferring the database id. */
export function appointmentKey(appointment: Appointment): string {
  return appointment.uuid ?? appointment.id
}

/** Today as `YYYY-MM-DD` in local time (`toISOString` would shift the date). */
export function todayIso(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

/** Minutes elapsed since an `HH:MM` clock time, relative to `now`. */
export function minutesSince(hhmm: string | undefined, now = new Date()): number | null {
  if (!hhmm) return null
  const [hours, minutes] = hhmm.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  const elapsed = now.getHours() * 60 + now.getMinutes() - (hours * 60 + minutes)
  return Math.max(0, elapsed)
}
