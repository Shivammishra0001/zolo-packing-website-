/** Pharmacy dashboard and prescription dispensing. */

import type { Prescription } from '@/types'
import { api } from '@/services/api'

/** Every figure the pharmacy dashboard shows, counted in PostgreSQL. */
export interface PharmacyDashboard {
  pendingPrescriptions: number
  dispensedToday: number
  itemsDispensedToday: number

  salesToday: string
  ordersToday: number
  averageOrderValue: string
  /** Yesterday's figures, so the cards' "vs yesterday" deltas are real. */
  salesYesterday: string
  ordersYesterday: number

  lowStock: number
  outOfStock: number
  nearExpiry: number
  inStock: number

  /**
   * Both valuations. The API returns each rather than guessing which the card
   * means — at cost is what the stock was bought for, at retail what it would
   * sell for.
   */
  inventoryValueAtCost: string
  inventoryValueAtRetail: string

  salesTrend: { day: string; sales: string; orders: number }[]
}

export function getDashboard(): Promise<PharmacyDashboard> {
  return api.get<PharmacyDashboard>('/api/pharmacy/dashboard')
}

/* -------------------------------------------------------------------------- */
/* Dispensing                                                                 */
/* -------------------------------------------------------------------------- */

/** Where one unit of stock actually went — the audit trail. */
export interface DispenseRecord {
  id: string
  medicine: string
  batchNumber: string
  quantity: number
  dispensedBy: string
  dispensedAt: string
}

export interface DispenseResult {
  prescriptionId: string
  status: Prescription['status']
  records: DispenseRecord[]
}

export interface DispenseLine {
  prescriptionItemId: string
  quantity: number
}

/**
 * Issue a prescription's medicines.
 *
 * Only item ids and quantities are sent. Which batches satisfy them, in what
 * order and at what price is decided server-side — the whole thing runs in one
 * transaction, so stock never moves without the prescription knowing.
 */
export function dispense(identifier: string, items: DispenseLine[]): Promise<DispenseResult> {
  return api.post<DispenseResult>(
    `/api/prescriptions/${encodeURIComponent(identifier)}/dispense`,
    { items },
  )
}
