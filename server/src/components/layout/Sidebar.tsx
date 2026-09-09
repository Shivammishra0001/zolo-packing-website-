import { NavLink } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react'
import type { NavSection } from '@/types'
import { icon as iconFor } from '@/lib/icons'
import { ROLE_LABEL } from '@/lib/permissions'
import { useAuth } from '@/context/AuthContext'
import { NAVIGATION } from '@/lib/navigation'
import { Logo } from '@/components/layout/Logo'
import { Hint } from '@/components/ui/tooltip'
import { useQuery } from '@/hooks/useApi'
import { listAppointments, todayIso } from '@/services/appointmentService'
import { cn } from '@/lib/utils'

/**
 * Live counts for the two appointment badges.
 *
 * The rest of the badges in `navigation.ts` are still placeholders — each one
 * becomes real as its module is built. Returning `undefined` hides a badge
 * rather than showing a number nobody can trust.
 */
function useAppointmentBadges(canView: boolean): Record<string, number | undefined> {
  const today = todayIso()
  const { data } = useQuery(() => listAppointments({ date: today, scope: 'branch', limit: 200 }), [today], {
    enabled: canView,
  })

  if (!data) return {}
  const items = data.items
  return {
    '/doctor/appointments': items.filter((a) => a.status !== 'Cancelled' && a.status !== 'No Show').length || undefined,
    '/reception/queue': items.filter((a) => a.status === 'Waiting').length || undefined,
  }
}

function visibleSections(sections: NavSection[], has: (p?: never) => boolean): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => has(item.permission as never)),
    }))
    .filter((section) => section.items.length > 0)
}

export function SidebarNav({
  collapsed,
  onNavigate,
  onOpenAssistant,
}: {
  collapsed: boolean
  onNavigate?: () => void
  onOpenAssistant?: () => void
}) {
  const { user, has } = useAuth()
  const badges = useAppointmentBadges(has('appointment.view'))
  if (!user) return null

  const sections = visibleSections(NAVIGATION[user.role], has as (p?: never) => boolean)

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      {sections.map((section, si) => (
        <div key={section.title ?? `section-${si}`}>
          {section.title && !collapsed && (
            <p className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-sidebar-muted">
              {section.title}
            </p>
          )}
          {section.title && collapsed && <div className="mx-2.5 mb-2 h-px bg-sidebar-border" />}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = iconFor(item.icon)
              const badge = item.to in badges ? badges[item.to] : item.badge
              const link = (
                <NavLink
                  to={item.to}
                  end={item.to.split('/').length <= 2}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors duration-150',
                      collapsed && 'justify-center px-0',
                      isActive
                        ? 'bg-accent/[0.11] text-sidebar-accent'
                        : 'text-sidebar-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-sidebar-accent"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      )}
                      <Icon className={cn('size-[18px] shrink-0', isActive && 'text-sidebar-accent')} />
                      {!collapsed && (
                        <>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {badge !== undefined && (
                            <span
                              className={cn(
                                'num shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold',
                                isActive ? 'bg-sidebar-accent/15 text-sidebar-accent' : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {badge}
                            </span>
                          )}
                        </>
                      )}
                      {collapsed && badge !== undefined && (
                        <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-sidebar-accent" />
                      )}
                    </>
                  )}
                </NavLink>
              )

              return (
                <li key={item.to}>
                  {collapsed ? (
                    <Hint label={item.label} side="right">
                      <span className="block">{link}</span>
                    </Hint>
                  ) : (
                    link
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {onOpenAssistant && (
        <div className="pt-1">
          {collapsed ? (
            <Hint label="AI Assistant" side="right">
              <button
                type="button"
                onClick={onOpenAssistant}
                className="flex w-full items-center justify-center rounded-lg px-0 py-2 text-sidebar-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Sparkles className="size-[18px]" />
              </button>
            </Hint>
          ) : (
            <button
              type="button"
              onClick={onOpenAssistant}
              className="flex w-full items-center gap-3 rounded-lg border border-dashed border-sidebar-border px-2.5 py-2.5 text-left text-[13px] font-medium text-sidebar-foreground transition-colors hover:border-accent/40 hover:bg-accent/[0.06]"
            >
              <Sparkles className="size-[18px] shrink-0 text-sidebar-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">AI Assistant</span>
                <span className="block truncate text-[11px] font-normal text-sidebar-muted">Ask about any record</span>
              </span>
            </button>
          )}
        </div>
      )}
    </nav>
  )
}

export function Sidebar({
  collapsed,
  onToggle,
  onOpenAssistant,
}: {
  collapsed: boolean
  onToggle: () => void
  onOpenAssistant: () => void
}) {
  const { user } = useAuth()

  return (
    <motion.aside
      animate={{ width: collapsed ? 76 : 262 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar lg:flex"
    >
      <div className={cn('flex h-16 shrink-0 items-center border-b border-sidebar-border px-4', collapsed && 'justify-center px-2')}>
        <Logo collapsed={collapsed} />
      </div>

      <SidebarNav collapsed={collapsed} onOpenAssistant={onOpenAssistant} />

      <div className="shrink-0 border-t border-sidebar-border p-3">
        <AnimatePresence initial={false} mode="wait">
          {!collapsed && user && (
            <motion.div
              key="role-card"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="mb-2 overflow-hidden rounded-lg bg-muted/60 px-3 py-2.5"
            >
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-sidebar-muted">Signed in as</p>
              <p className="mt-0.5 truncate text-[13px] font-semibold">{ROLE_LABEL[user.role]}</p>
              <p className="truncate text-[11.5px] text-sidebar-muted">{user.branch}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-sidebar-muted transition-colors hover:bg-muted hover:text-foreground',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </motion.aside>
  )
}
