import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./shared";

/* =========================================================
   Section 7 — Final CTA. Uses the app's own CTA styling.
   ========================================================= */

export function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-green-700 py-14 text-white lg:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[360px] w-[360px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(74,222,128,0.35), transparent 70%)" }}
      />

      <Reveal className="shell relative text-center">
        <h2 className="h2 text-white">
          Ready to <span className="text-green-400">Grow?</span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/75">
          Let's discuss how we can help you achieve your marketing goals.
        </p>
        <Link to="/contact" className="btn btn-lg btn-primary mt-7 !bg-primary-700 hover:!bg-primary-800">
          Start Your Growth Journey
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Reveal>
    </section>
  );
}
