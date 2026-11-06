import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ConsultationForm } from "./ConsultationForm";
import type { AdsensService } from "../../lib/api/adsens";
import type { CSSProperties } from "react";

/**
 * The dialog stays LIGHT over the dark page, deliberately.
 *
 * An eleven-field form is work, and a white panel is the more legible
 * surface for filling one in — dark form fields with dark labels are where
 * these pages usually fall down. The contrast also makes the dialog read as
 * a distinct layer rather than another section of the page.
 *
 * These three tokens are what ConsultationForm references. They used to come
 * from the page root, which is now dark, so the form carries its own.
 */
const formPalette = {
  "--ads-line": "var(--color-dark-200)",
  "--ads-muted": "var(--color-dark-500)",
  "--ads-orange": "var(--color-primary-500)",
} as CSSProperties;

// ============================================================
// The consultation form as a dialog.
//
// Every "Get started" / "Request a consultation" button on /adsens opens this
// instead of scrolling the visitor down a long page to find the form.
//
// Behaviour follows the storefront's existing AuthModal so the site has one
// modal idiom: Escape closes, the backdrop closes, body scroll is locked,
// focus moves in and is trapped, and the panel is a bottom sheet on phones
// that becomes a centred card from `sm` up.
//
// Sizing is the part that matters for this form specifically: it is tall
// (11 fields), so the panel is capped to the viewport with `max-h-[92dvh]`
// and scrolls INTERNALLY. `dvh` rather than `vh` because mobile browser
// chrome changes the viewport height as it hides — `vh` would leave the
// submit button under the address bar.
// ============================================================

export function ConsultationModal({
  open,
  onClose,
  services,
  preselect,
}: {
  open: boolean;
  onClose: () => void;
  services: AdsensService[];
  /** Service or package the visitor clicked through from. */
  preselect: { services?: string[]; packageId?: string } | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape to close + lock the page behind the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Move focus into the dialog so a keyboard user is not left on the page
  // behind it.
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  /** Keep Tab inside the dialog while it is open. */
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables?.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  // Portalled to <body>: the AdSens page sets its palette on a wrapper with
  // blurred decorative orbs, and a fixed child of a filtered ancestor is
  // positioned against that ancestor rather than the viewport.
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-dark-950/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={trapTab}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            // Bottom sheet on phones → centred card from sm. `2xl:max-w-3xl`
            // lets the two-column field grid breathe on a large screen without
            // the form stretching across an ultra-wide monitor.
            style={formPalette}
            className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[16px] rounded-b-none bg-white outline-none shadow-2xl sm:rounded-[16px] lg:max-w-2xl 2xl:max-w-3xl"
          >
            {/* Header stays put while the form scrolls under it, so the close
                control is always reachable on a long form. */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-dark-200 px-5 py-4 sm:px-7">
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-bold text-dark-900">Request a free consultation</h2>
                <p className="mt-0.5 text-sm text-dark-500">
                  Tell us about your business and we'll come back with a plan — no obligation.
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-dark-500 transition-colors hover:bg-dark-100 hover:text-dark-900"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
              {/* `bare` drops the form's own card chrome and heading: the
                  dialog already provides both. */}
              <ConsultationForm services={services} preselect={preselect} bare onDone={onClose} />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
