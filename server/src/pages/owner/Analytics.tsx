import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { KpiCard, KpiGrid } from '@/components/dashboard/KpiCard'
import { Progress } from '@/components/ui/misc'
import {
  DEPARTMENT_REVENUE,
  EXPENSE_BREAKDOWN,
  OCCUPANCY_TREND,
  OWNER_KPIS,
  PATIENT_VOLUME,
  REVENUE_TREND,
  THERAPY_UTILISATION_TREND,
} from '@/data/analytics'
import { PACKAGE_UTILISATION } from '@/data/therapy'
import { inr, numberFmt } from '@/lib/utils'

export default function OwnerAnalytics() {
  const avgOccupancy = Math.round(
    OCCUPANCY_TREND.reduce((acc, d) => acc + d.occupancy, 0) / OCCUPANCY_TREND.length,
  )
  const totalPackageRevenue = PACKAGE_UTILISATION.reduce((acc, p) => acc + p.revenue, 0)

  return (
    <>
      <PageHeader
        title="Business analytics"
        description="Revenue quality, demand and capacity, viewed together so trade-offs are visible."
        crumbs={[{ label: 'Owner', to: '/owner/dashboard' }, { label: 'Business Analytics' }]}
      />

      <KpiGrid className="mb-6 xl:grid-cols-4">
        <KpiCard
          label="Revenue per patient"
          value={Math.round(OWNER_KPIS.monthlyRevenue / 505)}
          format={(v) => inr(v)}
          change={3.8}
          tone="accent"
          footer="Across 505 patient interactions this month"
        />
        <KpiCard
          label="Average occupancy"
          value={avgOccupancy}
          suffix="%"
          change={-2.1}
          changeLabel="vs last week"
          tone="warning"
          footer="Peaks on Friday at 81%"
        />
        <KpiCard
          label="Therapy package revenue"
          value={totalPackageRevenue}
          format={(v) => inr(v, { compact: true })}
          change={11.2}
          tone="success"
          footer="Five active package types"
        />
        <KpiCard
          label="New patient share"
          value={Math.round((119 / 505) * 100)}
          suffix="%"
          change={1.4}
          tone="info"
          footer="119 new of 505 total this month"
        />
      </KpiGrid>

      <SectionCard
        title="Revenue, expenses and profit"
        description="Twelve-month view. August is month-to-date, which is why it sits lower than July."
        className="mb-6"
      >
        <RevenueTrendChart data={REVENUE_TREND} height={320} />
      </SectionCard>

      <div className="mb-6 grid gap-5 xl:grid-cols-2">
        <SectionCard title="Department mix" description="Where the month's revenue comes from." delay={0.05}>
          <DonutChart
            data={DEPARTMENT_REVENUE.map((d) => ({ label: d.department, value: d.revenue }))}
            format={(v) => inr(v, { compact: true })}
            centerValue={inr(OWNER_KPIS.monthlyRevenue, { compact: true })}
            centerLabel="Month to date"
          />
        </SectionCard>

        <SectionCard title="Expense breakdown" description="Recorded spend this month by category." delay={0.1}>
          <BarSeriesChart
            data={EXPENSE_BREAKDOWN}
            xKey="category"
            layout="vertical"
            series={[{ key: 'amount', name: 'Amount', color: 'chart-4' }]}
            format={(v) => inr(v, { compact: true })}
            height={260}
            showLegend={false}
          />
        </SectionCard>
      </div>

      <div className="mb-6 grid gap-5 xl:grid-cols-2">
        <SectionCard title="Patient volume" description="New versus returning, six-month view." delay={0.05}>
          <BarSeriesChart
            data={PATIENT_VOLUME}
            xKey="month"
            stacked
            series={[
              { key: 'returning', name: 'Returning', color: 'chart-2' },
              { key: 'newPatients', name: 'New', color: 'chart-1' },
            ]}
            height={260}
            format={(v) => numberFmt(v)}
          />
        </SectionCard>

        <SectionCard
          title="Therapy capacity"
          description="Sessions delivered against available slots, by week."
          delay={0.1}
        >
          <BarSeriesChart
            data={THERAPY_UTILISATION_TREND}
            xKey="week"
            series={[
              { key: 'sessions', name: 'Sessions delivered', color: 'chart-1' },
              { key: 'capacity', name: 'Capacity', color: 'chart-3' },
            ]}
            height={260}
          />
        </SectionCard>
      </div>

      <SectionCard title="Package performance" description="How much of each sold package has actually been consumed.">
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Packages sold" value={numberFmt(PACKAGE_UTILISATION.reduce((a, p) => a + p.sold, 0))} />
          <StatTile
            label="Sessions consumed"
            value={numberFmt(PACKAGE_UTILISATION.reduce((a, p) => a + p.consumed, 0))}
          />
          <StatTile label="Package revenue" value={inr(totalPackageRevenue, { compact: true })} tone="success" />
          <StatTile
            label="Unconsumed liability"
            value={inr(
              PACKAGE_UTILISATION.reduce((a, p) => a + (p.revenue / p.sold) * (p.sold - p.consumed), 0),
              { compact: true },
            )}
            tone="warning"
            hint="Revenue collected for sessions not yet delivered"
          />
        </div>

        <ul className="space-y-4">
          {PACKAGE_UTILISATION.map((pkg) => {
            const pct = Math.round((pkg.consumed / pkg.sold) * 100)
            return (
              <li key={pkg.package}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[13.5px] font-medium">{pkg.package}</span>
                  <span className="num text-[12.5px] text-muted-foreground">
                    {pkg.consumed} / {pkg.sold} consumed · {inr(pkg.revenue, { compact: true })}
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
