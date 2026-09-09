import * as React from 'react'
import { Link } from 'react-router-dom'
import { Plus, Printer } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { StatusBadge } from '@/components/ui/status'
import { Separator } from '@/components/ui/misc'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { createInvoice, listInvoices, type InvoiceRecord } from '@/services/invoiceService'
import { recordPayment } from '@/services/paymentService'
import { listPatients } from '@/services/patientService'
import { useAuth } from '@/context/AuthContext'
import { daysFromToday, formatDate, inr, sum } from '@/lib/utils'

/** How overdue a bill is, from its due date. Zero until the date passes. */
function daysOverdue(invoice: InvoiceRecord) {
  const diff = daysFromToday(invoice.dueDate)
  return diff < 0 ? Math.abs(diff) : 0
}

/** The balance is the server's figure, not one recomputed here. */
function outstandingOf(invoice: InvoiceRecord) {
  return invoice.balance
}

export default function Invoices() {
  const toast = useToast()
  const { has } = useAuth()
  const [selected, setSelected] = React.useState<InvoiceRecord | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [collecting, setCollecting] = React.useState(false)
  const [draft, setDraft] = React.useState({ patientId: '', department: 'OPD', label: '', amount: '' })

  const { data, loading, error, refetch } = useQuery(() => listInvoices({ limit: 100 }), [])
  const { data: patientPage } = useQuery(() => listPatients({ limit: 100 }), [])

  const invoices = data?.items ?? []
  const patients = patientPage?.items ?? []

  const columns: Column<InvoiceRecord>[] = [
    {
      key: 'id',
      header: 'Invoice',
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
    { key: 'department', header: 'Department', cell: (row) => row.department, sortValue: (row) => row.department },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (row) => <span className="num font-semibold">{inr(row.amount)}</span>,
      sortValue: (row) => row.amount,
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      cell: (row) => (
        <span className={`num ${outstandingOf(row) > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
          {outstandingOf(row) > 0 ? inr(outstandingOf(row)) : '—'}
        </span>
      ),
      sortValue: (row) => outstandingOf(row),
    },
    {
      key: 'due',
      header: 'Due date',
      cell: (row) => (
        <div>
          <p className="text-[13px]">{formatDate(row.dueDate)}</p>
          {daysOverdue(row) > 0 && (
            <p className="text-[11.5px] font-medium text-destructive">{daysOverdue(row)} days overdue</p>
          )}
        </div>
      ),
      sortValue: (row) => row.dueDate,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
  ]

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.patientId || !draft.label || !draft.amount) {
      toast.error('Incomplete invoice', 'Select a patient and enter a line item with an amount.')
      return
    }

    setSaving(true)
    try {
      // No total is sent: the server computes it from the line, and the invoice
      // number is allocated there too.
      const created = await createInvoice({
        patientId: draft.patientId,
        department: draft.department as InvoiceRecord['department'],
        items: [{ label: draft.label, qty: 1, rate: Number(draft.amount) }],
      })
      setCreateOpen(false)
      setDraft({ patientId: '', department: 'OPD', label: '', amount: '' })
      toast.success('Invoice created', `${created.id} for ${created.patientName} — ${inr(created.amount)}.`)
      refetch()
    } catch (err) {
      toast.error('Could not create that invoice', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function collect(invoice: InvoiceRecord) {
    setCollecting(true)
    try {
      const balance = outstandingOf(invoice)
      await recordPayment(invoice.id, { amount: balance, method: 'Cash' })
      setSelected(null)
      toast.success('Payment recorded', `${inr(balance)} collected for ${invoice.id}.`)
      refetch()
    } catch (err) {
      toast.error('Could not record that payment', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setCollecting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every invoice raised across OPD, IPD, therapy and pharmacy."
        crumbs={[{ label: 'Billing', to: '/billing/invoices' }, { label: 'Invoices' }]}
        actions={
          has('billing.manage') && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Create invoice
            </Button>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Invoices" value={invoices.length} />
        <StatTile label="Total billed" value={inr(sum(invoices, (i) => i.amount), { compact: true })} tone="info" />
        <StatTile label="Collected" value={inr(sum(invoices, (i) => i.paid), { compact: true })} tone="success" />
        <StatTile
          label="Outstanding"
          value={inr(sum(invoices, outstandingOf), { compact: true })}
          tone="danger"
          hint={`${invoices.filter((i) => outstandingOf(i) > 0).length} open`}
        />
      </div>

      <SectionCard title="Invoice register" description="Select an invoice to see the line items.">
        {error ? (
          <ErrorState message={error} title="Could not load invoices" onRetry={refetch} />
        ) : loading ? (
          <LoadingState label="Loading invoices" />
        ) : (
          <DataTable
            columns={columns}
            rows={invoices}
            rowKey={(row) => row.id}
            onRowClick={setSelected}
            initialSort={{ key: 'due', dir: 'desc' }}
            rowClassName={(row) => (daysOverdue(row) >= 15 ? 'bg-destructive/[0.035]' : '')}
            emptyTitle="No invoices yet"
            emptyDescription="Bills raised at the desk or on discharge appear here."
          />
        )}
      </SectionCard>

      {/* ---------------------------- Invoice detail ---------------------------- */}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent size="lg">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="num">{selected.id}</DialogTitle>
                  <StatusBadge status={selected.status} />
                </div>
                <DialogDescription>
                  <Link to={`/patients/${selected.patientId}`} className="font-medium text-accent hover:underline">
                    {selected.patientName}
                  </Link>{' '}
                  · {selected.department} · raised {formatDate(selected.date)} · due {formatDate(selected.dueDate)}
                </DialogDescription>
              </DialogHeader>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/45">
                    <tr>
                      {['Item', 'Qty', 'Rate', 'Amount'].map((h, i) => (
                        <th
                          key={h}
                          className={`px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ${
                            i === 0 ? 'text-left' : 'text-right'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((item) => (
                      <tr key={item.label} className="border-t border-border">
                        <td className="px-3.5 py-2.5 text-[13px]">{item.label}</td>
                        <td className="num px-3.5 py-2.5 text-right text-[13px]">{item.qty}</td>
                        <td className="num px-3.5 py-2.5 text-right text-[13px]">{inr(item.rate)}</td>
                        <td className="num px-3.5 py-2.5 text-right text-[13px] font-medium">
                          {inr(item.qty * item.rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1.5 rounded-lg bg-muted/50 px-4 py-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice total</span>
                  <span className="num font-medium">{inr(selected.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid{selected.method ? ` (${selected.method})` : ''}</span>
                  <span className="num text-success">{inr(selected.paid)}</span>
                </div>
                <Separator className="my-2" />
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">Balance due</span>
                  <span
                    className={`num text-lg font-bold ${outstandingOf(selected) > 0 ? 'text-destructive' : 'text-success'}`}
                  >
                    {inr(outstandingOf(selected))}
                  </span>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => toast.success('Invoice sent to printer')}>
                  <Printer />
                  Print
                </Button>
                {has('billing.manage') && outstandingOf(selected) > 0 && (
                  <Button loading={collecting} onClick={() => collect(selected)}>
                    Record full payment
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------------------------- Create invoice ---------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create an invoice</DialogTitle>
            <DialogDescription>A single line item now; more can be added before it is finalised.</DialogDescription>
          </DialogHeader>

          <form onSubmit={create} className="space-y-4">
            <Field label="Patient" required>
              <Select value={draft.patientId} onValueChange={(v) => setDraft((d) => ({ ...d, patientId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a patient" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {p.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department">
                <Select value={draft.department} onValueChange={(v) => setDraft((d) => ({ ...d, department: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['OPD', 'IPD', 'Therapy', 'Pharmacy', 'Diagnostics'].map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Amount" htmlFor="inv-amount" required>
                <Input
                  id="inv-amount"
                  type="number"
                  min={1}
                  value={draft.amount}
                  onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                  placeholder="9600"
                />
              </Field>
            </div>

            <Field label="Line item" htmlFor="inv-label" required>
              <Input
                id="inv-label"
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Consultation — Dr. Arjun Sharma"
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Create invoice
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
