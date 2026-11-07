import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { FOOTER } from "./content";

/* =========================================================
   Section 8 — AdSens footer block.

   The app's global <Footer> is shared by every page and must not be
   replaced, so this renders the reference's footer CONTENT as a band above
   it, in the app's own navy footer treatment. Zolo's real contact details
   and copyright stay in the global footer below.
   ========================================================= */

const COLUMNS = [
  { heading: "Services", items: FOOTER.services },
  { heading: "Company", items: FOOTER.company },
  { heading: "Legal", items: FOOTER.legal },
];

export function AdsensFooter() {
  return (
    <section className="border-t border-white/10 bg-navy-900 py-12 text-white">
      <div className="shell grid gap-9 md:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
        {/* identity */}
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-extrabold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            AdSense
          </p>
          <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-dark-400">{FOOTER.blurb}</p>
        </div>

        {/* link columns. These point at the consultation route rather than
            at pages that do not exist — a link to a 404 is worse than one
            that lands somewhere useful. */}
        {COLUMNS.map((col) => (
          <nav key={col.heading} aria-label={`AdSense ${col.heading}`}>
            <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-white">{col.heading}</h3>
            <ul className="mt-3 space-y-2">
              {col.items.map((item) => (
                <li key={item}>
                  <Link
                    to="/contact"
                    className="inline-flex min-h-11 items-center text-[13.5px] text-dark-400 transition-colors hover:text-green-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400"
                  >
                    {item}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </section>
  );
}
