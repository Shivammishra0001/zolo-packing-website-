import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, ImageOff, X } from "lucide-react";
import { DK_GRADIENT, darkPalette, prettyCategory } from "./dark";
import { assetUrl } from "../../lib/asset-url";
import { adsensApi, type AdsensCaseStudy } from "../../lib/api/adsens";

/* =========================================================
   Case study detail, as a dialog.

   Opened from a portfolio card or a campaign card. Behaviour matches the
   consultation dialog so the site keeps ONE modal idiom: Escape and the
   backdrop close it, body scroll locks, focus moves in and is trapped, and
   it is a bottom sheet on phones that becomes a centred panel from `sm` up.

   The detail is fetched on open rather than shipped with the grid: the long
   copy of every case study would otherwise be downloaded by every visitor
   who never opens one.

   RESULTS: the server sends `results` ONLY when an admin marked them
   verified. An unverified study therefore arrives with an empty array and
   this component renders no results block at all — there is no code path
   here that could display an unverified number, because it never has one.
   ========================================================= */

export function CaseStudyModal({ slug, onClose }: { slug: string | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [data, setData] = useState<AdsensCaseStudy | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const open = slug !== null;

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

  useEffect(() => { if (open) panelRef.current?.focus(); }, [open, state]);

  // Fetch on open. `cancelled` guards the case where the visitor closes and
  // opens a different study before the first request lands.
  useEffect(() => {
    if (!slug) { setData(null); setState("loading"); return; }
    let cancelled = false;
    setState("loading");
    setData(null);
    adsensApi
      .caseStudy(slug)
      .then((r) => { if (!cancelled) { setData(r.caseStudy); setState("ready"); } })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [slug]);

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

  return createPortal(
    <AnimatePresence>
      {open && (
        <div style={darkPalette} className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
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
            className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[16px] rounded-b-none border border-[var(--dk-line-2)] bg-[var(--dk-bg-2)] text-[var(--dk-ink)] shadow-2xl outline-none sm:rounded-[16px] lg:max-w-2xl 2xl:max-w-3xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--dk-line)] px-5 py-4 sm:px-7">
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-lg font-bold">
                  {data?.title ?? (state === "error" ? "Case study" : "Loading…")}
                </h2>
                {data && (
                  <p className="mt-0.5 truncate text-sm text-[var(--dk-muted)]">
                    {[data.clientName, data.industry].filter(Boolean).join(" · ") || prettyCategory(data.category)}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--dk-muted)] transition-colors hover:bg-white/10 hover:text-[var(--dk-ink)]"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
              {state === "loading" && <Skeleton />}

              {state === "error" && (
                <p className="py-8 text-center text-sm text-[var(--dk-muted)]">
                  We couldn't load this case study. Please close this and try again.
                </p>
              )}

              {state === "ready" && data && <Body data={data} />}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="aspect-[16/9] w-full animate-pulse rounded-xl bg-white/5" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-white/5" />
      <div className="h-3 w-full animate-pulse rounded bg-white/5" />
      <div className="h-3 w-5/6 animate-pulse rounded bg-white/5" />
    </div>
  );
}

function Body({ data }: { data: AdsensCaseStudy }) {
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl bg-[var(--dk-bg)]">
        {data.coverImage ? (
          <img src={assetUrl(data.coverImage)} alt={data.title} className="aspect-[16/9] w-full object-cover" />
        ) : (
          <div className="flex aspect-[16/9] w-full items-center justify-center" style={{ backgroundImage: DK_GRADIENT, opacity: 0.16 }}>
            <ImageOff className="h-8 w-8 text-white/60" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
          style={{ backgroundImage: DK_GRADIENT }}
        >
          {prettyCategory(data.category)}
        </span>
        {data.industry && (
          <span className="rounded-full border border-[var(--dk-line)] px-2.5 py-1 text-[11px] text-[var(--dk-muted)]">
            {data.industry}
          </span>
        )}
      </div>

      {data.summary && <p className="text-[15px] leading-relaxed text-[var(--dk-muted)]">{data.summary}</p>}

      {data.servicesProvided.length > 0 && (
        <section>
          <SectionTitle>Services provided</SectionTitle>
          <ul className="mt-2 flex flex-wrap gap-2">
            {data.servicesProvided.map((s) => (
              <li
                key={s}
                className="rounded-lg border border-[var(--dk-line)] bg-[var(--dk-panel)] px-2.5 py-1 text-[13px] text-[var(--dk-muted)]"
              >
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Prose title="Overview" body={data.overview} />
      <Prose title="Strategy" body={data.strategy} />
      <Prose title="Execution" body={data.execution} />

      {/* Only verified results ever arrive here, so the presence of the array
          IS the permission to show it. The badge tells the reader why they
          should believe the numbers. */}
      {data.results.length > 0 && (
        <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-emerald-400" aria-hidden />
            <SectionTitle>Results</SectionTitle>
          </div>
          <ul className="mt-3 space-y-2">
            {data.results.map((r) => (
              <li key={r} className="flex items-start gap-2 text-sm text-[var(--dk-ink)]">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-[var(--dk-faint)]">
            Figures confirmed with the client before publication.
          </p>
        </section>
      )}

      {data.gallery.length > 0 && (
        <section>
          <SectionTitle>Creative assets</SectionTitle>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {data.gallery.map((src) => (
              <img
                key={src}
                src={assetUrl(src)}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full rounded-lg object-cover"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--dk-cyan)]">{children}</h3>
);

function Prose({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      {/* Admin copy is plain text; `whitespace-pre-line` keeps their paragraph
          breaks without accepting HTML from the field. */}
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--dk-muted)]">{body}</p>
    </section>
  );
}
