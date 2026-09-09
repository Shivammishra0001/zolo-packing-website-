import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Indian numbering system currency, e.g. ₹1,25,000 */
export function inr(value: number, opts: { compact?: boolean; decimals?: boolean } = {}) {
  if (opts.compact) {
    if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`
    if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)} L`
    if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(1)}K`
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: opts.decimals ? 2 : 0,
    minimumFractionDigits: opts.decimals ? 2 : 0,
  }).format(value)
}

export function numberFmt(value: number) {
  return new Intl.NumberFormat('en-IN').format(value)
}

export function percent(value: number, decimals = 0) {
  return `${value.toFixed(decimals)}%`
}

export function initialsOf(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** "2026-08-24" -> "24 Aug 2026" */
export function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateShort(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export function daysBetween(fromIso: string, toIso: string) {
  const a = new Date(fromIso).getTime()
  const b = new Date(toIso).getTime()
  return Math.round((b - a) / 86400000)
}

/** Days from today (negative = in the past) */
export function daysFromToday(iso: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return daysBetween(today.toISOString().slice(0, 10), iso)
}

/** "09:30" -> minutes since midnight */
export function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** "14:05" -> "02:05 PM" */
export function to12Hour(t: string) {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function sum<T>(items: T[], pick: (item: T) => number) {
  return items.reduce((acc, item) => acc + pick(item), 0)
}

export function groupBy<T, K extends string>(items: T[], pick: (item: T) => K) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = pick(item)
    ;(acc[key] ||= []).push(item)
    return acc
  }, {})
}

/** Deterministic pseudo-random so mock data never shifts between renders. */
export function seeded(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}
