import type {
  DocumentRecord,
  MedicalHistoryEntry,
  Patient,
  ProgressPoint,
  RehabPlan,
  Vitals,
} from '@/types'
import { initialsOf, seeded } from '@/lib/utils'

const AVATAR_COLORS = [
  'bg-chart-1/15 text-chart-1',
  'bg-chart-2/15 text-chart-2',
  'bg-chart-3/15 text-chart-3',
  'bg-chart-4/15 text-chart-4',
  'bg-chart-5/15 text-chart-5',
  'bg-chart-6/15 text-chart-6',
]

/** Weekly labels ending at the current review week. */
const WEEK_LABELS = ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5', 'Wk 6', 'Wk 7', 'Wk 8']

interface ProgressShape {
  weeks: number
  painFrom: number
  painTo: number
  mobilityFrom: number
  mobilityTo: number
  strengthFrom: number
  strengthTo: number
  adherence: number
  /** 0 = linear improvement, >0 = flattens towards the end (plateau). */
  plateau?: number
}

function buildProgress(seed: number, shape: ProgressShape): ProgressPoint[] {
  const rand = seeded(seed)
  const n = shape.weeks
  return Array.from({ length: n }, (_, i) => {
    const raw = n === 1 ? 1 : i / (n - 1)
    // Plateau bends the curve so late weeks gain very little.
    const t = shape.plateau ? Math.pow(raw, 1 + shape.plateau) * (1 - shape.plateau * 0.28) + raw * shape.plateau * 0.28 : raw
    const jitter = (rand() - 0.5) * 0.5
    return {
      week: WEEK_LABELS[i] ?? `Wk ${i + 1}`,
      pain: Number(Math.max(0, shape.painFrom + (shape.painTo - shape.painFrom) * t + jitter * 0.6).toFixed(1)),
      mobility: Math.round(shape.mobilityFrom + (shape.mobilityTo - shape.mobilityFrom) * t + jitter * 2),
      strength: Math.round(shape.strengthFrom + (shape.strengthTo - shape.strengthFrom) * t + jitter * 2),
      adherence: Math.min(100, Math.round(shape.adherence + jitter * 4)),
    }
  })
}

interface VitalsShape {
  systolic: number
  diastolic: number
  heartRate: number
  temperature: number
  spo2: number
  respiratoryRate: number
}

function buildVitals(seed: number, base: VitalsShape, recordedBy: string, count = 5): Vitals[] {
  const rand = seeded(seed)
  const start = new Date('2026-08-24T07:30:00')
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(start.getTime() - i * 6 * 3600 * 1000)
    const j = () => rand() - 0.5
    return {
      recordedAt: at.toISOString(),
      recordedBy,
      systolic: Math.round(base.systolic + j() * 10),
      diastolic: Math.round(base.diastolic + j() * 7),
      heartRate: Math.round(base.heartRate + j() * 9),
      temperature: Number((base.temperature + j() * 0.6).toFixed(1)),
      spo2: Math.min(100, Math.round(base.spo2 + j() * 2)),
      respiratoryRate: Math.round(base.respiratoryRate + j() * 3),
    }
  })
}

const STANDARD_DOCS = (patientId: string, uploader: string): DocumentRecord[] => [
  {
    id: `${patientId}-DOC-1`,
    name: 'Initial Assessment Report.pdf',
    type: 'Report',
    size: '412 KB',
    uploadedOn: '2026-07-02',
    uploadedBy: uploader,
  },
  {
    id: `${patientId}-DOC-2`,
    name: 'MRI Lumbar Spine.dcm',
    type: 'Scan',
    size: '18.4 MB',
    uploadedOn: '2026-07-04',
    uploadedBy: 'Radiology Desk',
  },
  {
    id: `${patientId}-DOC-3`,
    name: 'Therapy Consent Form.pdf',
    type: 'Consent',
    size: '96 KB',
    uploadedOn: '2026-07-05',
    uploadedBy: 'Sneha Patil',
  },
  {
    id: `${patientId}-DOC-4`,
    name: 'Insurance Pre-Authorisation.pdf',
    type: 'Insurance',
    size: '244 KB',
    uploadedOn: '2026-07-06',
    uploadedBy: 'Kiran Rao',
  },
]

interface Seed {
  id: string
  name: string
  age: number
  gender: Patient['gender']
  phone: string
  email: string
  address: string
  bloodGroup: string
  status: Patient['status']
  registeredOn: string
  primaryCondition: string
  assignedDoctor: string
  assignedTherapist: string
  department: string
  ward?: string
  room?: string
  bed?: string
  admittedOn?: string
  expectedDischarge?: string
  emergency: [string, string, string]
  insurance?: [string, string, string]
  allergies: string[]
  lastVisit: string
  nextAppointment?: string
  outstandingAmount: number
  vitals: VitalsShape
  history: Omit<MedicalHistoryEntry, 'id'>[]
  plan?: Omit<RehabPlan, 'id'>
  progress: ProgressShape
}

