import * as React from 'react'
import { AlertTriangle, CalendarX2, PackageX, ShoppingBag } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listInventory, type MedicineRecord } from '@/services/inventoryService'
import { daysFromToday } from '@/lib/utils'
import { formatDate, inr } from '@/lib/utils'

export default function PharmacyStockAlerts() {
  const toast = useToast()
  const [ordered, setOrdered] = React.useState<string[]>([])
  const [confirmTarget, setConfirmTarget] = React.useState<MedicineRecord | null>(null)

  // One inventory read, split into the three disjoint alert buckets the screen
  // shows — the same partition the status badge uses.
  const { data, loading, error, refetch } = useQuery(() => listInventory(), [])
  const medicines = data ?? []
  const outOfStock = medicines.filter((m) => m.status === 'Out of Stock')
  const lowStock = medicines.filter((m) => m.status === 'Low Stock')
  const nearExpiry = medicines.filter((m) => m.status === 'Near Expiry')

  const reorderSuggestion = (m: MedicineRecord) => Math.max(m.threshold * 2 - m.quantity, m.threshold)
  const daysToExpiry = (m: MedicineRecord) => (m.expiry ? daysFromToday(m.expiry) : 0)

  const reorderColumns: Column<MedicineRecord>[] = [
    {
      key: 'name',
      header: 'Medicine',
      primary: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {row.manufacturer} · rack {row.rackLocation}
          </p>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: 'quantity',
      header: 'On hand',
      align: 'right',
      cell: (row) => (
        <span className={`num font-semibold ${row.quantity === 0 ? 'text-destructive' : 'text-warning'}`}>
          {row.quantity}
        </span>
      ),
      sortValue: (row) => row.quantity,
    },
    {
      key: 'threshold',
      header: 'Threshold',
      align: 'right',
      cell: (row) => <span className="num text-muted-foreground">{row.threshold}</span>,
      sortValue: (row) => row.threshold,
    },
    {
      key: 'suggested',
      header: 'Suggested order',
      align: 'right',
      cell: (row) => <span className="num font-medium">{reorderSuggestion(row)} units</span>,
      sortValue: (row) => reorderSuggestion(row),
    },
    {
      key: 'cost',
      header: 'Est. cost',
      align: 'right',
      cell: (row) => <span className="num">{inr(reorderSuggestion(row) * row.unitPrice)}</span>,
      sortValue: (row) => reorderSuggestion(row) * row.unitPrice,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} showDot={false} /> },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (row) =>
        ordered.includes(row.id) ? (
          <Badge variant="success">Ordered</Badge>
        ) : (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setConfirmTarget(row)
            }}
          >
            <ShoppingBag />
            Reorder
          </Button>
        ),
    },
  ]

  const expiryColumns: Column<MedicineRecord>[] = [
    {
      key: 'name',
      header: 'Medicine',
      primary: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="num truncate text-[12px] text-muted-foreground">Batch {row.batch}</p>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: 'expiry',
      header: 'Expires',
      cell: (row) => formatDate(row.expiry),
      sortValue: (row) => row.expiry,
    },
    {
      key: 'days',
      header: 'Days left',
      align: 'right',
      meta: true,
      cell: (row) => (
        <Badge variant={daysToExpiry(row) <= 20 ? 'danger' : 'warning'}>{daysToExpiry(row)} days</Badge>
      ),
      sortValue: (row) => daysToExpiry(row),
    },
    {
      key: 'quantity',
      header: 'On hand',
      align: 'right',
      cell: (row) => <span className="num">{row.quantity}</span>,
      sortValue: (row) => row.quantity,
    },
    {
      key: 'value',
      header: 'Value at risk',
      align: 'right',
      cell: (row) => <span className="num font-medium">{inr(row.quantity * row.unitPrice)}</span>,
      sortValue: (row) => row.quantity * row.unitPrice,
    },
  ]

  const reorderList = [...outOfStock, ...lowStock]
  const valueAtRisk = nearExpiry.reduce((a, m) => a + m.quantity * Number(m.unitPrice), 0)
  const reorderCost = reorderList.reduce((a, m) => a + reorderSuggestion(m) * m.unitPrice, 0)

  return (
    <>
      <PageHeader
        title="Stock alerts"
        description="What to reorder, what to pull forward, and what is about to expire."
        crumbs={[{ label: 'Pharmacist', to: '/pharmacist/dashboard' }, { label: 'Stock Alerts' }]}
        actions={
          <Button
            onClick={() => {
              setOrdered(reorderList.map((m) => m.id))
              toast.success('Purchase order raised', `${reorderList.length} items ordered for ${inr(reorderCost)}.`)
            }}
            disabled={reorderList.every((m) => ordered.includes(m.id))}
          >
            <ShoppingBag />
            Reorder all
          </Button>
        }
      />

      {error && (
        <ErrorState title="Could not load stock alerts" message={error} onRetry={refetch} className="mb-6" />
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Out of stock" value={loading ? '—' : outOfStock.length} tone="danger" />
        <StatTile label="Below threshold" value={loading ? '—' : lowStock.length} tone="warning" />
        <StatTile label="Near expiry" value={loading ? '—' : nearExpiry.length} tone="info" hint="Within 45 days" />
        <StatTile label="Value at risk" value={inr(valueAtRisk)} tone="warning" hint="Stock expiring soon" />
      </div>

      <SectionCard
        title="Reorder list"
        description={`${reorderList.length} items at or below their reorder threshold. Estimated cost ${inr(reorderCost)}.`}
        className="mb-5"
        icon={<PackageX />}
      >
        {loading ? (
          <LoadingState label="Loading stock alerts" className="border-0 shadow-none" />
        ) : (
        <DataTable
          columns={reorderColumns}
          rows={reorderList}
          rowKey={(row) => row.id}
          initialSort={{ key: 'quantity', dir: 'asc' }}
          emptyTitle="Everything is stocked"
          emptyDescription="No item is below its reorder threshold right now."
        />
        )}
      </SectionCard>

      <SectionCard
        title="Expiring soon"
        description="Rotate these forward or return them to the supplier before they expire."
        icon={<CalendarX2 />}
      >
        <DataTable
          columns={expiryColumns}
          rows={nearExpiry}
          rowKey={(row) => row.id}
          initialSort={{ key: 'days', dir: 'asc' }}
          emptyTitle="Nothing expiring soon"
          emptyDescription="No batch expires within the next 45 days."
        />

        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/[0.06] px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Items within 45 days of expiry are excluded from automatic dispensing suggestions but can still be sold
            manually at the counter.
          </p>
        </div>
      </SectionCard>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title={`Reorder ${confirmTarget?.name ?? 'this item'}?`}
        description={
          confirmTarget
            ? `A purchase order for ${reorderSuggestion(confirmTarget)} units will be raised with ${confirmTarget.manufacturer}, costing approximately ${inr(reorderSuggestion(confirmTarget) * confirmTarget.unitPrice)}.`
            : ''
        }
        confirmLabel="Raise purchase order"
        onConfirm={() => {
          if (confirmTarget) {
            setOrdered((prev) => [...prev, confirmTarget.id])
            toast.success('Purchase order raised', `${confirmTarget.name} ordered from ${confirmTarget.manufacturer}.`)
          }
          setConfirmTarget(null)
        }}
      />
    </>
  )
}
