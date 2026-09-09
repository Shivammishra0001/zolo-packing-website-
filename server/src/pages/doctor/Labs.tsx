import * as React from 'react'
import { Link } from 'react-router-dom'
import { Check, FlaskConical } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { ErrorState, LoadingState } from '@/components/ui/query-state'
import { useQuery } from '@/hooks/useApi'
import { listLabs, reviewLab, type LabResult } from '@/services/labService'
import { formatDate } from '@/lib/utils'

const FLAG_TONE = { Normal: 'success', Abnormal: 'warning', Critical: 'danger' } as const

export default function DoctorLabs() {
  const toast = useToast()
  const [selected, setSelected] = React.useState<LabResult | null>(null)
  const [reviewing, setReviewing] = React.useState(false)

  const { data, loading, error, refetch } = useQuery(() => listLabs({ limit: 200 }), [])
  const results = data?.items ?? []

  async function markReviewed(result: LabResult) {
    setReviewing(true)
    try {
      // The sign-off is attributed server-side to the authenticated doctor —
      // nothing about who reviewed it is sent from here.
      const signed = await reviewLab(result.uuid)
      setSelected(null)
      refetch()
      toast.success(
        'Marked as reviewed',
        `${signed.test} for ${signed.patientName} is signed off by ${signed.reviewedBy}.`,
      )
    } catch (err) {
      toast.error('Could not sign off', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setReviewing(false)
    }
  }

  const columns: Column<LabResult>[] = [
    {
      key: 'test',
      header: 'Test',
      primary: true,
      cell: (row) => (
        <div>
          <p className="font-medium">{row.test}</p>
          <p className="num text-[12px] text-muted-foreground">{row.id}</p>
        </div>
      ),
      sortValue: (row) => row.test,
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
      key: 'reportedOn',
      header: 'Reported',
      cell: (row) => formatDate(row.reportedOn),
      sortValue: (row) => row.reportedOn,
    },
    {
      key: 'flag',
      header: 'Result',
      meta: true,
      cell: (row) => (
        <Badge variant={FLAG_TONE[row.flag]} dot pulse={row.flag === 'Critical'}>
          {row.flag}
        </Badge>
      ),
      sortValue: (row) => row.flag,
    },
    {
      key: 'reviewed',
      header: 'Review',
      align: 'right',
      cell: (row) =>
        row.reviewed ? (
          <Badge variant="success">
            <Check className="size-3" />
            Reviewed
          </Badge>
        ) : (
          <Badge variant="warning">Awaiting review</Badge>
        ),
      sortValue: (row) => (row.reviewed ? 1 : 0),
    },
  ]

  const pending = results.filter((r) => !r.reviewed)

  return (
    <>
      <PageHeader
        title="Lab results"
        description="Reports released by the laboratory, waiting on your clinical review."
        crumbs={[{ label: 'Doctor', to: '/doctor/dashboard' }, { label: 'Lab Results' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Awaiting review" value={loading ? '—' : pending.length} tone="warning" />
        <StatTile
          label="Critical flags"
          value={loading ? '—' : results.filter((r) => r.flag === 'Critical').length}
          tone="danger"
        />
        <StatTile
          label="Abnormal"
          value={loading ? '—' : results.filter((r) => r.flag === 'Abnormal').length}
          tone="info"
        />
        <StatTile
          label="Reviewed"
          value={loading ? '—' : results.filter((r) => r.reviewed).length}
          tone="success"
        />
      </div>

      <SectionCard
        title="Released reports"
        description="Select a report to see the full analyte breakdown."
        icon={<FlaskConical />}
      >
        {loading ? (
          <LoadingState label="Loading released reports" className="border-0 shadow-none" />
        ) : error ? (
          <ErrorState
            title="Could not load lab results"
            message={error}
            onRetry={refetch}
            className="border-0 shadow-none"
          />
        ) : (
          <DataTable
            columns={columns}
            rows={results}
            rowKey={(row) => row.id}
            onRowClick={setSelected}
            initialSort={{ key: 'reportedOn', dir: 'desc' }}
            rowClassName={(row) => (row.flag === 'Critical' && !row.reviewed ? 'bg-destructive/[0.035]' : '')}
            emptyTitle="No reports released"
            emptyDescription="Reports appear here as the laboratory releases them."
          />
        )}
      </SectionCard>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent size="lg">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>{selected.test}</DialogTitle>
                  <Badge variant={FLAG_TONE[selected.flag]}>{selected.flag}</Badge>
                </div>
                <DialogDescription>
                  {selected.patientName} · {selected.patientId} · reported {formatDate(selected.reportedOn)}
                  {selected.reviewed && selected.reviewedBy && ` · reviewed by ${selected.reviewedBy}`}
                </DialogDescription>
              </DialogHeader>

              <p className="rounded-lg bg-muted/55 px-3.5 py-3 text-[13px] leading-relaxed">{selected.summary}</p>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/45">
                    <tr>
                      {['Analyte', 'Result', 'Reference range'].map((h) => (
                        <th
                          key={h}
                          className="px-3.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.values.map((v) => (
                      <tr key={v.analyte} className="border-t border-border">
                        <td className="px-3.5 py-2.5 text-[13px]">{v.analyte}</td>
                        <td
                          className={`num px-3.5 py-2.5 text-[13px] font-semibold ${
                            v.abnormal ? 'text-destructive' : ''
                          }`}
                        >
                          {v.value}
                        </td>
                        <td className="num px-3.5 py-2.5 text-[12.5px] text-muted-foreground">{v.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <DialogFooter>
                <Button variant="outline" asChild>
                  <Link to={`/patients/${selected.patientId}`}>Open Patient 360</Link>
                </Button>
                <Button
                  onClick={() => void markReviewed(selected)}
                  disabled={selected.reviewed}
                  loading={reviewing}
                >
                  <Check />
                  {selected.reviewed ? 'Already reviewed' : 'Mark as reviewed'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