const SEEDS: Seed[] = [
  {
    id: 'PT-10248',
    name: 'Raj Kumar',
    age: 46,
    gender: 'Male',
    phone: '+91 98201 44567',
    email: 'raj.kumar@gmail.com',
    address: 'B-704, Shanti Heights, Andheri West, Mumbai 400058',
    bloodGroup: 'B+',
    status: 'In Rehabilitation',
    registeredOn: '2026-06-28',
    primaryCondition: 'Post-operative ACL reconstruction — right knee',
    assignedDoctor: 'Dr. Arjun Sharma',
    assignedTherapist: 'Meera Iyer',
    department: 'Physiotherapy',
    ward: 'Ward A',
    room: 'A-1',
    bed: 'A-102',
    admittedOn: '2026-08-18',
    expectedDischarge: '2026-08-29',
    emergency: ['Sunita Kumar', 'Spouse', '+91 98201 44568'],
    insurance: ['Star Health Insurance', 'SH-4471-90223', '2027-03-31'],
    allergies: ['Penicillin'],
    lastVisit: '2026-08-23',
    nextAppointment: '2026-08-24 10:15',
    outstandingAmount: 18400,
    vitals: { systolic: 128, diastolic: 82, heartRate: 76, temperature: 36.8, spo2: 98, respiratoryRate: 16 },
    history: [
      {
        date: '2026-06-24',
        type: 'Surgery',
        title: 'Arthroscopic ACL reconstruction (right knee)',
        detail: 'Hamstring autograft. Uneventful intra-operative course. Discharged on day 3 with knee immobiliser.',
        clinician: 'Dr. Sanjay Bhatt',
      },
      {
        date: '2026-06-18',
        type: 'Injury',
        title: 'Complete ACL tear — right knee',
        detail: 'Sustained during recreational football. MRI confirmed complete ACL rupture with grade I MCL sprain.',
        clinician: 'Dr. Sanjay Bhatt',
      },
      {
        date: '2026-07-02',
        type: 'Diagnosis',
        title: 'Post-operative knee stiffness',
        detail: 'Range of motion limited to 0-85 degrees at 8 days post-op. Enrolled in structured rehabilitation.',
        clinician: 'Dr. Arjun Sharma',
      },
      {
        date: '2026-08-20',
        type: 'Lab Result',
        title: 'Complete blood count — within normal limits',
        detail: 'Hb 14.1 g/dL, WBC 7,200/µL, Platelets 2.4 lakh/µL. No signs of post-operative infection.',
        clinician: 'Central Laboratory',
      },
      {
        date: '2020-01-15',
        type: 'Chronic Condition',
        title: 'Hypertension — controlled',
        detail: 'On Telmisartan 40 mg once daily. Blood pressure well controlled on current regimen.',
        clinician: 'Dr. Priya Nair',
      },
    ],
    plan: {
      title: 'ACL Reconstruction Rehabilitation — Phase 3',
      goal: 'Restore full knee extension, achieve 90% quadriceps strength symmetry and return to non-contact sport by week 14.',
      startDate: '2026-07-02',
      targetEndDate: '2026-09-18',
      totalSessions: 24,
      completedSessions: 18,
      frequencyPerWeek: 3,
      primaryTherapist: 'Meera Iyer',
      modalities: ['Closed-chain strengthening', 'Neuromuscular re-education', 'Gait training', 'Cryotherapy'],
      trend: 'On Track',
      attendanceRate: 94,
      adherenceRate: 88,
      milestones: [
        { label: 'Full passive extension achieved', done: true, date: '2026-07-16' },
        { label: 'Independent stair negotiation', done: true, date: '2026-07-30' },
        { label: 'Single-leg squat to 60 degrees', done: true, date: '2026-08-13' },
        { label: 'Quadriceps symmetry above 85%', done: false, date: '2026-09-03' },
        { label: 'Return-to-sport clearance', done: false, date: '2026-09-18' },
      ],
    },
    progress: {
      weeks: 8,
      painFrom: 7.2,
      painTo: 3.8,
      mobilityFrom: 38,
      mobilityTo: 82,
      strengthFrom: 32,
      strengthTo: 76,
      adherence: 88,
    },
  },
  {
    id: 'PT-10251',
    name: 'Simran Kaur',
    age: 34,
    gender: 'Female',
    phone: '+91 99304 77812',
    email: 'simran.kaur@outlook.com',
    address: 'Flat 12, Hiranandani Gardens, Powai, Mumbai 400076',
    bloodGroup: 'O+',
    status: 'In Rehabilitation',
    registeredOn: '2026-06-15',
    primaryCondition: 'Cervical radiculopathy with chronic neck pain',
    assignedDoctor: 'Dr. Priya Nair',
    assignedTherapist: 'Meera Iyer',
    department: 'Physiotherapy',
    emergency: ['Harpreet Singh', 'Brother', '+91 99304 77813'],
    insurance: ['HDFC ERGO Health', 'HE-88231-4470', '2026-12-31'],
    allergies: ['Sulfa drugs', 'Latex'],
    lastVisit: '2026-08-22',
    nextAppointment: '2026-08-24 10:00',
    outstandingAmount: 6200,
    vitals: { systolic: 118, diastolic: 76, heartRate: 72, temperature: 36.6, spo2: 99, respiratoryRate: 15 },
    history: [
      {
        date: '2026-06-10',
        type: 'Diagnosis',
        title: 'C6 cervical radiculopathy',
        detail: 'MRI shows C5-C6 disc protrusion with left-sided foraminal narrowing. Conservative management advised.',
        clinician: 'Dr. Priya Nair',
      },
      {
        date: '2026-06-15',
        type: 'Diagnosis',
        title: 'Postural dysfunction — forward head posture',
        detail: 'Prolonged desk work. Deep neck flexor weakness with upper trapezius overactivity.',
        clinician: 'Meera Iyer',
      },
      {
        date: '2026-08-05',
        type: 'Lab Result',
        title: 'Vitamin D deficiency',
        detail: 'Serum 25-OH vitamin D 14 ng/mL. Supplementation started, may be contributing to slow recovery.',
        clinician: 'Central Laboratory',
      },
    ],
    plan: {
      title: 'Cervical Spine Rehabilitation Programme',
      goal: 'Eliminate radicular symptoms, restore pain-free cervical rotation and build sustained postural endurance.',
      startDate: '2026-06-18',
      targetEndDate: '2026-09-10',
      totalSessions: 20,
      completedSessions: 13,
      frequencyPerWeek: 2,
      primaryTherapist: 'Meera Iyer',
      modalities: ['Manual therapy', 'Deep neck flexor training', 'Cervical traction', 'Ergonomic re-education'],
      trend: 'Plateaued',
      attendanceRate: 78,
      adherenceRate: 61,
      milestones: [
        { label: 'Radicular pain reduced below 5/10', done: true, date: '2026-07-08' },
        { label: 'Full cervical rotation restored', done: true, date: '2026-07-29' },
        { label: 'Deep neck flexor endurance 30s', done: false, date: '2026-08-26' },
        { label: 'Symptom-free full work day', done: false, date: '2026-09-10' },
      ],
    },
    progress: {
      weeks: 8,
      painFrom: 6.8,
      painTo: 4.4,
      mobilityFrom: 44,
      mobilityTo: 68,
      strengthFrom: 40,
      strengthTo: 58,
      adherence: 61,
      plateau: 0.55,
    },
  },
  {
    id: 'PT-10263',
    name: 'Amit Singh',
    age: 58,
    gender: 'Male',
    phone: '+91 98923 10045',
    email: 'amit.singh58@gmail.com',
    address: '3rd Floor, Sai Krupa CHS, Vile Parle East, Mumbai 400057',
    bloodGroup: 'A+',
    status: 'Admitted - IPD',
    registeredOn: '2026-05-30',
    primaryCondition: 'Left middle cerebral artery stroke with right hemiparesis',
    assignedDoctor: 'Dr. Priya Nair',
    assignedTherapist: 'Tanmay Joshi',
    department: 'Neuro Rehabilitation',
    ward: 'Ward A',
    room: 'A-2',
    bed: 'A-105',
    admittedOn: '2026-08-02',
    expectedDischarge: '2026-09-05',
    emergency: ['Rekha Singh', 'Spouse', '+91 98923 10046'],
    insurance: ['New India Assurance', 'NIA-2210-88734', '2027-06-30'],
    allergies: [],
    lastVisit: '2026-08-23',
    nextAppointment: '2026-08-24 11:30',
    outstandingAmount: 42750,
    vitals: { systolic: 142, diastolic: 88, heartRate: 82, temperature: 36.9, spo2: 96, respiratoryRate: 18 },
    history: [
      {
        date: '2026-05-26',
        type: 'Diagnosis',
        title: 'Acute ischaemic stroke — left MCA territory',
        detail: 'Thrombolysed within window. NIHSS 12 on admission, improved to 6 at 72 hours.',
        clinician: 'Dr. Priya Nair',
      },
      {
        date: '2026-06-02',
        type: 'Diagnosis',
        title: 'Expressive aphasia',
        detail: 'Moderate non-fluent aphasia with preserved comprehension. Speech therapy commenced.',
        clinician: 'Farah Sheikh',
      },
      {
        date: '2015-08-11',
        type: 'Chronic Condition',
        title: 'Type 2 diabetes mellitus',
        detail: 'On Metformin 1000 mg twice daily. HbA1c 7.4% at last review.',
        clinician: 'Dr. Arjun Sharma',
      },
      {
        date: '2026-08-19',
        type: 'Lab Result',
        title: 'HbA1c 7.1% — improving',
        detail: 'Down from 7.4%. Dietary counselling and inpatient glycaemic monitoring continuing.',
        clinician: 'Central Laboratory',
      },
    ],
    plan: {
      title: 'Neuro Rehabilitation — Post-Stroke Recovery',
      goal: 'Achieve independent ambulation with a single-point stick and functional right-hand grasp for daily tasks.',
      startDate: '2026-06-05',
      targetEndDate: '2026-10-02',
      totalSessions: 36,
      completedSessions: 21,
      frequencyPerWeek: 5,
      primaryTherapist: 'Tanmay Joshi',
      modalities: ['Task-oriented training', 'Constraint-induced movement therapy', 'Gait re-training', 'Speech therapy'],
      trend: 'On Track',
      attendanceRate: 97,
      adherenceRate: 91,
      milestones: [
        { label: 'Sitting balance without support', done: true, date: '2026-06-19' },
        { label: 'Standing tolerance 10 minutes', done: true, date: '2026-07-10' },
        { label: 'Assisted ambulation 20 metres', done: true, date: '2026-08-07' },
        { label: 'Independent stick ambulation', done: false, date: '2026-09-11' },
        { label: 'Functional right-hand grasp', done: false, date: '2026-10-02' },
      ],
    },
    progress: {
      weeks: 8,
      painFrom: 4.2,
      painTo: 2.1,
      mobilityFrom: 18,
      mobilityTo: 58,
      strengthFrom: 15,
      strengthTo: 52,
      adherence: 91,
    },
  },
  {
    id: 'PT-10277',
    name: 'Priya Sharma',
    age: 29,
    gender: 'Female',
    phone: '+91 90045 21178',
    email: 'priya.sharma29@gmail.com',
    address: 'A-302, Green Acres, Lokhandwala, Mumbai 400053',
    bloodGroup: 'AB+',
    status: 'Active - OPD',
    registeredOn: '2026-07-19',
    primaryCondition: 'Chronic lower back pain with core instability',
    assignedDoctor: 'Dr. Arjun Sharma',
    assignedTherapist: 'Kavya Reddy',
    department: 'Physiotherapy',
    emergency: ['Deepak Sharma', 'Father', '+91 90045 21179'],
    allergies: ['Ibuprofen'],
    lastVisit: '2026-08-21',
    nextAppointment: '2026-08-24 09:30',
    outstandingAmount: 0,
    vitals: { systolic: 112, diastolic: 72, heartRate: 68, temperature: 36.5, spo2: 99, respiratoryRate: 14 },
    history: [
      {
        date: '2026-07-19',
        type: 'Diagnosis',
        title: 'Mechanical low back pain',
        detail: 'No red flags. X-ray unremarkable. Weak transversus abdominis with poor lumbopelvic control.',
        clinician: 'Dr. Arjun Sharma',
      },
      {
        date: '2026-07-19',
        type: 'Allergy',
        title: 'NSAID intolerance',
        detail: 'Gastric irritation with ibuprofen. Paracetamol used for analgesia instead.',
        clinician: 'Dr. Arjun Sharma',
      },
    ],
    plan: {
      title: 'Core Stabilisation Programme',
      goal: 'Pain-free prolonged sitting and lifting to 15 kg with correct lumbopelvic mechanics.',
      startDate: '2026-07-22',
      targetEndDate: '2026-09-25',
      totalSessions: 16,
      completedSessions: 9,
      frequencyPerWeek: 2,
      primaryTherapist: 'Kavya Reddy',
      modalities: ['Motor control training', 'Pilates-based exercise', 'Manual therapy', 'Education'],
      trend: 'Ahead of Plan',
      attendanceRate: 100,
      adherenceRate: 96,
      milestones: [
        { label: 'Pain below 3/10 at rest', done: true, date: '2026-08-05' },
        { label: 'Plank hold 60 seconds', done: true, date: '2026-08-19' },
        { label: 'Lift 15 kg with correct form', done: false, date: '2026-09-09' },
        { label: 'Discharge to home programme', done: false, date: '2026-09-25' },
      ],
    },
    progress: {
      weeks: 6,
      painFrom: 6.0,
      painTo: 2.2,
      mobilityFrom: 52,
      mobilityTo: 88,
      strengthFrom: 45,
      strengthTo: 84,
      adherence: 96,
    },
  },
  {
    id: 'PT-10284',
    name: 'Mohammed Farhan',
    age: 62,
    gender: 'Male',
    phone: '+91 98195 30021',
    email: 'm.farhan@rediffmail.com',
    address: '14, Nargis Villa, Bandra West, Mumbai 400050',
    bloodGroup: 'B-',
    status: 'Discharge Pending',
    registeredOn: '2026-07-01',
    primaryCondition: 'Post-CABG cardiac rehabilitation — phase II',
    assignedDoctor: 'Dr. Arjun Sharma',
    assignedTherapist: 'Ritika Shah',
    department: 'Cardiac Rehabilitation',
    ward: 'Ward B',
    room: 'B-1',
    bed: 'B-201',
    admittedOn: '2026-08-12',
    expectedDischarge: '2026-08-24',
    emergency: ['Zainab Farhan', 'Daughter', '+91 98195 30022'],
    insurance: ['ICICI Lombard', 'IL-77120-3348', '2027-01-31'],
    allergies: ['Aspirin — mild rash'],
    lastVisit: '2026-08-23',
    outstandingAmount: 31200,
    vitals: { systolic: 134, diastolic: 84, heartRate: 88, temperature: 36.7, spo2: 95, respiratoryRate: 19 },
    history: [
      {
        date: '2026-06-28',
        type: 'Surgery',
        title: 'Coronary artery bypass grafting (triple vessel)',
        detail: 'LIMA to LAD, SVG to OM and RCA. Recovery uneventful, ejection fraction 48% post-operatively.',
        clinician: 'Dr. Sanjay Bhatt',
      },
      {
        date: '2026-07-01',
        type: 'Chronic Condition',
        title: 'Ischaemic heart disease',
        detail: 'On dual antiplatelet therapy, statin and beta blocker. Cardiac rehab phase II commenced.',
        clinician: 'Dr. Arjun Sharma',
      },
      {
        date: '2026-08-18',
        type: 'Lab Result',
        title: 'Lipid profile — improved',
        detail: 'LDL 78 mg/dL, HDL 42 mg/dL, Triglycerides 148 mg/dL. Target LDL achieved on Atorvastatin 40 mg.',
        clinician: 'Central Laboratory',
      },
    ],
    plan: {
      title: 'Cardiac Rehabilitation — Phase II',
      goal: 'Reach 5 METs functional capacity with stable haemodynamics and complete risk-factor education.',
      startDate: '2026-07-05',
      targetEndDate: '2026-08-28',
      totalSessions: 18,
      completedSessions: 16,
      frequencyPerWeek: 3,
      primaryTherapist: 'Ritika Shah',
      modalities: ['Monitored aerobic training', 'Resistance training', 'Breathing exercises', 'Risk-factor education'],
      trend: 'On Track',
      attendanceRate: 89,
      adherenceRate: 85,
      milestones: [
        { label: 'Six-minute walk test above 300 m', done: true, date: '2026-07-24' },
        { label: 'Functional capacity 4 METs', done: true, date: '2026-08-11' },
        { label: 'Functional capacity 5 METs', done: false, date: '2026-08-28' },
      ],
    },
    progress: {
      weeks: 7,
      painFrom: 3.5,
      painTo: 1.4,
      mobilityFrom: 40,
      mobilityTo: 74,
      strengthFrom: 35,
      strengthTo: 66,
      adherence: 85,
    },
  },
  {
    id: 'PT-10290',
    name: 'Anjali Deshpande',
    age: 41,
    gender: 'Female',
    phone: '+91 97690 88452',
    email: 'anjali.d@gmail.com',
    address: '702, Rustomjee Elanza, Malad West, Mumbai 400064',
    bloodGroup: 'O-',
    status: 'In Rehabilitation',
    registeredOn: '2026-07-08',
    primaryCondition: 'Frozen shoulder (adhesive capsulitis) — left',
    assignedDoctor: 'Dr. Sanjay Bhatt',
    assignedTherapist: 'Kavya Reddy',
    department: 'Occupational Therapy',
    emergency: ['Nikhil Deshpande', 'Spouse', '+91 97690 88453'],
    insurance: ['Star Health Insurance', 'SH-6612-33810', '2026-11-30'],
    allergies: [],
    lastVisit: '2026-08-20',
    nextAppointment: '2026-08-25 12:00',
    outstandingAmount: 9800,
    vitals: { systolic: 122, diastolic: 78, heartRate: 74, temperature: 36.6, spo2: 98, respiratoryRate: 15 },
    history: [
      {
        date: '2026-07-08',
        type: 'Diagnosis',
        title: 'Adhesive capsulitis — freezing stage',
        detail: 'Global restriction of glenohumeral movement, external rotation most affected. Onset insidious over 4 months.',
        clinician: 'Dr. Sanjay Bhatt',
      },
      {
        date: '2026-07-08',
        type: 'Chronic Condition',
        title: 'Subclinical hypothyroidism',
        detail: 'TSH 6.8 mIU/L. Known association with adhesive capsulitis. Endocrine referral made.',
        clinician: 'Dr. Sanjay Bhatt',
      },
    ],
    plan: {
      title: 'Shoulder Mobilisation & Functional Restoration',
      goal: 'Restore functional overhead reach and independent dressing without compensatory trunk movement.',
      startDate: '2026-07-11',
      targetEndDate: '2026-10-16',
      totalSessions: 28,
      completedSessions: 12,
      frequencyPerWeek: 2,
      primaryTherapist: 'Kavya Reddy',
      modalities: ['Joint mobilisation', 'Capsular stretching', 'Activity of daily living retraining', 'Thermotherapy'],
      trend: 'At Risk',
      attendanceRate: 68,
      adherenceRate: 54,
      milestones: [
        { label: 'Pain-free sleeping position', done: true, date: '2026-08-01' },
        { label: 'External rotation to 30 degrees', done: false, date: '2026-09-04' },
        { label: 'Independent overhead dressing', done: false, date: '2026-10-16' },
      ],
    },
    progress: {
      weeks: 7,
      painFrom: 7.8,
      painTo: 5.9,
      mobilityFrom: 28,
      mobilityTo: 46,
      strengthFrom: 30,
      strengthTo: 44,
      adherence: 54,
      plateau: 0.7,
    },
  },
  {
    id: 'PT-10302',
    name: 'Gurpreet Sethi',
    age: 52,
    gender: 'Male',
    phone: '+91 98338 71209',
    email: 'gurpreet.sethi@yahoo.in',
    address: '9, Juhu Tara Road, Juhu, Mumbai 400049',
    bloodGroup: 'A-',
    status: 'Admitted - IPD',
    registeredOn: '2026-08-05',
    primaryCondition: 'Total knee replacement — left, post-operative day 6',
    assignedDoctor: 'Dr. Sanjay Bhatt',
    assignedTherapist: 'Meera Iyer',
    department: 'Physiotherapy',
    ward: 'Ward A',
    room: 'A-3',
    bed: 'A-108',
    admittedOn: '2026-08-18',
    expectedDischarge: '2026-08-30',
    emergency: ['Manpreet Sethi', 'Spouse', '+91 98338 71210'],
    insurance: ['Bajaj Allianz Health', 'BA-33091-7745', '2027-04-30'],
    allergies: ['Codeine'],
    lastVisit: '2026-08-23',
    nextAppointment: '2026-08-24 14:00',
    outstandingAmount: 57300,
    vitals: { systolic: 136, diastolic: 86, heartRate: 84, temperature: 37.1, spo2: 97, respiratoryRate: 17 },
    history: [
      {
        date: '2026-08-18',
        type: 'Surgery',
        title: 'Total knee arthroplasty — left',
        detail: 'Cemented posterior-stabilised implant. Blood loss minimal. Mobilised on post-operative day 1.',
        clinician: 'Dr. Sanjay Bhatt',
      },
      {
        date: '2024-03-12',
        type: 'Diagnosis',
        title: 'Grade IV osteoarthritis — left knee',
        detail: 'Bone-on-bone changes with varus deformity. Conservative management exhausted.',
        clinician: 'Dr. Sanjay Bhatt',
      },
    ],
    plan: {
      title: 'Total Knee Replacement Rehabilitation',
      goal: 'Achieve 110 degrees of active knee flexion and independent community ambulation by week 8.',
      startDate: '2026-08-19',
      targetEndDate: '2026-10-14',
      totalSessions: 30,
      completedSessions: 5,
      frequencyPerWeek: 5,
      primaryTherapist: 'Meera Iyer',
      modalities: ['Continuous passive motion', 'Quadriceps activation', 'Oedema management', 'Transfer training'],
      trend: 'On Track',
      attendanceRate: 100,
      adherenceRate: 92,
      milestones: [
        { label: 'Active flexion to 70 degrees', done: true, date: '2026-08-22' },
        { label: 'Independent bed-to-chair transfer', done: true, date: '2026-08-21' },
        { label: 'Active flexion to 110 degrees', done: false, date: '2026-09-16' },
        { label: 'Independent stair climbing', done: false, date: '2026-10-14' },
      ],
    },
    progress: {
      weeks: 2,
      painFrom: 8.4,
      painTo: 6.2,
      mobilityFrom: 12,
      mobilityTo: 34,
      strengthFrom: 14,
      strengthTo: 30,
      adherence: 92,
    },
  },
  {
    id: 'PT-10315',
    name: 'Lakshmi Venkatesh',
    age: 67,
    gender: 'Female',
    phone: '+91 99871 40023',
    email: 'lakshmi.v67@gmail.com',
    address: '5, Matunga East, Mumbai 400019',
    bloodGroup: 'B+',
    status: 'In Rehabilitation',
    registeredOn: '2026-06-02',
    primaryCondition: "Parkinson's disease — balance and gait rehabilitation",
    assignedDoctor: 'Dr. Priya Nair',
    assignedTherapist: 'Tanmay Joshi',
    department: 'Neuro Rehabilitation',
    emergency: ['Ramesh Venkatesh', 'Son', '+91 99871 40024'],
    insurance: ['Senior Citizen Mediclaim', 'SCM-1120-8843', '2027-02-28'],
    allergies: [],
    lastVisit: '2026-08-22',
    nextAppointment: '2026-08-24 15:30',
    outstandingAmount: 12400,
    vitals: { systolic: 126, diastolic: 74, heartRate: 70, temperature: 36.4, spo2: 97, respiratoryRate: 16 },
    history: [
      {
        date: '2023-11-04',
        type: 'Diagnosis',
        title: "Idiopathic Parkinson's disease, Hoehn & Yahr stage 2",
        detail: 'Bradykinesia with resting tremor, right-side dominant. On Levodopa-Carbidopa.',
        clinician: 'Dr. Priya Nair',
      },
      {
        date: '2026-05-28',
        type: 'Injury',
        title: 'Fall at home — no fracture',
        detail: 'Mechanical fall while turning. X-ray of hip and pelvis normal. Referred for balance rehabilitation.',
        clinician: 'Dr. Priya Nair',
      },
    ],
    plan: {
      title: 'Balance & Gait Rehabilitation Programme',
      goal: 'Reduce fall risk, improve turning strategy and increase functional walking distance to 500 metres.',
      startDate: '2026-06-06',
      targetEndDate: '2026-09-30',
      totalSessions: 32,
      completedSessions: 24,
      frequencyPerWeek: 2,
      primaryTherapist: 'Tanmay Joshi',
      modalities: ['LSVT BIG protocol', 'Dual-task training', 'Cueing strategies', 'Balance re-education'],
      trend: 'On Track',
      attendanceRate: 91,
      adherenceRate: 87,
      milestones: [
        { label: 'Berg Balance Score above 45', done: true, date: '2026-07-15' },
        { label: 'No falls for 8 weeks', done: true, date: '2026-08-14' },
        { label: 'Walking distance 500 m', done: false, date: '2026-09-30' },
      ],
    },
    progress: {
      weeks: 8,
      painFrom: 2.8,
      painTo: 1.6,
      mobilityFrom: 46,
      mobilityTo: 71,
      strengthFrom: 42,
      strengthTo: 64,
      adherence: 87,
    },
  },
  {
    id: 'PT-10328',
    name: 'Aditya Rane',
    age: 24,
    gender: 'Male',
    phone: '+91 91678 22904',
    email: 'aditya.rane@gmail.com',
    address: '404, Sunrise Apartments, Goregaon East, Mumbai 400063',
    bloodGroup: 'O+',
    status: 'Follow-up',
    registeredOn: '2026-04-14',
    primaryCondition: 'Grade II ankle sprain — return to sport',
    assignedDoctor: 'Dr. Sanjay Bhatt',
    assignedTherapist: 'Meera Iyer',
    department: 'Physiotherapy',
    emergency: ['Sharmila Rane', 'Mother', '+91 91678 22905'],
    allergies: [],
    lastVisit: '2026-08-12',
    nextAppointment: '2026-09-02 11:00',
    outstandingAmount: 0,
    vitals: { systolic: 116, diastolic: 70, heartRate: 62, temperature: 36.5, spo2: 99, respiratoryRate: 14 },
    history: [
      {
        date: '2026-04-12',
        type: 'Injury',
        title: 'Grade II lateral ankle ligament sprain',
        detail: 'Inversion injury during basketball. ATFL partially torn on ultrasound.',
        clinician: 'Dr. Sanjay Bhatt',
      },
      {
        date: '2026-08-12',
        type: 'Diagnosis',
        title: 'Return-to-sport clearance granted',
        detail: 'Hop test symmetry 96%, no residual laxity. Advised prophylactic taping for 3 months.',
        clinician: 'Dr. Sanjay Bhatt',
      },
    ],
    plan: {
      title: 'Ankle Proprioception & Return-to-Sport',
      goal: 'Full return to competitive basketball with symmetric hop-test performance.',
      startDate: '2026-04-18',
      targetEndDate: '2026-08-12',
      totalSessions: 18,
      completedSessions: 18,
      frequencyPerWeek: 2,
      primaryTherapist: 'Meera Iyer',
      modalities: ['Proprioceptive training', 'Plyometrics', 'Agility drills', 'Strength training'],
      trend: 'Completed',
      attendanceRate: 100,
      adherenceRate: 95,
      milestones: [
        { label: 'Pain-free full weight bearing', done: true, date: '2026-05-02' },
        { label: 'Single-leg balance 60 seconds', done: true, date: '2026-06-06' },
        { label: 'Hop test symmetry above 90%', done: true, date: '2026-08-12' },
      ],
    },
    progress: {
      weeks: 8,
      painFrom: 5.5,
      painTo: 0.4,
      mobilityFrom: 55,
      mobilityTo: 97,
      strengthFrom: 50,
      strengthTo: 94,
      adherence: 95,
    },
  },
  {
    id: 'PT-10341',
    name: 'Fatima Ansari',
    age: 38,
    gender: 'Female',
    phone: '+91 98929 55617',
    email: 'fatima.ansari@gmail.com',
    address: '22, Mahim West, Mumbai 400016',
    bloodGroup: 'AB-',
    status: 'Active - OPD',
    registeredOn: '2026-08-11',
    primaryCondition: 'Carpal tunnel syndrome — bilateral, conservative management',
    assignedDoctor: 'Dr. Arjun Sharma',
    assignedTherapist: 'Kavya Reddy',
    department: 'Occupational Therapy',
    emergency: ['Iqbal Ansari', 'Spouse', '+91 98929 55618'],
    allergies: ['Iodine contrast'],
    lastVisit: '2026-08-19',
    nextAppointment: '2026-08-26 10:30',
    outstandingAmount: 3400,
    vitals: { systolic: 120, diastolic: 76, heartRate: 78, temperature: 36.7, spo2: 98, respiratoryRate: 15 },
    history: [
      {
        date: '2026-08-11',
        type: 'Diagnosis',
        title: 'Bilateral carpal tunnel syndrome — moderate',
        detail: 'Nerve conduction study confirms median nerve slowing across the wrist bilaterally.',
        clinician: 'Dr. Arjun Sharma',
      },
    ],
    plan: {
      title: 'Hand Function & Nerve Gliding Programme',
      goal: 'Reduce nocturnal paraesthesia and restore pain-free grip for full-time work duties.',
      startDate: '2026-08-13',
      targetEndDate: '2026-10-08',
      totalSessions: 14,
      completedSessions: 3,
      frequencyPerWeek: 2,
      primaryTherapist: 'Kavya Reddy',
      modalities: ['Nerve gliding', 'Night splinting', 'Workstation modification', 'Grip strengthening'],
      trend: 'On Track',
      attendanceRate: 100,
      adherenceRate: 90,
      milestones: [
        { label: 'Night splints tolerated', done: true, date: '2026-08-16' },
        { label: 'Nocturnal symptoms halved', done: false, date: '2026-09-10' },
        { label: 'Full-duty work return', done: false, date: '2026-10-08' },
      ],
    },
    progress: {
      weeks: 2,
      painFrom: 6.2,
      painTo: 5.1,
      mobilityFrom: 60,
      mobilityTo: 68,
      strengthFrom: 48,
      strengthTo: 55,
      adherence: 90,
    },
  },
  {
    id: 'PT-10356',
    name: 'Suresh Pillai',
    age: 71,
    gender: 'Male',
    phone: '+91 90290 11784',
    email: 'suresh.pillai@gmail.com',
    address: '8, Chembur Colony, Mumbai 400071',
    bloodGroup: 'A+',
    status: 'Admitted - IPD',
    registeredOn: '2026-07-25',
    primaryCondition: 'Hip fracture — post hemiarthroplasty mobilisation',
    assignedDoctor: 'Dr. Sanjay Bhatt',
    assignedTherapist: 'Ritika Shah',
    department: 'Physiotherapy',
    ward: 'Ward B',
    room: 'B-2',
    bed: 'B-204',
    admittedOn: '2026-08-14',
    expectedDischarge: '2026-09-02',
    emergency: ['Nandini Pillai', 'Daughter', '+91 90290 11785'],
    insurance: ['Senior Citizen Mediclaim', 'SCM-4471-2290', '2027-05-31'],
    allergies: ['Morphine — nausea'],
    lastVisit: '2026-08-23',
    nextAppointment: '2026-08-24 16:00',
    outstandingAmount: 68900,
    vitals: { systolic: 138, diastolic: 80, heartRate: 86, temperature: 37.0, spo2: 95, respiratoryRate: 18 },
    history: [
      {
        date: '2026-08-14',
        type: 'Surgery',
        title: 'Bipolar hemiarthroplasty — right hip',
        detail: 'Displaced intracapsular neck of femur fracture following a fall. Surgery within 24 hours of admission.',
        clinician: 'Dr. Sanjay Bhatt',
      },
      {
        date: '2026-08-16',
        type: 'Chronic Condition',
        title: 'Osteoporosis',
        detail: 'DEXA T-score -2.9 at femoral neck. Started on Denosumab with calcium and vitamin D.',
        clinician: 'Dr. Arjun Sharma',
      },
    ],
    plan: {
      title: 'Post-Hemiarthroplasty Mobilisation',
      goal: 'Safe independent transfers and supervised walker ambulation of 50 metres before discharge home.',
      startDate: '2026-08-16',
      targetEndDate: '2026-09-27',
      totalSessions: 24,
      completedSessions: 7,
      frequencyPerWeek: 5,
      primaryTherapist: 'Ritika Shah',
      modalities: ['Bed mobility training', 'Walker ambulation', 'Hip precaution education', 'Chest physiotherapy'],
      trend: 'On Track',
      attendanceRate: 96,
      adherenceRate: 83,
      milestones: [
        { label: 'Sit-to-stand with walker', done: true, date: '2026-08-18' },
        { label: 'Walker ambulation 20 metres', done: true, date: '2026-08-22' },
        { label: 'Walker ambulation 50 metres', done: false, date: '2026-09-01' },
        { label: 'Independent home transfers', done: false, date: '2026-09-27' },
      ],
    },
    progress: {
      weeks: 2,
      painFrom: 7.6,
      painTo: 5.4,
      mobilityFrom: 10,
      mobilityTo: 28,
      strengthFrom: 12,
      strengthTo: 26,
      adherence: 83,
    },
  },
  {
    id: 'PT-10367',
    name: 'Ishaan Mehta',
    age: 9,
    gender: 'Male',
    phone: '+91 98204 33019',
    email: 'mehta.family@gmail.com',
    address: '11, Pali Hill, Bandra West, Mumbai 400050',
    bloodGroup: 'O+',
    status: 'In Rehabilitation',
    registeredOn: '2026-05-12',
    primaryCondition: 'Speech and language delay — paediatric therapy',
    assignedDoctor: 'Dr. Priya Nair',
    assignedTherapist: 'Farah Sheikh',
    department: 'Speech Therapy',
    emergency: ['Rhea Mehta', 'Mother', '+91 98204 33020'],
    insurance: ['HDFC ERGO Health', 'HE-22190-6641', '2027-07-31'],
    allergies: ['Peanuts'],
    lastVisit: '2026-08-21',
    nextAppointment: '2026-08-25 16:30',
    outstandingAmount: 5600,
    vitals: { systolic: 100, diastolic: 64, heartRate: 92, temperature: 36.8, spo2: 99, respiratoryRate: 20 },
    history: [
      {
        date: '2026-05-12',
        type: 'Diagnosis',
        title: 'Expressive language delay',
        detail: 'Receptive language age-appropriate. Expressive vocabulary approximately 18 months behind peers.',
        clinician: 'Dr. Priya Nair',
      },
    ],
    plan: {
      title: 'Paediatric Speech & Language Programme',
      goal: 'Build four-to-five word sentence construction and improve classroom participation confidence.',
      startDate: '2026-05-16',
      targetEndDate: '2026-11-20',
      totalSessions: 40,
      completedSessions: 26,
      frequencyPerWeek: 2,
      primaryTherapist: 'Farah Sheikh',
      modalities: ['Play-based therapy', 'Phonological awareness', 'Parent coaching', 'Visual supports'],
      trend: 'Ahead of Plan',
      attendanceRate: 95,
      adherenceRate: 93,
      milestones: [
        { label: 'Consistent three-word phrases', done: true, date: '2026-06-27' },
        { label: 'Four-word sentence construction', done: true, date: '2026-08-08' },
        { label: 'Classroom presentation completed', done: false, date: '2026-10-30' },
      ],
    },
    progress: {
      weeks: 8,
      painFrom: 0.5,
      painTo: 0.2,
      mobilityFrom: 62,
      mobilityTo: 88,
      strengthFrom: 58,
      strengthTo: 86,
      adherence: 93,
    },
  },
  {
    id: 'PT-10372',
    name: 'Kavita Joshi',
    age: 55,
    gender: 'Female',
    phone: '+91 97025 60483',
    email: 'kavita.joshi@gmail.com',
    address: '303, Sea Breeze, Worli, Mumbai 400018',
    bloodGroup: 'B+',
    status: 'Active - OPD',
    registeredOn: '2026-08-16',
    primaryCondition: 'Rheumatoid arthritis — hand function maintenance',
    assignedDoctor: 'Dr. Arjun Sharma',
    assignedTherapist: 'Kavya Reddy',
    department: 'Occupational Therapy',
    emergency: ['Prashant Joshi', 'Spouse', '+91 97025 60484'],
    insurance: ['New India Assurance', 'NIA-5590-11238', '2027-08-31'],
    allergies: ['Methotrexate — monitored'],
    lastVisit: '2026-08-20',
    nextAppointment: '2026-08-27 09:00',
    outstandingAmount: 2100,
    vitals: { systolic: 124, diastolic: 78, heartRate: 76, temperature: 36.9, spo2: 98, respiratoryRate: 16 },
    history: [
      {
        date: '2019-02-20',
        type: 'Chronic Condition',
        title: 'Seropositive rheumatoid arthritis',
        detail: 'Anti-CCP positive. On Methotrexate 15 mg weekly with folic acid supplementation.',
        clinician: 'Dr. Arjun Sharma',
      },
      {
        date: '2026-08-16',
        type: 'Diagnosis',
        title: 'Early MCP joint deformity — both hands',
        detail: 'Mild ulnar drift. Referred for joint protection education and adaptive equipment assessment.',
        clinician: 'Dr. Arjun Sharma',
      },
    ],
    plan: {
      title: 'Joint Protection & Hand Function Programme',
      goal: 'Preserve grip strength, slow deformity progression and maintain independence in daily activities.',
      startDate: '2026-08-18',
      targetEndDate: '2026-11-10',
      totalSessions: 12,
      completedSessions: 2,
      frequencyPerWeek: 1,
      primaryTherapist: 'Kavya Reddy',
      modalities: ['Joint protection education', 'Adaptive equipment', 'Gentle range of motion', 'Splinting'],
      trend: 'On Track',
      attendanceRate: 100,
      adherenceRate: 88,
      milestones: [
        { label: 'Adaptive kitchen tools fitted', done: true, date: '2026-08-20' },
        { label: 'Resting splints tolerated overnight', done: false, date: '2026-09-15' },
        { label: 'Grip strength maintained at review', done: false, date: '2026-11-10' },
      ],
    },
    progress: {
      weeks: 2,
      painFrom: 5.4,
      painTo: 4.6,
      mobilityFrom: 58,
      mobilityTo: 64,
      strengthFrom: 44,
      strengthTo: 49,
      adherence: 88,
    },
  },
  {
    id: 'PT-10388',
    name: 'Deepak Chauhan',
    age: 33,
    gender: 'Male',
    phone: '+91 99878 41250',
    email: 'deepak.chauhan@gmail.com',
    address: '17, Kandivali East, Mumbai 400101',
    bloodGroup: 'A+',
    status: 'Discharged',
    registeredOn: '2026-03-09',
    primaryCondition: 'Rotator cuff repair — rehabilitation completed',
    assignedDoctor: 'Dr. Sanjay Bhatt',
    assignedTherapist: 'Meera Iyer',
    department: 'Physiotherapy',
    emergency: ['Preeti Chauhan', 'Spouse', '+91 99878 41251'],
    allergies: [],
    lastVisit: '2026-07-30',
    outstandingAmount: 0,
    vitals: { systolic: 118, diastolic: 74, heartRate: 66, temperature: 36.6, spo2: 99, respiratoryRate: 14 },
    history: [
      {
        date: '2026-03-05',
        type: 'Surgery',
        title: 'Arthroscopic rotator cuff repair — right shoulder',
        detail: 'Full-thickness supraspinatus tear repaired with double-row technique.',
        clinician: 'Dr. Sanjay Bhatt',
      },
      {
        date: '2026-07-30',
        type: 'Diagnosis',
        title: 'Rehabilitation completed — discharged',
        detail: 'Full active range of motion restored with strength symmetry at 94%. Home programme issued.',
        clinician: 'Meera Iyer',
      },
    ],
    plan: {
      title: 'Rotator Cuff Repair Rehabilitation',
      goal: 'Restore full overhead function and return to unrestricted gym training.',
      startDate: '2026-03-16',
      targetEndDate: '2026-07-30',
      totalSessions: 26,
      completedSessions: 26,
      frequencyPerWeek: 2,
      primaryTherapist: 'Meera Iyer',
      modalities: ['Protected passive motion', 'Scapular stabilisation', 'Progressive loading', 'Return-to-gym coaching'],
      trend: 'Completed',
      attendanceRate: 96,
      adherenceRate: 94,
      milestones: [
        { label: 'Sling discontinued', done: true, date: '2026-04-20' },
        { label: 'Full active elevation', done: true, date: '2026-06-11' },
        { label: 'Strength symmetry above 90%', done: true, date: '2026-07-30' },
      ],
    },
    progress: {
      weeks: 8,
      painFrom: 6.4,
      painTo: 0.6,
      mobilityFrom: 30,
      mobilityTo: 96,
      strengthFrom: 25,
      strengthTo: 92,
      adherence: 94,
    },
  },
]

