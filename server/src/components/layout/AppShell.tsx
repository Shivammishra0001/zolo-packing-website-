import * as React from 'react'
import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { FlaskConical } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { Sidebar, SidebarNav } from '@/components/layout/Sidebar'
import { Topbar, MobileSearchBar } from '@/components/layout/Topbar'
import { MobileNav } from '@/components/layout/MobileNav'
import { AIAssistant } from '@/components/layout/AIAssistant'
import { Logo } from '@/components/layout/Logo'
import { PageSkeleton } from '@/components/layout/PageSkeleton'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

function DemoModeBadge() {
  return (
    <div className="pointer-events-none fixed bottom-[4.75rem] left-3 z-30 lg:bottom-4 lg:left-auto lg:right-4">
      <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-warning/35 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning shadow-card backdrop-blur">
        <FlaskConical className="size-3" />
        Demo Mode — sample data
      </span>
    </div>
  )
}

export function AppShell() {
  const { user } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useLocalStorage('arogya.sidebar.collapsed', false)
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [assistantOpen, setAssistantOpen] = React.useState(false)

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  if (!user) return null

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-screen bg-background">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          onOpenAssistant={() => setAssistantOpen(true)}
        />

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="p-0">
            <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-4">
              <SheetTitle asChild>
                <span>
                  <Logo />
                </span>
              </SheetTitle>
            </div>
            <SidebarNav
              collapsed={false}
              onNavigate={() => setDrawerOpen(false)}
              onOpenAssistant={() => {
                setDrawerOpen(false)
                setAssistantOpen(true)
              }}
            />
          </SheetContent>
        </Sheet>

        <div
          className={cn(
            'flex min-h-screen flex-col lg:transition-[padding-left] lg:duration-200 lg:ease-out',
            collapsed ? 'lg:pl-[76px]' : 'lg:pl-[262px]',
          )}
        >
          <Topbar onOpenMobileNav={() => setDrawerOpen(true)} onOpenAssistant={() => setAssistantOpen(true)} />
          <MobileSearchBar />

          <main className="flex-1 px-4 pb-24 pt-6 sm:px-6 lg:pb-10 lg:pt-7 xl:px-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="mx-auto w-full max-w-[1500px]"
              >
                <Suspense fallback={<PageSkeleton />}>
                  <Outlet />
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <MobileNav onOpenMore={() => setDrawerOpen(true)} />
        <DemoModeBadge />
        <AIAssistant open={assistantOpen} onOpenChange={setAssistantOpen} />
      </div>
    </TooltipProvider>
  )
}
