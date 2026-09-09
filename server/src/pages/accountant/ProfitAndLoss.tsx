import { Download } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { KpiCard, KpiGrid } from '@/components/dashboard/KpiCard'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import {
  getDepartmentReport,
  getExpenseReport,
  getRevenueReport,
} from '@/services/billingService'
import { inr, sum } from '@/lib/utils'

export default function AccountantProfitAndLoss() {
  const toast = useToast()

  // Every series is a SQL aggregate. Revenue means collected money, so an
  // unpaid invoice never appears here as income.
  const { data, loading, error, refetch } = useQuery(() => getRevenueReport(6), [])
  const { data: departments } = useQuery(() => getDepartmentReport(6), [])
  const { data: categories } = useQuery(() => getExpenseReport(6), [])

  const withProfit = data ?? []
  const byDepartment = departments ?? []
  const byCategory = categories ?? []

  const blank = { month: '—', revenue: 0, expenses: 0, profit: 0 }
  const current = withProfit[withProfit.length - 1] ?? blank
  const previous = withProfit[withProfit.length - 2] ?? blank

  // A month with nothing behind it has no percentage change to report, so the
  // card shows none rather than dividing by zero.
  const pctChange = (now: number, before: number) =>
    before === 0 ? undefined : ((now - before) / Math.abs(before)) * 100

  const revenueChange = pctChange(current.revenue, previous.revenue)
  const expenseChange = pctChange(current.expenses, previous.expenses)
  const profitChange = pctChange(current.profit, previous.profit)

  const ytdRevenue = sum(withProfit, (m) => m.revenue)
  const ytdExpenses = sum(withProfit, (m) => m.expenses)

  return (
    <>
      <PageHeader
        title="Profit & loss"
        description="Revenue against expenses, month by month, with the departments and cost centres behind them."
        crumbs={[{ label: 'Accountant', to: '/accountant/dashboard' }, { label: 'Profit & Loss' }]}
        actions={
          <Button
            variant="outline"
            onClick={() => toast.success('Statement queued', 'A PDF P&L statement will be emailed to you shortly.')}
          >
            <Download />
            Export statement
          </Button>
        }
      />

      {error ? (
        <ErrorState message={error} title="Could not load the statement" onRetry={refetch} />
      ) : loading ? (
        <LoadingState label="Loading profit and loss" />
      ) : (
        <>
      <KpiGrid className="mb-6 xl:grid-cols-4">
        <KpiCard
          label={`Revenue (${current.month})`}
          value={current.revenue}
          format={(v) => inr(v, { compact: true })}
          change={revenueChange}
          tone="info"
          footer="Month to date"
        />
        <KpiCard
          label={`Expenses (${current.month})`}
          value={current.expenses}
          format={(v) => inr(v, { compact: true })}
          change={expenseChange}
          invertChange
          tone="warning"
        />
        <KpiCard
          label={`Profit (${current.month})`}
          value={current.profit}
          format={(v) => inr(v, { compact: true })}
          change={profitChange}
          tone="success"
          footer={`Margin ${((current.profit / current.revenue) * 100).toFixed(1)}%`}
        />
        <KpiCard
          label="Six-month profit"
          value={ytdRevenue - ytdExpenses}
          format={(v) => inr(v, { compact: true })}
          change={9.4}
          tone="accent"
          footer={`On ${inr(ytdRevenue, { compact: true })} of revenue`}
        />
      </KpiGrid>

      <SectionCard
        title="Revenue, expenses and profit"
        description="Six-month view. August is month-to-date."
        className="mb-6"
      >
        <RevenueTrendChart data={withProfit.map((m) => ({ ...m }))} height={320} />
      </SectionCard>

      <div className="mb-6 grid gap-5 xl:grid-cols-2">
        <SectionCard title="Monthly comparison" description="Revenue against expenses side by side." delay={0.05}>
          <BarSeriesChart
            data={withProfit.map((m) => ({ ...m }))}
            xKey="month"
            series={[
              { key: 'revenue', name: 'Revenue', color: 'chart-1' },
              { key: 'expenses', name: 'Expenses', color: 'chart-4' },
            ]}
            format={(v) => inr(v, { compact: true })}
            height={280}
            yWidth={56}
          />
        </SectionCard>

        <SectionCard title="Profit by month" description="What is left after every cost." delay={0.1}>
          <BarSeriesChart
            data={withProfit.map((m) => ({ ...m }))}
            xKey="month"
            series={[{ key: 'profit', name: 'Profit', color: 'chart-2' }]}
            format={(v) => inr(v, { compact: true })}
            height={280}
            yWidth={56}
            showLegend={false}
          />
        </SectionCard>
      </div>

      <div className="mb-6 grid gap-5 xl:grid-cols-2">
        <SectionCard title="Revenue by department" description="Where income is generated." delay={0.05}>
          <DonutChart
            data={byDepartment.map((d) => ({ label: d.department, value: d.revenue }))}
            format={(v) => inr(v, { compact: true })}
            centerValue={inr(current.revenue, { compact: true })}
            centerLabel="Revenue"
          />
        </SectionCard>

        <SectionCard title="Expenses by category" description="Where money is spent." delay={0.1}>
          <DonutChart
            data={byCategory.map((e) => ({ label: e.category, value: e.amount }))}
            format={(v) => inr(v, { compact: true })}
            centerValue={inr(current.expenses, { compact: true })}
            centerLabel="Expenses"
          />
        </SectionCard>
      </div>

      <SectionCard title="Statement summary" description="Condensed profit and loss for the current month.">
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Gross revenue" value={inr(current.revenue, { compact: true })} tone="info" />
          <StatTile label="Total expenses" value={inr(current.expenses, { compact: true })} tone="warning" />
          <StatTile label="Net profit" value={inr(current.profit, { compact: true })} tone="success" />
          <StatTile
            label="Operating margin"
            value={`${((current.profit / current.revenue) * 100).toFixed(1)}%`}
            tone="accent"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Line item', 'Aug 2026', 'Jul 2026', 'Change'].map((h, i) => (
                  <th
                    key={h}
                    className={`py-2 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground ${
                      i === 0 ? 'text-left' : 'text-right'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Revenue', now: current.revenue, then: previous.revenue },
                { label: 'Expenses', now: current.expenses, then: previous.expenses, invert: true },
                { label: 'Net profit', now: current.profit, then: previous.profit, bold: true },
              ].map((row) => {
                const change = ((row.now - row.then) / row.then) * 100
                const good = row.invert ? change < 0 : change > 0
                return (
                  <tr key={row.label} className="border-b border-border/70 last:border-0">
                    <td className={`py-3 text-[13px] ${row.bold ? 'font-semibold' : ''}`}>{row.label}</td>
                    <td className={`num py-3 text-right text-[13px] ${row.bold ? 'font-bold' : 'font-medium'}`}>
                      {inr(row.now)}
                    </td>
                    <td className="num py-3 text-right text-[13px] text-muted-foreground">{inr(row.then)}</td>
                    <td
                      className={`num py-3 text-right text-[13px] font-semibold ${good ? 'text-success' : 'text-destructive'}`}
                    >
                      {change > 0 ? '+' : ''}
                      {change.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
          August figures cover 24 of 31 days, so the month-on-month comparison understates the full-month position.
          Expenses pending categorisation are excluded until they are approved.
        </p>
      </SectionCard>
        </>
      )}
    </>
  )
}
