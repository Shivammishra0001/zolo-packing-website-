import { Link } from "react-router-dom";
import {
  BarChart3, Code2, FileText, Mail, Megaphone, Palette, Search, Share2,
} from "lucide-react";
import { SERVICES, type ServiceKey } from "./content";
import { Reveal, RevealGroup, SectionHead } from "./shared";

/* =========================================================
   Section 2 — Our Services. Eight cards, responsive 1/2/4 grid.
   ========================================================= */

const ICON: Record<ServiceKey, typeof Search> = {
  seo: Search,
  ppc: Megaphone,
  social: Share2,
  content: FileText,
  email: Mail,
  analytics: BarChart3,
  branding: Palette,
  web: Code2,
};

export function Services() {
  return (
    <section id="services" className="section scroll-mt-20 bg-white">
      <div className="shell">
        <Reveal>
          <SectionHead
            eyebrow="What we do"
            title="Our"
            accent="Services"
            subtitle="Full-stack performance marketing tailored to your business goals."
          />
        </Reveal>

        <RevealGroup as="ul" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((s) => {
            const Icon = ICON[s.key];
            return (
              <Reveal key={s.key} as="li">
                <Link
                  to="/contact"
                  aria-label={`Enquire about ${s.name}`}
                  className="card card-hover group flex h-full flex-col p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-green-100 text-green-600 transition-colors group-hover:bg-green-500 group-hover:text-white">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="mt-4 font-display text-[17px] font-extrabold leading-tight text-dark-900">
                    {s.name}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-dark-600">{s.body}</p>
                </Link>
              </Reveal>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
