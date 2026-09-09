import * as React from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { BedBoard } from '@/components/dashboard/BedBoard'
import { OccupancyGauge } from '@/components/charts/OccupancyGauge'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/ui/status'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { bedSummary, listBeds, type BedRecord } from '@/services/wardService'
import { formatDate, inr } from '@/lib/utils'

const columns: Column<BedRecord>[] = [
  {
    key: 'bed',
    header: 'Bed',
    primary: true,
    cell: (row) => (
      <div>
        <p className="num font-medium">{row.bed}</p>
        <p className="text-[11.5px] text-muted-foreground">
          {row.ward} · Room {row.room}
        </p>
      </div>
    ),
    sortValue: (row) => row.bed,
  },
  { key: 'type', header: 'Type', cell: (row) => row.type, sortValue: (row) => row.type },
  {
    key: 'patient',
    header: 'Patient',
    cell: (row) =>
      row.patientName ? (
        <span className="text-[13px]">{row.patientName}</span>
      ) : (
        <span className="text-[13px] text-muted-foreground">—</span>
      ),
    sortValue: (row) => row.patientName ?? '',
  },
  {
    key: 'since',
    header: 'Since',
    cell: (row) => (row.since ? formatDate(row.since) : <span className="text-muted-foreground">—</span>),
    sortValue: (row) => row.since ?? '',
  },
  {
    key: 'rate',
    header: 'Daily rate',
    align: 'right',
    cell: (row) => <span className="num">{inr(row.dailyRate)}</span>,
    sortValue: (row) => row.dailyRate,
  },
  { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} showDot={false} /> },
]

export default function Beds() {
  const [ward, setWard] = React.useState('All wards')

  const { data: bedData, loading, error, refetch } = useQuery(() => listBeds(), [])
  const {
    data: summary,
    loading: loadingSummary,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery(() => bedSummary(), [])

  const beds = React.useMemo(() => bedData ?? [], [bedData])
  const wardNames = React.useMemo(() => Array.from(new Set(beds.map((b) => b.ward))), [beds])
  const wards = ['All wards', ...wardNames]

  const filtered = ward === 'All wards' ? beds : beds.filter((b) => b.ward === ward)
  const dailyRevenue = beds.filter((b) => b.status === 'Occupied').reduce((a, b) => a + b.dailyRate, 0)
  // A tile shows "—" rather than a zero it cannot stand behind.
  const unknownSummary = loadingSummary || summaryError !== null
  const unknownBeds = loading || error !== null

  return (
    <>
      <PageHeader
        title="Beds & wards"
        description="Live bed status across every ward, room and suite."
        crumbs={[{ label: 'Beds & Wards' }]}
        actions={
          <Select value={ward} onValueChange={setWard}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {wards.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard title="Occupancy" description="Across the whole centre.">
          {loadingSummary ? (
            <LoadingState label="Loading occupancy" className="border-0 shadow-none" />
          ) : summaryError ? (
            <ErrorState
              title="Could not load occupancy"
              message={summaryError}
              onRetry={refetchSummary}
              className="border-0 shadow-none"
            />
          ) : (
            <OccupancyGauge
              value={summary?.occupancyRate ?? 0}
              size={150}
              breakdown={[
                { label: 'Occupied', count: summary?.occupied ?? 0, tone: 'info' },
                { label: 'Available', count: summary?.available ?? 0, tone: 'success' },
                { label: 'Reserved', count: summary?.reserved ?? 0, tone: 'warning' },
                { label: 'Cleaning', count: summary?.cleaning ?? 0, tone: 'muted' },
              ]}
            />
          )}
        </SectionCard>

        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2">
          <StatTile
            label="Total beds"
            value={unknownSummary ? '—' : (summary?.total ?? 0)}
            hint={`Across ${wardNames.length} ward${wardNames.length === 1 ? '' : 's'}`}
          />
          <StatTile
            label="Available now"
            value={unknownSummary ? '—' : (summary?.available ?? 0)}
            tone="success"
            hint="Ready for admission"
          />
          <StatTile
            label="Reserved"
            value={unknownSummary ? '—' : (summary?.reserved ?? 0)}
            tone="warning"
            hint="Admissions booked in advance"
          />
          <StatTile
            label="Daily bed revenue"
            value={unknownBeds ? '—' : inr(dailyRevenue)}
            tone="accent"
            hint="From currently occupied beds"
          />
        </div>
      </div>

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Bed board</TabsTrigger>
          <TabsTrigger value="table">Table view</TabsTrigger>
        </TabsList>

        <TabsContent value="board">
          <SectionCard title={ward} description={`${filtered.length} beds shown.`}>
            {loading ? (
              <LoadingState label="Loading the bed board" className="border-0 shadow-none" />
            ) : error ? (
              <ErrorState
                title="Could not load the bed board"
                message={error}
                onRetry={refetch}
                className="border-0 shadow-none"
              />
            ) : (
              <BedBoard beds={filtered} />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="table">
          <SectionCard title={ward} description={`${filtered.length} beds shown.`}>
            {error ? (
              <ErrorState
                title="Could not load the bed board"
                message={error}
                onRetry={refetch}
                className="border-0 shadow-none"
              />
            ) : (
              <DataTable
                columns={columns}
                rows={filtered}
                rowKey={(row) => row.id}
                loading={loading}
                initialSort={{ key: 'bed', dir: 'asc' }}
              />
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </>
  )
}