export const PATIENTS: Patient[] = SEEDS.map((seed, index) => {
  const numericSeed = Number(seed.id.replace(/\D/g, '')) || index + 1
  return {
    id: seed.id,
    name: seed.name,
    age: seed.age,
    gender: seed.gender,
    phone: seed.phone,
    email: seed.email,
    address: seed.address,
    bloodGroup: seed.bloodGroup,
    avatarColor: AVATAR_COLORS[index % AVATAR_COLORS.length],
    initials: initialsOf(seed.name),
    status: seed.status,
    registeredOn: seed.registeredOn,
    primaryCondition: seed.primaryCondition,
    assignedDoctor: seed.assignedDoctor,
    assignedTherapist: seed.assignedTherapist,
    department: seed.department,
    ward: seed.ward,
    room: seed.room,
    bed: seed.bed,
    admittedOn: seed.admittedOn,
    expectedDischarge: seed.expectedDischarge,
    emergencyContact: { name: seed.emergency[0], relation: seed.emergency[1], phone: seed.emergency[2] },
    insurance: seed.insurance
      ? { provider: seed.insurance[0], policyNo: seed.insurance[1], validTill: seed.insurance[2] }
      : undefined,
    allergies: seed.allergies,
    vitals: buildVitals(numericSeed, seed.vitals, seed.ward ? 'Sister Anita Fernandes' : 'Sister Lata Gaikwad'),
    history: seed.history.map((h, i) => ({ ...h, id: `${seed.id}-HX-${i + 1}` })),
    rehabPlan: seed.plan ? { ...seed.plan, id: `${seed.id}-PLAN` } : undefined,
    progress: buildProgress(numericSeed, seed.progress),
    documents: STANDARD_DOCS(seed.id, seed.assignedTherapist),
    lastVisit: seed.lastVisit,
    nextAppointment: seed.nextAppointment,
    outstandingAmount: seed.outstandingAmount,
  }
})

