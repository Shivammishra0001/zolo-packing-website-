import { useState } from "react";
import LogoLoop, { type LogoItem } from "./LogoLoop";
import { SectionHeader } from "./UI";

// ============================================================
// Trusted by Leading Brands — customer-logo marquee on the cream band.
//
// IMAGE-ONLY: each card shows the brand's real logo from /logos/<file>. Drop
// the PNG/JPG into public/logos/ (Vite serves that folder at the site root).
// A card whose image is missing is hidden — no text placeholder, no broken
// icon — so only real logos ever appear.
// ============================================================

interface Customer { name: string; src: string }

// `src` is a path under public/. To add a brand's logo, drop the file into
// public/logos/ and point its src here (any extension: .png/.jpg/.jpeg/.svg).
const CUSTOMERS: Customer[] = [
  { name: "Sri Shiv", src: "/logos/sri-shiv.jpeg" },
  { name: "SARA GOLD", src: "/logos/sagar-logo.jpeg" },
  { name: "KIRPM", src: "/logos/kirpm.jpeg" },
  { name: "sks", src: "/logos/sks-logo.png" },
  { name: "EZEE", src: "/logos/ezee.png" },
  { name: "HPL", src: "/logos/hpl.png" },
  { name: "ACI gold", src: "/logos/aci-gold.png" },
];

// Must match `bg-cream-50` (--color-cream-50) so the marquee's edge fade
// dissolves into the section surface.
const CREAM_50 = "#fcfaf2";

/** A single logo image. On load failure it calls `onFail` so the parent can
 *  remove it from the marquee entirely — otherwise a missing file would leave
 *  an empty slot that still reserves a gap and breaks even spacing. */
function LogoImg({ customer, onFail }: { customer: Customer; onFail: () => void }) {
  return (
    <img
      src={customer.src}
      alt={customer.name}
      loading="lazy"
      decoding="async"
      onError={onFail}
      className="h-full w-auto max-w-none rounded-lg object-contain"
    />
  );
}

export default function TrustedCustomers() {
  // Track which logo files fail to load and drop them from the marquee, so a
  // missing file never leaves an empty gap.
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const logos: LogoItem[] = CUSTOMERS.filter((c) => !broken.has(c.src)).map((c) => ({
    alt: c.name,
    node: (
      <LogoImg
        customer={c}
        onFail={() => setBroken((prev) => (prev.has(c.src) ? prev : new Set(prev).add(c.src)))}
      />
    ),
  }));

  return (
    <section className="section-sm overflow-hidden bg-cream-50" aria-label="Trusted by leading brands">
      {/* Heading — constrained to the readable column */}
      <div className="shell">
        <SectionHeader
          align="center"
          eyebrow="Trusted by leading brands"
          title="Our valued customers"
          subtitle="Proud to deliver packaging solutions for businesses across industries"
        />
      </div>

      {/* Logo marquee — full-bleed: spans edge-to-edge of the viewport */}
      <div className="mt-6 w-full sm:mt-8">
        <LogoLoop
          logos={logos}
          speed={70}
          direction="left"
          logoHeight={72}
          gap={28}
          hoverSpeed={0}
          scaleOnHover
          fadeOut
          fadeOutColor={CREAM_50}
          ariaLabel="Zolo Packaging customers"
        />
      </div>
    </section>
  );
}
