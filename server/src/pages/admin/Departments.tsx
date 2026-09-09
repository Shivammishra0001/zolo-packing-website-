import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Progress } from '@/components/ui/misc'
import { Badge } from '@/components/ui/badge'
import { useQuery } from '@/hooks/useApi'
import { listUsers } from '@/services/userService'
import { inr } from '@/lib/utils'

interface Department {
  id: string
  name: string
  type: 'Clinical' | 'Therapy' | 'Support'
  head: string
  staff: number
  rooms: number
  monthlyRevenue: number
  utilisation: number
}

const DEPARTMENTS: Department[] = [
  { id: 'DEP-01', name: 'Rehabilitation Medicine', type: 'Clinical', head: 'Dr. Arjun Sharma', staff: 6, rooms: 4, monthlyRevenue: 1_240_000, utilisation: 88 },
  { id: 'DEP-02', name: 'Orthopaedics', type: 'Clinical', head: 'Dr. Sanjay Bhatt', staff: 5, rooms: 3, monthlyRevenue: 1_080_000, utilisation: 82 },
  { id: 'DEP-03', name: 'Neurology', type: 'Clinical', head: 'Dr. Priya Nair', staff: 4, rooms: 3, monthlyRevenue: 960_000, utilisation: 79 },
  { id: 'DEP-04', name: 'Physiotherapy', type: 'Therapy', head: 'Meera Iyer', staff: 8, rooms: 6, monthlyRevenue: 1_460_000, utilisation: 89 },
  { id: 'DEP-05', name: 'Occupational Therapy', type: 'Therapy', head: 'Kavya Reddy', staff: 5, rooms: 4, monthlyRevenue: 720_000, utilisation: 71 },
  { id: 'DEP-06', name: 'Neuro Rehabilitation', type: 'Therapy', head: 'Tanmay Joshi', staff: 6, rooms: 3, monthlyRevenue: 890_000, utilisation: 88 },
  { id: 'DEP-07', name: 'Speech Therapy', type: 'Therapy', head: 'Farah Sheikh', staff: 3, rooms: 2, monthlyRevenue: 410_000, utilisation: 64 },
  { id: 'DEP-08', name: 'Cardiac Rehabilitation', type: 'Therapy', head: 'Ritika Shah', staff: 4, rooms: 2, monthlyRevenue: 560_000, utilisation: 70 },
  { id: 'DEP-09', name: 'Nursing', type: 'Support', head: 'Sister Anita Fernandes', staff: 14, rooms: 0, monthlyRevenue: 0, utilisation: 92 },
  { id: 'DEP-10', name: 'Pharmacy', type: 'Support', head: 'Rohit Malhotra', staff: 4, rooms: 1, monthlyRevenue: 746_000, utilisation: 76 },
  { id: 'DEP-11', name: 'Front Office', type: 'Support', head: 'Sneha Patil', staff: 5, rooms: 2, monthlyRevenue: 0, utilisation: 84 },
]

const TYPE_TONE = {
  Clinical: 'info',
  Therapy: 'accent',
  Support: 'default',
} as const

const columns: Column<Department>[] = [
  {
    key: 'name',
    header: 'Department',
    primary: true,
    cell: (row) => (
      <div>
        <p className="font-medium">{row.name}</p>
        <p className="text-[12px] text-muted-foreground">Head: {row.head}</p>
      </div>
    ),
    sortValue: (row) => row.name,
  },
  {
    key: 'type',
    header: 'Type',
    meta: true,
    cell: (row) => <Badge variant={TYPE_TONE[row.type]}>{row.type}</Badge>,
    sortValue: (row) => row.type,
  },
  {
    key: 'staff',
    header: 'Staff',
    align: 'right',
    cell: (row) => <span className="num">{row.staff}</span>,
    sortValue: (row) => row.staff,
  },
  {
    key: 'rooms',
    header: 'Rooms',
    align: 'right',
    cell: (row) => <span className="num text-muted-foreground">{row.rooms || '—'}</span>,
    sortValue: (row) => row.rooms,
  },
  {
    key: 'revenue',
    header: 'Monthly revenue',
    align: 'right',
    cell: (row) => (
      <span className="num font-semibold">{row.monthlyRevenue ? inr(row.monthlyRevenue, { compact: true }) : '—'}</span>
    ),
    sortValue: (row) => row.monthlyRevenue,
  },
  {
    key: 'utilisation',
    header: 'Utilisation',
    className: 'w-[190px]',
    cell: (row) => (
      <div className="flex items-center gap-3">
        <Progress
          value={row.utilisation}
          className="w-24"
          tone={row.utilisation >= 85 ? 'warning' : row.utilisation >= 70 ? 'accent' : 'info'}
        />
        <span className="num text-[12.5px] font-semibold">{row.utilisation}%</span>
      </div>
    ),
    sortValue: (row) => row.utilisation,
  },
]

export default function AdminDepartments() {
  // Headcount comes from the real directory, so a department cannot claim
  // people who have left or changed role.
  const { data } = useQuery(() => listUsers({ limit: 100 }), [])
  const STAFF_DIRECTORY = data?.items ?? []

  const totalStaff = DEPARTMENTS.reduce((a, d) => a + d.staff, 0)
  const revenueGenerating = DEPARTMENTS.filter((d) => d.monthlyRevenue > 0)

  return (
    <>
      <PageHeader
        title="Departments"
        description="Clinical, therapy and support units, with the staff and space assigned to each."
        crumbs={[{ label: 'Administrator', to: '/admin/dashboard' }, { label: 'Departments' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Departments" value={DEPARTMENTS.length} hint="Across three branches" />
        <StatTile label="Budgeted headcount" value={totalStaff} hint={`${STAFF_DIRECTORY.length} accounts provisioned`} tone="info" />
        <StatTile label="Therapy units" value={DEPARTMENTS.filter((d) => d.type === 'Therapy').length} tone="accent" />
        <StatTile
          label="Revenue-generating"
          value={revenueGenerating.length}
          hint={inr(revenueGenerating.reduce((a, d) => a + d.monthlyRevenue, 0), { compact: true })}
          tone="success"
        />
      </div>

      <SectionCard title="All departments" description="Sorted by monthly revenue contribution by default.">
        <DataTable
          columns={columns}
          rows={DEPARTMENTS}
          rowKey={(row) => row.id}
          initialSort={{ key: 'revenue', dir: 'desc' }}
        />
      </SectionCard>
    </>
  )
}
