/**
 * System configuration.
 *
 * Values keep their types across the wire — a toggle is a boolean and a rate is
 * a number, so the configuration screen never parses a string back out.
 *
 * No secret is served here and none can be: the accepted keys are a fixed list
 * of clinic configuration, and the JWT secret, the database password and every
 * other credential live in the environment rather than in this table.
 */

import { api } from '@/services/api'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type SettingValue = string | number | boolean

export interface SettingRecord {
  key: string
  value: SettingValue
  type: 'boolean' | 'integer' | 'decimal' | 'string' | 'json'
  updatedAt: string | null
  updatedBy: string
}

/** Every setting keyed for direct lookup, which is how the screen reads them. */
export type SettingsMap = Record<string, SettingValue>

function toMap(rows: SettingRecord[]): SettingsMap {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

/* -------------------------------------------------------------------------- */
/* Reads and writes                                                           */
/* -------------------------------------------------------------------------- */

export function listSettings(): Promise<SettingRecord[]> {
  return api.get<SettingRecord[]>('/api/settings')
}

export async function getSettings(): Promise<SettingsMap> {
  return toMap(await listSettings())
}

/**
 * Save the configuration screen.
 *
 * Send only what changed. Every value is validated against its declared type
 * before anything is written, so one bad field cannot half-save the rest.
 */
export async function updateSettings(values: SettingsMap): Promise<SettingsMap> {
  return toMap(await api.put<SettingRecord[]>('/api/settings', { values }))
}
