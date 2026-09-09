import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] font-medium leading-5 transition-colors whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border bg-transparent text-foreground',
        accent: 'border-accent/25 bg-accent/10 text-accent',
        success: 'border-success/25 bg-success/10 text-success',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        danger: 'border-destructive/25 bg-destructive/10 text-destructive',
        info: 'border-info/25 bg-info/10 text-info',
        solid: 'border-transparent bg-primary text-primary-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
  pulse?: boolean
}

function Badge({ className, variant, dot, pulse, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
