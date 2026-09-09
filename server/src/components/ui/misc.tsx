import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import * as SliderPrimitive from '@radix-ui/react-slider'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Check } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/* --------------------------------- Avatar --------------------------------- */

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn('relative flex size-9 shrink-0 overflow-hidden rounded-full', className)}
    {...props}
  />
))
Avatar.displayName = 'Avatar'

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn('flex size-full items-center justify-center rounded-full text-xs font-semibold', className)}
    {...props}
  />
))
AvatarFallback.displayName = 'AvatarFallback'

/** Deterministic colour-coded initials avatar used for patients and staff. */
export function InitialsAvatar({
  initials,
  color,
  className,
  ring,
}: {
  initials: string
  color: string
  className?: string
  ring?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold tracking-tight',
        ring && 'ring-2 ring-card',
        color,
        className ?? 'size-9',
      )}
      aria-hidden
    >
      {initials}
    </span>
  )
}

/* -------------------------------- Separator -------------------------------- */

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    {...props}
  />
))
Separator.displayName = 'Separator'

/* --------------------------------- Switch ---------------------------------- */

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-accent data-[state=unchecked]:bg-muted-foreground/35',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
))
Switch.displayName = 'Switch'

/* -------------------------------- Checkbox --------------------------------- */

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-4 shrink-0 rounded border border-input shadow-xs transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="size-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = 'Checkbox'

/* --------------------------------- Slider ---------------------------------- */

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { tone?: 'accent' | 'warning' | 'info' }
>(({ className, tone = 'accent', ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('relative flex w-full touch-none select-none items-center py-2', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
      <SliderPrimitive.Range
        className={cn(
          'absolute h-full',
          tone === 'accent' && 'bg-accent',
          tone === 'warning' && 'bg-warning',
          tone === 'info' && 'bg-info',
        )}
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        'block size-4 rounded-full border-2 bg-card shadow-sm transition-transform hover:scale-110',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        tone === 'accent' && 'border-accent',
        tone === 'warning' && 'border-warning',
        tone === 'info' && 'border-info',
      )}
    />
  </SliderPrimitive.Root>
))
Slider.displayName = 'Slider'

/* -------------------------------- Progress --------------------------------- */

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    value?: number
    tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info'
    animate?: boolean
  }
>(({ className, value = 0, tone = 'accent', animate = true, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    value={value}
    className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    {...props}
  >
    <motion.div
      className={cn(
        'h-full rounded-full',
        tone === 'accent' && 'bg-accent',
        tone === 'success' && 'bg-success',
        tone === 'warning' && 'bg-warning',
        tone === 'danger' && 'bg-destructive',
        tone === 'info' && 'bg-info',
      )}
      initial={animate ? { width: 0 } : false}
      animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = 'Progress'

/* -------------------------------- Skeleton --------------------------------- */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton h-4 w-full', className)} {...props} />
}

export { Avatar, AvatarFallback, Separator, Switch, Checkbox, Slider, Progress }
