import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import type { PaymentMethod } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { DonutChart } from '@/components/charts/DonutChart'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { getDashboard } from '@/services/billingService'
import { listPayments, setPaymentStatus, type PaymentRow } from '@/services/paymentService'
import { formatDate, inr, sum } from '@/lib/utils'

const METHODS: (PaymentMethod | 'All')[] = ['All', 'Cash', 'UPI', 'Card', 'Bank Transfer', 'Insurance']

export default function AccountantPayments() {
  const toast = useToast()
  const [method, setMethod] = React.useState<(typeof METHODS)[number]>('All')

  const { data, loading, error, refetch } = useQuery(() => listPayments({ limit: 100 }), [])
  // The collections figure and its method split are summed in SQL rather than
  // by adding up whichever page of rows happens to be loaded.
  const { data: summary, refetch: refetchSummary } = useQuery(() => getDashboard(), [])

  const payments = data?.items ?? []
  const filtered = payments.filter((p) => method === 'All' || p.method === method)
  const failed = payments.filter((p) => p.status === 'Failed')

  async function retry(payment: PaymentRow) {
    try {
      await setPaymentStatus(payment.id, 'Processing')
      toast.info('Retry requested', `${inr(payment.amount)} from ${payment.patientName} has been re-submitted.`)
      refetch()
      refetchSummary()
    } catch (err) {
      toast.error('Could not retry that payment', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  const columns: Column<PaymentRow>[] = [
    {
      key: 'id',
      header: 'Payment',
      primary: true,
      cell: (row) => (
        <div>
          <p className="num font-medium">{row.id}</p>
          <p className="num text-[12px] text-muted-foreground">{row.invoiceId}</p>
        </div>
      ),
      sortValue: (row) => row.id,
    },
    { key: 'patient', header: 'Patient', cell: (row) => row.patientName, sortValue: (row) => row.patientName },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (row) => <span className="num font-semibold">{inr(row.amount)}</span>,
      sortValue: (row) => row.amount,
    },
    { key: 'method', header: 'Method', cell: (row) => row.method, sortValue: (row) => row.method },
    { key: 'date', header: 'Date', cell: (row) => formatDate(row.date), sortValue: (row) => row.date },
    {
      key: 'collectedBy',
      header: 'Collected by',
      cell: (row) => <span className="text-[12.5px] text-muted-foreground">{row.collectedBy}</span>,
      sortValue: (row) => row.collectedBy,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (row) =>
        row.status === 'Failed' ? (
          <Button size="sm" variant="outline" onClick={() => retry(row)}>
            <RefreshCw />
            Retry
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment collected today across all counters and channels."
        crumbs={[{ label: 'Accountant', to: '/accountant/dashboard' }, { label: 'Payments' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Collected today" value={inr(summary?.todayRevenue ?? 0)} tone="success" />
        <StatTile label="Payments" value={summary?.todayPaymentCount ?? 0} />
        <StatTile
          label="Processing"
          value={payments.filter((p) => p.status === 'Processing').length}
          tone="info"
          hint="Awaiting bank confirmation"
        />
        <StatTile
          label="Failed"
          value={failed.length}
          tone={failed.length ? 'danger' : 'success'}
          hint={failed.length ? inr(sum(failed, (p) => p.amount)) : 'None'}
        />
      </div>

      {error ? (
        <ErrorState message={error} title="Could not load payments" onRetry={refetch} />
      ) : loading ? (
        <LoadingState label="Loading payments" />
      ) : (
      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard title="By payment method" description="Settled payments only." delay={0.05}>
          <DonutChart
            data={(summary?.paymentBreakdown ?? []).map((p) => ({ label: p.method, value: p.amount }))}
            format={(v) => inr(v)}
            centerValue={inr(summary?.todayRevenue ?? 0, { compact: true })}
            centerLabel="Total"
            height={190}
            className="sm:flex-col sm:items-stretch"
          />
        </SectionCard>

        <SectionCard
          title="Payment ledger"
          description={`${filtered.length} of ${payments.length} payments shown.`}
          className="xl:col-span-2"
          delay={0.1}
          action={
            <Select value={method} onValueChange={(v) => setMethod(v as (typeof METHODS)[number])}>
              <SelectTrigger className="h-8 w-40 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        >
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            initialSort={{ key: 'amount', dir: 'desc' }}
            rowClassName={(row) => (row.status === 'Failed' ? 'bg-destructive/[0.04]' : '')}
            emptyTitle="No payments recorded"
            emptyDescription="Payments taken at the desk or in the pharmacy appear here immediately."
          />
        </SectionCard>
      </div>
      )}
    </>
  )
}
