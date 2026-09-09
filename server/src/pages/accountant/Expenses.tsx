import * as React from 'react'
import { Check, Plus } from 'lucide-react'
import type { Expense } from '@/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard, StatTile } from '@/components/dashboard/SectionCard'
import { DataTable, type Column } from '@/components/ui/data-table'
import { DonutChart } from '@/components/charts/DonutChart'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status'
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
import { getDashboard, getExpenseReport } from '@/services/billingService'
import {
  categoriseExpense,
  createExpense,
  listExpenses,
  type ExpenseRow,
} from '@/services/expenseService'
import { formatDate, inr, sum } from '@/lib/utils'

const CATEGORIES: Expense['category'][] = [
  'Salaries',
  'Pharmacy Purchase',
  'Equipment',
  'Utilities',
  'Maintenance',
  'Marketing',
  'Uncategorised',
]

export default function AccountantExpenses() {
  const toast = useToast()
  const [categorising, setCategorising] = React.useState<ExpenseRow | null>(null)
  const [newCategory, setNewCategory] = React.useState<Expense['category']>('Uncategorised')
  const [addOpen, setAddOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [draft, setDraft] = React.useState({ vendor: '', amount: '', category: 'Utilities' as Expense['category'], reference: '' })

  const { data, loading, error, refetch } = useQuery(() => listExpenses({ limit: 100 }), [])
  // Both the month total and the category split are aggregated in SQL, so the
  // figures do not shift with however many rows this page happens to hold.
  const { data: summary, refetch: refetchSummary } = useQuery(() => getDashboard(), [])
  const { data: byCategory, refetch: refetchCategories } = useQuery(() => getExpenseReport(), [])

  const expenses = data?.items ?? []
  const categories = byCategory ?? []
  const pending = expenses.filter((e) => e.status === 'Pending Categorisation')

  function reload() {
    refetch()
    refetchSummary()
    refetchCategories()
  }

  async function applyCategory() {
    if (!categorising) return
    try {
      await categoriseExpense(categorising.id, newCategory)
      toast.success('Expense categorised', `${categorising.vendor} recorded under ${newCategory}.`)
      setCategorising(null)
      reload()
    } catch (err) {
      toast.error('Could not categorise that', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const created = await createExpense({
        vendor: draft.vendor,
        amount: Number(draft.amount),
        category: draft.category,
        reference: draft.reference || undefined,
      })
      setAddOpen(false)
      setDraft({ vendor: '', amount: '', category: 'Utilities', reference: '' })
      toast.success('Expense recorded', `${created.vendor} — ${inr(created.amount)}.`)
      reload()
    } catch (err) {
      toast.error('Could not record that expense', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const columns: Column<ExpenseRow>[] = [
    {
      key: 'vendor',
      header: 'Vendor',
      primary: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.vendor}</p>
          <p className="num truncate text-[11.5px] text-muted-foreground">{row.reference}</p>
        </div>
      ),
      sortValue: (row) => row.vendor,
    },
    {
      key: 'category',
      header: 'Category',
      cell: (row) => (
        <Badge variant={row.category === 'Uncategorised' ? 'warning' : 'default'}>{row.category}</Badge>
      ),
      sortValue: (row) => row.category,
    },
    { key: 'date', header: 'Date', cell: (row) => formatDate(row.date), sortValue: (row) => row.date },
    { key: 'method', header: 'Method', cell: (row) => row.method, sortValue: (row) => row.method },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (row) => <span className="num font-semibold">{inr(row.amount)}</span>,
      sortValue: (row) => row.amount,
    },
    { key: 'status', header: 'Status', meta: true, cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'action',
      header: '',
      align: 'right',
      cell: (row) =>
        row.status === 'Pending Categorisation' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              setCategorising(row)
              setNewCategory(row.category)
            }}
          >
            Categorise
          </Button>
        ) : (
          <Check className="ml-auto size-4 text-success" />
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Recorded spend this month, and anything still waiting to be categorised."
        crumbs={[{ label: 'Accountant', to: '/accountant/dashboard' }, { label: 'Expenses' }]}
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus />
            Record expense
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total this month" value={inr(summary?.totalExpenses ?? 0, { compact: true })} />
        <StatTile
          label="Pending categorisation"
          value={summary?.pendingExpenses ?? 0}
          tone={summary?.pendingExpenses ? 'warning' : 'success'}
          hint={summary?.pendingExpenses ? inr(summary.pendingExpenseAmount) : 'All clear'}
        />
        <StatTile
          label="Approved"
          value={expenses.filter((e) => e.status === 'Approved').length}
          tone="success"
        />
        <StatTile
          label="Largest category"
          value={categories[0]?.category ?? '—'}
          hint={categories.length ? inr(categories[0].amount, { compact: true }) : 'Nothing recorded'}
          tone="info"
        />
      </div>

      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <SectionCard title="Spend by category" description="Month to date." delay={0.05}>
          <DonutChart
            data={categories.map((e) => ({ label: e.category, value: e.amount }))}
            format={(v) => inr(v, { compact: true })}
            centerValue={inr(sum(categories, (e) => e.amount), { compact: true })}
            centerLabel="Total"
            height={190}
            className="sm:flex-col sm:items-stretch"
          />
        </SectionCard>

        <SectionCard
          title="Pending categorisation"
          description="These are excluded from the profit figure until reviewed."
          className="xl:col-span-2"
          delay={0.1}
        >
          {pending.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Check className="mb-2 size-8 text-success" />
              <p className="text-sm font-semibold">Everything is categorised</p>
              <p className="mt-1 text-[13px] text-muted-foreground">No expense is waiting on review.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {pending.map((expense) => (
                <li
                  key={expense.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/[0.05] px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{expense.vendor}</p>
                    <p className="num truncate text-[11.5px] text-muted-foreground">
                      {expense.reference} · {formatDate(expense.date)} · {expense.method}
                    </p>
                  </div>
                  <span className="num shrink-0 text-[14px] font-bold">{inr(expense.amount)}</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      setCategorising(expense)
                      setNewCategory(expense.category)
                    }}
                  >
                    Categorise
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="All expenses" description="Every entry recorded this month.">
        {error ? (
          <ErrorState message={error} title="Could not load expenses" onRetry={refetch} />
        ) : loading ? (
          <LoadingState label="Loading expenses" />
        ) : (
          <DataTable
            columns={columns}
            rows={expenses}
            rowKey={(row) => row.id}
            initialSort={{ key: 'date', dir: 'desc' }}
            rowClassName={(row) => (row.status === 'Pending Categorisation' ? 'bg-warning/[0.04]' : '')}
            emptyTitle="No expenses recorded"
            emptyDescription="Costs filed against this branch appear here."
          />
        )}
      </SectionCard>

      {/* --------------------------- Categorise dialog --------------------------- */}
      <Dialog open={categorising !== null} onOpenChange={(open) => !open && setCategorising(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Categorise expense</DialogTitle>
            <DialogDescription>
              {categorising?.vendor} · {categorising ? inr(categorising.amount) : ''} · {categorising?.reference}
            </DialogDescription>
          </DialogHeader>

          <Field label="Category" required>
            <Select value={newCategory} onValueChange={(v) => setNewCategory(v as Expense['category'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCategorising(null)}>
              Cancel
            </Button>
            <Button onClick={applyCategory} disabled={newCategory === 'Uncategorised'}>
              Approve and categorise
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------- Add expense ------------------------------ */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record an expense</DialogTitle>
            <DialogDescription>Manual entries are marked as recorded and appear in this month's total.</DialogDescription>
          </DialogHeader>

          <form onSubmit={addExpense} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vendor" htmlFor="vendor" required>
                <Input
                  id="vendor"
                  required
                  value={draft.vendor}
                  onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))}
                  placeholder="MedSupply Distributors"
                />
              </Field>
              <Field label="Amount" htmlFor="amount" required>
                <Input
                  id="amount"
                  type="number"
                  required
                  min={1}
                  value={draft.amount}
                  onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                  placeholder="25000"
                />
              </Field>
              <Field label="Category">
                <Select
                  value={draft.category}
                  onValueChange={(v) => setDraft((d) => ({ ...d, category: v as Expense['category'] }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter((c) => c !== 'Uncategorised').map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Reference" htmlFor="reference">
                <Input
                  id="reference"
                  value={draft.reference}
                  onChange={(e) => setDraft((d) => ({ ...d, reference: e.target.value }))}
                  placeholder="PO-2026-0000"
                />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Record expense
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
