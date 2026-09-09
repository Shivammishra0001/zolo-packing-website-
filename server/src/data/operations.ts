import type { ActivityEvent, Bed, NursingTask } from '@/types'

export const BEDS: Bed[] = [
  { id: 'BED-A101', ward: 'Ward A', room: 'A-1', bed: 'A-101', type: 'Semi-Private', status: 'Available', dailyRate: 1_800 },
  { id: 'BED-A102', ward: 'Ward A', room: 'A-1', bed: 'A-102', type: 'Semi-Private', status: 'Occupied', patientId: 'PT-10248', patientName: 'Raj Kumar', since: '2026-08-18', dailyRate: 1_800 },
  { id: 'BED-A103', ward: 'Ward A', room: 'A-1', bed: 'A-103', type: 'Semi-Private', status: 'Reserved', patientName: 'Nikhil Bharadwaj (admission 25 Aug)', dailyRate: 1_800 },
  { id: 'BED-A104', ward: 'Ward A', room: 'A-2', bed: 'A-104', type: 'General', status: 'Available', dailyRate: 1_400 },
  { id: 'BED-A105', ward: 'Ward A', room: 'A-2', bed: 'A-105', type: 'General', status: 'Occupied', patientId: 'PT-10263', patientName: 'Amit Singh', since: '2026-08-02', dailyRate: 1_400 },
  { id: 'BED-A106', ward: 'Ward A', room: 'A-2', bed: 'A-106', type: 'General', status: 'Cleaning', dailyRate: 1_400 },
  { id: 'BED-A107', ward: 'Ward A', room: 'A-3', bed: 'A-107', type: 'Private', status: 'Available', dailyRate: 2_400 },
  { id: 'BED-A108', ward: 'Ward A', room: 'A-3', bed: 'A-108', type: 'Private', status: 'Occupied', patientId: 'PT-10302', patientName: 'Gurpreet Sethi', since: '2026-08-18', dailyRate: 2_400 },
  { id: 'BED-B201', ward: 'Ward B', room: 'B-1', bed: 'B-201', type: 'Private', status: 'Occupied', patientId: 'PT-10284', patientName: 'Mohammed Farhan', since: '2026-08-12', dailyRate: 2_400 },
  { id: 'BED-B202', ward: 'Ward B', room: 'B-1', bed: 'B-202', type: 'Private', status: 'Available', dailyRate: 2_400 },
  { id: 'BED-B203', ward: 'Ward B', room: 'B-2', bed: 'B-203', type: 'Semi-Private', status: 'Reserved', patientName: 'Sunita Rathore (admission 26 Aug)', dailyRate: 1_800 },
  { id: 'BED-B204', ward: 'Ward B', room: 'B-2', bed: 'B-204', type: 'Semi-Private', status: 'Occupied', patientId: 'PT-10356', patientName: 'Suresh Pillai', since: '2026-08-14', dailyRate: 1_800 },
  { id: 'BED-B205', ward: 'Ward B', room: 'B-3', bed: 'B-205', type: 'General', status: 'Available', dailyRate: 1_400 },
  { id: 'BED-B206', ward: 'Ward B', room: 'B-3', bed: 'B-206', type: 'General', status: 'Available', dailyRate: 1_400 },
  { id: 'BED-R301', ward: 'Rehab Suites', room: 'R-1', bed: 'R-301', type: 'Rehab Suite', status: 'Occupied', patientName: 'Ravi Sathe', since: '2026-08-16', dailyRate: 3_200 },
  { id: 'BED-R302', ward: 'Rehab Suites', room: 'R-1', bed: 'R-302', type: 'Rehab Suite', status: 'Available', dailyRate: 3_200 },
  { id: 'BED-R303', ward: 'Rehab Suites', room: 'R-2', bed: 'R-303', type: 'Rehab Suite', status: 'Occupied', patientName: 'Meenal Kapoor', since: '2026-08-09', dailyRate: 3_200 },
  { id: 'BED-R304', ward: 'Rehab Suites', room: 'R-2', bed: 'R-304', type: 'Rehab Suite', status: 'Cleaning', dailyRate: 3_200 },
  { id: 'BED-I401', ward: 'ICU', room: 'I-1', bed: 'ICU-401', type: 'ICU', status: 'Occupied', patientName: 'Balwant Rai', since: '2026-08-21', dailyRate: 8_500 },
  { id: 'BED-I402', ward: 'ICU', room: 'I-1', bed: 'ICU-402', type: 'ICU', status: 'Available', dailyRate: 8_500 },
]

