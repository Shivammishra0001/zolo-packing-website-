import type { Medicine, Prescription, StockStatus } from '@/types'
import { daysFromToday } from '@/lib/utils'

interface MedicineSeed {
  id: string
  name: string
  genericName: string
  category: string
  batch: string
  quantity: number
  threshold: number
  unitPrice: number
  mrp: number
  expiry: string
  manufacturer: string
  rackLocation: string
}

const SEEDS: MedicineSeed[] = [
  { id: 'MED-2001', name: 'Paracetamol 650 mg', genericName: 'Paracetamol', category: 'Analgesic', batch: 'PCM-24A118', quantity: 12, threshold: 60, unitPrice: 1.4, mrp: 2.1, expiry: '2027-04-30', manufacturer: 'Cipla', rackLocation: 'A-1-03' },
  { id: 'MED-2002', name: 'Etoricoxib 90 mg', genericName: 'Etoricoxib', category: 'NSAID', batch: 'ETX-25C441', quantity: 148, threshold: 50, unitPrice: 11.2, mrp: 16.5, expiry: '2027-01-31', manufacturer: 'Sun Pharma', rackLocation: 'A-2-07' },
  { id: 'MED-2003', name: 'Pantoprazole 40 mg', genericName: 'Pantoprazole', category: 'Gastro-protective', batch: 'PAN-24B902', quantity: 210, threshold: 80, unitPrice: 3.8, mrp: 6.4, expiry: '2026-09-11', manufacturer: 'Alkem', rackLocation: 'B-1-02' },
  { id: 'MED-2004', name: 'Telmisartan 40 mg', genericName: 'Telmisartan', category: 'Antihypertensive', batch: 'TEL-25A310', quantity: 96, threshold: 40, unitPrice: 5.6, mrp: 9.2, expiry: '2027-08-31', manufacturer: 'Torrent', rackLocation: 'B-2-01' },
  { id: 'MED-2005', name: 'Metformin 1000 mg', genericName: 'Metformin HCl', category: 'Antidiabetic', batch: 'MET-24D551', quantity: 0, threshold: 60, unitPrice: 2.9, mrp: 4.8, expiry: '2027-03-31', manufacturer: 'USV', rackLocation: 'B-2-05' },
  { id: 'MED-2006', name: 'Atorvastatin 40 mg', genericName: 'Atorvastatin', category: 'Statin', batch: 'ATV-25B227', quantity: 132, threshold: 45, unitPrice: 4.2, mrp: 7.5, expiry: '2027-06-30', manufacturer: 'Zydus', rackLocation: 'B-3-04' },
  { id: 'MED-2007', name: 'Clopidogrel 75 mg', genericName: 'Clopidogrel', category: 'Antiplatelet', batch: 'CLP-24C808', quantity: 28, threshold: 40, unitPrice: 6.1, mrp: 10.2, expiry: '2026-09-05', manufacturer: 'Sanofi', rackLocation: 'B-3-06' },
  { id: 'MED-2008', name: 'Levodopa-Carbidopa 100/25', genericName: 'Levodopa + Carbidopa', category: 'Anti-Parkinsonian', batch: 'LDC-25A063', quantity: 74, threshold: 30, unitPrice: 8.9, mrp: 14.0, expiry: '2027-05-31', manufacturer: 'Intas', rackLocation: 'C-1-01' },
  { id: 'MED-2009', name: 'Calcium + Vitamin D3', genericName: 'Calcium Carbonate + Cholecalciferol', category: 'Supplement', batch: 'CAD-25B740', quantity: 320, threshold: 100, unitPrice: 3.2, mrp: 5.5, expiry: '2027-11-30', manufacturer: 'Mankind', rackLocation: 'C-2-02' },
  { id: 'MED-2010', name: 'Cholecalciferol 60000 IU', genericName: 'Vitamin D3', category: 'Supplement', batch: 'VD3-24A995', quantity: 45, threshold: 40, unitPrice: 24.0, mrp: 38.0, expiry: '2026-09-18', manufacturer: 'Abbott', rackLocation: 'C-2-04' },
  { id: 'MED-2011', name: 'Tramadol 50 mg', genericName: 'Tramadol HCl', category: 'Opioid Analgesic', batch: 'TRM-25C182', quantity: 64, threshold: 30, unitPrice: 5.4, mrp: 8.9, expiry: '2027-02-28', manufacturer: 'Cipla', rackLocation: 'A-3-01' },
  { id: 'MED-2012', name: 'Methotrexate 15 mg', genericName: 'Methotrexate', category: 'DMARD', batch: 'MTX-24D207', quantity: 22, threshold: 20, unitPrice: 18.5, mrp: 29.0, expiry: '2027-07-31', manufacturer: 'Sun Pharma', rackLocation: 'D-1-02' },
  { id: 'MED-2013', name: 'Folic Acid 5 mg', genericName: 'Folic Acid', category: 'Supplement', batch: 'FOL-25A616', quantity: 280, threshold: 80, unitPrice: 0.9, mrp: 1.8, expiry: '2028-01-31', manufacturer: 'Mankind', rackLocation: 'C-2-06' },
  { id: 'MED-2014', name: 'Diclofenac Gel 30 g', genericName: 'Diclofenac Diethylamine', category: 'Topical Analgesic', batch: 'DFG-25B429', quantity: 18, threshold: 35, unitPrice: 62.0, mrp: 98.0, expiry: '2027-09-30', manufacturer: 'Novartis', rackLocation: 'E-1-01' },
  { id: 'MED-2015', name: 'Baclofen 10 mg', genericName: 'Baclofen', category: 'Muscle Relaxant', batch: 'BCF-24C334', quantity: 88, threshold: 30, unitPrice: 4.6, mrp: 7.8, expiry: '2026-09-02', manufacturer: 'Intas', rackLocation: 'D-2-03' },
  { id: 'MED-2016', name: 'Pregabalin 75 mg', genericName: 'Pregabalin', category: 'Neuropathic Agent', batch: 'PRG-25A870', quantity: 110, threshold: 40, unitPrice: 9.3, mrp: 15.4, expiry: '2027-10-31', manufacturer: 'Lupin', rackLocation: 'D-2-05' },
  { id: 'MED-2017', name: 'Crepe Bandage 10 cm', genericName: 'Elastic Bandage', category: 'Consumable', batch: 'CRP-25A011', quantity: 240, threshold: 60, unitPrice: 42.0, mrp: 65.0, expiry: '2029-12-31', manufacturer: 'Datt Mediproducts', rackLocation: 'F-1-01' },
  { id: 'MED-2018', name: 'Kinesiology Tape 5 cm', genericName: 'Therapeutic Tape', category: 'Consumable', batch: 'KIN-25B550', quantity: 26, threshold: 40, unitPrice: 210.0, mrp: 320.0, expiry: '2029-06-30', manufacturer: 'Leukotape', rackLocation: 'F-1-04' },
  { id: 'MED-2019', name: 'Denosumab 60 mg Injection', genericName: 'Denosumab', category: 'Bone Agent', batch: 'DEN-25A128', quantity: 6, threshold: 8, unitPrice: 9800.0, mrp: 12400.0, expiry: '2027-04-30', manufacturer: 'Amgen', rackLocation: 'REF-1' },
  { id: 'MED-2020', name: 'Insulin Glargine 100 IU', genericName: 'Insulin Glargine', category: 'Antidiabetic', batch: 'ING-25B333', quantity: 34, threshold: 15, unitPrice: 780.0, mrp: 1150.0, expiry: '2026-09-25', manufacturer: 'Biocon', rackLocation: 'REF-2' },
]

