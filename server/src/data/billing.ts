import type { Expense, Invoice, PaymentRecord } from '@/types'
import { daysFromToday, sum } from '@/lib/utils'

export const INVOICES: Invoice[] = [
  {
    id: 'INV-2026-4412',
    patientId: 'PT-10356',
    patientName: 'Suresh Pillai',
    date: '2026-07-14',
    dueDate: '2026-07-29',
    amount: 128_900,
    paid: 60_000,
    status: 'Overdue',
    department: 'IPD',
    items: [
      { label: 'Hemiarthroplasty — surgical package', qty: 1, rate: 92_000 },
      { label: 'Private room (12 days)', qty: 12, rate: 2_400 },
      { label: 'Physiotherapy sessions', qty: 7, rate: 1_100 },
    ],
  },
  {
    id: 'INV-2026-4438',
    patientId: 'PT-10302',
    patientName: 'Gurpreet Sethi',
    date: '2026-07-28',
    dueDate: '2026-08-12',
    amount: 87_300,
    paid: 30_000,
    status: 'Overdue',
    department: 'IPD',
    items: [
      { label: 'Total knee replacement package', qty: 1, rate: 74_000 },
      { label: 'Semi-private room (6 days)', qty: 6, rate: 1_800 },
      { label: 'Rehabilitation sessions', qty: 5, rate: 500 },
    ],
  },
  {
    id: 'INV-2026-4455',
    patientId: 'PT-10263',
    patientName: 'Amit Singh',
    date: '2026-08-02',
    dueDate: '2026-08-17',
    amount: 96_500,
    paid: 53_750,
    status: 'Overdue',
    department: 'IPD',
    items: [
      { label: 'Neuro rehabilitation package (36 sessions)', qty: 1, rate: 60_000 },
      { label: 'General ward (22 days)', qty: 22, rate: 1_400 },
      { label: 'Speech therapy sessions', qty: 6, rate: 950 },
    ],
  },
  {
    id: 'INV-2026-4471',
    patientId: 'PT-10284',
    patientName: 'Mohammed Farhan',
    date: '2026-08-12',
    dueDate: '2026-08-27',
    amount: 74_200,
    paid: 43_000,
    status: 'Partially Paid',
    department: 'IPD',
    items: [
      { label: 'Cardiac rehabilitation phase II package', qty: 1, rate: 54_000 },
      { label: 'Private room (8 days)', qty: 8, rate: 2_400 },
      { label: 'Cardiac monitoring charges', qty: 1, rate: 1_000 },
    ],
    method: 'Bank Transfer',
  },
  {
    id: 'INV-2026-4488',
    patientId: 'PT-10248',
    patientName: 'Raj Kumar',
    date: '2026-08-18',
    dueDate: '2026-09-02',
    amount: 46_400,
    paid: 28_000,
    status: 'Partially Paid',
    department: 'Therapy',
    items: [
      { label: 'Ortho rehab package (24 sessions)', qty: 1, rate: 30_000 },
      { label: 'Semi-private room (6 days)', qty: 6, rate: 1_800 },
      { label: 'Hydrotherapy add-on', qty: 4, rate: 1_400 },
    ],
    method: 'UPI',
  },
  {
    id: 'INV-2026-4492',
    patientId: 'PT-10315',
    patientName: 'Lakshmi Venkatesh',
    date: '2026-08-19',
    dueDate: '2026-09-03',
    amount: 24_800,
    paid: 12_400,
    status: 'Partially Paid',
    department: 'Therapy',
    items: [
      { label: 'Balance & gait programme (32 sessions)', qty: 1, rate: 22_400 },
      { label: 'Assistive device fitting', qty: 1, rate: 2_400 },
    ],
    method: 'Card',
  },
  {
    id: 'INV-2026-4501',
    patientId: 'PT-10290',
    patientName: 'Anjali Deshpande',
    date: '2026-08-20',
    dueDate: '2026-09-04',
    amount: 19_600,
    paid: 9_800,
    status: 'Partially Paid',
    department: 'Therapy',
    items: [
      { label: 'Shoulder mobilisation programme (28 sessions)', qty: 1, rate: 16_800 },
      { label: 'Thermotherapy add-on', qty: 4, rate: 700 },
    ],
    method: 'UPI',
  },
  {
    id: 'INV-2026-4510',
    patientId: 'PT-10367',
    patientName: 'Ishaan Mehta',
    date: '2026-08-21',
    dueDate: '2026-09-05',
    amount: 22_400,
    paid: 16_800,
    status: 'Partially Paid',
    department: 'Therapy',
    items: [
      { label: 'Paediatric speech programme (40 sessions)', qty: 1, rate: 20_000 },
      { label: 'Parent coaching sessions', qty: 3, rate: 800 },
    ],
    method: 'Card',
  },
  {
    id: 'INV-2026-4516',
    patientId: 'PT-10251',
    patientName: 'Simran Kaur',
    date: '2026-08-22',
    dueDate: '2026-09-06',
    amount: 14_200,
    paid: 8_000,
    status: 'Partially Paid',
    department: 'OPD',
    items: [
      { label: 'Cervical rehabilitation (20 sessions)', qty: 1, rate: 12_000 },
      { label: 'Consultation — Dr. Priya Nair', qty: 2, rate: 1_100 },
    ],
    method: 'UPI',
  },
  {
    id: 'INV-2026-4520',
    patientId: 'PT-10341',
    patientName: 'Fatima Ansari',
    date: '2026-08-23',
    dueDate: '2026-09-07',
    amount: 11_400,
    paid: 8_000,
    status: 'Partially Paid',
    department: 'OPD',
    items: [
      { label: 'Hand therapy programme (14 sessions)', qty: 1, rate: 9_800 },
      { label: 'Night splints (pair)', qty: 1, rate: 1_600 },
    ],
    method: 'Cash',
  },
  {
    id: 'INV-2026-4523',
    patientId: 'PT-10277',
    patientName: 'Priya Sharma',
    date: '2026-08-24',
    dueDate: '2026-09-08',
    amount: 9_600,
    paid: 9_600,
    status: 'Paid',
    department: 'OPD',
    items: [
      { label: 'Core stabilisation programme (16 sessions)', qty: 1, rate: 8_000 },
      { label: 'Consultation — Dr. Arjun Sharma', qty: 1, rate: 1_600 },
    ],
    method: 'UPI',
  },
  {
    id: 'INV-2026-4524',
    patientId: 'PT-10372',
    patientName: 'Kavita Joshi',
    date: '2026-08-24',
    dueDate: '2026-09-08',
    amount: 6_300,
    paid: 4_200,
    status: 'Partially Paid',
    department: 'Pharmacy',
    items: [
      { label: 'Methotrexate 15 mg (12 tablets)', qty: 12, rate: 29 },
      { label: 'Adaptive kitchen tool set', qty: 1, rate: 3_800 },
      { label: 'Resting splints (pair)', qty: 1, rate: 2_152 },
    ],
    method: 'Card',
  },
  {
    id: 'INV-2026-4525',
    patientId: 'PT-10328',
    patientName: 'Aditya Rane',
    date: '2026-08-12',
    dueDate: '2026-08-27',
    amount: 18_000,
    paid: 18_000,
    status: 'Paid',
    department: 'Therapy',
    items: [
      { label: 'Ankle rehabilitation programme (18 sessions)', qty: 1, rate: 16_200 },
      { label: 'Return-to-sport assessment', qty: 1, rate: 1_800 },
    ],
    method: 'Bank Transfer',
  },
  {
    id: 'INV-2026-4526',
    patientId: 'PT-10388',
    patientName: 'Deepak Chauhan',
    date: '2026-07-30',
    dueDate: '2026-08-14',
    amount: 31_200,
    paid: 31_200,
    status: 'Paid',
    department: 'Therapy',
    items: [
      { label: 'Rotator cuff rehabilitation (26 sessions)', qty: 1, rate: 28_600 },
      { label: 'Discharge assessment', qty: 1, rate: 2_600 },
    ],
    method: 'Insurance',
  },
]

