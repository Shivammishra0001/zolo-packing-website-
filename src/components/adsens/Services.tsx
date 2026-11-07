import { Link } from "react-router-dom";
import {
  BarChart3, Code2, FileText, Mail, Megaphone, Palette, Search, Share2,
} from "lucide-react";
import { SERVICES, type ServiceKey } from "./content";
import { Reveal, RevealGroup, SectionHead } from "./shared";
import { SERVICE_PHOTO } from "./photos";

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
                  className="card card-hover group flex h-full flex-col overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
                >
                  {/* A photo of the discipline, with the icon chip riding
                      over its lower edge so the card keeps its anchor. */}
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-dark-100">
                    <img
                      src={SERVICE_PHOTO[s.key].src}
                      srcSet={SERVICE_PHOTO[s.key].srcSet}
                      sizes="(min-width:1024px) 25vw, (min-width:640px) 50vw, 100vw"
                      alt={SERVICE_PHOTO[s.key].alt}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06] motion-reduce:transform-none motion-reduce:transition-none"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-16"
                      style={{ background: "linear-gradient(to top, rgba(15,23,42,0.55), transparent)" }}
                    />
                    <span className="absolute bottom-3 left-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/95 text-green-600 shadow-sm backdrop-blur transition-colors group-hover:bg-green-500 group-hover:text-white">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="font-display text-[17px] font-extrabold leading-tight text-dark-900">
                      {s.name}
                    </h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-dark-600">{s.body}</p>
                  </div>
                </Link>
              </Reveal>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