export const PATIENT_BY_ID = Object.fromEntries(PATIENTS.map((p) => [p.id, p])) as Record<string, Patient>

export function getPatient(id: string | undefined) {
  return id ? PATIENT_BY_ID[id] : undefined
}

/** Global search across name, ID and phone — powers the command palette. */
export function searchPatients(query: string, limit = 6): Patient[] {
  const q = query.trim().toLowerCase()
  if (q.length < 1) return []
  const digits = q.replace(/\D/g, '')

  const scored = PATIENTS.map((p) => {
    const name = p.name.toLowerCase()
    const id = p.id.toLowerCase()
    const phone = p.phone.replace(/\D/g, '')

    let score = 0
    if (name.startsWith(q)) score = 100
    else if (name.split(' ').some((part) => part.startsWith(q))) score = 90
    else if (name.includes(q)) score = 70
    if (id.includes(q)) score = Math.max(score, q.length >= 3 ? 95 : 60)
    if (digits.length >= 3 && phone.includes(digits)) score = Math.max(score, 85)
    if (p.primaryCondition.toLowerCase().includes(q)) score = Math.max(score, 40)
    if (p.department.toLowerCase().includes(q)) score = Math.max(score, 35)

    return { patient: p, score }
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.patient.name.localeCompare(b.patient.name))

  return scored.slice(0, limit).map((s) => s.patient)
}

/** Overall rehabilitation completion, 0-100. */
export function rehabCompletion(patient: Patient) {
  if (!patient.rehabPlan) return 0
  return Math.round((patient.rehabPlan.completedSessions / patient.rehabPlan.totalSessions) * 100)
}

export const IPD_PATIENTS = PATIENTS.filter((p) => p.bed)
export const ACTIVE_PATIENTS = PATIENTS.filter((p) => p.status !== 'Discharged')
