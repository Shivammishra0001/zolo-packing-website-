import { NavLink } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { NAVIGATION } from '@/lib/navigation'
import { icon as iconFor } from '@/lib/icons'
import { cn } from '@/lib/utils'

/**
 * Bottom navigation for phones: the first four permitted destinations plus a
 * "More" button that opens the full drawer.
 */
export function MobileNav({ onOpenMore }: { onOpenMore: () => void }) {
  const { user, has } = useAuth()
  if (!user) return null

  const items = NAVIGATION[user.role]
    .flatMap((section) => section.items)
    .filter((item) => has(item.permission))
    .slice(0, 4)

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {items.map((item) => {
        const Icon = iconFor(item.icon)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to.split('/').length <= 2}
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10.5px] font-medium transition-colors',
                isActive ? 'text-accent' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-accent" />}
                <span className="relative">
                  <Icon className="size-[19px]" />
                  {item.badge !== undefined && (
                    <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-destructive" />
                  )}
                </span>
                <span className="max-w-full truncate">{item.label.split(' ')[0]}</span>
              </>
            )}
          </NavLink>
        )
      })}

      <button
        type="button"
        onClick={onOpenMore}
        className="flex flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <MoreHorizontal className="size-[19px]" />
        More
      </button>
    </nav>
  )
}
