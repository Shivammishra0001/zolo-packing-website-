import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, Loader2, Search, UserRound, X } from 'lucide-react'
import { globalSearch, type SearchGroup, type SearchHit } from '@/services/notificationService'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const SUGGESTIONS = ['Raj Kumar', 'PT-10263', '98201', 'Neuro Rehabilitation']

export function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const [searching, setSearching] = React.useState(false)
  const [groups, setGroups] = React.useState<SearchGroup[]>([])
  const [failed, setFailed] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Debounced server-side lookup. A stale response is discarded, so fast
  // typing can never land an older result after a newer one.
  React.useEffect(() => {
    if (query.trim().length < 2) {
      setGroups([])
      setSearching(false)
      setFailed(false)
      return
    }

    let cancelled = false
    setSearching(true)

    const id = window.setTimeout(() => {
      // The server decides which categories this role may see; a category the
      // caller lacks permission for is absent rather than empty.
      globalSearch(query)
        .then((res) => {
          if (cancelled) return
          setGroups(res.groups)
          setActive(0)
          setFailed(false)
        })
        .catch(() => {
          if (!cancelled) {
            setGroups([])
            setFailed(true)
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [query])

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Arrow keys move through every hit in order, across group boundaries, so
  // the whole panel behaves like one list however it is grouped on screen.
  const flat = React.useMemo(() => groups.flatMap((g) => g.hits), [groups])

  function choose(hit: SearchHit) {
    setOpen(false)
    setQuery('')
    navigate(hit.url)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault()
      choose(flat[active])
    }
  }

  const showPanel = open && (query.trim().length > 0 || flat.length === 0)

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search patients by name, ID or phone"
          aria-label="Global patient search"
          aria-expanded={showPanel}
          role="combobox"
          aria-controls="global-search-results"
          className={cn(
            'h-9 w-full rounded-lg border border-input bg-muted/45 pl-9 pr-16 text-[13.5px] shadow-xs transition-all',
            'placeholder:text-muted-foreground/80',
            'focus:bg-card focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 select-none items-center gap-0.5 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
            Ctrl K
          </kbd>
        )}
      </div>

      <AnimatePresence>
        {showPanel && (
          <motion.div
            id="global-search-results"
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-border bg-popover shadow-pop"
          >
            {query.trim().length === 0 ? (
              <div className="p-3">
                <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Try searching for
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setQuery(s)}
                      className="rounded-md border border-border px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/[0.07] hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : searching ? (
              <div className="flex items-center gap-2.5 px-4 py-6 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Searching patient records…
              </div>
            ) : failed ? (
              <div className="px-4 py-7 text-center">
                <div className="mx-auto mb-2 flex size-9 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <UserRound className="size-4" />
                </div>
                <p className="text-[13px] font-medium">Search is unavailable</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Could not reach the server. Check your connection and try again.
                </p>
              </div>
            ) : flat.length === 0 ? (
              <div className="px-4 py-7 text-center">
                <div className="mx-auto mb-2 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Search className="size-4" />
                </div>
                <p className="text-[13px] font-medium">Nothing matches “{query}”</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Try a patient ID such as PT-10248, an invoice number, or a medicine name.
                </p>
              </div>
            ) : (
              <>
                <ul className="max-h-[min(60vh,22rem)] overflow-y-auto p-1.5">
                  {groups.map((group) => (
                    <li key={group.type}>
                      <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </p>
                      <ul>
                        {group.hits.map((hit) => {
                          const index = flat.indexOf(hit)
                          return (
                            <li key={`${hit.type}-${hit.id}`}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={index === active}
                                onMouseEnter={() => setActive(index)}
                                onClick={() => choose(hit)}
                                className={cn(
                                  'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                                  index === active ? 'bg-muted' : 'hover:bg-muted/60',
                                )}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13.5px] font-semibold">
                                    {hit.title}
                                  </span>
                                  {hit.subtitle && (
                                    <span className="num mt-0.5 block truncate text-[12px] text-muted-foreground">
                                      {hit.subtitle}
                                    </span>
                                  )}
                                </span>
                                <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                                  {group.label.replace(/s$/, '')}
                                </Badge>
                                {index === active && (
                                  <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                                )}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-border px-3 py-2 text-[11.5px] text-muted-foreground">
                  <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> to navigate ·{' '}
                  <kbd className="font-mono">Enter</kbd> to open
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