export function outstandingOf(invoice: Invoice) {
  return Math.max(0, invoice.amount - invoice.paid)
}

export function daysOverdue(invoice: Invoice) {
  const diff = daysFromToday(invoice.dueDate)
  return diff < 0 ? Math.abs(diff) : 0
}

export const OUTSTANDING_INVOICES = INVOICES.filter((i) => outstandingOf(i) > 0).sort(
  (a, b) => daysOverdue(b) - daysOverdue(a) || outstandingOf(b) - outstandingOf(a),
)

export const TOTAL_OUTSTANDING = sum(OUTSTANDING_INVOICES, outstandingOf)

/* --------------------------------- Payments -------------------------------- */

export const PAYMENTS: PaymentRecord[] = [
  { id: 'PAY-9901', invoiceId: 'INV-2026-4523', patientName: 'Priya Sharma', amount: 9_600, method: 'UPI', date: '2026-08-24', collectedBy: 'Sneha Patil', status: 'Settled' },
  { id: 'PAY-9902', invoiceId: 'INV-2026-4524', patientName: 'Kavita Joshi', amount: 4_200, method: 'Card', date: '2026-08-24', collectedBy: 'Sneha Patil', status: 'Settled' },
  { id: 'PAY-9903', invoiceId: 'INV-2026-4488', patientName: 'Raj Kumar', amount: 28_000, method: 'UPI', date: '2026-08-24', collectedBy: 'Kiran Rao', status: 'Settled' },
  { id: 'PAY-9904', invoiceId: 'INV-2026-4520', patientName: 'Fatima Ansari', amount: 8_000, method: 'Cash', date: '2026-08-24', collectedBy: 'Sneha Patil', status: 'Settled' },
  { id: 'PAY-9905', invoiceId: 'INV-2026-4471', patientName: 'Mohammed Farhan', amount: 43_000, method: 'Bank Transfer', date: '2026-08-24', collectedBy: 'Kiran Rao', status: 'Processing' },
  { id: 'PAY-9906', invoiceId: 'INV-2026-4516', patientName: 'Simran Kaur', amount: 8_000, method: 'UPI', date: '2026-08-24', collectedBy: 'Divya Menon', status: 'Settled' },
  { id: 'PAY-9907', invoiceId: 'INV-2026-4510', patientName: 'Ishaan Mehta', amount: 16_800, method: 'Card', date: '2026-08-24', collectedBy: 'Sneha Patil', status: 'Settled' },
  { id: 'PAY-9908', invoiceId: 'INV-2026-4501', patientName: 'Anjali Deshpande', amount: 9_800, method: 'UPI', date: '2026-08-24', collectedBy: 'Divya Menon', status: 'Settled' },
  { id: 'PAY-9909', invoiceId: 'INV-2026-4492', patientName: 'Lakshmi Venkatesh', amount: 12_400, method: 'Card', date: '2026-08-24', collectedBy: 'Sneha Patil', status: 'Settled' },
  { id: 'PAY-9910', invoiceId: 'INV-2026-4455', patientName: 'Amit Singh', amount: 25_000, method: 'Bank Transfer', date: '2026-08-24', collectedBy: 'Kiran Rao', status: 'Failed' },
]

