import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Crumb {
  label: string
  to?: string
}

export function PageHeader({
  title,
  description,
  crumbs = [],
  actions,
  className,
  children,
}: {
  title: string
  description?: string
  crumbs?: Crumb[]
  actions?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn('mb-6', className)}
    >
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted-foreground">
            {crumbs.map((crumb, i) => (
              <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5 opacity-60" aria-hidden />}
                {crumb.to ? (
                  <Link to={crumb.to} className="rounded transition-colors hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight lg:text-[26px]">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {children && <div className="mt-4">{children}</div>}
    </motion.header>
  )
}