const NEAR_EXPIRY_DAYS = 45

function statusFor(seed: MedicineSeed): StockStatus {
  if (seed.quantity === 0) return 'Out of Stock'
  const daysToExpiry = daysFromToday(seed.expiry)
  if (daysToExpiry <= NEAR_EXPIRY_DAYS) return 'Near Expiry'
  if (seed.quantity <= seed.threshold) return 'Low Stock'
  return 'In Stock'
}

export const MEDICINES: Medicine[] = SEEDS.map((seed) => ({ ...seed, status: statusFor(seed) }))

export const LOW_STOCK = MEDICINES.filter((m) => m.status === 'Low Stock')
export const OUT_OF_STOCK = MEDICINES.filter((m) => m.status === 'Out of Stock')
export const NEAR_EXPIRY = MEDICINES.filter((m) => m.status === 'Near Expiry')

export function daysToExpiry(medicine: Medicine) {
  return daysFromToday(medicine.expiry)
}

export function searchMedicines(query: string, limit = 8) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return MEDICINES.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.genericName.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q),
  ).slice(0, limit)
}

export const STOCK_TONE: Record<StockStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  'In Stock': 'success',
  'Low Stock': 'warning',
  'Near Expiry': 'info',
  'Out of Stock': 'danger',
}

/* ------------------------------ Prescriptions ------------------------------ */

