import * as React from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/misc'

export interface Column<T> {
  /** Unique key, also used for sorting. */
  key: string
  header: string
  /** Renders the desktop cell and the mobile card row value. */
  cell: (row: T) => React.ReactNode
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number
  className?: string
  headerClassName?: string
  align?: 'left' | 'right' | 'center'
  /** Promote to the mobile card's title line. Exactly one column should set this. */
  primary?: boolean
  /** Shown next to the title on mobile cards instead of as a labelled row. */
  meta?: boolean
  /** Hide from mobile cards entirely. */
  hideOnCard?: boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  loading?: boolean
  loadingRows?: number
  className?: string
  /** Extra classes computed per row, e.g. to tint overdue rows. */
  rowClassName?: (row: T) => string
  stickyHeader?: boolean
  initialSort?: { key: string; dir: 'asc' | 'desc' }
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyTitle = 'Nothing here yet',
  emptyDescription = 'Records will appear here once they are created.',
  emptyAction,
  loading = false,
  loadingRows = 5,
  className,
  rowClassName,
  stickyHeader = false,
  initialSort,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null)

  const sorted = React.useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const pick = col.sortValue
    return [...rows].sort((a, b) => {
      const av = pick(a)
      const bv = pick(b)
      if (av === bv) return 0
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort, columns])

  function toggleSort(col: Column<T>) {
    if (!col.sortValue) return
    setSort((prev) => {
      if (prev?.key !== col.key) return { key: col.key, dir: 'asc' }
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' }
      return null
    })
  }

  if (loading) {
    return (
      <div className={cn('rounded-xl border border-border bg-card', className)}>
        <div className="space-y-3 p-4">
          {Array.from({ length: loadingRows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-3.5 w-1/4" />
              <Skeleton className="h-3.5 w-1/5" />
              <Skeleton className="ml-auto h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center',
          className,
        )}
      >
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="size-5" />
        </div>
        <p className="text-sm font-semibold">{emptyTitle}</p>
        <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{emptyDescription}</p>
        {emptyAction && <div className="mt-4">{emptyAction}</div>}
      </div>
    )
  }

  const primaryCol = columns.find((c) => c.primary) ?? columns[0]
  const metaCols = columns.filter((c) => c.meta && c !== primaryCol)
  const cardCols = columns.filter((c) => c !== primaryCol && !c.meta && !c.hideOnCard)

  return (
    <div className={className}>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full caption-bottom text-sm">
            <thead className={cn('bg-muted/45', stickyHeader && 'sticky top-0 z-10 backdrop-blur')}>
              <tr className="border-b border-border">
                {columns.map((col) => {
                  const active = sort?.key === col.key
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      className={cn(
                        'h-10 whitespace-nowrap px-4 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground',
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                        col.headerClassName,
                      )}
                    >
                      {col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded transition-colors hover:text-foreground',
                            active && 'text-foreground',
                          )}
                        >
                          {col.header}
                          {active ? (
                            sort.dir === 'asc' ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            )
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <motion.tr
                  key={rowKey(row)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.018, 0.25), duration: 0.2 }}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'border-b border-border/70 transition-colors last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-muted/55 focus-visible:bg-muted/55',
                    rowClassName?.(row),
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-3 align-middle',
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {sorted.map((row, i) => (
          <motion.div
            key={rowKey(row)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.25), duration: 0.22 }}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={
              onRowClick
                ? (e) => {
                    if (e.key === 'Enter') onRowClick(row)
                  }
                : undefined
            }
            className={cn(
              'rounded-xl border border-border bg-card p-3.5 shadow-card',
              onRowClick && 'cursor-pointer active:bg-muted/50',
              rowClassName?.(row),
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-sm font-medium">{primaryCol.cell(row)}</div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {metaCols.map((col) => (
                  <div key={col.key}>{col.cell(row)}</div>
                ))}
              </div>
            </div>
            {cardCols.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3">
                {cardCols.map((col) => (
                  <div key={col.key} className="min-w-0">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {col.header}
                    </dt>
                    <dd className="mt-0.5 truncate text-[13px]">{col.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
