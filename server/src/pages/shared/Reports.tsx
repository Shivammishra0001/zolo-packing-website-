import * as React from 'react'
import { Download, FileBarChart } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import {
  DEPARTMENT_REVENUE,
  MONTHLY_PNL,
  OCCUPANCY_TREND,
  PATIENT_VOLUME,
  REVENUE_TREND,
  THERAPY_UTILISATION_TREND,
} from '@/data/analytics'
import { useQuery } from '@/hooks/useApi'
import { getDashboard } from '@/services/billingService'
import { THERAPIST_WORKLOAD } from '@/data/therapy'
import { PATIENTS } from '@/data/patients'
import { BED_SUMMARY, OCCUPANCY_RATE } from '@/data/operations'
import { useAuth } from '@/context/AuthContext'
import { ROLE_LABEL } from '@/lib/permissions'
import { inr, numberFmt } from '@/lib/utils'

const REPORT_LIBRARY = [
  { id: 'R1', name: 'Monthly revenue statement', detail: 'Revenue, expenses and profit by department', permission: 'finance.reports' },
  { id: 'R2', name: 'Rehabilitation outcomes', detail: 'Progress, adherence and discharge outcomes by plan', permission: 'therapy.progress.view' },
  { id: 'R3', name: 'Occupancy and length of stay', detail: 'Bed utilisation by ward and room type', permission: 'beds.view' },
  { id: 'R4', name: 'Pharmacy stock movement', detail: 'Dispensing, wastage and reorder history', permission: 'pharmacy.inventory' },
  { id: 'R5', name: 'Patient volume and mix', detail: 'New versus returning patients by department', permission: 'analytics.operational' },
  { id: 'R6', name: 'Outstanding receivables ageing', detail: 'Debt by age bucket and payer', permission: 'billing.view' },
] as const

export default function Reports() {
  // The financial figures on this page are aggregated in PostgreSQL; the
  // operational series around them still come from the analytics module.
  const { data: finance } = useQuery(() => getDashboard(), [])

  const toast = useToast()
  const { user, has } = useAuth()
  const [period, setPeriod] = React.useState('6m')

  const available = REPORT_LIBRARY.filter((r) => has(r.permission))
  const trendData = period === '6m' ? REVENUE_TREND.slice(-6) : REVENUE_TREND

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Analytics available to you as ${user ? ROLE_LABEL[user.role] : 'a staff member'}.`}
        crumbs={[{ label: 'Reports' }]}
        actions={
          <>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6m">Last 6 months</SelectItem>
                <SelectItem value="12m">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => toast.success('Export queued', 'The report pack will be emailed to you shortly.')}
            >
              <Download />
              Export pack
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Patients on file" value={numberFmt(PATIENTS.length * 92)} hint="Across three branches" />
        <StatTile label="Occupancy" value={`${OCCUPANCY_RATE}%`} hint={`${BED_SUMMARY.occupied} of ${BED_SUMMARY.total} beds`} tone="info" />
        {has('finance.reports') || has('billing.view') ? (
          <>
            <StatTile label="Collected today" value={inr(finance?.todayRevenue ?? 0)} tone="success" />
            <StatTile
              label="Outstanding"
              value={inr(finance?.outstandingAmount ?? 0, { compact: true })}
              tone="danger"
            />
          </>
        ) : (
          <>
            <StatTile
              label="Active rehab plans"
              value={PATIENTS.filter((p) => p.rehabPlan && p.rehabPlan.trend !== 'Completed').length}
              tone="accent"
            />
            <StatTile
              label="Therapy utilisation"
              value={`${Math.round(
                (THERAPIST_WORKLOAD.reduce((a, r) => a + r.booked, 0) /
                  THERAPIST_WORKLOAD.reduce((a, r) => a + r.capacity, 0)) *
                  100,
              )}%`}
              tone="accent"
            />
          </>
        )}
      </div>

      {(has('analytics.business') || has('finance.reports')) && (
        <SectionCard
          title="Revenue performance"
          description="Revenue against expenses and the resulting profit."
          className="mb-5"
        >
          <RevenueTrendChart data={trendData} height={310} />
        </SectionCard>
      )}

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        {has('analytics.operational') && (
          <SectionCard title="Patient volume" description="New versus returning patients." delay={0.05}>
            <BarSeriesChart
              data={PATIENT_VOLUME}
              xKey="month"
              stacked
              series={[
                { key: 'returning', name: 'Returning', color: 'chart-2' },
                { key: 'newPatients', name: 'New', color: 'chart-1' },
              ]}
              height={260}
            />
          </SectionCard>
        )}

        {has('beds.view') && (
          <SectionCard title="Occupancy this week" description="Percentage of beds in use each day." delay={0.1}>
            <BarSeriesChart
              data={OCCUPANCY_TREND}
              xKey="day"
              series={[{ key: 'occupancy', name: 'Occupancy %', color: 'chart-3' }]}
              height={260}
              format={(v) => `${v}%`}
              showLegend={false}
            />
          </SectionCard>
        )}

        {has('therapy.progress.view') && (
          <SectionCard title="Therapy capacity" description="Sessions delivered against slots available." delay={0.15}>
            <BarSeriesChart
              data={THERAPY_UTILISATION_TREND}
              xKey="week"
              series={[
                { key: 'sessions', name: 'Delivered', color: 'chart-1' },
                { key: 'capacity', name: 'Capacity', color: 'chart-3' },
              ]}
              height={260}
            />
          </SectionCard>
        )}

        {has('billing.view') && (
          <SectionCard title="Payment mix" description="Settled payments by method." delay={0.2}>
            <DonutChart
              data={(finance?.paymentBreakdown ?? []).map((p) => ({ label: p.method, value: p.amount }))}
              format={(v) => inr(v)}
              centerValue={inr(finance?.todayRevenue ?? 0, { compact: true })}
              centerLabel="Collected"
            />
          </SectionCard>
        )}

        {has('analytics.business') && (
          <SectionCard title="Department revenue" description="Contribution to the month." delay={0.25}>
            <DonutChart
              data={DEPARTMENT_REVENUE.map((d) => ({ label: d.department, value: d.revenue }))}
              format={(v) => inr(v, { compact: true })}
              centerValue={inr(MONTHLY_PNL[MONTHLY_PNL.length - 1].revenue, { compact: true })}
              centerLabel="This month"
            />
          </SectionCard>
        )}

        {has('pharmacy.inventory') && (
          <SectionCard title="Therapist workload" description="Booked sessions against capacity." delay={0.3}>
            <BarSeriesChart
              data={THERAPIST_WORKLOAD}
              xKey="therapist"
              layout="vertical"
              series={[{ key: 'booked', name: 'Booked', color: 'chart-1' }]}
              height={240}
              showLegend={false}
            />
          </SectionCard>
        )}
      </div>

      <SectionCard
        title="Report library"
        description="Downloadable reports your role has access to."
        icon={<FileBarChart />}
      >
        {available.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            Your role does not currently have access to any downloadable reports.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {available.map((report) => (
              <li key={report.id}>
                <div className="flex h-full flex-col rounded-xl border border-border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/35 hover:shadow-elevated">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <FileBarChart className="size-4" />
                    </span>
                    <Badge variant="outline">PDF · XLSX</Badge>
                  </div>
                  <p className="mt-3 text-[13.5px] font-semibold">{report.name}</p>
                  <p className="mt-1 flex-1 text-[12px] leading-relaxed text-muted-foreground">{report.detail}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => toast.success('Report queued', `${report.name} will be emailed to you.`)}
                  >
                    <Download />
                    Generate
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  )
}