export const PRESCRIPTIONS: Prescription[] = [
  {
    id: 'RX-7712',
    patientId: 'PT-10248',
    patientName: 'Raj Kumar',
    doctor: 'Dr. Arjun Sharma',
    date: '2026-08-24',
    status: 'Pending',
    priority: 'Routine',
    items: [
      { medicine: 'Etoricoxib 90 mg', strength: '90 mg', dosage: '1 tablet', frequency: 'Once daily after breakfast', duration: '10 days', quantity: 10, instructions: 'Take with food. Stop if gastric discomfort occurs.' },
      { medicine: 'Pantoprazole 40 mg', strength: '40 mg', dosage: '1 tablet', frequency: 'Once daily before breakfast', duration: '10 days', quantity: 10, instructions: 'Take 30 minutes before food.' },
      { medicine: 'Diclofenac Gel 30 g', strength: '1.16% w/w', dosage: 'Apply locally', frequency: 'Twice daily', duration: '2 weeks', quantity: 1, instructions: 'Massage gently over the knee. Do not apply on broken skin.' },
    ],
  },
  {
    id: 'RX-7713',
    patientId: 'PT-10263',
    patientName: 'Amit Singh',
    doctor: 'Dr. Priya Nair',
    date: '2026-08-24',
    status: 'Pending',
    priority: 'Urgent',
    items: [
      { medicine: 'Metformin 1000 mg', strength: '1000 mg', dosage: '1 tablet', frequency: 'Twice daily with meals', duration: '30 days', quantity: 60, instructions: 'Monitor blood sugar twice weekly.' },
      { medicine: 'Clopidogrel 75 mg', strength: '75 mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', quantity: 30, instructions: 'Do not stop without consulting the treating physician.' },
      { medicine: 'Atorvastatin 40 mg', strength: '40 mg', dosage: '1 tablet', frequency: 'Once daily at bedtime', duration: '30 days', quantity: 30, instructions: 'Report any unexplained muscle pain.' },
    ],
  },
  {
    id: 'RX-7714',
    patientId: 'PT-10302',
    patientName: 'Gurpreet Sethi',
    doctor: 'Dr. Sanjay Bhatt',
    date: '2026-08-24',
    status: 'Partially Dispensed',
    priority: 'Urgent',
    items: [
      { medicine: 'Tramadol 50 mg', strength: '50 mg', dosage: '1 capsule', frequency: 'Every 8 hours as needed', duration: '5 days', quantity: 15, instructions: 'Maximum 3 doses in 24 hours. May cause drowsiness.' },
      { medicine: 'Pantoprazole 40 mg', strength: '40 mg', dosage: '1 tablet', frequency: 'Once daily', duration: '7 days', quantity: 7, instructions: 'Before breakfast.' },
      { medicine: 'Calcium + Vitamin D3', strength: '500 mg + 250 IU', dosage: '1 tablet', frequency: 'Twice daily', duration: '30 days', quantity: 60, instructions: 'Take after meals.' },
    ],
  },
  {
    id: 'RX-7715',
    patientId: 'PT-10356',
    patientName: 'Suresh Pillai',
    doctor: 'Dr. Sanjay Bhatt',
    date: '2026-08-23',
    status: 'Pending',
    priority: 'Routine',
    items: [
      { medicine: 'Denosumab 60 mg Injection', strength: '60 mg/mL', dosage: '1 pre-filled syringe', frequency: 'Once every 6 months', duration: 'Single dose', quantity: 1, instructions: 'Subcutaneous. Refrigerate until administration.' },
      { medicine: 'Calcium + Vitamin D3', strength: '500 mg + 250 IU', dosage: '1 tablet', frequency: 'Twice daily', duration: '30 days', quantity: 60, instructions: 'Take after meals.' },
    ],
  },
  {
    id: 'RX-7716',
    patientId: 'PT-10315',
    patientName: 'Lakshmi Venkatesh',
    doctor: 'Dr. Priya Nair',
    date: '2026-08-23',
    status: 'Pending',
    priority: 'Routine',
    items: [
      { medicine: 'Levodopa-Carbidopa 100/25', strength: '100/25 mg', dosage: '1 tablet', frequency: 'Three times daily', duration: '30 days', quantity: 90, instructions: 'Take 30 minutes before meals for best absorption.' },
    ],
  },
  {
    id: 'RX-7717',
    patientId: 'PT-10251',
    patientName: 'Simran Kaur',
    doctor: 'Dr. Priya Nair',
    date: '2026-08-22',
    status: 'Dispensed',
    priority: 'Routine',
    items: [
      { medicine: 'Pregabalin 75 mg', strength: '75 mg', dosage: '1 capsule', frequency: 'Twice daily', duration: '21 days', quantity: 42, instructions: 'May cause dizziness — avoid driving initially.' },
      { medicine: 'Cholecalciferol 60000 IU', strength: '60000 IU', dosage: '1 sachet', frequency: 'Once weekly', duration: '8 weeks', quantity: 8, instructions: 'Dissolve in milk after a meal.' },
    ],
  },
  {
    id: 'RX-7718',
    patientId: 'PT-10284',
    patientName: 'Mohammed Farhan',
    doctor: 'Dr. Arjun Sharma',
    date: '2026-08-22',
    status: 'Dispensed',
    priority: 'Routine',
    items: [
      { medicine: 'Atorvastatin 40 mg', strength: '40 mg', dosage: '1 tablet', frequency: 'Once daily at bedtime', duration: '30 days', quantity: 30, instructions: 'Continue long term.' },
      { medicine: 'Clopidogrel 75 mg', strength: '75 mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', quantity: 30, instructions: 'Do not discontinue abruptly.' },
    ],
  },
  {
    id: 'RX-7719',
    patientId: 'PT-10372',
    patientName: 'Kavita Joshi',
    doctor: 'Dr. Arjun Sharma',
    date: '2026-08-20',
    status: 'Dispensed',
    priority: 'Routine',
    items: [
      { medicine: 'Methotrexate 15 mg', strength: '15 mg', dosage: '1 tablet', frequency: 'Once weekly (Sunday)', duration: '12 weeks', quantity: 12, instructions: 'Never take daily. Blood counts every 8 weeks.' },
      { medicine: 'Folic Acid 5 mg', strength: '5 mg', dosage: '1 tablet', frequency: 'Once weekly (Wednesday)', duration: '12 weeks', quantity: 12, instructions: 'Take on a different day from methotrexate.' },
    ],
  },
]

export const PENDING_PRESCRIPTIONS = PRESCRIPTIONS.filter(
  (p) => p.status === 'Pending' || p.status === 'Partially Dispensed',
)

/* --------------------------------- Sales ---------------------------------- */

export const PHARMACY_SALES_TODAY = {
  revenue: 84_620,
  orders: 47,
  averageOrderValue: 1_800,
  itemsDispensed: 214,
}

export const PHARMACY_SALES_TREND = [
  { day: 'Mon', sales: 71_400, orders: 39 },
  { day: 'Tue', sales: 66_800, orders: 36 },
  { day: 'Wed', sales: 92_100, orders: 51 },
  { day: 'Thu', sales: 78_300, orders: 44 },
  { day: 'Fri', sales: 88_900, orders: 49 },
  { day: 'Sat', sales: 103_500, orders: 58 },
  { day: 'Sun', sales: 84_620, orders: 47 },
]
