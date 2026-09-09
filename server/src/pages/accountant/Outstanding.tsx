import * as React from 'react'
import { Link } from 'react-router-dom'
import { Bell, Phone } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { Progress } from '@/components/ui/misc'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { getAgeing, getDashboard } from '@/services/billingService'
import { listInvoices, type InvoiceRecord } from '@/services/invoiceService'
import { daysFromToday, formatDate, inr, sum } from '@/lib/utils'

/** How overdue a bill is, from its due date. Zero until the date passes. */
function daysOverdue(invoice: InvoiceRecord) {
  const diff = daysFromToday(invoice.dueDate)
  return diff < 0 ? Math.abs(diff) : 0
}

function outstandingOf(invoice: InvoiceRecord) {
  return invoice.balance
}

export default function AccountantOutstanding() {
  const toast = useToast()
  const [reminded, setReminded] = React.useState<string[]>([])

  const { data, loading, error, refetch } = useQuery(
    () => listInvoices({ outstanding: true, limit: 100 }),
    [],
  )
  // The ageing bands and the headline total are aggregated in SQL — the four
  // bars are four aggregates, not a page of rows added up in the browser.
  const { data: ageingRows } = useQuery(() => getAgeing(), [])
  const { data: summary } = useQuery(() => getDashboard(), [])

  const invoices = data?.items ?? []
  const ageing = ageingRows ?? []

  function remind(invoice: InvoiceRecord) {
    setReminded((prev) => [...prev, invoice.id])
    toast.success('Reminder sent', `${invoice.patientName} has been sent an SMS and email for ${invoice.id}.`)
  }

  const columns: Column<InvoiceRecord>[] = [
    {
      key: 'patient',
      header: 'Patient',
      primary: true,
      cell: (row) => {
        return (
          <div className="min-w-0">
            <Link
              to={`/patients/${row.patientId}`}
              onClick={(e) => e.stopPropagation()}
              className="block truncate font-medium text-accent hover:underline"
            >
              {row.patientName}
            </Link>
            <p className="num truncate text-[11.5px] text-muted-foreground">
              {row.patientId}
            </p>
          </div>
        )
      },
      sortValue: (row) => row.patientName,
    },
    {
      key: 'invoice',
      header: 'Invoice',
      cell: (row) => (
        <div>
          <p className="num text-[12.5px]">{row.id}</p>
          <p className="text-[11.5px] text-muted-foreground">{row.department}</p>
        </div>
      ),
      sortValue: (row) => row.id,
    },
    {
      key: 'amount',
      header: 'Outstanding',
      align: 'right',
      cell: (row) => (
        <div>
          <p className="num font-semibold">{inr(outstandingOf(row))}</p>
          <p className="num text-[11.5px] text-muted-foreground">of {inr(row.amount)}</p>
        </div>
      ),
      sortValue: (row) => outstandingOf(row),
    },
    {
      key: 'collected',
      header: 'Collected',
      className: 'w-[150px]',
      cell: (row) => {
        const pct = Math.round((row.paid / row.amount) * 100)
        return (
          <div>
            <p className="num mb-1 text-[12px]">{pct}%</p>
            <Progress value={pct} className="h-1.5" tone={pct >= 70 ? 'success' : pct >= 40 ? 'warning' : 'danger'} />
          </div>
        )
      },
      sortValue: (row) => row.paid / row.amount,
    },
    { key: 'dueDate', header: 'Due date', cell: (row) => formatDate(row.dueDate), sortValue: (row) => row.dueDate },
    {
      key: 'overdue',
      header: 'Days overdue',
      align: 'right',
      meta: true,
      cell: (row) => {
        const days = daysOverdue(row)
        if (days === 0) return <Badge variant="default">Not due</Badge>
        return <Badge variant={days >= 30 ? 'danger' : days >= 15 ? 'warning' : 'info'}>{days} days</Badge>
      },
      sortValue: (row) => daysOverdue(row),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} />, hideOnCard: true },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (row) =>
        reminded.includes(row.id) ? (
          <Badge variant="success">Reminded</Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              remind(row)
            }}
          >
            <Bell />
            Remind
          </Button>
        ),
    },
  ]

  const critical = invoices.filter((i) => daysOverdue(i) >= 15)

  return (
    <>
      <PageHeader
        title="Outstanding payments"
        description="Open balances ordered by how long they have been overdue."
        crumbs={[{ label: 'Accountant', to: '/accountant/dashboard' }, { label: 'Outstanding' }]}
        actions={
          <Button
            onClick={() => {
              setReminded(invoices.map((i) => i.id))
              toast.success('Reminders sent', `${invoices.length} patients notified by SMS and email.`)
            }}
            disabled={invoices.length === 0 || invoices.every((i) => reminded.includes(i.id))}
          >
            <Bell />
            Remind all
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total outstanding" value={inr(summary?.outstandingAmount ?? 0)} tone="danger" />
        <StatTile label="Open invoices" value={summary?.outstandingInvoices ?? 0} />
        <StatTile
          label="Overdue 15+ days"
          value={critical.length}
          tone="warning"
          hint={inr(sum(critical, outstandingOf))}
        />
        <StatTile
          label="Oldest debt"
          value={invoices.length ? `${Math.max(...invoices.map(daysOverdue))} days` : '—'}
          tone="danger"
          hint={invoices[0]?.patientName ?? 'Nothing outstanding'}
        />
      </div>

      <SectionCard title="Ageing analysis" description="Outstanding balance by how overdue it is." className="mb-5">
        <BarSeriesChart
          data={ageing.map((b) => ({ bucket: b.bucket, amount: b.amount }))}
          xKey="bucket"
          series={[{ key: 'amount', name: 'Outstanding', color: 'chart-4' }]}
          format={(v) => inr(v, { compact: true })}
          height={230}
          yWidth={56}
          showLegend={false}
        />
      </SectionCard>

      <SectionCard
        title="Open balances"
        description="Send a reminder or open the patient record to arrange a payment plan."
        icon={<Phone />}
      >
        {error ? (
          <ErrorState message={error} title="Could not load open balances" onRetry={refetch} />
        ) : loading ? (
          <LoadingState label="Loading open balances" />
        ) : (
          <DataTable
            columns={columns}
            rows={invoices}
            rowKey={(row) => row.id}
            initialSort={{ key: 'overdue', dir: 'desc' }}
            rowClassName={(row) => (daysOverdue(row) >= 30 ? 'bg-destructive/[0.045]' : daysOverdue(row) >= 15 ? 'bg-warning/[0.04]' : '')}
            emptyTitle="Nothing outstanding"
            emptyDescription="Every invoice has been settled in full."
          />
        )}
      </SectionCard>
    </>
  )
}
