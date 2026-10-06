import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Mail, Phone } from "lucide-react";

// ============================================================
// FinalCta — the last conversion surface before the footer (§19).
//
// Two paths, because Zolo has two kinds of buyer: shop the catalog, or talk to
// someone about a custom job. The phone/email row replaces the newsletter block
// the brief sketched (§20): there is NO newsletter endpoint or subscriber
// storage in this codebase, and an input that silently discards an email is
// worse UX than none. These contact details are the same ones the footer
// already publishes, so nothing here is invented.
// ============================================================

export function FinalCta() {
  return (
    <section className="section bg-green-800 text-white" aria-label="Get started">
      <div className="shell">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.35 }}
          className="flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-300">Ready when you are</p>
            <h2 className="h2 mt-2 text-white">Ready to package better?</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-white/80 sm:text-base">
              Find the right packaging for your business, or talk to our team about a custom requirement.
            </p>

            {/* Real, existing contact routes — no fabricated channels. */}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/75">
              <a href="tel:+919582712626" className="flex min-h-11 items-center gap-2 transition-colors hover:text-white sm:min-h-0">
                <Phone className="h-4 w-4 text-green-300" aria-hidden /> +91 9582712626
              </a>
              <a href="mailto:contact@zolopacking.com" className="flex min-h-11 items-center gap-2 transition-colors hover:text-white sm:min-h-0">
                <Mail className="h-4 w-4 text-green-300" aria-hidden /> contact@zolopacking.com
              </a>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <Link to="/products" className="btn btn-primary btn-lg">
              Shop products <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/rfq" className="btn btn-white btn-lg">
              Get a quote
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
