import { useEffect } from "react";
import { Hero } from "../components/adsens/Hero";
import { Services } from "../components/adsens/Services";
import { Campaigns } from "../components/adsens/Campaigns";
import { Portfolio } from "../components/adsens/Portfolio";
import { Testimonials } from "../components/adsens/Testimonials";
import { Insights } from "../components/adsens/Insights";
import { FinalCta } from "../components/adsens/FinalCta";

/* =========================================================
   AdSense by Zolo — performance marketing landing page.

   Sections follow the reference design's order exactly:
     1 Hero (+ stats, live ad panel)   5 Testimonials
     2 Our Services (8)                6 Latest Insights (3)
     3 Active Campaigns (4)            7 Final CTA
     4 Our Portfolio (6, filterable)

   The AdSens footer band was removed from the composition; the global
   <Footer> in App.tsx closes the page. AdsensFooter.tsx is still present
   if it is wanted back.

   Content lives in ./components/adsens/content.ts; this file is pure
   composition. The page is built from the app's own tokens and utilities
   (.shell, .card, .btn, .chip, green brand / orange CTA) rather than the
   reference's dark palette, so it reads as part of Zolo.
   ========================================================= */

export default function AdSens() {
  // The page's own title, restored on unmount so a later route does not
  // inherit it.
  useEffect(() => {
    const previous = document.title;
    document.title = "AdSense by Zolo — Performance Marketing Agency";
    return () => { document.title = previous; };
  }, []);

  return (
    <main>
      <Hero />
      <Services />
      <Campaigns />
      <Portfolio />
      <Testimonials />
      <Insights />
      <FinalCta />
    </main>
  );
}
