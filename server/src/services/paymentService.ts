/** Money received against invoices. */

import type { PaymentMethod, PaymentRecord } from '@/types'
import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The API's payment row: the frontend `PaymentRecord` shape plus the ids the
 * till needs to open the invoice or the patient behind a line.
 */
export interface PaymentRow extends PaymentRecord {
  uuid: string
  invoiceUuid: string
  patientId: string
  reference: string | null
}

interface ApiPayment {
  id: string
  uuid: string
  invoiceId: string
  invoiceUuid: string
  patientId: string
  patientName: string
  /** A money column, so it crosses the wire as a string. */
  amount: string
  method: PaymentMethod
  date: string
  collectedBy: string
  status: PaymentRecord['status']
  reference: string | null
}

export interface PaymentPage {
  items: PaymentRow[]
  page: number
  limit: number
  total: number
  totalPages: number
}

interface ApiPaymentPage {
  items: ApiPayment[]
  page: number
  limit: number
  total: number
  total_pages: number
}

function toPayment(row: ApiPayment): PaymentRow {
  return {
    id: row.id,
    uuid: row.uuid,
    invoiceId: row.invoiceId,
    invoiceUuid: row.invoiceUuid,
    patientId: row.patientId,
    patientName: row.patientName,
    amount: Number(row.amount),
    method: row.method,
    date: row.date,
    collectedBy: row.collectedBy,
    status: row.status,
    reference: row.reference,
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface PaymentListParams {
  page?: number
  limit?: number
  /** Invoice UUID or `INV-YYYY-####` code. */
  invoice?: string
  /** Patient UUID or `PT-#####` code. */
  patient?: string
  method?: PaymentMethod
  status?: PaymentRecord['status']
  dateFrom?: string
  dateTo?: string
}

export async function listPayments(params: PaymentListParams = {}): Promise<PaymentPage> {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.invoice) query.set('invoice', params.invoice)
  if (params.patient) query.set('patient', params.patient)
  if (params.method) query.set('method', params.method)
  if (params.status) query.set('status', params.status)
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)

  const suffix = query.toString()
  const page = await api.get<ApiPaymentPage>(`/api/payments${suffix ? `?${suffix}` : ''}`)
  return {
    items: page.items.map(toPayment),
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export async function getPayment(identifier: string): Promise<PaymentRow> {
  return toPayment(await api.get<ApiPayment>(`/api/payments/${encodeURIComponent(identifier)}`))
}

/** Everything collected against one invoice. */
export async function paymentsForInvoice(invoice: string): Promise<PaymentRow[]> {
  const page = await api.get<ApiPaymentPage>(
    `/api/invoices/${encodeURIComponent(invoice)}/payments?limit=100`,
  )
  return page.items.map(toPayment)
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface PaymentPayload {
  amount: number
  method: PaymentMethod
  /** A UPI, card or bank reference. Never card numbers. */
  reference?: string
  /** Bank transfers clear later, so the till may take one as Processing. */
  status?: PaymentRecord['status']
  date?: string
}

/**
 * Record money against an invoice.
 *
 * The collector, the timestamp and the invoice's resulting status are all the
 * server's. An amount larger than the outstanding balance is refused with a
 * 409 rather than quietly over-collecting.
 */
export async function recordPayment(
  invoice: string,
  payload: PaymentPayload,
): Promise<PaymentRow> {
  return toPayment(
    await api.post<ApiPayment>(`/api/invoices/${encodeURIComponent(invoice)}/payments`, payload),
  )
}

/**
 * Settle or fail a payment that was taken as Processing.
 *
 * The amount cannot be edited: a wrong figure is corrected by failing this one
 * and taking another, so the ledger keeps both facts.
 */
export async function setPaymentStatus(
  identifier: string,
  status: PaymentRecord['status'],
): Promise<PaymentRow> {
  return toPayment(
    await api.patch<ApiPayment>(`/api/payments/${encodeURIComponent(identifier)}/status`, {
      status,
    }),
  )
}