export const TODAYS_COLLECTIONS = sum(
  PAYMENTS.filter((p) => p.date === '2026-08-24' && p.status !== 'Failed'),
  (p) => p.amount,
)

export const PAYMENT_BREAKDOWN = (['Cash', 'UPI', 'Card', 'Bank Transfer'] as const).map((method) => ({
  method,
  amount: sum(
    PAYMENTS.filter((p) => p.method === method && p.status !== 'Failed'),
    (p) => p.amount,
  ),
}))

/* --------------------------------- Expenses -------------------------------- */

export const EXPENSES: Expense[] = [
  { id: 'EXP-3301', date: '2026-08-24', vendor: 'MedSupply Distributors', category: 'Pharmacy Purchase', amount: 214_500, method: 'Bank Transfer', status: 'Recorded', reference: 'PO-2026-8841' },
  { id: 'EXP-3302', date: '2026-08-24', vendor: 'Adani Electricity', category: 'Utilities', amount: 86_400, method: 'Bank Transfer', status: 'Approved', reference: 'BILL-AUG-2026' },
  { id: 'EXP-3303', date: '2026-08-23', vendor: 'PhysioTech Equipment', category: 'Equipment', amount: 342_000, method: 'Bank Transfer', status: 'Pending Categorisation', reference: 'INV-PT-11209' },
  { id: 'EXP-3304', date: '2026-08-23', vendor: 'Sparkle Facility Services', category: 'Maintenance', amount: 48_000, method: 'Bank Transfer', status: 'Recorded', reference: 'SFS-AUG-04' },
  { id: 'EXP-3305', date: '2026-08-22', vendor: 'Staff Payroll — August', category: 'Salaries', amount: 2_840_000, method: 'Bank Transfer', status: 'Approved', reference: 'PAY-AUG-2026' },
  { id: 'EXP-3306', date: '2026-08-22', vendor: 'Google Ads India', category: 'Marketing', amount: 62_500, method: 'Card', status: 'Pending Categorisation', reference: 'GADS-8827' },
  { id: 'EXP-3307', date: '2026-08-21', vendor: 'AquaPure Systems', category: 'Maintenance', amount: 27_800, method: 'UPI', status: 'Recorded', reference: 'APS-2291' },
  { id: 'EXP-3308', date: '2026-08-20', vendor: 'Unknown UPI Credit', category: 'Uncategorised', amount: 15_400, method: 'UPI', status: 'Pending Categorisation', reference: 'UPI-77120934' },
  { id: 'EXP-3309', date: '2026-08-19', vendor: 'Cipla Distribution', category: 'Pharmacy Purchase', amount: 178_900, method: 'Bank Transfer', status: 'Approved', reference: 'PO-2026-8829' },
  { id: 'EXP-3310', date: '2026-08-18', vendor: 'Mahanagar Gas', category: 'Utilities', amount: 19_200, method: 'Bank Transfer', status: 'Recorded', reference: 'MGL-AUG-2026' },
]

export const PENDING_EXPENSES = EXPENSES.filter((e) => e.status === 'Pending Categorisation')
export const TOTAL_EXPENSES_MONTH = sum(EXPENSES, (e) => e.amount)
