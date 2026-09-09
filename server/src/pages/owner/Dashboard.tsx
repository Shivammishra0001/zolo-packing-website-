import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  HeartPulse,
  IndianRupee,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { KpiCard, KpiGrid } from '@/components/dashboard/KpiCard'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { AlertList } from '@/components/dashboard/AlertList'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { OccupancyGauge } from '@/components/charts/OccupancyGauge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/misc'
import {
  DEPARTMENT_REVENUE,
  OWNER_KPIS,
  PATIENT_VOLUME,
  REVENUE_TREND,
} from '@/data/analytics'
import { BED_SUMMARY, OCCUPANCY_RATE } from '@/data/operations'
import { PACKAGE_UTILISATION, THERAPIST_WORKLOAD } from '@/data/therapy'
import { LOW_STOCK, NEAR_EXPIRY, OUT_OF_STOCK } from '@/data/medicines'
import { useQuery } from '@/hooks/useApi'
import { getDashboard } from '@/services/billingService'
import { ORGANISATION } from '@/data/users'
import { inr, numberFmt } from '@/lib/utils'

export default function OwnerDashboard() {
  // The financial figures on this page are aggregated in PostgreSQL; the
  // operational series around them still come from the analytics module.
  const { data: finance } = useQuery(() => getDashboard(), [])

  const alerts = [
    {
      id: 'a1',
      title: `${LOW_STOCK.length + OUT_OF_STOCK.length} medicines running low`,
      detail: `${OUT_OF_STOCK.length} out of stock, ${LOW_STOCK.length} below reorder threshold.`,
      href: '/pharmacy/alerts',
      severity: 'warning' as const,
    },
    {
      id: 'a2',
      title: `${NEAR_EXPIRY.length} medicines near expiry`,
      detail: 'All expiring within the next 45 days across the main campus pharmacy.',
      href: '/pharmacy/alerts',
      severity: 'info' as const,
    },
    {
      id: 'a3',
      title: `${inr(finance?.outstandingAmount ?? 0)} outstanding payments`,
      detail: 'Three IPD invoices have crossed 15 days past due.',
      href: '/reports',
      severity: 'critical' as const,
    },
    {
      id: 'a4',
      title: 'Therapy capacity is 87% utilised',
      detail: 'Speech therapy and occupational therapy still have open slots this week.',
      href: '/owner/therapy',
      severity: 'success' as const,
    },
  ]

  return (
    <>
      <PageHeader
        title="Business overview"
        description={`How ${ORGANISATION.name} is performing today, across all ${ORGANISATION.branches.length} branches.`}
        crumbs={[{ label: 'Owner', to: '/owner/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/reports">
                <CalendarDays />
                Monthly report
              </Link>
            </Button>
            <Button asChild>
              <Link to="/owner/analytics">
                Full analytics
                <ArrowRight />
              </Link>
            </Button>
          </>
        }
      />

      <KpiGrid className="mb-6">
        <KpiCard
          label="Today's Revenue"
          value={OWNER_KPIS.todayRevenue}
          format={(v) => inr(v)}
          change={OWNER_KPIS.todayRevenueChange}
          changeLabel="vs yesterday"
          icon={<IndianRupee className="size-4" />}
          tone="accent"
          footer="47 pharmacy orders · 9 settled payments"
        />
        <KpiCard
          label="Monthly Revenue"
          value={OWNER_KPIS.monthlyRevenue}
          format={(v) => inr(v, { compact: true })}
          change={OWNER_KPIS.monthlyRevenueChange}
          icon={<TrendingUp className="size-4" />}
          tone="info"
          footer="Month-to-date, 24 of 31 days elapsed"
        />
        <KpiCard
          label="Current Profit"
          value={OWNER_KPIS.profit}
          format={(v) => inr(v, { compact: true })}
          change={OWNER_KPIS.profitChange}
          icon={<Wallet className="size-4" />}
          tone="success"
          footer={`Margin ${((OWNER_KPIS.profit / OWNER_KPIS.monthlyRevenue) * 100).toFixed(1)}%`}
        />
        <KpiCard
          label="Bed Occupancy"
          value={OCCUPANCY_RATE}
          suffix="%"
          change={OWNER_KPIS.occupancyChange}
          changeLabel="vs last week"
          icon={<BedDouble className="size-4" />}
          tone="warning"
          footer={`${BED_SUMMARY.occupied} of ${BED_SUMMARY.total} beds in use`}
        />
        <KpiCard
          label="Total Patients"
          value={OWNER_KPIS.totalPatients}
          format={(v) => numberFmt(v)}
          change={OWNER_KPIS.totalPatientsChange}
          icon={<Users className="size-4" />}
          tone="accent"
          footer="119 new registrations this month"
        />
        <KpiCard
          label="Therapy Utilisation"
          value={OWNER_KPIS.therapyUtilisation}
          suffix="%"
          change={OWNER_KPIS.therapyUtilisationChange}
          icon={<HeartPulse className="size-4" />}
          tone="info"
          footer="229 of 240 session slots booked this week"
        />
      </KpiGrid>

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Revenue trend"
          description="Revenue, expenses and profit over the last twelve months."
          className="xl:col-span-2"
          viewAllHref="/owner/revenue"
          delay={0.05}
        >
          <RevenueTrendChart data={REVENUE_TREND} />
        </SectionCard>

        <SectionCard
          title="Revenue by department"
          description="Month-to-date contribution."
          delay={0.1}
        >
          <DonutChart
            data={DEPARTMENT_REVENUE.map((d) => ({ label: d.department, value: d.revenue }))}
            format={(v) => inr(v, { compact: true })}
            centerValue={inr(OWNER_KPIS.monthlyRevenue, { compact: true })}
            centerLabel="This month"
            height={190}
            className="sm:flex-col sm:items-stretch"
          />
        </SectionCard>
      </div>

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Patient volume"
          description="New versus returning patients across six months."
          className="xl:col-span-2"
          delay={0.05}
        >
          <BarSeriesChart
            data={PATIENT_VOLUME}
            xKey="month"
            stacked
            series={[
              { key: 'returning', name: 'Returning', color: 'chart-2' },
              { key: 'newPatients', name: 'New', color: 'chart-1' },
            ]}
            height={264}
          />
        </SectionCard>

        <SectionCard title="Bed occupancy" description="Live position across all wards." viewAllHref="/owner/occupancy" delay={0.1}>
          <OccupancyGauge
            value={OCCUPANCY_RATE}
            size={150}
            breakdown={[
              { label: 'Occupied', count: BED_SUMMARY.occupied, tone: 'info' },
              { label: 'Available', count: BED_SUMMARY.available, tone: 'success' },
              { label: 'Reserved', count: BED_SUMMARY.reserved, tone: 'warning' },
              { label: 'Cleaning', count: BED_SUMMARY.cleaning, tone: 'muted' },
            ]}
          />
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Therapist workload"
          description="Booked sessions against weekly capacity."
          className="xl:col-span-2"
          viewAllHref="/owner/therapy"
          delay={0.05}
        >
          <ul className="space-y-4">
            {THERAPIST_WORKLOAD.map((row) => (
              <li key={row.therapist}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[13.5px] font-medium">
                    {row.therapist}
                    <span className="ml-2 text-[12px] font-normal text-muted-foreground">{row.discipline}</span>
                  </span>
                  <span className="num text-[12.5px] text-muted-foreground">
                    {row.booked} / {row.capacity} sessions ·{' '}
                    <span className="font-semibold text-foreground">{row.utilisation}%</span>
                  </span>
                </div>
                <Progress
                  value={row.utilisation}
                  tone={row.utilisation >= 85 ? 'warning' : row.utilisation >= 70 ? 'accent' : 'info'}
                />
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-border pt-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Package utilisation
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PACKAGE_UTILISATION.slice(0, 3).map((pkg) => (
                <StatTile
                  key={pkg.package}
                  label={pkg.package}
                  value={`${Math.round((pkg.consumed / pkg.sold) * 100)}%`}
                  hint={`${pkg.consumed} of ${pkg.sold} sold · ${inr(pkg.revenue, { compact: true })}`}
                />
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Needs attention" description="Alerts across pharmacy, finance and capacity." delay={0.1}>
          <AlertList items={alerts} />
        </SectionCard>
      </div>
    </>
  )
}
