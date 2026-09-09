import { useState } from "react";
import { Package, ShieldCheck, Users } from "lucide-react";
import LogoLoop, { type LogoItem } from "./LogoLoop";
// Branded cream backdrop (leaves, kraft boxes, zolo mark) — supplies the
// section's decoration, so no extra decorative elements are added over it.
import customerBg from "../../images/customer-section.png";

// ============================================================
// Trusted by Leading Brands — customer-logo marquee.
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

/** One white logo card. If the image is missing it renders nothing. */
function LogoCard({ customer }: { customer: Customer }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
    src={customer.src}
    alt={customer.name}
    loading="lazy"
    decoding="async"
    onError={() => setFailed(true)}
    className="max-h-full max-w-full object-contain"
  />
  );
}

const TRUST_POINTS = [
  { icon: Package, label: "Custom Packaging" },
  { icon: ShieldCheck, label: "Trusted Quality" },
  { icon: Users, label: "Growing Together" },
];

export default function TrustedCustomers() {
  const logos: LogoItem[] = CUSTOMERS.map((c) => ({
    alt: c.name,
    node: <LogoCard customer={c} />,
  }));

  return (
    <section
      className="relative overflow-hidden bg-cover bg-center bg-no-repeat py-20"
      style={{ backgroundImage: `url(${customerBg})` }}
    >
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        {/* Heading */}
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600">
            <span className="mr-2 inline-block h-1 w-6 rounded-full bg-primary-500" />
            Trusted by Leading Brands
          </div>
          <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-dark-900 sm:text-4xl lg:text-5xl">
            Our Valued <span className="grad-text">Customers</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-dark-500 sm:text-lg">
            Proud to deliver packaging solutions for businesses across industries
          </p>
        </div>

        {/* Logo marquee */}
        <div className="mt-3">
          <LogoLoop
            logos={logos}
            speed={70}
            direction="left"
            logoHeight={100}
            gap={28}
            hoverSpeed={0}
            scaleOnHover
            fadeOut
            fadeOutColor="#f7f1e6"
            ariaLabel="Zolo Packaging customers"
          />
        </div>

        {/* Trust indicators */}
        <div className="mx-auto mt-12 grid max-w-2xl grid-cols-3 gap-4 sm:gap-8">
          {TRUST_POINTS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-center sm:gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-primary-600 shadow-sm ring-1 ring-dark-100">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-xs font-semibold text-dark-700 sm:text-sm">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
