/** Invoices and their line items. */

import type { Invoice, PaymentMethod } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The API's invoice row: the frontend `Invoice` shape plus the ids and derived
 * figures the screens would otherwise have to work out for themselves.
 *
 * `balance`, `paid` and `status` are all the server's. In particular `paid` is
 * the sum of *settled* payments — a bank transfer still clearing has not paid
 * anything — so nothing here is recomputed in React.
 */
export interface InvoiceRecord extends Invoice {
  uuid: string
  patientUuid: string
  balance: number
  subtotal: number
  discount: number
  tax: number
  branch: string | null
  itemsDetailed: InvoiceLine[]
}

export interface InvoiceLine {
  id: string
  label: string
  qty: number
  rate: number
  amount: number
}

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

interface ApiInvoiceLine {
  id: string
  label: string
  /** Money columns cross the wire as strings, so no float rounds a rupee. */
  qty: number
  rate: string
  amount: string
}

interface ApiInvoice {
  id: string
  uuid: string
  patientId: string
  patientUuid: string
  patientName: string
  date: string
  dueDate: string | null
  amount: string
  paid: string
  balance: string
  subtotal: string
  discount: string
  tax: string
  status: Invoice['status']
  department: Invoice['department']
  items: ApiInvoiceLine[]
  method: PaymentMethod | null
  branch: string | null
}

export interface InvoicePage {
  items: InvoiceRecord[]
  page: number
  limit: number
  total: number
  totalPages: number
}

interface ApiInvoicePage {
  items: ApiInvoice[]
  page: number
  limit: number
  total: number
  total_pages: number
}

function toInvoice(row: ApiInvoice): InvoiceRecord {
  const lines = row.items.map((item) => ({
    id: item.id,
    label: item.label,
    qty: item.qty,
    rate: Number(item.rate),
    amount: Number(item.amount),
  }))

  return {
    id: row.id,
    uuid: row.uuid,
    patientId: row.patientId,
    patientUuid: row.patientUuid,
    patientName: row.patientName,
    date: row.date,
    dueDate: row.dueDate ?? row.date,
    amount: Number(row.amount),
    paid: Number(row.paid),
    balance: Number(row.balance),
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    tax: Number(row.tax),
    status: row.status,
    department: row.department,
    // The existing `Invoice.items` shape, so the detail dialog is untouched.
    items: lines.map(({ label, qty, rate }) => ({ label, qty, rate })),
    itemsDetailed: lines,
    method: row.method ?? undefined,
    branch: row.branch,
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface InvoiceListParams {
  page?: number
  limit?: number
  /** Patient UUID or `PT-#####` code. */
  patient?: string
  status?: Invoice['status']
  department?: Invoice['department']
  /** Only bills with money still on them. */
  outstanding?: boolean
  dateFrom?: string
  dateTo?: string
  search?: string
}

export async function listInvoices(params: InvoiceListParams = {}): Promise<InvoicePage> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.patient) query.set('patient', params.patient)
  if (params.status) query.set('status', params.status)
  if (params.department) query.set('department', params.department)
  if (params.outstanding) query.set('outstanding', 'true')
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)
  if (params.search) query.set('search', params.search)

  const suffix = query.toString()
  const page = await api.get<ApiInvoicePage>(`/api/invoices${suffix ? `?${suffix}` : ''}`)
  return {
    items: page.items.map(toInvoice),
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export async function getInvoice(identifier: string): Promise<InvoiceRecord> {
  return toInvoice(await api.get<ApiInvoice>(`/api/invoices/${encodeURIComponent(identifier)}`))
}

/** The billing tab on a patient record. */
export async function invoicesForPatient(patient: string): Promise<InvoiceRecord[]> {
  const rows = await api.get<ApiInvoice[]>(
    `/api/patients/${encodeURIComponent(patient)}/invoices`,
  )
  return rows.map(toInvoice)
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface InvoiceLinePayload {
  label: string
  qty: number
  rate: number
}

export interface InvoicePayload {
  /** Patient UUID or `PT-#####` code. */
  patientId: string
  department?: Invoice['department']
  items: InvoiceLinePayload[]
  date?: string
  dueDate?: string
  discount?: number
  tax?: number
}

/**
 * Raise an invoice.
 *
 * No total is sent: the server computes every figure from the lines. There is
 * deliberately no field for one.
 */
export async function createInvoice(payload: InvoicePayload): Promise<InvoiceRecord> {
  return toInvoice(await api.post<ApiInvoice>('/api/invoices', payload))
}

/**
 * Amend an invoice.
 *
 * Status is not settable — it follows from the payments recorded against the
 * bill — and one with money already collected cannot be re-costed.
 */
export async function updateInvoice(
  identifier: string,
  payload: Partial<Omit<InvoicePayload, 'patientId'>>,
): Promise<InvoiceRecord> {
  return toInvoice(
    await api.put<ApiInvoice>(`/api/invoices/${encodeURIComponent(identifier)}`, payload),
  )
}
