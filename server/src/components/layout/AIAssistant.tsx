import { ArrowRight, FileScan, Info, MessageSquare, Receipt, Sparkles, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { useQuery } from '@/hooks/useApi'
import { getAiStatus } from '@/services/aiService'

/**
 * The assistant launcher.
 *
 * This used to be a chat window with scripted replies — it would answer "what
 * is this month's revenue?" with a figure that was written into the source
 * code. That was acceptable while the application was a front-end prototype
 * and stopped being acceptable the moment a real AI layer existed behind it:
 * the two look identical to a user, and only one of them is reading the
 * database.
 *
 * So it is now a signpost rather than an oracle. It names the four things the
 * AI layer can actually do, says whether a model is configured, and sends the
 * user to the workspace where each one runs against real records with a
 * human approving the result.
 */

const CAPABILITIES = [
  {
    icon: Sparkles,
    title: 'Patient recap',
    detail: 'The recent record for one patient, in order, with a written summary over it.',
    where: 'On any patient’s Overview tab.',
    permission: 'patient.clinical.view',
  },
  {
    icon: FileScan,
    title: 'Document transcription',
    detail: 'Read a scanned prescription or letter into fields, for a clinician to check.',
    where: 'AI assistant → Documents.',
    permission: 'patient.clinical.edit',
  },
  {
    icon: Receipt,
    title: 'Invoice check',
    detail: 'Recompute the totals, compare the payments, ask about anything unbilled.',
    where: 'AI assistant → Invoice check.',
    permission: 'billing.view',
  },
  {
    icon: MessageSquare,
    title: 'Follow-up reminders',
    detail: 'Draft a reminder for each patient who is due, for someone to approve.',
    where: 'AI assistant → Reminders.',
    permission: 'appointment.create',
  },
  {
    icon: TrendingUp,
    title: 'Finance insights',
    detail: 'This period against the last, with the movement attributed where the data allows.',
    where: 'AI assistant → Finance insights.',
    permission: 'finance.reports',
  },
] as const

export function AIAssistant({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { has } = useAuth()
  const navigate = useNavigate()
  // Only asked while the dialog is open: the status endpoint is cheap, but
  // polling it from every page for a panel nobody opened is still waste.
  const { data: status } = useQuery(() => getAiStatus(), [open], { enabled: open })

  const available = CAPABILITIES.filter((capability) => has(capability.permission))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
              <Sparkles className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle>AI assistant</DialogTitle>
              <DialogDescription>
                Five assistants, each working on records you already have access to.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {status
              ? status.enabled
                ? `Connected to ${status.model} via ${status.provider}. Nothing it produces is applied without someone approving it, and it never makes a clinical decision.`
                : 'No AI model is configured, so nothing is sent anywhere. The features below still run against your records — what is missing is the written summary on top of the figures.'
              : 'Checking what is available…'}
          </p>
        </div>

        <ul className="mt-4 space-y-2.5">
          {available.map((capability) => (
            <li
              key={capability.title}
              className="flex items-start gap-3 rounded-lg border border-border px-3.5 py-3"
            >
              <capability.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{capability.title}</p>
                <p className="text-[12.5px] text-muted-foreground">{capability.detail}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{capability.where}</p>
              </div>
            </li>
          ))}
        </ul>

        {available.length === 0 && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Your role does not have access to any of the AI features. Each one needs the same
            permission as the records it works on.
          </p>
        )}

        {available.length > 0 && (
          <Button
            className="mt-5 w-full"
            onClick={() => {
              onOpenChange(false)
              navigate('/ai')
            }}
          >
            Open the AI workspace
            <ArrowRight className="ml-1.5 size-4" aria-hidden />
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
