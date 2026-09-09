import type { NavSection, Role } from '@/types'

/**
 * Role-scoped navigation. Each item may carry a `permission`; the sidebar hides
 * anything the signed-in user is not allowed to open, so navigation and route
 * guards always agree.
 */
export const NAVIGATION: Record<Role, NavSection[]> = {
  owner: [
    {
      items: [
        { label: 'Dashboard', to: '/owner/dashboard', icon: 'dashboard' },
        { label: 'Business Analytics', to: '/owner/analytics', icon: 'analytics', permission: 'analytics.business' },
        { label: 'Revenue', to: '/owner/revenue', icon: 'revenue', permission: 'analytics.business' },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Patients', to: '/patients', icon: 'patients', permission: 'patient.view' },
        { label: 'Occupancy', to: '/owner/occupancy', icon: 'bed', permission: 'beds.view' },
        { label: 'Therapy Utilisation', to: '/owner/therapy', icon: 'therapy', permission: 'therapy.progress.view' },
      ],
    },
    {
      title: 'Insight',
      items: [
        { label: 'Reports', to: '/reports', icon: 'reports', permission: 'finance.reports' },
        { label: 'Audit Log', to: '/admin/audit', icon: 'audit', permission: 'audit.view' },
        { label: 'AI Assistant', to: '/ai', icon: 'ai', permission: 'finance.reports' },
      ],
    },
  ],

  admin: [
    {
      items: [
        { label: 'Dashboard', to: '/admin/dashboard', icon: 'dashboard' },
        { label: 'Staff Management', to: '/admin/staff', icon: 'contacts', permission: 'staff.manage', badge: 3 },
        { label: 'Roles & Permissions', to: '/admin/roles', icon: 'security', permission: 'roles.manage' },
      ],
    },
    {
      title: 'Clinical Operations',
      items: [
        { label: 'Patients', to: '/patients', icon: 'patients', permission: 'patient.view' },
        { label: 'Appointments', to: '/appointments', icon: 'appointments', permission: 'appointment.view' },
        { label: 'Beds & Wards', to: '/beds', icon: 'bed', permission: 'beds.view' },
        { label: 'Pharmacy Stock', to: '/pharmacy/inventory', icon: 'inventory', permission: 'pharmacy.inventory' },
      ],
    },
    {
      title: 'System',
      items: [
        { label: 'Departments', to: '/admin/departments', icon: 'branches', permission: 'settings.manage' },
        { label: 'Branch Settings', to: '/admin/branches', icon: 'branches', permission: 'branches.manage' },
        { label: 'Configuration', to: '/admin/configuration', icon: 'settings', permission: 'settings.manage' },
        { label: 'Audit Log', to: '/admin/audit', icon: 'audit', permission: 'audit.view' },
        { label: 'Reports', to: '/reports', icon: 'reports', permission: 'analytics.operational' },
        { label: 'AI Assistant', to: '/ai', icon: 'ai', permission: 'finance.reports' },
      ],
    },
  ],

  doctor: [
    {
      items: [
        { label: 'Dashboard', to: '/doctor/dashboard', icon: 'dashboard' },
        { label: 'Appointments', to: '/doctor/appointments', icon: 'appointments', permission: 'appointment.view' },
        { label: 'Patients', to: '/patients', icon: 'patients', permission: 'patient.view' },
      ],
    },
    {
      title: 'Clinical',
      items: [
        { label: 'Consultations', to: '/doctor/consultations', icon: 'consultation', permission: 'consultation.manage' },
        { label: 'Prescriptions', to: '/doctor/prescriptions', icon: 'prescriptions', permission: 'prescription.create' },
        { label: 'Lab Results', to: '/doctor/labs', icon: 'labs', permission: 'patient.clinical.view', badge: 4 },
        { label: 'Rehab Plans', to: '/rehab/plans', icon: 'rehab', permission: 'rehab.plan.view' },
        { label: 'AI Assistant', to: '/ai', icon: 'ai', permission: 'patient.clinical.edit' },
      ],
    },
    {
      title: 'Insight',
      items: [{ label: 'Reports', to: '/reports', icon: 'reports', permission: 'analytics.operational' }],
    },
  ],

  therapist: [
    {
      items: [
        { label: 'Dashboard', to: '/therapist/dashboard', icon: 'dashboard' },
        { label: 'My Sessions', to: '/therapist/sessions', icon: 'therapy', permission: 'therapy.session.manage', badge: 7 },
        { label: 'Assigned Patients', to: '/patients', icon: 'patients', permission: 'patient.view' },
      ],
    },
    {
      title: 'Rehabilitation',
      items: [
        { label: 'Rehab Plans', to: '/rehab/plans', icon: 'rehab', permission: 'rehab.plan.manage' },
        { label: 'Progress Tracking', to: '/therapist/progress', icon: 'progress', permission: 'therapy.progress.view' },
      ],
    },
    {
      title: 'Insight',
      items: [{ label: 'Reports', to: '/reports', icon: 'reports', permission: 'analytics.operational' }],
    },
  ],

  nurse: [
    {
      items: [
        { label: 'Dashboard', to: '/nurse/dashboard', icon: 'dashboard' },
        { label: 'My Tasks', to: '/nurse/tasks', icon: 'tasks', permission: 'nursing.tasks', badge: 6 },
        { label: 'Patients', to: '/patients', icon: 'patients', permission: 'patient.view' },
      ],
    },
    {
      title: 'Ward Care',
      items: [
        { label: 'Vitals Rounds', to: '/nurse/vitals', icon: 'activity', permission: 'vitals.record' },
        { label: 'Beds & Wards', to: '/beds', icon: 'bed', permission: 'beds.view' },
        { label: 'Discharges', to: '/nurse/discharges', icon: 'worklist', permission: 'nursing.tasks', badge: 2 },
      ],
    },
  ],

  pharmacist: [
    {
      items: [
        { label: 'Dashboard', to: '/pharmacist/dashboard', icon: 'dashboard' },
        { label: 'Prescriptions', to: '/pharmacy/prescriptions', icon: 'prescriptions', permission: 'prescription.dispense', badge: 5 },
        { label: 'Point of Sale', to: '/pharmacy/pos', icon: 'cart', permission: 'pharmacy.pos' },
      ],
    },
    {
      title: 'Stock',
      items: [
        { label: 'Inventory', to: '/pharmacy/inventory', icon: 'inventory', permission: 'pharmacy.inventory' },
        { label: 'Stock Alerts', to: '/pharmacy/alerts', icon: 'alert', permission: 'pharmacy.inventory', badge: 8 },
      ],
    },
    {
      title: 'Insight',
      items: [
        { label: 'Reports', to: '/reports', icon: 'reports', permission: 'pharmacy.inventory' },
        { label: 'AI Assistant', to: '/ai', icon: 'ai', permission: 'billing.view' },
      ],
    },
  ],

  receptionist: [
    {
      items: [
        { label: 'Dashboard', to: '/reception/dashboard', icon: 'dashboard' },
        { label: 'Appointments', to: '/appointments', icon: 'appointments', permission: 'appointment.view' },
        { label: 'Check-in Queue', to: '/reception/queue', icon: 'worklist', permission: 'appointment.checkin' },
      ],
    },
    {
      title: 'Front Desk',
      items: [
        { label: 'Register Patient', to: '/reception/register', icon: 'register', permission: 'patient.create' },
        { label: 'Patients', to: '/patients', icon: 'patients', permission: 'patient.view' },
        { label: 'Bed Availability', to: '/beds', icon: 'bed', permission: 'beds.view' },
        { label: 'Invoices', to: '/billing/invoices', icon: 'billing', permission: 'billing.manage' },
        { label: 'AI Assistant', to: '/ai', icon: 'ai', permission: 'appointment.create' },
      ],
    },
  ],

  accountant: [
    {
      items: [
        { label: 'Dashboard', to: '/accountant/dashboard', icon: 'dashboard' },
        { label: 'Invoices', to: '/billing/invoices', icon: 'billing', permission: 'billing.view' },
        { label: 'Payments', to: '/accountant/payments', icon: 'payments', permission: 'payments.manage' },
      ],
    },
    {
      title: 'Finance',
      items: [
        { label: 'Outstanding', to: '/accountant/outstanding', icon: 'alert', permission: 'payments.manage', badge: 12 },
        { label: 'Expenses', to: '/accountant/expenses', icon: 'expenses', permission: 'expenses.manage', badge: 3 },
        { label: 'Profit & Loss', to: '/accountant/pnl', icon: 'pnl', permission: 'finance.reports' },
      ],
    },
    {
      title: 'Insight',
      items: [
        { label: 'Reports', to: '/reports', icon: 'reports', permission: 'finance.reports' },
        { label: 'AI Assistant', to: '/ai', icon: 'ai', permission: 'finance.reports' },
      ],
    },
  ],
}
