import { Link } from "react-router-dom";
import { ArrowRight, Clock } from "lucide-react";
import { ARTICLES } from "./content";
import { CardPhoto } from "./CardPhoto";
import { ARTICLE_PHOTO } from "./photos";
import { Reveal, RevealGroup, SectionHead } from "./shared";

/* =========================================================
   Section 6 — Latest Insights. Three article cards.
   ========================================================= */

export function Insights() {
  return (
    <section className="section bg-dark-50">
      <div className="shell">
        <Reveal>
          <SectionHead
            eyebrow="From the blog"
            title="Latest"
            accent="Insights"
            subtitle="Actionable strategies and insights from our team."
          />
        </Reveal>

        <RevealGroup as="ul" className="mt-10 grid gap-5 md:grid-cols-3">
          {ARTICLES.map((a) => (
            <Reveal key={a.title} as="li" className="h-full">
              <article className="card card-hover group flex h-full flex-col overflow-hidden">
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-cream-50">
                  <CardPhoto
                    photo={ARTICLE_PHOTO[a.photo]}
                    monogram={a.category}
                    category={a.category}
                    shape={a.shape}
                    sizes="(min-width:768px) 33vw, 100vw"
                    className="transition-transform duration-500 ease-out group-hover:scale-[1.06] motion-reduce:transform-none motion-reduce:transition-none"
                  />
                  <span className="badge absolute left-3 top-3 bg-green-500 text-white">{a.category}</span>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <p className="flex items-center gap-2 text-[12px] text-dark-500">
                    <time>{a.date}</time>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      {a.readingTime}
                    </span>
                  </p>
                  <h3 className="mt-2 font-display text-[16px] font-extrabold leading-snug text-dark-900">
                    {a.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-dark-600">{a.body}</p>

                  <Link
                    to="/contact"
                    aria-label={`Read more about ${a.title}`}
                    className="mt-4 inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-bold text-green-600 transition-colors hover:text-green-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
                  >
                    Read More
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden />
                  </Link>
                </div>
              </article>
            </Reveal>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
