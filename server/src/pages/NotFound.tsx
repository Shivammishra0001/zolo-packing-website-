import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/layout/Logo'
import { useAuth } from '@/context/AuthContext'
import { ROLE_HOME } from '@/lib/permissions'

export default function NotFound() {
  const { user } = useAuth()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <LogoMark className="mx-auto size-11" />

        <p className="num mt-8 text-[64px] font-bold leading-none tracking-tight text-muted-foreground/25">404</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">This page does not exist</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
          The link may be out of date, or the record may have been moved. Everything else is exactly where you left it.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to={user ? ROLE_HOME[user.role] : '/login'}>
              <ArrowLeft />
              {user ? 'Back to my dashboard' : 'Go to sign in'}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">
              <Compass />
              Home
            </Link>
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
