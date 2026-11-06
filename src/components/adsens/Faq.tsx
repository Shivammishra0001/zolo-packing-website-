import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DarkHead, Glow } from "./dark";
import { useReveal } from "./flourish";

/* =========================================================
   FAQ (§12).

   An accessible accordion: each question is a real <button> carrying
   aria-expanded and aria-controls, and each answer is a region labelled by
   its button. Several can be open at once — a visitor comparing two answers
   should not have the first one snap shut.

   Answers are deliberately plain about what we do NOT promise: ad spend is
   separate, lead volume is not guaranteed, packaging is not required.
   ========================================================= */

const FAQS = [
  {
    q: "What services does AdSens provide?",
    a: "Digital advertising (Google, Meta, YouTube, LinkedIn), social media marketing, SEO, website and landing page development, creative and content production, lead generation, WhatsApp business marketing, and marketing strategy consulting.",
  },
  {
    q: "Can I choose individual marketing services?",
    a: "Yes. You can start with a single service — many businesses begin with advertising or social media and add more later. There is no requirement to take a bundle.",
  },
  {
    q: "Do you manage Google and Meta Ads?",
    a: "Yes. We handle campaign setup, audience targeting, creatives, monitoring and ongoing optimisation on both platforms.",
  },
  {
    q: "Is advertising spend separate from service charges?",
    a: "Yes, and we always show the two separately in a quotation. Our service fee covers strategy, setup, creatives, management and reporting. What you pay Google, Meta or any other platform for ad placement goes directly to them and is billed by them.",
  },
  {
    q: "Can you help with lead generation?",
    a: "We build and run campaigns designed to bring enquiries to your business. Results depend on your industry, budget, offer and competition, so we do not promise a fixed number of leads — anyone who does is guessing.",
  },
  {
    q: "Do you provide monthly reporting?",
    a: "Yes. You receive reports covering what ran, how it performed and what we recommend changing next.",
  },
  {
    q: "Can I use AdSens without buying packaging from Zolo?",
    a: "Yes. AdSens is a standalone service and you do not need to be a Zolo packaging customer. The two are quoted and billed separately.",
  },
  {
    q: "How can I request a consultation?",
    a: "Use the consultation form on this page. Our team reviews your requirements and contacts you to discuss the next steps. You will get a reference number as soon as your enquiry is saved.",
  },
];

export function Faq() {
  const scope = useReveal<HTMLDivElement>("[data-faq]", { y: 18, stagger: 0.04 });

  return (
    <section className="relative border-t border-[var(--dk-line)] py-14 lg:py-20">
      <Glow className="right-1/4 top-10" color="var(--dk-violet)" size={360} />

      <div ref={scope} className="shell relative">
        <DarkHead badge="Questions" title="Frequently Asked" accent="Questions" />

        <div className="mx-auto mt-10 max-w-3xl space-y-3">
          {FAQS.map((f) => <FaqItem key={f.q} {...f} />)}
        </div>
      </div>
    </section>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div
      data-faq
      className={`overflow-hidden rounded-2xl border transition-colors ${
        open ? "border-[var(--dk-cyan)]/40 bg-[var(--dk-panel-2)]" : "border-[var(--dk-line)] bg-[var(--dk-panel)]"
      }`}
    >
      <h3>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-button`}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        >
          <span className="text-[15px] font-semibold text-[var(--dk-ink)]">{q}</span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-[var(--dk-cyan)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </h3>
      {/* Unmounted rather than hidden: a closed answer should not be
          reachable by Tab or read out by a screen reader. */}
      {open && (
        <div role="region" id={`${id}-panel`} aria-labelledby={`${id}-button`} className="px-5 pb-4">
          <p className="text-sm leading-relaxed text-[var(--dk-muted)]">{a}</p>
        </div>
      )}
    </div>
  );
}
