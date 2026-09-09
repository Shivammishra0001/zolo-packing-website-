/** Business and operational series used across the owner and accountant views. */

export const REVENUE_TREND = [
  { month: 'Sep 25', revenue: 5_820_000, expenses: 4_310_000, profit: 1_510_000 },
  { month: 'Oct 25', revenue: 6_140_000, expenses: 4_480_000, profit: 1_660_000 },
  { month: 'Nov 25', revenue: 5_960_000, expenses: 4_520_000, profit: 1_440_000 },
  { month: 'Dec 25', revenue: 6_780_000, expenses: 4_690_000, profit: 2_090_000 },
  { month: 'Jan 26', revenue: 7_120_000, expenses: 5_010_000, profit: 2_110_000 },
  { month: 'Feb 26', revenue: 6_640_000, expenses: 4_870_000, profit: 1_770_000 },
  { month: 'Mar 26', revenue: 7_460_000, expenses: 5_140_000, profit: 2_320_000 },
  { month: 'Apr 26', revenue: 7_180_000, expenses: 5_260_000, profit: 1_920_000 },
  { month: 'May 26', revenue: 7_690_000, expenses: 5_320_000, profit: 2_370_000 },
  { month: 'Jun 26', revenue: 8_040_000, expenses: 5_480_000, profit: 2_560_000 },
  { month: 'Jul 26', revenue: 8_310_000, expenses: 5_610_000, profit: 2_700_000 },
  { month: 'Aug 26', revenue: 6_240_000, expenses: 4_410_000, profit: 1_830_000 },
]

export const DEPARTMENT_REVENUE = [
  { department: 'Therapy', revenue: 2_840_000, share: 45.5 },
  { department: 'IPD', revenue: 1_690_000, share: 27.1 },
  { department: 'OPD', revenue: 964_000, share: 15.4 },
  { department: 'Pharmacy', revenue: 746_000, share: 12.0 },
]

export const PATIENT_VOLUME = [
  { month: 'Mar 26', newPatients: 128, returning: 412 },
  { month: 'Apr 26', newPatients: 141, returning: 438 },
  { month: 'May 26', newPatients: 136, returning: 465 },
  { month: 'Jun 26', newPatients: 158, returning: 491 },
  { month: 'Jul 26', newPatients: 172, returning: 528 },
  { month: 'Aug 26', newPatients: 119, returning: 386 },
]

export const OCCUPANCY_TREND = [
  { day: 'Mon', occupancy: 68, capacity: 100 },
  { day: 'Tue', occupancy: 72, capacity: 100 },
  { day: 'Wed', occupancy: 79, capacity: 100 },
  { day: 'Thu', occupancy: 75, capacity: 100 },
  { day: 'Fri', occupancy: 81, capacity: 100 },
  { day: 'Sat', occupancy: 64, capacity: 100 },
  { day: 'Sun', occupancy: 55, capacity: 100 },
]

export const THERAPY_UTILISATION_TREND = [
  { week: 'Wk 1', sessions: 186, capacity: 240 },
  { week: 'Wk 2', sessions: 203, capacity: 240 },
  { week: 'Wk 3', sessions: 221, capacity: 240 },
  { week: 'Wk 4', sessions: 198, capacity: 240 },
  { week: 'Wk 5', sessions: 214, capacity: 240 },
  { week: 'Wk 6', sessions: 229, capacity: 240 },
]

export const OWNER_KPIS = {
  todayRevenue: 284_620,
  todayRevenueChange: 12.4,
  monthlyRevenue: 6_240_000,
  monthlyRevenueChange: 8.1,
  profit: 1_830_000,
  profitChange: 6.3,
  occupancy: 40,
  occupancyChange: -3.2,
  totalPatients: 1_284,
  totalPatientsChange: 4.7,
  therapyUtilisation: 87,
  therapyUtilisationChange: 5.5,
}

export const DOCTOR_PENDING = [
  { id: 'DP-1', label: '4 lab results awaiting review', detail: 'Raj Kumar, Amit Singh, Mohammed Farhan, Simran Kaur', href: '/doctor/labs', tone: 'info' as const },
  { id: 'DP-2', label: '3 patients due for follow-up', detail: 'Anjali Deshpande is 6 days overdue', href: '/doctor/appointments', tone: 'warning' as const },
  { id: 'DP-3', label: '2 prescriptions awaiting confirmation', detail: 'Pharmacy flagged a stock substitution', href: '/doctor/prescriptions', tone: 'warning' as const },
  { id: 'DP-4', label: '1 rehabilitation plan needs review', detail: 'Simran Kaur has plateaued for 3 weeks', href: '/rehab/plans', tone: 'danger' as const },
]

export const MONTHLY_PNL = [
  { month: 'Mar 26', revenue: 7_460_000, expenses: 5_140_000 },
  { month: 'Apr 26', revenue: 7_180_000, expenses: 5_260_000 },
  { month: 'May 26', revenue: 7_690_000, expenses: 5_320_000 },
  { month: 'Jun 26', revenue: 8_040_000, expenses: 5_480_000 },
  { month: 'Jul 26', revenue: 8_310_000, expenses: 5_610_000 },
  { month: 'Aug 26', revenue: 6_240_000, expenses: 4_410_000 },
]

export const EXPENSE_BREAKDOWN = [
  { category: 'Salaries', amount: 2_840_000 },
  { category: 'Pharmacy Purchase', amount: 393_400 },
  { category: 'Equipment', amount: 342_000 },
  { category: 'Utilities', amount: 105_600 },
  { category: 'Maintenance', amount: 75_800 },
  { category: 'Marketing', amount: 62_500 },
]