export const BED_SUMMARY = {
  total: BEDS.length,
  occupied: BEDS.filter((b) => b.status === 'Occupied').length,
  available: BEDS.filter((b) => b.status === 'Available').length,
  reserved: BEDS.filter((b) => b.status === 'Reserved').length,
  cleaning: BEDS.filter((b) => b.status === 'Cleaning').length,
}

export const OCCUPANCY_RATE = Math.round((BED_SUMMARY.occupied / BED_SUMMARY.total) * 100)

export const BED_STATUS_TONE = {
  Available: 'success',
  Occupied: 'info',
  Reserved: 'warning',
  Cleaning: 'default',
} as const

/* ------------------------------ Nursing tasks ------------------------------ */

export const NURSING_TASKS: NursingTask[] = [
  { id: 'NT-6601', patientId: 'PT-10248', patientName: 'Raj Kumar', ward: 'Ward A', bed: 'A-102', type: 'Vitals', label: '10:00 vitals round', due: '10:00', priority: 'Routine', done: false },
  { id: 'NT-6602', patientId: 'PT-10248', patientName: 'Raj Kumar', ward: 'Ward A', bed: 'A-102', type: 'Medication', label: 'Etoricoxib 90 mg — post breakfast', due: '09:30', priority: 'High', done: true },
  { id: 'NT-6603', patientId: 'PT-10263', patientName: 'Amit Singh', ward: 'Ward A', bed: 'A-105', type: 'Medication', label: 'Metformin 1000 mg with lunch', due: '13:00', priority: 'High', done: false },
  { id: 'NT-6604', patientId: 'PT-10263', patientName: 'Amit Singh', ward: 'Ward A', bed: 'A-105', type: 'Vitals', label: 'Blood pressure recheck — was 142/88', due: '11:00', priority: 'High', done: false },
  { id: 'NT-6605', patientId: 'PT-10302', patientName: 'Gurpreet Sethi', ward: 'Ward A', bed: 'A-108', type: 'Doctor Instruction', label: 'Surgical wound review with Dr. Bhatt', due: '14:00', priority: 'Critical', done: false },
  { id: 'NT-6606', patientId: 'PT-10302', patientName: 'Gurpreet Sethi', ward: 'Ward A', bed: 'A-108', type: 'Care Task', label: 'Ice therapy — 20 minutes post session', due: '11:45', priority: 'Routine', done: false },
  { id: 'NT-6607', patientId: 'PT-10284', patientName: 'Mohammed Farhan', ward: 'Ward B', bed: 'B-201', type: 'Care Task', label: 'Discharge summary preparation', due: '15:00', priority: 'High', done: false },
  { id: 'NT-6608', patientId: 'PT-10284', patientName: 'Mohammed Farhan', ward: 'Ward B', bed: 'B-201', type: 'Vitals', label: 'Pre-discharge vitals', due: '12:00', priority: 'Routine', done: false },
  { id: 'NT-6609', patientId: 'PT-10356', patientName: 'Suresh Pillai', ward: 'Ward B', bed: 'B-204', type: 'Therapy Prep', label: 'Prepare for 13:00 walker session', due: '12:45', priority: 'Routine', done: false },
  { id: 'NT-6610', patientId: 'PT-10356', patientName: 'Suresh Pillai', ward: 'Ward B', bed: 'B-204', type: 'Medication', label: 'Tramadol 50 mg if pain above 5/10', due: 'As needed', priority: 'Routine', done: false },
  { id: 'NT-6611', patientId: 'PT-10356', patientName: 'Suresh Pillai', ward: 'Ward B', bed: 'B-204', type: 'Vitals', label: '08:00 vitals round', due: '08:00', priority: 'Routine', done: true },
  { id: 'NT-6612', patientId: 'PT-10263', patientName: 'Amit Singh', ward: 'Ward A', bed: 'A-105', type: 'Care Task', label: 'Two-hourly position change', due: 'Hourly', priority: 'High', done: true },
]

