import type { Notification, Role } from '@/types'

export const NOTIFICATIONS: Notification[] = [
  /* ------------------------------- Owner ------------------------------- */
  { id: 'N-001', role: 'owner', title: 'August revenue is tracking 8% ahead', body: 'Therapy packages contributed ₹28.4 L so far this month.', time: '18 minutes ago', icon: 'finance', severity: 'success', read: false, href: '/owner/revenue' },
  { id: 'N-002', role: 'owner', title: '₹1,25,000 in payments now overdue', body: 'Three IPD invoices have crossed 15 days past due.', time: '1 hour ago', icon: 'finance', severity: 'critical', read: false, href: '/reports' },
  { id: 'N-003', role: 'owner', title: 'Occupancy dipped below 45%', body: 'Ward B has 4 free beds — consider the weekend admission drive.', time: '3 hours ago', icon: 'system', severity: 'warning', read: true, href: '/owner/occupancy' },

  /* ------------------------------- Admin ------------------------------- */
  { id: 'N-010', role: 'admin', title: '3 staff accounts awaiting approval', body: 'Imran Qureshi, Divya Menon and Ritika Shah completed onboarding.', time: '25 minutes ago', icon: 'system', severity: 'warning', read: false, href: '/admin/staff' },
  { id: 'N-011', role: 'admin', title: 'Pharmacy sync is degraded', body: 'Thane branch stock sync last succeeded 4 hours ago.', time: '52 minutes ago', icon: 'system', severity: 'critical', read: false, href: '/admin/configuration' },
  { id: 'N-012', role: 'admin', title: 'Permission request from Kavya Reddy', body: 'Requested edit access to rehabilitation plans.', time: '2 hours ago', icon: 'system', severity: 'info', read: true, href: '/admin/roles' },

  /* ------------------------------- Doctor ------------------------------ */
  { id: 'N-020', role: 'doctor', title: 'New lab result available for Raj Kumar', body: 'Complete blood count reported — all values within normal limits.', time: '12 minutes ago', icon: 'clinical', severity: 'info', read: false, href: '/doctor/labs' },
  { id: 'N-021', role: 'doctor', title: 'Simran Kaur has plateaued', body: 'No measurable mobility gain across the last three weekly reviews.', time: '40 minutes ago', icon: 'therapy', severity: 'warning', read: false, href: '/patients/PT-10251' },
  { id: 'N-022', role: 'doctor', title: 'Pharmacy flagged a substitution', body: 'Metformin 1000 mg is out of stock for prescription RX-7713.', time: '1 hour ago', icon: 'stock', severity: 'warning', read: false, href: '/doctor/prescriptions' },
  { id: 'N-023', role: 'doctor', title: 'Anjali Deshpande missed her follow-up', body: 'Six days overdue. Front desk has been asked to reschedule.', time: '4 hours ago', icon: 'patient', severity: 'critical', read: true, href: '/patients/PT-10290' },

  /* ------------------------------ Therapist ---------------------------- */
  { id: 'N-030', role: 'therapist', title: "Raj Kumar's session starts in 30 minutes", body: 'Hydrotherapy at 16:00 — Hydrotherapy Pool.', time: '3 minutes ago', icon: 'therapy', severity: 'info', read: false, href: '/therapist/sessions' },
  { id: 'N-031', role: 'therapist', title: 'Kavita Joshi did not attend', body: '09:00 occupational therapy session marked as missed.', time: '2 hours ago', icon: 'patient', severity: 'warning', read: false, href: '/therapist/sessions' },
  { id: 'N-032', role: 'therapist', title: 'Anjali Deshpande flagged At Risk', body: 'Attendance has fallen to 68% and progress has stalled.', time: '5 hours ago', icon: 'therapy', severity: 'critical', read: false, href: '/patients/PT-10290' },
  { id: 'N-033', role: 'therapist', title: 'New rehabilitation plan assigned', body: 'Dr. Bhatt assigned Gurpreet Sethi to your caseload.', time: 'Yesterday', icon: 'clinical', severity: 'info', read: true, href: '/rehab/plans' },

  /* -------------------------------- Nurse ------------------------------ */
  { id: 'N-040', role: 'nurse', title: 'Wound review due for Gurpreet Sethi', body: 'Dr. Bhatt is expected in Ward A at 14:00.', time: '20 minutes ago', icon: 'clinical', severity: 'critical', read: false, href: '/nurse/tasks' },
  { id: 'N-041', role: 'nurse', title: 'Blood pressure recheck for Amit Singh', body: 'Last reading was 142/88 mmHg at 07:30.', time: '45 minutes ago', icon: 'patient', severity: 'warning', read: false, href: '/nurse/vitals' },
  { id: 'N-042', role: 'nurse', title: 'Discharge paperwork pending', body: 'Mohammed Farhan is scheduled to leave at 16:00 today.', time: '1 hour ago', icon: 'system', severity: 'info', read: true, href: '/nurse/discharges' },

  /* ----------------------------- Pharmacist ---------------------------- */
  { id: 'N-050', role: 'pharmacist', title: 'Paracetamol stock is below threshold', body: 'Only 12 units remaining against a threshold of 60.', time: '8 minutes ago', icon: 'stock', severity: 'critical', read: false, href: '/pharmacy/alerts' },
  { id: 'N-051', role: 'pharmacist', title: 'Metformin 1000 mg is out of stock', body: 'Prescription RX-7713 cannot be dispensed in full.', time: '35 minutes ago', icon: 'stock', severity: 'critical', read: false, href: '/pharmacy/prescriptions' },
  { id: 'N-052', role: 'pharmacist', title: '5 medicines expire within 45 days', body: 'Pantoprazole, Clopidogrel, Baclofen, Vitamin D3 and Insulin Glargine.', time: '2 hours ago', icon: 'stock', severity: 'warning', read: false, href: '/pharmacy/alerts' },
  { id: 'N-053', role: 'pharmacist', title: 'Urgent prescription queued', body: 'RX-7714 for Gurpreet Sethi is marked urgent.', time: '3 hours ago', icon: 'clinical', severity: 'warning', read: true, href: '/pharmacy/prescriptions' },

  /* ---------------------------- Receptionist --------------------------- */
  { id: 'N-060', role: 'receptionist', title: '4 patients waiting to be checked in', body: 'Longest wait is 17 minutes — token 03, Raj Kumar.', time: '5 minutes ago', icon: 'patient', severity: 'warning', read: false, href: '/reception/queue' },
  { id: 'N-061', role: 'receptionist', title: 'Anjali Deshpande cancelled', body: 'Requested rescheduling to 25 August at 12:00.', time: '1 hour ago', icon: 'system', severity: 'info', read: false, href: '/appointments' },
  { id: 'N-062', role: 'receptionist', title: 'Bed A-103 reserved for tomorrow', body: 'Nikhil Bharadwaj is admitted at 10:00 on 25 August.', time: '2 hours ago', icon: 'system', severity: 'info', read: true, href: '/beds' },

  /* ----------------------------- Accountant ---------------------------- */
  { id: 'N-070', role: 'accountant', title: '₹45,000 payment overdue for 15 days', body: 'Invoice INV-2026-4438 — Gurpreet Sethi.', time: '15 minutes ago', icon: 'finance', severity: 'critical', read: false, href: '/accountant/outstanding' },
  { id: 'N-071', role: 'accountant', title: 'A bank transfer failed', body: '₹25,000 from Amit Singh was rejected by the payment gateway.', time: '50 minutes ago', icon: 'finance', severity: 'critical', read: false, href: '/accountant/payments' },
  { id: 'N-072', role: 'accountant', title: '3 expenses need categorisation', body: 'Totalling ₹4,20,400 across equipment, marketing and one UPI credit.', time: '2 hours ago', icon: 'finance', severity: 'warning', read: false, href: '/accountant/expenses' },
  { id: 'N-073', role: 'accountant', title: "Today's collections crossed ₹1.3 L", body: '9 settled payments recorded across all counters.', time: '3 hours ago', icon: 'finance', severity: 'success', read: true, href: '/accountant/payments' },

  /* --------------------------------- All ------------------------------- */
  { id: 'N-080', role: 'all', title: 'Scheduled maintenance this Sunday', body: 'The platform will be read-only from 02:00 to 04:00 IST on 30 August.', time: 'Yesterday', icon: 'system', severity: 'info', read: true, href: '/reports' },
]

export function notificationsForRole(role: Role) {
  return NOTIFICATIONS.filter((n) => n.role === role || n.role === 'all')
}
