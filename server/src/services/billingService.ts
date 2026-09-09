/**
 * The finance dashboard and the reports behind it.
 *
 * Every figure here is aggregated in PostgreSQL. Revenue is *collected* money —
 * settled payments plus pharmacy counter takings, each counted once — not
 * invoice totals, because an unpaid bill is a claim on the future rather than
 * income.
 */

import type { Expense, Invoice, PaymentMethod } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface MethodTotal {
  method: PaymentMethod
  amount: number
}

export interface CategoryTotal {
  category: Expense['category']
  amount: number
}

export interface MonthTotal {
  /** The chart's own label, e.g. "Aug 26". */
  month: string
  revenue: number
  expenses: number
  profit: number
}

export interface DepartmentTotal {
  department: Invoice['department']
  revenue: number
  share: number
}

export interface AgeingBucket {
  bucket: string
  amount: number
  count: number
}

export interface BillingDashboard {
  todayRevenue: number
  todayPaymentCount: number
  monthlyRevenue: number
  totalExpenses: number
  /** Collections minus costs. Negative when that is the truth. */
  netRevenue: number
  outstandingAmount: number
  outstandingInvoices: number
  paidInvoices: number
  pendingInvoices: number
  overdueInvoices: number
  failedPayments: number
  failedAmount: number
  pendingExpenses: number
  pendingExpenseAmount: number
  paymentBreakdown: MethodTotal[]
}

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

/** Money crosses the wire as a string, so no float ever rounds a rupee. */
type Money = string

interface ApiDashboard {
  todayRevenue: Money
  todayPaymentCount: number
  monthlyRevenue: Money
  totalExpenses: Money
  netRevenue: Money
  outstandingAmount: Money
  outstandingInvoices: number
  paidInvoices: number
  pendingInvoices: number
  overdueInvoices: number
  failedPayments: number
  failedAmount: Money
  pendingExpenses: number
  pendingExpenseAmount: Money
  paymentBreakdown: { method: PaymentMethod; amount: Money }[]
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getDashboard(): Promise<BillingDashboard> {
  const body = await api.get<ApiDashboard>('/api/billing/dashboard')
  return {
    todayRevenue: Number(body.todayRevenue),
    todayPaymentCount: body.todayPaymentCount,
    monthlyRevenue: Number(body.monthlyRevenue),
    totalExpenses: Number(body.totalExpenses),
    netRevenue: Number(body.netRevenue),
    outstandingAmount: Number(body.outstandingAmount),
    outstandingInvoices: body.outstandingInvoices,
    paidInvoices: body.paidInvoices,
    pendingInvoices: body.pendingInvoices,
    overdueInvoices: body.overdueInvoices,
    failedPayments: body.failedPayments,
    failedAmount: Number(body.failedAmount),
    pendingExpenses: body.pendingExpenses,
    pendingExpenseAmount: Number(body.pendingExpenseAmount),
    paymentBreakdown: body.paymentBreakdown.map((slice) => ({
      method: slice.method,
      amount: Number(slice.amount),
    })),
  }
}

/** Outstanding money split by how long it has been overdue. */
export async function getAgeing(): Promise<AgeingBucket[]> {
  const rows = await api.get<{ bucket: string; amount: Money; count: number }[]>(
    '/api/billing/ageing',
  )
  return rows.map((row) => ({
    bucket: row.bucket,
    amount: Number(row.amount),
    count: row.count,
  }))
}

/** The profit-and-loss series. A quiet month is a zero column, not a gap. */
export async function getRevenueReport(months = 6): Promise<MonthTotal[]> {
  const rows = await api.get<{ month: string; revenue: Money; expenses: Money; profit: Money }[]>(
    `/api/billing/reports/revenue?months=${months}`,
  )
  return rows.map((row) => ({
    month: row.month,
    revenue: Number(row.revenue),
    expenses: Number(row.expenses),
    profit: Number(row.profit),
  }))
}

export async function getExpenseReport(months = 1): Promise<CategoryTotal[]> {
  const rows = await api.get<{ category: Expense['category']; amount: Money }[]>(
    `/api/billing/reports/expenses?months=${months}`,
  )
  return rows.map((row) => ({ category: row.category, amount: Number(row.amount) }))
}

export async function getDepartmentReport(months = 1): Promise<DepartmentTotal[]> {
  const rows = await api.get<
    { department: Invoice['department']; revenue: Money; share: number }[]
  >(`/api/billing/reports/departments?months=${months}`)
  return rows.map((row) => ({
    department: row.department,
    revenue: Number(row.revenue),
    share: row.share,
  }))
}