export const PENDING_TASKS = NURSING_TASKS.filter((t) => !t.done)

export const DISCHARGE_PENDING = [
  {
    patientId: 'PT-10284',
    patientName: 'Mohammed Farhan',
    ward: 'Ward B',
    bed: 'B-201',
    doctor: 'Dr. Arjun Sharma',
    expectedTime: 'Today, 16:00',
    blockers: ['Final billing clearance pending', 'Discharge summary awaiting doctor sign-off'],
  },
  {
    patientId: 'PT-10356',
    patientName: 'Suresh Pillai',
    ward: 'Ward B',
    bed: 'B-204',
    doctor: 'Dr. Sanjay Bhatt',
    expectedTime: '02 Sep, 11:00',
    blockers: ['Awaiting 50 m walker milestone', 'Home safety assessment scheduled'],
  },
]

/* ------------------------------ System activity ---------------------------- */

export const ACTIVITY_FEED: ActivityEvent[] = [
  { id: 'ACT-1', actor: 'Dr. Arjun Sharma', action: 'signed in from', target: 'Andheri West — Main Campus', time: '2 minutes ago', category: 'auth' },
  { id: 'ACT-2', actor: 'Sneha Patil', action: 'checked in', target: 'Raj Kumar (PT-10248)', time: '9 minutes ago', category: 'patient' },
  { id: 'ACT-3', actor: 'Neha Kulkarni', action: 'created a therapist account for', target: 'Ritika Shah', time: '26 minutes ago', category: 'staff' },
  { id: 'ACT-4', actor: 'Rohit Malhotra', action: 'updated stock levels for', target: '14 pharmacy items', time: '41 minutes ago', category: 'pharmacy' },
  { id: 'ACT-5', actor: 'Meera Iyer', action: 'recorded a therapy session for', target: 'Raj Kumar (PT-10248)', time: '1 hour ago', category: 'patient' },
  { id: 'ACT-6', actor: 'Kiran Rao', action: 'changed billing configuration for', target: 'Therapy package GST slab', time: '2 hours ago', category: 'billing' },
  { id: 'ACT-7', actor: 'System', action: 'completed nightly backup for', target: 'All 3 branches', time: '5 hours ago', category: 'system' },
  { id: 'ACT-8', actor: 'Dr. Priya Nair', action: 'updated the rehabilitation plan for', target: 'Amit Singh (PT-10263)', time: 'Yesterday, 18:40', category: 'patient' },
  { id: 'ACT-9', actor: 'Neha Kulkarni', action: 'granted pharmacy permissions to', target: 'Imran Qureshi', time: 'Yesterday, 17:12', category: 'staff' },
  { id: 'ACT-10', actor: 'System', action: 'flagged 5 medicines nearing expiry in', target: 'Main Campus pharmacy', time: 'Yesterday, 06:00', category: 'pharmacy' },
]

export const PENDING_APPROVALS = [
  { id: 'AP-1', title: '3 staff accounts awaiting approval', detail: 'Imran Qureshi, Divya Menon and Ritika Shah have completed onboarding.', href: '/admin/staff', severity: 'warning' as const },
  { id: 'AP-2', title: '2 permission change requests', detail: 'Kavya Reddy requested rehab plan editing; Aakash Verma requested payment refunds.', href: '/admin/roles', severity: 'info' as const },
  { id: 'AP-3', title: '1 branch configuration pending', detail: 'Thane — Day Care Centre still needs consultation-hour and tariff setup.', href: '/admin/branches', severity: 'info' as const },
]

export const SYSTEM_STATUS = [
  { label: 'Application', status: 'Operational', uptime: '99.98%' },
  { label: 'Database', status: 'Operational', uptime: '99.99%' },
  { label: 'Pharmacy Sync', status: 'Degraded', uptime: '97.20%' },
  { label: 'Backup Service', status: 'Operational', uptime: '100%' },
]
