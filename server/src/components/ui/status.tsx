import type { BadgeProps } from '@/components/ui/badge'
import { Badge } from '@/components/ui/badge'

type Tone = NonNullable<BadgeProps['variant']>

const TONES: Record<string, Tone> = {
  // Patient status
  'Active - OPD': 'info',
  'Admitted - IPD': 'accent',
  'In Rehabilitation': 'accent',
  'Discharge Pending': 'warning',
  Discharged: 'default',
  'Follow-up': 'info',

  // Appointment status
  Scheduled: 'default',
  Waiting: 'warning',
  'In Consultation': 'info',
  Completed: 'success',
  Cancelled: 'danger',
  'No Show': 'danger',

  // Rehab trend
  'On Track': 'success',
  'Ahead of Plan': 'success',
  Plateaued: 'warning',
  'At Risk': 'danger',

  // Session status
  'In Progress': 'info',
  Missed: 'danger',

  // Stock
  'In Stock': 'success',
  'Low Stock': 'warning',
  'Near Expiry': 'info',
  'Out of Stock': 'danger',

  // Prescription
  Pending: 'warning',
  'Partially Dispensed': 'info',
  Dispensed: 'success',

  // Invoice / payment
  Paid: 'success',
  'Partially Paid': 'warning',
  Unpaid: 'warning',
  Overdue: 'danger',
  Settled: 'success',
  Processing: 'info',
  Failed: 'danger',

  // Beds
  Available: 'success',
  Occupied: 'info',
  Reserved: 'warning',
  Cleaning: 'default',

  // Staff / system
  active: 'success',
  pending: 'warning',
  suspended: 'danger',
  Operational: 'success',
  Degraded: 'warning',
  Down: 'danger',

  // Expense
  Recorded: 'default',
  Approved: 'success',
  'Pending Categorisation': 'warning',

  // Task priority
  Routine: 'default',
  High: 'warning',
  Critical: 'danger',
  Urgent: 'danger',
}

const PULSING = new Set(['In Consultation', 'In Progress', 'Waiting', 'Critical', 'Overdue'])

export function StatusBadge({
  status,
  className,
  showDot = true,
}: {
  status: string
  className?: string
  showDot?: boolean
}) {
  const tone = TONES[status] ?? 'default'
  const label = status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <Badge variant={tone} className={className} dot={showDot} pulse={PULSING.has(status)}>
      {label}
    </Badge>
  )
}
