import * as React from 'react'
import { Download, Search } from 'lucide-react'
import type { StockStatus } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { Progress } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listInventory, type MedicineRecord } from '@/services/inventoryService'
import { getDashboard } from '@/services/pharmacyService'
import { daysFromToday, formatDate, inr } from '@/lib/utils'

const STATUSES: (StockStatus | 'All')[] = ['All', 'In Stock', 'Low Stock', 'Near Expiry', 'Out of Stock']

export default function PharmacyInventory() {
  const toast = useToast()
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>('All')

  const { data, loading, error, refetch } = useQuery(() => listInventory(), [])
  // The stock valuation comes from the dashboard, which sums it in SQL rather
  // than the browser adding up a page of rows.
  const { data: summary } = useQuery(() => getDashboard(), [])
  const medicines = data ?? []

  const filtered = medicines.filter((m) => {
    const matchesStatus = status === 'All' || m.status === status
    const haystack = `${m.name} ${m.genericName} ${m.category} ${m.batch} ${m.manufacturer}`.toLowerCase()
    return matchesStatus && (!query || haystack.includes(query.toLowerCase()))
  })

  const columns: Column<MedicineRecord>[] = [
    {
      key: 'name',
      header: 'Medicine',
      primary: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {row.genericName} · {row.manufacturer}
          </p>
        </div>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: 'batch',
      header: 'Batch',
      cell: (row) => (
        <div>
          <p className="num text-[12.5px]">{row.batch}</p>
          <p className="num text-[11.5px] text-muted-foreground">Rack {row.rackLocation}</p>
        </div>
      ),
      sortValue: (row) => row.batch,
    },
    {
      key: 'quantity',
      header: 'Quantity',
      className: 'w-[170px]',
      cell: (row) => {
        const pct = Math.min(100, Math.round((row.quantity / Math.max(row.threshold * 2, 1)) * 100))
        return (
          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="num text-[13px] font-semibold">{row.quantity}</span>
              <span className="num text-[11px] text-muted-foreground">min {row.threshold}</span>
            </div>
            <Progress
              value={pct}
              className="h-1.5"
              tone={row.quantity === 0 ? 'danger' : row.quantity <= row.threshold ? 'warning' : 'success'}
            />
          </div>
        )
      },
      sortValue: (row) => row.quantity,
    },
    {
      key: 'expiry',
      header: 'Expiry',
      cell: (row) => {
        if (!row.expiry) {
          return <span className="text-[12.5px] text-muted-foreground">No stock</span>
        }
        const days = daysFromToday(row.expiry)
        return (
          <div>
            <p className="text-[12.5px]">{formatDate(row.expiry)}</p>
            <p className={`text-[11.5px] ${days <= 45 ? 'font-medium text-warning' : 'text-muted-foreground'}`}>
              {days > 0 ? `${days} days left` : 'Expired'}
            </p>
          </div>
        )
      },
      sortValue: (row) => row.expiry ?? '',
    },
    {
      key: 'mrp',
      header: 'MRP',
      align: 'right',
      cell: (row) => <span className="num">{inr(Number(row.mrp), { decimals: true })}</span>,
      sortValue: (row) => Number(row.mrp),
    },
    {
      key: 'value',
      header: 'Stock value',
      align: 'right',
      cell: (row) => (
        <span className="num text-muted-foreground">{inr(row.quantity * Number(row.unitPrice))}</span>
      ),
      sortValue: (row) => row.quantity * Number(row.unitPrice),
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} showDot={false} /> },
  ]

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every batch in the pharmacy, with stock level, expiry and shelf location."
        crumbs={[{ label: 'Pharmacist', to: '/pharmacist/dashboard' }, { label: 'Inventory' }]}
        actions={
          <Button
            variant="outline"
            onClick={() => toast.success('Export queued', 'A stock CSV will be emailed to you shortly.')}
          >
            <Download />
            Export stock
          </Button>
        }
      />

      {error && (
        <ErrorState title="Could not load the inventory" message={error} onRetry={refetch} className="mb-6" />
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Catalogue items" value={loading ? '—' : medicines.length} />
        <StatTile
          label="Stock value"
          value={summary ? inr(Number(summary.inventoryValueAtCost), { compact: true }) : '—'}
          tone="success"
          hint="At cost price"
        />
        <StatTile
          label="Needs reorder"
          value={loading ? '—' : medicines.filter((m) => m.status === 'Low Stock' || m.status === 'Out of Stock').length}
          tone="warning"
        />
        <StatTile
          label="Near expiry"
          value={loading ? '—' : medicines.filter((m) => m.status === 'Near Expiry').length}
          tone="info"
          hint="Within 45 days"
        />
      </div>

      <SectionCard
        title="Stock register"
        description={loading ? 'Loading…' : `${filtered.length} of ${medicines.length} items shown.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search medicine or batch"
                className="h-8 w-52 pl-8 text-[13px]"
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as (typeof STATUSES)[number])}>
              <SelectTrigger className="h-8 w-40 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {loading ? (
          <LoadingState label="Loading the inventory" className="border-0 shadow-none" />
        ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          initialSort={{ key: 'quantity', dir: 'asc' }}
          rowClassName={(row) => (row.status === 'Out of Stock' ? 'bg-destructive/[0.035]' : '')}
          emptyTitle="No medicines match your filters"
          emptyDescription="Try a different search term or reset the status filter."
          emptyAction={
            <Button
              variant="outline"
              onClick={() => {
                setQuery('')
                setStatus('All')
              }}
            >
              Clear filters
            </Button>
          }
        />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span>Legend:</span>
          {(['In Stock', 'Low Stock', 'Near Expiry', 'Out of Stock'] as StockStatus[]).map((s) => (
            <Badge key={s} variant={s === 'In Stock' ? 'success' : s === 'Low Stock' ? 'warning' : s === 'Near Expiry' ? 'info' : 'danger'}>
              {s}
            </Badge>
          ))}
        </div>
      </SectionCard>
    </>
  )
}
