import type { Patient } from '@/types'

/**
 * Overall rehabilitation completion, 0-100.
 *
 * A pure presentation helper, kept client-side: the server returns the session
 * counts and the UI derives the percentage from them.
 */
export function rehabCompletion(patient: Patient): number {
  if (!patient.rehabPlan || !patient.rehabPlan.totalSessions) return 0
  return Math.round((patient.rehabPlan.completedSessions / patient.rehabPlan.totalSessions) * 100)
}
