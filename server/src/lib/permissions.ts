import type { Permission, Role } from '@/types'

/**
 * Frontend permission matrix.
 *
 * This is deliberately a plain data structure so that a real backend can later
 * return the same shape (`{ role, permissions[] }`) from `/api/session` and the
 * UI keeps working unchanged. Nothing in the app checks `role === 'doctor'` for
 * gating — everything goes through `can()` / `<Guard>` / route `permission`.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    'patient.view',
    'appointment.view',
    'rehab.plan.view',
    'therapy.progress.view',
    'billing.view',
    'finance.reports',
    'beds.view',
    'analytics.business',
    'analytics.operational',
    'audit.view',
  ],
  admin: [
    'patient.view',
    'patient.create',
    'patient.edit',
    'appointment.view',
    'appointment.create',
    'rehab.plan.view',
    'therapy.progress.view',
    'pharmacy.inventory',
    'billing.view',
    'billing.manage',
    'finance.reports',
    'beds.view',
    'beds.manage',
    'analytics.business',
    'analytics.operational',
    'staff.manage',
    'roles.manage',
    'branches.manage',
    'audit.view',
    'settings.manage',
  ],
  doctor: [
    'patient.view',
    'patient.edit',
    'patient.clinical.view',
    'patient.clinical.edit',
    'appointment.view',
    'appointment.create',
    'consultation.manage',
    'prescription.create',
    'rehab.plan.view',
    'rehab.plan.manage',
    'therapy.progress.view',
    'beds.view',
    'analytics.operational',
  ],
  therapist: [
    'patient.view',
    'patient.clinical.view',
    'appointment.view',
    'rehab.plan.view',
    'rehab.plan.manage',
    'therapy.session.manage',
    'therapy.progress.view',
    'analytics.operational',
  ],
  nurse: [
    'patient.view',
    'patient.clinical.view',
    'appointment.view',
    'vitals.record',
    'nursing.tasks',
    'rehab.plan.view',
    'beds.view',
    'beds.manage',
  ],
  pharmacist: [
    'patient.view',
    'prescription.dispense',
    'pharmacy.inventory',
    'pharmacy.pos',
    'billing.view',
  ],
  receptionist: [
    'patient.view',
    'patient.create',
    'patient.edit',
    'appointment.view',
    'appointment.create',
    'appointment.checkin',
    'billing.view',
    'billing.manage',
    'beds.view',
  ],
  accountant: [
    'patient.view',
    'billing.view',
    'billing.manage',
    'payments.manage',
    'expenses.manage',
    'finance.reports',
    'analytics.business',
  ],
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Hospital Owner',
  admin: 'Administrator',
  doctor: 'Doctor',
  therapist: 'Therapist',
  nurse: 'Nurse',
  pharmacist: 'Pharmacist',
  receptionist: 'Receptionist',
  accountant: 'Accountant',
}

export const ROLE_HOME: Record<Role, string> = {
  owner: '/owner/dashboard',
  admin: '/admin/dashboard',
  doctor: '/doctor/dashboard',
  therapist: '/therapist/dashboard',
  nurse: '/nurse/dashboard',
  pharmacist: '/pharmacist/dashboard',
  receptionist: '/reception/dashboard',
  accountant: '/accountant/dashboard',
}

/** Tailwind-friendly accent per role, used for badges and avatars. */
export const ROLE_ACCENT: Record<Role, string> = {
  owner: 'bg-chart-5/12 text-chart-5 border-chart-5/25',
  admin: 'bg-chart-2/12 text-chart-2 border-chart-2/25',
  doctor: 'bg-info/12 text-info border-info/25',
  therapist: 'bg-accent/12 text-accent border-accent/25',
  nurse: 'bg-chart-6/12 text-chart-6 border-chart-6/25',
  pharmacist: 'bg-success/12 text-success border-success/25',
  receptionist: 'bg-warning/12 text-warning border-warning/25',
  accountant: 'bg-chart-3/12 text-chart-3 border-chart-3/25',
}

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

export function can(permissions: Permission[], required?: Permission | Permission[]): boolean {
  if (!required) return true
  const list = Array.isArray(required) ? required : [required]
  return list.every((p) => permissions.includes(p))
}

export function canAny(permissions: Permission[], required: Permission[]): boolean {
  return required.some((p) => permissions.includes(p))
}
