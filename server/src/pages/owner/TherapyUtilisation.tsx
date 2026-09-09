import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Progress } from '@/components/ui/misc'
import { StatusBadge } from '@/components/ui/status'
import { THERAPY_UTILISATION_TREND } from '@/data/analytics'
import { PACKAGE_UTILISATION, THERAPIST_WORKLOAD, THERAPY_SESSIONS } from '@/data/therapy'
import { PATIENTS } from '@/data/patients'
import { inr } from '@/lib/utils'

type WorkloadRow = (typeof THERAPIST_WORKLOAD)[number]

const columns: Column<WorkloadRow>[] = [
  {
    key: 'therapist',
    header: 'Therapist',
    primary: true,
    cell: (row) => (
      <div>
        <p className="font-medium">{row.therapist}</p>
        <p className="text-[12px] text-muted-foreground">{row.discipline}</p>
      </div>
    ),
    sortValue: (row) => row.therapist,
  },
  {
    key: 'booked',
    header: 'Booked',
    align: 'right',
    cell: (row) => <span className="num">{row.booked}</span>,
    sortValue: (row) => row.booked,
  },
  {
    key: 'capacity',
    header: 'Capacity',
    align: 'right',
    cell: (row) => <span className="num text-muted-foreground">{row.capacity}</span>,
    sortValue: (row) => row.capacity,
  },
  {
    key: 'utilisation',
    header: 'Utilisation',
    className: 'w-[220px]',
    cell: (row) => (
      <div className="flex items-center gap-3">
        <Progress
          value={row.utilisation}
          className="w-28"
          tone={row.utilisation >= 85 ? 'warning' : row.utilisation >= 70 ? 'accent' : 'info'}
        />
        <span className="num text-[12.5px] font-semibold">{row.utilisation}%</span>
      </div>
    ),
    sortValue: (row) => row.utilisation,
  },
  {
    key: 'headroom',
    header: 'Free slots',
    align: 'right',
    meta: true,
    cell: (row) => <span className="num text-muted-foreground">{row.capacity - row.booked}</span>,
    sortValue: (row) => row.capacity - row.booked,
  },
]

export default function OwnerTherapyUtilisation() {
  const activePlans = PATIENTS.filter((p) => p.rehabPlan && p.rehabPlan.trend !== 'Completed')
  const atRisk = activePlans.filter((p) => p.rehabPlan!.trend === 'At Risk' || p.rehabPlan!.trend === 'Plateaued')
  const totalBooked = THERAPIST_WORKLOAD.reduce((a, r) => a + r.booked, 0)
  const totalCapacity = THERAPIST_WORKLOAD.reduce((a, r) => a + r.capacity, 0)

  return (
    <>
      <PageHeader
        title="Therapy utilisation"
        description="Whether the rehabilitation capacity the centre pays for is actually being used."
        crumbs={[{ label: 'Owner', to: '/owner/dashboard' }, { label: 'Therapy Utilisation' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Weekly utilisation"
          value={`${Math.round((totalBooked / totalCapacity) * 100)}%`}
          hint={`${totalBooked} of ${totalCapacity} slots booked`}
          tone="accent"
        />
        <StatTile label="Sessions today" value={THERAPY_SESSIONS.length} hint="Across five therapists" tone="info" />
        <StatTile label="Active rehab plans" value={activePlans.length} hint="Excluding completed programmes" />
        <StatTile
          label="Plans needing review"
          value={atRisk.length}
          hint="Plateaued or at risk"
          tone={atRisk.length > 0 ? 'warning' : 'success'}
        />
      </div>

      <SectionCard
        title="Capacity by week"
        description="Sessions delivered against the slots available."
        className="mb-6"
      >
        <BarSeriesChart
          data={THERAPY_UTILISATION_TREND}
          xKey="week"
          series={[
            { key: 'sessions', name: 'Delivered', color: 'chart-1' },
            { key: 'capacity', name: 'Capacity', color: 'chart-3' },
          ]}
          height={270}
        />
      </SectionCard>

      <SectionCard title="Therapist workload" description="Where the headroom is." className="mb-6">
        <DataTable
          columns={columns}
          rows={THERAPIST_WORKLOAD}
          rowKey={(row) => row.therapist}
          initialSort={{ key: 'utilisation', dir: 'desc' }}
        />
      </SectionCard>

      <SectionCard title="Package consumption" description="Sold packages against sessions actually delivered.">
        <ul className="space-y-5">
          {PACKAGE_UTILISATION.map((pkg) => {
            const pct = Math.round((pkg.consumed / pkg.sold) * 100)
            return (
              <li key={pkg.package}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="flex items-center gap-2 text-[13.5px] font-medium">
                    {pkg.package}
                    <StatusBadge status={pct >= 70 ? 'On Track' : pct >= 50 ? 'Plateaued' : 'At Risk'} />
                  </span>
                  <span className="num text-[12.5px] text-muted-foreground">
                    {pkg.consumed} / {pkg.sold} · {inr(pkg.revenue, { compact: true })} booked
                  </span>
                </div>
                <Progress value={pct} tone={pct >= 70 ? 'success' : pct >= 50 ? 'accent' : 'warning'} />
              </li>
            )
          })}
        </ul>
      </SectionCard>
    </>
  )
}
