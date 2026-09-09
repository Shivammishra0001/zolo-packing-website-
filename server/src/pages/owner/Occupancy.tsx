import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { OccupancyGauge } from '@/components/charts/OccupancyGauge'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { BedBoard } from '@/components/dashboard/BedBoard'
import { OCCUPANCY_TREND } from '@/data/analytics'
import { BED_SUMMARY, BEDS, OCCUPANCY_RATE } from '@/data/operations'
import { groupBy, inr } from '@/lib/utils'

export default function OwnerOccupancy() {
  const dailyPotential = BEDS.reduce((acc, b) => acc + b.dailyRate, 0)
  const dailyRealised = BEDS.filter((b) => b.status === 'Occupied').reduce((acc, b) => acc + b.dailyRate, 0)
  const byWard = groupBy(BEDS, (b) => b.ward)

  return (
    <>
      <PageHeader
        title="Occupancy"
        description="Bed utilisation and the revenue it is currently generating."
        crumbs={[{ label: 'Owner', to: '/owner/dashboard' }, { label: 'Occupancy' }]}
      />

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard title="Live occupancy" description="Across every ward and suite.">
          <OccupancyGauge
            value={OCCUPANCY_RATE}
            size={158}
            breakdown={[
              { label: 'Occupied', count: BED_SUMMARY.occupied, tone: 'info' },
              { label: 'Available', count: BED_SUMMARY.available, tone: 'success' },
              { label: 'Reserved', count: BED_SUMMARY.reserved, tone: 'warning' },
              { label: 'Cleaning', count: BED_SUMMARY.cleaning, tone: 'muted' },
            ]}
          />
        </SectionCard>

        <SectionCard title="Occupancy this week" description="Percentage of beds in use each day." className="xl:col-span-2" delay={0.05}>
          <BarSeriesChart
            data={OCCUPANCY_TREND}
            xKey="day"
            series={[{ key: 'occupancy', name: 'Occupancy %', color: 'chart-1' }]}
            height={232}
            format={(v) => `${v}%`}
            showLegend={false}
          />
        </SectionCard>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Daily bed revenue" value={inr(dailyRealised)} hint="From currently occupied beds" tone="success" />
        <StatTile label="Daily capacity value" value={inr(dailyPotential)} hint="If every bed were occupied" />
        <StatTile
          label="Revenue left on the table"
          value={inr(dailyPotential - dailyRealised)}
          hint="Per day at current occupancy"
          tone="warning"
        />
        <StatTile
          label="Wards"
          value={Object.keys(byWard).length}
          hint={`${BED_SUMMARY.total} beds in total`}
          tone="info"
        />
      </div>

      <SectionCard title="Bed board" description="Every bed, grouped by ward and room.">
        <BedBoard />
      </SectionCard>
    </>
  )
}
