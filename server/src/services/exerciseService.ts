/**
 * The exercise library.
 *
 * Shared clinical configuration: every therapist reads it, editing needs
 * `settings.manage`, so protocol lists cannot drift per person.
 */

import type { TherapyType } from '@/types'
import { api } from '@/services/api'

export interface Exercise {
  id: string
  name: string
  category: TherapyType
  description: string | null
  instructions: string | null
  defaultDuration: number | null
  isActive: boolean
}

export interface ListParams {
  /** Matches the name and description — filtered in SQL, not in the browser. */
  search?: string
  category?: TherapyType
  /** `false` includes retired exercises, which a historical session needs. */
  active?: boolean
}

export function listExercises(params: ListParams = {}): Promise<Exercise[]> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.category) query.set('category', params.category)
  if (params.active !== undefined) query.set('active', String(params.active))

  const suffix = query.toString()
  return api.get<Exercise[]>(`/api/exercises${suffix ? `?${suffix}` : ''}`)
}

/**
 * The library grouped by discipline — the `Record<category, string[]>` shape
 * the session form's checkbox list already binds to.
 */
export async function exerciseLibraryByCategory(
  category?: TherapyType,
): Promise<Record<string, string[]>> {
  const rows = await listExercises({ category })
  return rows.reduce<Record<string, string[]>>((acc, row) => {
    ;(acc[row.category] ??= []).push(row.name)
    return acc
  }, {})
}

export interface ExercisePayload {
  name: string
  category: TherapyType
  description?: string
  instructions?: string
  defaultDuration?: number
}

export function createExercise(payload: ExercisePayload): Promise<Exercise> {
  return api.post<Exercise>('/api/exercises', payload)
}

/** Setting `isActive: false` retires an exercise rather than deleting it. */
export function updateExercise(
  id: string,
  payload: Partial<ExercisePayload> & { isActive?: boolean },
): Promise<Exercise> {
  return api.put<Exercise>(`/api/exercises/${encodeURIComponent(id)}`, payload)
}
