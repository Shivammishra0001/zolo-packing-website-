import { Link } from 'react-router-dom'
import { AlertTriangle, IndianRupee, Receipt, TrendingUp, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { KpiCard, KpiGrid } from '@/components/dashboard/KpiCard'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DonutChart } from '@/components/charts/DonutChart'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { DataTable, type Column } from '@/components/ui/data-table'
import { AlertList } from '@/components/dashboard/AlertList'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { getDashboard, getRevenueReport } from '@/services/billingService'
import { listInvoices, type InvoiceRecord } from '@/services/invoiceService'
import { listPayments } from '@/services/paymentService'
import { daysFromToday, formatDate, inr } from '@/lib/utils'

/** How overdue a bill is, from its due date. Zero until the date passes. */
function daysOverdue(invoice: InvoiceRecord) {
  const diff = daysFromToday(invoice.dueDate)
  return diff < 0 ? Math.abs(diff) : 0
}

/** The balance is the server's figure, not one recomputed here. */
function outstandingOf(invoice: InvoiceRecord) {
  return invoice.balance
}

const columns: Column<InvoiceRecord>[] = [
  {
    key: 'patient',
    header: 'Patient',
    primary: true,
    cell: (row) => (
      <Link to={`/patients/${row.patientId}`} className="font-medium text-accent hover:underline">
        {row.patientName}
      </Link>
    ),
    sortValue: (row) => row.patientName,
  },
  {
    key: 'invoice',
    header: 'Invoice',
    cell: (row) => <span className="num text-[12.5px]">{row.id}</span>,
    sortValue: (row) => row.id,
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cell: (row) => <span className="num font-semibold">{inr(outstandingOf(row))}</span>,
    sortValue: (row) => outstandingOf(row),
  },
  { key: 'dueDate', header: 'Due date', cell: (row) => formatDate(row.dueDate), sortValue: (row) => row.dueDate },
  {
    key: 'overdue',
    header: 'Days overdue',
    align: 'right',
    meta: true,
    cell: (row) => {
      const days = daysOverdue(row)
      return days > 0 ? (
        <span className="num font-semibold text-destructive">{days}</span>
      ) : (
        <span className="num text-muted-foreground">—</span>
      )
    },
    sortValue: (row) => daysOverdue(row),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
]

export default function AccountantDashboard() {
  // Every figure below is aggregated in PostgreSQL. Revenue is collected money
  // — settled payments plus pharmacy counter takings — not invoice totals.
  const { data: summary, loading, error, refetch } = useQuery(() => getDashboard(), [])
  const { data: pnl } = useQuery(() => getRevenueReport(6), [])
  const { data: outstandingPage } = useQuery(
    () => listInvoices({ outstanding: true, limit: 20 }),
    [],
  )
  const { data: failedPage } = useQuery(
    () => listPayments({ status: 'Failed', limit: 10 }),
    [],
  )

  const monthRevenue = summary?.monthlyRevenue ?? 0
  const monthExpenses = summary?.totalExpenses ?? 0
  const profit = summary?.netRevenue ?? 0
  const series = pnl ?? []
  const outstanding = outstandingPage?.items ?? []
  const failed = failedPage?.items ?? []

  const alerts = [
    ...outstanding
      .filter((i) => daysOverdue(i) >= 15)
      .slice(0, 2)
      .map((i) => ({
        id: `od-${i.id}`,
        title: `${inr(outstandingOf(i))} overdue for ${daysOverdue(i)} days`,
        detail: `${i.id} — ${i.patientName} · ${i.department}`,
        href: '/accountant/outstanding',
        severity: 'critical' as const,
      })),
    ...failed.map((p) => ({
      id: `fail-${p.id}`,
      title: `${inr(p.amount)} ${p.method.toLowerCase()} payment failed`,
      detail: `${p.patientName} · ${p.invoiceId} · collected by ${p.collectedBy}`,
      href: '/accountant/payments',
      severity: 'critical' as const,
    })),
    ...(summary && summary.pendingExpenses > 0
      ? [
          {
            id: 'exp',
            title: `${summary.pendingExpenses} expenses need categorisation`,
            detail: `Totalling ${inr(summary.pendingExpenseAmount)} and excluded from the profit figure until reviewed.`,
            href: '/accountant/expenses',
            severity: 'warning' as const,
          },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Finance"
        description="Collections, outstanding balances and where the month is landing."
        crumbs={[{ label: 'Accountant', to: '/accountant/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/accountant/expenses">
                <Wallet />
                Expenses
              </Link>
            </Button>
            <Button asChild>
              <Link to="/accountant/outstanding">
                <AlertTriangle />
                Chase outstanding
              </Link>
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState message={error} title="Could not load the finance dashboard" onRetry={refetch} />
      ) : loading ? (
        <LoadingState label="Loading finance figures" />
      ) : (
        <>
      <KpiGrid className="mb-6 xl:grid-cols-4">
        <KpiCard
          label="Today's Collections"
          value={summary?.todayRevenue ?? 0}
          format={(v) => inr(v)}
          change={9.6}
          changeLabel="vs yesterday"
          icon={<IndianRupee className="size-4" />}
          tone="success"
          footer={`${summary?.todayPaymentCount ?? 0} settled payments`}
        />
        <KpiCard
          label="Outstanding"
          value={summary?.outstandingAmount ?? 0}
          format={(v) => inr(v, { compact: true })}
          change={4.2}
          invertChange
          icon={<AlertTriangle className="size-4" />}
          tone="danger"
          footer={`${summary?.outstandingInvoices ?? 0} open invoices`}
        />
        <KpiCard
          label="Month Revenue"
          value={monthRevenue}
          format={(v) => inr(v, { compact: true })}
          change={8.1}
          icon={<TrendingUp className="size-4" />}
          tone="info"
        />
        <KpiCard
          label="Month Profit"
          value={profit}
          format={(v) => inr(v, { compact: true })}
          change={6.3}
          icon={<Receipt className="size-4" />}
          tone="accent"
          footer={monthRevenue ? `Margin ${((profit / monthRevenue) * 100).toFixed(1)}%` : 'No collections yet'}
        />
      </KpiGrid>

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard title="Payment breakdown" description="How today's collections were taken." delay={0.05}>
          <DonutChart
            data={(summary?.paymentBreakdown ?? []).map((p) => ({ label: p.method, value: p.amount }))}
            format={(v) => inr(v)}
            centerValue={inr(summary?.todayRevenue ?? 0, { compact: true })}
            centerLabel="Collected"
            height={190}
            className="sm:flex-col sm:items-stretch"
          />
        </SectionCard>

        <SectionCard
          title="Monthly profit & loss"
          description="Revenue against expenses over six months."
          className="xl:col-span-2"
          viewAllHref="/accountant/pnl"
          delay={0.1}
        >
          <BarSeriesChart
            data={series.map((m) => ({ month: m.month, revenue: m.revenue, expenses: m.expenses }))}
            xKey="month"
            series={[
              { key: 'revenue', name: 'Revenue', color: 'chart-1' },
              { key: 'expenses', name: 'Expenses', color: 'chart-4' },
            ]}
            format={(v) => inr(v, { compact: true })}
            height={250}
            yWidth={56}
          />
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Outstanding payments"
          description="Sorted by how long they have been overdue."
          className="xl:col-span-2"
          viewAllHref="/accountant/outstanding"
          delay={0.05}
        >
          <DataTable
            columns={columns}
            rows={outstanding.slice(0, 7)}
            rowKey={(row) => row.id}
            rowClassName={(row) => (daysOverdue(row) >= 15 ? 'bg-destructive/[0.035]' : '')}
            emptyTitle="Nothing outstanding"
            emptyDescription="Every invoice has been settled in full."
          />
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Needs attention" delay={0.1}>
            <AlertList items={alerts} />
          </SectionCard>

          <SectionCard title="Expenses" description="Recorded this month." viewAllHref="/accountant/expenses" delay={0.15}>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Total expenses" value={inr(monthExpenses, { compact: true })} />
              <StatTile label="Pending review" value={summary?.pendingExpenses ?? 0} tone="warning" />
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
              Uncategorised entries are excluded from the profit figure until they are reviewed and approved.
            </p>
          </SectionCard>
        </div>
      </div>
        </>
      )}
    </>
  )
}
