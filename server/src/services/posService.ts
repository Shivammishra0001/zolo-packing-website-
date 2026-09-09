/**
 * Pharmacy point of sale.
 *
 * No money is ever sent from here. The cart shows a running total for the
 * operator, but the till computes the authoritative subtotal, discount, GST and
 * grand total server-side from the batch it draws — so a tampered request
 * cannot discount itself.
 */

import type { PaymentMethod } from '@/types'
import { api } from '@/services/api'
import type { MedicineRecord } from '@/services/inventoryService'

export interface SaleItem {
  id: string
  medicineId: string | null
  medicine: string
  batchNumber: string
  quantity: number
  unitPrice: string
  lineTotal: string
}

export interface Sale {
  id: string
  uuid: string
  patientId: string | null
  patientName: string | null
  customerName: string | null
  soldBy: string
  items: SaleItem[]
  subtotal: string
  discountPercent: string
  discount: string
  taxPercent: string
  tax: string
  total: string
  paymentMethod: PaymentMethod
  createdAt: string
}

export interface SalePage {
  items: Sale[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface SalePayload {
  items: { medicineId: string; quantity: number }[]
  /** A percentage, matching the POS screen's discount control. */
  discountPercent?: number
  paymentMethod: PaymentMethod
  /** Omitted for a walk-in customer. */
  patientId?: string
  customerName?: string
}

/**
 * What the till can sell.
 *
 * Out-of-stock items come back too — the POS screen shows them and refuses to
 * add them, and hiding them would make a missing medicine look like a search
 * failure.
 */
export function listProducts(search?: string, limit = 100): Promise<MedicineRecord[]> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (search) query.set('search', search)
  return api.get<MedicineRecord[]>(`/api/pharmacy/pos/products?${query}`)
}

/** Ring up a sale. The sale, its lines and the stock deduction are atomic. */
export function createSale(payload: SalePayload): Promise<Sale> {
  return api.post<Sale>('/api/pharmacy/pos/sale', payload)
}

export async function listSales(
  params: { page?: number; limit?: number; dateFrom?: string; dateTo?: string } = {},
): Promise<SalePage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 50))
  if (params.dateFrom) query.set('date_from', params.dateFrom)
  if (params.dateTo) query.set('date_to', params.dateTo)

  const page = await api.get<{
    items: Sale[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/pharmacy/pos/sales?${query}`)

  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

/** One receipt, by UUID or `POS-####` code. */
export function getSale(identifier: string): Promise<Sale> {
  return api.get<Sale>(`/api/pharmacy/pos/sales/${encodeURIComponent(identifier)}`)
}
