/**
 * Medicine catalogue, batch stock and inventory alerts.
 *
 * The API aggregates batches into the flat `Medicine` shape the screens
 * already read, so nothing here has to understand the batch structure — except
 * the medicine-detail view, which asks for it explicitly.
 */

import type { Medicine, StockStatus } from '@/types'
import { api } from '@/services/api'

/** One batch behind a medicine's aggregate figures. */
export interface Batch {
  id: string
  batchNumber: string
  quantity: number
  purchasePrice: string
  sellingPrice: string
  mrp: string | null
  expiry: string
  receivedOn: string | null
  expired: boolean
  daysToExpiry: number
}

/** The API row: the frontend `Medicine` shape plus the database id. */
export interface MedicineRecord extends Medicine {
  uuid: string
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface MedicineDetail extends MedicineRecord {
  batches: Batch[]
  /** Both valuations, so the UI labels which one it shows. */
  stockValueAtCost: string
  stockValueAtRetail: string
}

export interface MedicinePage {
  items: MedicineRecord[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ListParams {
  page?: number
  limit?: number
  /** Matches name, generic name, category and manufacturer — filtered in SQL. */
  search?: string
  category?: string
  status?: StockStatus
  active?: boolean
}

export async function listMedicines(params: ListParams = {}): Promise<MedicinePage> {
  const query = new URLSearchParams()
  query.set('page', String(params.page ?? 1))
  query.set('limit', String(params.limit ?? 200))
  if (params.search) query.set('search', params.search)
  if (params.category) query.set('category', params.category)
  if (params.status) query.set('status', params.status)
  if (params.active !== undefined) query.set('active', String(params.active))

  const page = await api.get<{
    items: MedicineRecord[]
    page: number
    limit: number
    total: number
    total_pages: number
  }>(`/api/medicines?${query}`)

  return {
    items: page.items,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.total_pages,
  }
}

export function getMedicine(identifier: string): Promise<MedicineDetail> {
  return api.get<MedicineDetail>(`/api/medicines/${encodeURIComponent(identifier)}`)
}

export interface MedicinePayload {
  name: string
  genericName?: string
  category?: string
  manufacturer?: string
  rackLocation?: string
  /** The reorder level. Never negative. */
  threshold?: number
  /** An opening batch, so a medicine can be added with its first delivery. */
  batch?: BatchPayload
}

export function createMedicine(payload: MedicinePayload): Promise<MedicineDetail> {
  return api.post<MedicineDetail>('/api/medicines', payload)
}

/** Catalogue details only — stock never moves through here. */
export function updateMedicine(
  identifier: string,
  payload: Partial<Omit<MedicinePayload, 'batch'>> & { isActive?: boolean },
): Promise<MedicineDetail> {
  return api.put<MedicineDetail>(`/api/medicines/${encodeURIComponent(identifier)}`, payload)
}

/* -------------------------------------------------------------------------- */
/* Batches                                                                    */
/* -------------------------------------------------------------------------- */

export interface BatchPayload {
  batchNumber: string
  quantity: number
  purchasePrice: string | number
  sellingPrice: string | number
  mrp?: string | number
  expiry: string
  receivedOn?: string
}

export function listBatches(identifier: string): Promise<Batch[]> {
  return api.get<Batch[]>(`/api/medicines/${encodeURIComponent(identifier)}/batches`)
}

/** Receive a delivery. An already-expired batch is refused. */
export function addBatch(identifier: string, payload: BatchPayload): Promise<Batch> {
  return api.post<Batch>(`/api/medicines/${encodeURIComponent(identifier)}/batches`, payload)
}

/** Correct a batch. A quantity change is audited with both figures. */
export function updateBatch(batchId: string, payload: Partial<BatchPayload>): Promise<Batch> {
  return api.put<Batch>(`/api/medicine-batches/${encodeURIComponent(batchId)}`, payload)
}

/* -------------------------------------------------------------------------- */
/* Inventory views                                                            */
/* -------------------------------------------------------------------------- */

export function listInventory(status?: StockStatus): Promise<MedicineRecord[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return api.get<MedicineRecord[]>(`/api/pharmacy/inventory${query}`)
}

/**
 * The reorder list: everything at or below its threshold.
 *
 * Broader than the `Low Stock` badge, which is exclusive — an item that is both
 * near expiry and below threshold still needs reordering, so it appears here.
 */
export function listLowStock(): Promise<MedicineRecord[]> {
  return api.get<MedicineRecord[]>('/api/pharmacy/inventory/low-stock')
}

/** Stock inside the 45-day near-expiry window. */
export function listNearExpiry(): Promise<MedicineRecord[]> {
  return api.get<MedicineRecord[]>('/api/pharmacy/inventory/near-expiry')
}
