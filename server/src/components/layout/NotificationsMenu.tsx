import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bell, BellOff, CheckCheck } from 'lucide-react'
import type { Notification } from '@/types'
import { useNotifications } from '@/context/NotificationContext'
import type { NotificationRecord } from '@/services/notificationService'
import { icon as iconFor } from '@/lib/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ICON_FOR: Record<Notification['icon'], string> = {
  clinical: 'consultation',
  stock: 'inventory',
  finance: 'revenue',
  therapy: 'therapy',
  system: 'settings',
  patient: 'patients',
}

const SEVERITY_TONE: Record<Notification['severity'], string> = {
  info: 'bg-info/12 text-info',
  warning: 'bg-warning/12 text-warning',
  critical: 'bg-destructive/12 text-destructive',
  success: 'bg-success/12 text-success',
}

export function NotificationsMenu() {
  const { items, unread, markRead, markAllRead } = useNotifications()
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)

  function openItem(item: NotificationRecord) {
    markRead(item.id)
    setOpen(false)
    navigate(item.href)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9.5px] font-bold leading-4 text-destructive-foreground ring-2 ring-card">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(92vw,24rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
          <div>
            <p className="text-[13.5px] font-semibold">Notifications</p>
            <p className="text-[11.5px] text-muted-foreground">
              {unread > 0 ? `${unread} unread` : 'You are all caught up'}
            </p>
          </div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="text-[12px]">
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto mb-2.5 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <BellOff className="size-4" />
            </div>
            <p className="text-[13px] font-medium">No notifications yet</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Alerts relevant to your role will appear here.</p>
          </div>
        ) : (
          <ul className="max-h-[min(70vh,26rem)] overflow-y-auto p-1.5">
            {items.map((item, i) => {
              const Icon = iconFor(ICON_FOR[item.icon])
              return (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.035, duration: 0.2 }}
                >
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      'flex w-full gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-muted',
                      !item.read && 'bg-accent/[0.045]',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                        SEVERITY_TONE[item.severity],
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className={cn('flex-1 text-[13px] leading-snug', !item.read && 'font-semibold')}>
                          {item.title}
                        </span>
                        {!item.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-muted-foreground">{item.body}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground/80">{item.time}</span>
                    </span>
                  </button>
                </motion.li>
              )
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
