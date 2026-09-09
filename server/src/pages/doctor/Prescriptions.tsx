import * as React from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { Prescription } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { PrescriptionDetail } from '@/components/pharmacy/PrescriptionDetail'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listPrescriptions } from '@/services/prescriptionService'
import { formatDate } from '@/lib/utils'

export default function DoctorPrescriptions() {
  const [selected, setSelected] = React.useState<Prescription | null>(null)

  // The signed-in doctor's own prescriptions — the backend resolves "own" from
  // the token, so no clinician name is sent from the browser.
  const { data, loading, error, refetch } = useQuery(() => listPrescriptions({ limit: 200 }), [])
  const rows = data?.items ?? []

  const columns: Column<Prescription>[] = [
    {
      key: 'id',
      header: 'Prescription',
      primary: true,
      cell: (row) => (
        <div>
          <p className="num font-medium">{row.id}</p>
          <p className="text-[12px] text-muted-foreground">{formatDate(row.date)}</p>
        </div>
      ),
      sortValue: (row) => row.id,
    },
    {
      key: 'patient',
      header: 'Patient',
      cell: (row) => (
        <Link
          to={`/patients/${row.patientId}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-accent hover:underline"
        >
          {row.patientName}
        </Link>
      ),
      sortValue: (row) => row.patientName,
    },
    {
      key: 'items',
      header: 'Medicines',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px]">{row.items.map((i) => i.medicine).join(', ')}</p>
          <p className="text-[11.5px] text-muted-foreground">{row.items.length} item(s)</p>
        </div>
      ),
      sortValue: (row) => row.items.length,
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (row) => <Badge variant={row.priority === 'Urgent' ? 'danger' : 'default'}>{row.priority}</Badge>,
      sortValue: (row) => row.priority,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
  ]

  return (
    <>
      <PageHeader
        title="Prescriptions"
        description="Everything you have prescribed, with live dispensing status from the pharmacy."
        crumbs={[{ label: 'Doctor', to: '/doctor/dashboard' }, { label: 'Prescriptions' }]}
        actions={
          <Button asChild>
            <Link to="/doctor/consultations">
              <Plus />
              New prescription
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total prescriptions" value={loading ? '—' : rows.length} />
        <StatTile
          label="Awaiting dispensing"
          value={loading ? '—' : rows.filter((r) => r.status === 'Pending').length}
          tone="warning"
        />
        <StatTile
          label="Partially dispensed"
          value={loading ? '—' : rows.filter((r) => r.status === 'Partially Dispensed').length}
          tone="info"
        />
        <StatTile
          label="Dispensed"
          value={loading ? '—' : rows.filter((r) => r.status === 'Dispensed').length}
          tone="success"
        />
      </div>

      <SectionCard title="Prescription history" description="Select a row to review the full prescription.">
        {loading ? (
          <LoadingState label="Loading your prescriptions" className="border-0 shadow-none" />
        ) : error ? (
          <ErrorState
            title="Could not load prescriptions"
            message={error}
            onRetry={refetch}
            className="border-0 shadow-none"
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={setSelected}
            initialSort={{ key: 'id', dir: 'desc' }}
            emptyTitle="No prescriptions yet"
            emptyDescription="Prescriptions written during a consultation appear here."
          />
        )}
      </SectionCard>

      <PrescriptionDetail prescription={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </>
  )
}
