import { motion } from "framer-motion";
import { Headphones, Palette, ShieldCheck, Truck } from "lucide-react";

// ============================================================
// BenefitStrip — the compact reassurance bar directly under the hero (§8).
//
// Kept deliberately short: icon + 2-word title + one clause, on one row at
// desktop. It rides the seam between the hero and the category band (a
// negative top margin lifts it onto the hero's edge), which removes the dead
// white gutter the old layout had between two full-width sections.
//
// Every claim here is a service fact Zolo already publishes elsewhere on the
// site (shipping note, quote flow, contact hours) — nothing invented.
// ============================================================

const BENEFITS = [
  { icon: Truck, title: "Pan-India delivery", desc: "Tracked dispatch nationwide" },
  { icon: ShieldCheck, title: "Secure payments", desc: "UPI, cards & net banking" },
  { icon: Palette, title: "Custom packaging", desc: "Your size, print & material" },
  { icon: Headphones, title: "Business support", desc: "Talk to a real person" },
];

export function BenefitStrip() {
  return (
    <div className="shell relative z-10 -mt-7 hidden sm:block">
      <motion.ul
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
        className="grid grid-cols-2 divide-y divide-dark-100 rounded-[14px] border border-dark-200 bg-white shadow-card lg:grid-cols-4 lg:divide-y-0"
      >
        {BENEFITS.map((b, i) => (
          <li
            key={b.title}
            className={`flex items-center gap-3 px-4 py-3.5 ${i % 2 === 1 ? "border-l border-dark-100" : ""} lg:border-l lg:first:border-l-0`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-500">
              <b.icon className="h-4.5 w-4.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-dark-900">{b.title}</span>
              <span className="block truncate text-xs text-dark-500">{b.desc}</span>
            </span>
          </li>
        ))}
      </motion.ul>
    </div>
  );
}
