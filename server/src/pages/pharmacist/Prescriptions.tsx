import * as React from 'react'
import { Link } from 'react-router-dom'
import { Check, PackageCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { PrescriptionDetail } from '@/components/pharmacy/PrescriptionDetail'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listPrescriptions, type PrescriptionRecord } from '@/services/prescriptionService'
import { dispense as dispenseApi } from '@/services/pharmacyService'
import { formatDate } from '@/lib/utils'

export default function PharmacyPrescriptions() {
  const toast = useToast()
  const [selected, setSelected] = React.useState<PrescriptionRecord | null>(null)
  const [dispensing, setDispensing] = React.useState(false)

  // The pharmacy works the whole branch queue, not one prescriber's list.
  const { data, loading, error, refetch } = useQuery(
    () => listPrescriptions({ scope: 'all', limit: 200 }),
    [],
  )
  const prescriptions = data?.items ?? []

  async function dispense(prescription: PrescriptionRecord) {
    // Issue whatever is still outstanding on each line. Stock, batch choice and
    // the resulting status are all decided by the backend.
    const items = prescription.items
      .map((item) => ({
        prescriptionItemId: item.id,
        quantity: item.quantity - item.quantityDispensed,
      }))
      .filter((line) => line.quantity > 0)

    if (items.length === 0) {
      toast.error('Nothing to dispense', `${prescription.id} has already been fully dispensed.`)
      return
    }

    setDispensing(true)
    try {
      const result = await dispenseApi(prescription.uuid, items)
      setSelected(null)
      refetch()
      const units = result.records.reduce((a, r) => a + r.quantity, 0)
      toast.success(
        result.status === 'Dispensed' ? 'Prescription dispensed' : 'Partially dispensed',
        `${prescription.id} for ${prescription.patientName}: ${units} unit(s) issued from ${result.records.length} batch(es).`,
      )
    } catch (err) {
      // Insufficient or expired stock comes back as a 409 with a readable
      // message — shown rather than swallowed, since nothing was issued.
      toast.error(
        'Could not dispense',
        err instanceof Error ? err.message : 'Please try again.',
      )
    } finally {
      setDispensing(false)
    }
  }

  const columns: Column<PrescriptionRecord>[] = [
    {
      key: 'id',
      header: 'Prescription ID',
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
    { key: 'doctor', header: 'Doctor', cell: (row) => row.doctor, sortValue: (row) => row.doctor },
    {
      key: 'medicine',
      header: 'Medicine',
      cell: (row) => (
        <div className="min-w-0">
          {row.items.slice(0, 2).map((item) => (
            <p key={item.medicine} className="truncate text-[12.5px]">
              {item.medicine}
            </p>
          ))}
          {row.items.length > 2 && (
            <p className="text-[11.5px] text-muted-foreground">+{row.items.length - 2} more</p>
          )}
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Quantity',
      align: 'right',
      cell: (row) => <span className="num">{row.items.reduce((a, i) => a + i.quantity, 0)}</span>,
      sortValue: (row) => row.items.reduce((a, i) => a + i.quantity, 0),
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (row) => <Badge variant={row.priority === 'Urgent' ? 'danger' : 'default'}>{row.priority}</Badge>,
      sortValue: (row) => (row.priority === 'Urgent' ? 0 : 1),
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button
          size="sm"
          variant={row.status === 'Dispensed' ? 'outline' : 'default'}
          disabled={row.status === 'Dispensed'}
          onClick={(e) => {
            e.stopPropagation()
            dispense(row)
          }}
        >
          {row.status === 'Dispensed' ? (
            <>
              <Check />
              Done
            </>
          ) : (
            'Dispense'
          )}
        </Button>
      ),
    },
  ]

  const pending = prescriptions.filter((p) => p.status === 'Pending' || p.status === 'Partially Dispensed')
  const dispensed = prescriptions.filter((p) => p.status === 'Dispensed')

  return (
    <>
      <PageHeader
        title="Prescriptions"
        description="Dispense against live stock. Items that cannot be filled are flagged back to the prescriber."
        crumbs={[{ label: 'Pharmacist', to: '/pharmacist/dashboard' }, { label: 'Prescriptions' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="In the queue" value={pending.length} tone="warning" />
        <StatTile label="Urgent" value={pending.filter((p) => p.priority === 'Urgent').length} tone="danger" />
        <StatTile label="Dispensed today" value={dispensed.length} tone="success" />
        <StatTile
          label="Items to pick"
          value={pending.reduce((a, p) => a + p.items.reduce((s, i) => s + i.quantity, 0), 0)}
          tone="info"
        />
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="dispensed">Dispensed ({dispensed.length})</TabsTrigger>
          <TabsTrigger value="all">All ({prescriptions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <SectionCard title="Dispensing queue" description="Select a row to review before dispensing." icon={<PackageCheck />}>
            {loading ? (
              <LoadingState label="Loading the queue" className="border-0 shadow-none" />
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
              rows={pending}
              rowKey={(row) => row.id}
              onRowClick={setSelected}
              initialSort={{ key: 'priority', dir: 'asc' }}
              emptyTitle="Queue is clear"
              emptyDescription="Every prescription has been dispensed."
            />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="dispensed">
          <SectionCard title="Dispensed" description="Completed today.">
            <DataTable columns={columns} rows={dispensed} rowKey={(row) => row.id} onRowClick={setSelected} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="all">
          <SectionCard title="All prescriptions" description="Full list across statuses.">
            <DataTable columns={columns} rows={prescriptions} rowKey={(row) => row.id} onRowClick={setSelected} />
          </SectionCard>
        </TabsContent>
      </Tabs>

      <PrescriptionDetail
        prescription={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        footer={
          selected && (
            <>
              <Button variant="outline" onClick={() => setSelected(null)}>
                Close
              </Button>
              <Button
                disabled={selected.status === 'Dispensed'}
                loading={dispensing}
                onClick={() => void dispense(selected)}
              >
                <PackageCheck />
                Dispense prescription
              </Button>
            </>
          )
        }
      />
    </>
  )
}
