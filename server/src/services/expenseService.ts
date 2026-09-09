/** Operating costs recorded against a branch. */

import type { Expense, PaymentMethod } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The API's expense row: the frontend `Expense` shape plus the branch it
 * belongs to and the free-text note the record can carry.
 */
export interface ExpenseRow extends Expense {
  uuid: string
  description: string | null
  branch: string | null
  branchId: string | null
}

interface ApiExpense {
  id: string
  uuid: string
  date: string
  vendor: string
  category: Expense['category']
  /** A money column, so it crosses the wire as a string. */
  amount: string
  method: PaymentMethod | null
  status: Expense['status']
  reference: string
  description: string | null
  branch: string | null
  branchId: string | null
}

export interface ExpensePage {
  items: ExpenseRow[]
  page: number
  limit: number
  total: number
  totalPages: number
}

interface ApiExpensePage {
  items: ApiExpense[]
  page: number
  limit: number
  total: number
  total_pages: number
}

function toExpense(row: ApiExpense): ExpenseRow {
  return {
    id: row.id,
    uuid: row.uuid,
    date: row.date,
    vendor: row.vendor,
    category: row.category,
    amount: Number(row.amount),
    // The frontend's `Expense.method` is required; the column is not, and a
    // cost with no recorded tender defaults to how the clinic pays its bills.
    method: row.method ?? 'Bank Transfer',
    status: row.status,
    reference: row.reference,
    description: row.description,
    branch: row.branch,
    branchId: row.branchId,
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface ExpenseListParams {
  page?: number
  limit?: number
  category?: Expense['category']
  status?: Expense['status']
  dateFrom?: string
  dateTo?: string
}

export async function listExpenses(params: ExpenseListParams = {}): Promise<ExpensePage> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.category) query.set('category', params.category)
  if (params.status) query.set('status', params.status)
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)

  const suffix = query.toString()
  const page = await api.get<ApiExpensePage>(`/api/expenses${suffix ? `?${suffix}` : ''}`)
  return {
    items: page.items.map(toExpense),
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export async function getExpense(identifier: string): Promise<ExpenseRow> {
  return toExpense(await api.get<ApiExpense>(`/api/expenses/${encodeURIComponent(identifier)}`))
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface ExpensePayload {
  vendor: string
  amount: number
  category?: Expense['category']
  date?: string
  method?: PaymentMethod
  reference?: string
  description?: string
  /** Defaults to the caller's own branch on the server. */
  branchId?: string
}

/**
 * Record a cost.
 *
 * One filed without a category lands in Pending Categorisation, which is what
 * the review queue on the expenses screen reads.
 */
export async function createExpense(payload: ExpensePayload): Promise<ExpenseRow> {
  return toExpense(await api.post<ApiExpense>('/api/expenses', payload))
}

export async function updateExpense(
  identifier: string,
  payload: Partial<ExpensePayload> & { status?: Expense['status'] },
): Promise<ExpenseRow> {
  return toExpense(
    await api.put<ApiExpense>(`/api/expenses/${encodeURIComponent(identifier)}`, payload),
  )
}

/** Give a bank-feed entry a category, which clears it out of the review queue. */
export function categoriseExpense(
  identifier: string,
  category: Expense['category'],
): Promise<ExpenseRow> {
  return updateExpense(identifier, { category })
}
