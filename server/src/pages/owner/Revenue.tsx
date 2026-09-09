import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/dashboard/SectionCard'
import { KpiCard, KpiGrid } from '@/components/dashboard/KpiCard'
import { RevenueTrendChart } from '@/components/charts/RevenueTrendChart'
import { DonutChart } from '@/components/charts/DonutChart'
import { DataTable, type Column } from '@/components/ui/data-table'
import { StatusBadge } from '@/components/ui/status'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import {
  getDashboard,
  getDepartmentReport,
  getRevenueReport,
} from '@/services/billingService'
import { listInvoices, type InvoiceRecord } from '@/services/invoiceService'
import { formatDate, inr, sum } from '@/lib/utils'

const columns: Column<InvoiceRecord>[] = [
  {
    key: 'invoice',
    header: 'Invoice',
    primary: true,
    cell: (row) => (
      <div>
        <p className="num font-medium">{row.id}</p>
        <p className="text-[12px] text-muted-foreground">{row.patientName}</p>
      </div>
    ),
    sortValue: (row) => row.id,
  },
  { key: 'department', header: 'Department', cell: (row) => row.department, sortValue: (row) => row.department },
  { key: 'date', header: 'Date', cell: (row) => formatDate(row.date), sortValue: (row) => row.date },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cell: (row) => <span className="num font-semibold">{inr(row.amount)}</span>,
    sortValue: (row) => row.amount,
  },
  {
    key: 'paid',
    header: 'Collected',
    align: 'right',
    cell: (row) => <span className="num">{inr(row.paid)}</span>,
    sortValue: (row) => row.paid,
  },
  { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
]

export default function OwnerRevenue() {
  const { data: summary, loading, error, refetch } = useQuery(() => getDashboard(), [])
  const { data: trend } = useQuery(() => getRevenueReport(12), [])
  const { data: departments } = useQuery(() => getDepartmentReport(1), [])
  const { data: page } = useQuery(() => listInvoices({ limit: 50 }), [])

  const invoices = page?.items ?? []
  const series = trend ?? []
  const byDepartment = departments ?? []

  // Billed and collected are different questions: the first is what was
  // charged, the second what actually arrived. The gap between them is the
  // point of this screen, so neither is derived from the other.
  const billed = sum(invoices, (i) => i.amount)
  const collected = sum(invoices, (i) => i.paid)

  return (
    <>
      <PageHeader
        title="Revenue"
        description="Billing, collection and the gap between the two."
        crumbs={[{ label: 'Owner', to: '/owner/dashboard' }, { label: 'Revenue' }]}
      />

      {error ? (
        <ErrorState message={error} title="Could not load revenue" onRetry={refetch} />
      ) : loading ? (
        <LoadingState label="Loading revenue" />
      ) : (
        <>
      <KpiGrid className="mb-6 xl:grid-cols-4">
        <KpiCard
          label="Billed this cycle"
          value={billed}
          format={(v) => inr(v, { compact: true })}
          change={9.2}
          tone="info"
        />
        <KpiCard
          label="Collected"
          value={collected}
          format={(v) => inr(v, { compact: true })}
          change={7.4}
          tone="success"
          footer={billed ? `${((collected / billed) * 100).toFixed(1)}% collection rate` : 'Nothing billed yet'}
        />
        <KpiCard
          label="Outstanding"
          value={summary?.outstandingAmount ?? 0}
          format={(v) => inr(v, { compact: true })}
          change={4.1}
          invertChange
          tone="danger"
          footer="Across 10 open invoices"
        />
        <KpiCard
          label="Today's collections"
          value={summary?.todayRevenue ?? 0}
          format={(v) => inr(v)}
          changeLabel="vs yesterday"
          tone="accent"
        />
      </KpiGrid>

      <SectionCard title="Twelve-month revenue" description="Revenue against expenses and resulting profit." className="mb-6">
        <RevenueTrendChart data={series.map((m) => ({ ...m }))} height={320} />
      </SectionCard>

      <div className="mb-6 grid gap-5 xl:grid-cols-2">
        <SectionCard title="Revenue by department" delay={0.05}>
          <DonutChart
            data={byDepartment.map((d) => ({ label: d.department, value: d.revenue }))}
            format={(v) => inr(v, { compact: true })}
            centerValue={inr(summary?.monthlyRevenue ?? 0, { compact: true })}
            centerLabel="This month"
          />
        </SectionCard>

        <SectionCard title="How patients pay" description="Settled payments by method." delay={0.1}>
          <DonutChart
            data={(summary?.paymentBreakdown ?? []).map((p) => ({ label: p.method, value: p.amount }))}
            format={(v) => inr(v)}
            centerValue={inr(summary?.todayRevenue ?? 0, { compact: true })}
            centerLabel="Collected"
          />
        </SectionCard>
      </div>

      <SectionCard title="Invoices" description="Every invoice raised in the current cycle." bodyClassName="p-0 sm:p-0">
        <div className="p-5 pt-0 sm:p-5">
          <DataTable
            columns={columns}
            rows={invoices}
            rowKey={(row) => row.id}
            initialSort={{ key: 'date', dir: 'desc' }}
            emptyTitle="No invoices raised"
            emptyDescription="Invoices generated at the front desk and pharmacy appear here."
          />
        </div>
      </SectionCard>
        </>
      )}
    </>
  )
}
