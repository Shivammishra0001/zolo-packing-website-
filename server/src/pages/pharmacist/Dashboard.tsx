import { Link } from 'react-router-dom'
import { AlertTriangle, Boxes, IndianRupee, Receipt, ShoppingCart } from 'lucide-react'
import type { Prescription } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { KpiCard, KpiGrid } from '@/components/dashboard/KpiCard'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { AlertList } from '@/components/dashboard/AlertList'
import { BarSeriesChart } from '@/components/charts/BarSeriesChart'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { getDashboard } from '@/services/pharmacyService'
import { listInventory } from '@/services/inventoryService'
import { listPrescriptions } from '@/services/prescriptionService'
import { daysFromToday, inr } from '@/lib/utils'

const columns: Column<Prescription>[] = [
  {
    key: 'id',
    header: 'Prescription',
    primary: true,
    cell: (row) => (
      <div>
        <p className="num font-medium">{row.id}</p>
        <p className="text-[12px] text-muted-foreground">{row.date}</p>
      </div>
    ),
    sortValue: (row) => row.id,
  },
  {
    key: 'patient',
    header: 'Patient',
    cell: (row) => (
      <Link to={`/patients/${row.patientId}`} className="font-medium text-accent hover:underline">
        {row.patientName}
      </Link>
    ),
    sortValue: (row) => row.patientName,
  },
  { key: 'doctor', header: 'Doctor', cell: (row) => row.doctor, sortValue: (row) => row.doctor },
  {
    key: 'medicine',
    header: 'Medicines',
    cell: (row) => <span className="text-[12.5px]">{row.items.map((i) => i.medicine).join(', ')}</span>,
  },
  {
    key: 'quantity',
    header: 'Qty',
    align: 'right',
    cell: (row) => <span className="num">{row.items.reduce((a, i) => a + i.quantity, 0)}</span>,
    sortValue: (row) => row.items.reduce((a, i) => a + i.quantity, 0),
  },
  { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
]

/** Percentage change between two figures, for the KPI cards' deltas. */
function delta(today: number, yesterday: number): number | undefined {
  if (!yesterday) return undefined
  return Number((((today - yesterday) / yesterday) * 100).toFixed(1))
}

export default function PharmacistDashboard() {
  const { data: summary, loading, error, refetch } = useQuery(() => getDashboard(), [])
  const { data: stock } = useQuery(() => listInventory(), [])
  // The queue itself, so the table shows real rows rather than a count.
  const { data: queue } = useQuery(
    () => listPrescriptions({ scope: 'all', status: 'Pending', limit: 50 }),
    [],
  )

  const medicines = stock ?? []
  const outOfStock = medicines.filter((m) => m.status === 'Out of Stock')
  const lowStock = medicines.filter((m) => m.status === 'Low Stock')
  const nearExpiry = medicines.filter((m) => m.status === 'Near Expiry')
  const pending = queue?.items ?? []

  const salesToday = Number(summary?.salesToday ?? 0)
  const salesYesterday = Number(summary?.salesYesterday ?? 0)

  const alerts = [
    ...outOfStock.map((m) => ({
      id: `oos-${m.id}`,
      title: `${m.name} is out of stock`,
      detail: `Threshold is ${m.threshold} units. Reorder from ${m.manufacturer}.`,
      href: '/pharmacy/alerts',
      severity: 'critical' as const,
    })),
    ...lowStock.slice(0, 3).map((m) => ({
      id: `low-${m.id}`,
      title: `${m.name} — ${m.quantity} units remaining`,
      detail: `Below the reorder threshold of ${m.threshold}. Rack ${m.rackLocation}.`,
      href: '/pharmacy/alerts',
      severity: 'warning' as const,
    })),
    ...nearExpiry.slice(0, 2).map((m) => ({
      id: `exp-${m.id}`,
      title: `${m.name} expires in ${m.expiry ? daysFromToday(m.expiry) : 0} days`,
      detail: `Batch ${m.batch} · ${m.quantity} units on hand.`,
      href: '/pharmacy/alerts',
      severity: 'info' as const,
    })),
  ]

  return (
    <>
      <PageHeader
        title="Pharmacy"
        description={
          loading
            ? 'Loading the pharmacy position…'
            : `${summary?.pendingPrescriptions ?? 0} prescriptions waiting and ${
                (summary?.lowStock ?? 0) + (summary?.outOfStock ?? 0)
              } items needing a reorder.`
        }
        crumbs={[{ label: 'Pharmacist', to: '/pharmacist/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/pharmacy/inventory">
                <Boxes />
                Inventory
              </Link>
            </Button>
            <Button asChild>
              <Link to="/pharmacy/pos">
                <ShoppingCart />
                Open POS
              </Link>
            </Button>
          </>
        }
      />

      <KpiGrid className="mb-6 xl:grid-cols-4">
        <KpiCard
          label="Today's Sales"
          value={salesToday}
          format={(v) => inr(v)}
          change={delta(salesToday, salesYesterday)}
          changeLabel="vs yesterday"
          icon={<IndianRupee className="size-4" />}
          tone="success"
        />
        <KpiCard
          label="Orders"
          value={summary?.ordersToday ?? 0}
          change={delta(summary?.ordersToday ?? 0, summary?.ordersYesterday ?? 0)}
          changeLabel="vs yesterday"
          icon={<Receipt className="size-4" />}
          tone="info"
          footer={`${summary?.itemsDispensedToday ?? 0} items dispensed`}
        />
        <KpiCard
          label="Average Order Value"
          value={Number(summary?.averageOrderValue ?? 0)}
          format={(v) => inr(v)}
          icon={<ShoppingCart className="size-4" />}
          tone="accent"
        />
        <KpiCard
          label="Stock Alerts"
          value={
            (summary?.lowStock ?? 0) + (summary?.outOfStock ?? 0) + (summary?.nearExpiry ?? 0)
          }
          invertChange
          icon={<AlertTriangle className="size-4" />}
          tone="warning"
          footer={`${summary?.outOfStock ?? 0} out of stock · ${summary?.nearExpiry ?? 0} near expiry`}
        />
      </KpiGrid>

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Pending prescriptions"
          description="Awaiting dispensing, urgent items first."
          className="xl:col-span-2"
          viewAllHref="/pharmacy/prescriptions"
          delay={0.05}
        >
          {loading ? (
            <LoadingState label="Loading the queue" className="border-0 shadow-none" />
          ) : error ? (
            <ErrorState
              title="Could not load the pharmacy dashboard"
              message={error}
              onRetry={refetch}
              className="border-0 shadow-none"
            />
          ) : (
            <DataTable
              columns={columns}
              rows={pending}
              rowKey={(row) => row.id}
              emptyTitle="Queue is clear"
              emptyDescription="Prescriptions written by doctors arrive here instantly."
            />
          )}
        </SectionCard>

        <SectionCard title="Inventory alerts" description="What to reorder or pull from the shelf." delay={0.1}>
          <AlertList items={alerts} />
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Sales this week"
          description="Daily pharmacy revenue."
          className="xl:col-span-2"
          delay={0.05}
        >
          {loading ? (
            <LoadingState label="Loading sales" className="border-0 shadow-none" />
          ) : (
            <BarSeriesChart
              data={(summary?.salesTrend ?? []).map((d) => ({ day: d.day, sales: Number(d.sales) }))}
              xKey="day"
              series={[{ key: 'sales', name: 'Sales', color: 'chart-1' }]}
              format={(v) => inr(v, { compact: true })}
              height={250}
              showLegend={false}
            />
          )}
        </SectionCard>

        <SectionCard title="Stock position" description="Across the whole catalogue." delay={0.1}>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="In stock" value={summary?.inStock ?? '—'} tone="success" />
            <StatTile label="Low stock" value={summary?.lowStock ?? '—'} tone="warning" />
            <StatTile label="Near expiry" value={summary?.nearExpiry ?? '—'} tone="info" />
            <StatTile label="Out of stock" value={summary?.outOfStock ?? '—'} tone="danger" />
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Expiring soonest
            </p>
            {nearExpiry.length === 0 ? (
              <p className="py-3 text-center text-[12.5px] text-muted-foreground">
                {loading ? 'Loading…' : 'Nothing expiring soon.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {nearExpiry.slice(0, 4).map((m) => {
                  const days = m.expiry ? daysFromToday(m.expiry) : 0
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="min-w-0 truncate">{m.name}</span>
                      <Badge variant={days <= 20 ? 'danger' : 'warning'}>{days} days</Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </SectionCard>
      </div>
    </>
  )
}
