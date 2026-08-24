import { motion } from "framer-motion";
import step1 from "../../images/step-1.png";
import step2 from "../../images/step-2.png";
import step3 from "../../images/step-3.png";
import step4 from "../../images/step-4.png";
import step5 from "../../images/step-5.png";
import {
  ArrowRight,
  Award,
  Cloud,
  Factory,
  Gift,
  Leaf,
  PackageCheck,
  Recycle,
  ShieldCheck,
  Users,
} from "lucide-react";

import {
  PageShell,
  TierGrid,
} from "../components/eco/EcoRewardsComponents";

/* =========================================================
   ANIMATION
========================================================= */

const fadeUp = {
  hidden: {
    opacity: 0,
    y: 40,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.65,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
};

const stagger = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

/* =========================================================
   DATA
========================================================= */

const sustainabilityBadges = [
  {
    icon: ShieldCheck,
    label: "Responsible Materials",
  },
  {
    icon: Factory,
    label: "Cleaner Manufacturing",
  },
  {
    icon: Cloud,
    label: "Lower Carbon Impact",
  },
  {
    icon: Recycle,
    label: "Circular Packaging",
  },
];

const recyclingSteps = [
  {
    number: "01",
    title: "Collect",
    text: "Keep used recyclable packaging aside.",
    image: step1,
  },
  {
    number: "02",
    title: "Schedule Pickup",
    text: "Choose a convenient collection slot.",
    image: step2,
  },
  {
    number: "03",
    title: "Inspection",
    text: "We verify material and recycling eligibility.",
    image: step3,
  },
  {
    number: "04",
    title: "Recycle",
    text: "Approved packaging enters recovery streams.",
    image: step4,
  },
  {
    number: "05",
    title: "Earn Rewards",
    text: "Verified returns add points to your wallet.",
    image: step5,
  },
];

const earningMethods = [
  
  {
    icon: Recycle,
    title: "Return Packaging",
    text: "Recycle eligible used packaging with us.",
    points: "+100 pts",
  },
  {
    icon: Users,
    title: "Refer a Business",
    text: "Invite another business to join Zolo.",
    points: "+250 pts",
  },
 
];

const benefits = [
  {
    icon: Leaf,
    title: "Less Waste",
    text: "Better planet",
  },
  {
    icon: Cloud,
    title: "Lower Emissions",
    text: "Cleaner future",
  },
  {
    icon: PackageCheck,
    title: "More Recovery",
    text: "Packaging reused",
  },
  {
    icon: Gift,
    title: "More Rewards",
    text: "Impact rewarded",
  },
];

const stats = [
  {
    value: "10K+",
    label: "Participants",
    icon: Users,
  },
  {
    value: "50K+",
    label: "Packs Recycled",
    icon: PackageCheck,
  },
  {
    value: "120T",
    label: "CO₂ Reduced",
    icon: Cloud,
  },
  {
    value: "1M+",
    label: "Points Issued",
    icon: Award,
  },
];

/* =========================================================
   REUSABLE SECTION HEADING
========================================================= */

function SectionHeading({
  eyebrow,
  title,
  description,
  center = true,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: string;
  center?: boolean;
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.25 }}
      className={
        center
          ? "mx-auto max-w-2xl text-center"
          : "max-w-2xl"
      }
    >
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-green-600">
        {eyebrow}
      </p>

      <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl dark:text-white">
        {title}
      </h2>

      {description && (
        <p className="mt-3 leading-7 text-slate-500 dark:text-dark-300">
          {description}
        </p>
      )}
    </motion.div>
  );
}

/* =========================================================
   PAGE
========================================================= */

export default function EcoRewards() {
  return (
    <PageShell
      eyebrow="Zolo Sustainability"
      title={
        <>
          Better packaging.
          <br />

          <span className="grad-text">
            Rewarding impact.
          </span>
        </>
      }
      subtitle="Choose responsibly, recycle used packaging and earn rewards for every positive action."
    >
      <main className="overflow-hidden bg-white dark:bg-dark-950">

         {/* =====================================================
            8. FINAL IMPACT CTA
        ====================================================== */}

<section className="pb-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">

            <motion.div
              initial={{
                opacity: 0,
                y: 50,
                scale: 0.98,
              }}
              whileInView={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              viewport={{
                once: true,
                amount: 0.2,
              }}
              transition={{
                duration: 0.8,
              }}
              className="relative overflow-hidden rounded-[32px] bg-[#073b23]"
            >

              {/* REAL BACKGROUND IMAGE SPACE */}

              <img
                src="/images/eco/green-earth.webp"
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-35"
              />

              <div className="absolute inset-0 bg-gradient-to-r from-[#052f1c] via-[#073b23]/95 to-[#073b23]/40" />

              <div className="relative z-10 px-7 py-14 sm:px-12 lg:px-16 lg:py-16">

                <p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">
                  Better tomorrow starts today
                </p>

                <h2 className="mt-4 max-w-2xl font-display text-4xl font-extrabold leading-tight text-white sm:text-5xl">
                  Every action{" "}
                  <span className="text-lime-400">
                    counts.
                  </span>

                  <br />

                  Every pack{" "}
                  <span className="text-lime-400">
                    matters.
                  </span>
                </h2>

                <p className="mt-5 max-w-lg leading-7 text-green-50/80">
                  Choose better packaging, return what you
                  can and get rewarded for building a more
                  circular future.
                </p>

                <a
                  href="#recycling"
                  className="mt-7 inline-flex items-center gap-2 rounded-xl bg-lime-400 px-6 py-3 font-bold text-green-950 transition hover:-translate-y-1 hover:bg-lime-300"
                >
                  Start Recycling

                  <ArrowRight size={18} />
                </a>
              </div>
            </motion.div>

            {/* Impact Stats */}

            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="relative z-20 mx-4 -mt-3 grid rounded-b-[24px] border border-slate-200 bg-white shadow-lg sm:grid-cols-2 lg:grid-cols-4 dark:border-dark-800 dark:bg-dark-900"
            >
              {stats.map(
                ({ value, label, icon: Icon }) => (
                  <motion.div
                    key={label}
                    variants={fadeUp}
                    className="flex items-center justify-center gap-4 px-6 py-6 lg:border-r lg:border-slate-200 lg:last:border-0 dark:lg:border-dark-700"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-green-50 text-green-600 dark:bg-green-950/30">
                      <Icon size={21} />
                    </div>

                    <div>
                      <p className="text-xl font-extrabold text-green-800 dark:text-green-400">
                        {value}
                      </p>

                      <p className="text-xs text-slate-500">
                        {label}
                      </p>
                    </div>
                  </motion.div>
                )
              )}
            </motion.div>
          </div>
        </section>

        {/* =====================================================
            1. INTRO
        ====================================================== */}

        <section className="relative py-16 lg:py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">

            {/* Content */}

            <motion.div
              initial={{ opacity: 0, x: -40 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.75 }}
            >
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-green-600">
                Packaging with purpose
              </p>

              <h2 className="mt-4 max-w-xl font-display text-4xl font-extrabold leading-tight text-slate-950 sm:text-5xl dark:text-white">
                Your packaging can have a{" "}
                <span className="text-green-600">
                  second life.
                </span>
              </h2>

              <p className="mt-5 max-w-xl text-lg leading-8 text-slate-500 dark:text-dark-300">
                We make it easier to choose responsible packaging,
                return eligible materials and turn sustainable
                actions into real rewards.
              </p>

              <motion.div
                variants={stagger}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="mt-8 grid gap-3 sm:grid-cols-2"
              >
                {sustainabilityBadges.map(
                  ({ icon: Icon, label }) => (
                    <motion.div
                      key={label}
                      variants={fadeUp}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-dark-800 dark:bg-dark-900"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-950/30">
                        <Icon size={18} />
                      </div>

                      <span className="text-sm font-semibold text-slate-700 dark:text-white">
                        {label}
                      </span>
                    </motion.div>
                  )
                )}
              </motion.div>
            </motion.div>

            {/* REAL IMAGE SPACE */}

            <motion.div
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              whileInView={{
                opacity: 1,
                x: 0,
                scale: 1,
              }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative"
            >
              <div className="absolute -inset-6 rounded-full bg-green-200/30 blur-3xl" />

              <div className="relative overflow-hidden rounded-[32px] bg-green-50 shadow-[0_30px_80px_rgba(22,101,52,0.15)]">

                <img
                  src="/images/recycle.jpg"
                  alt="Sustainable recyclable packaging"
                  className="h-[780px] w-full object-cover"
                />

              </div>
            </motion.div>
          </div>
        </section>

        {/* =====================================================
            2. RECYCLING JOURNEY
        ====================================================== */}

        <section
          id="recycling"
          className="relative border-y border-green-100 bg-gradient-to-b from-green-50/70 via-white to-white py-20 dark:border-dark-800 dark:from-green-950/10 dark:via-dark-950 dark:to-dark-950"
        >
          <div className="mx-auto max-w-[1450px] px-4 sm:px-6">

            <SectionHeading
              eyebrow="Our Loop"
              title="Recycling made simple"
              description="Five simple steps turn used packaging into measurable impact and reward points."
            />

            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.12 }}
              className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-5"
            >
              {recyclingSteps.map(
                (
                  {
                    number,
                    title,
                    text,
                    image,
                  },
                  index
                ) => (
                  <motion.article
                    key={title}
                    variants={fadeUp}
                    whileHover={{ y: -8 }}
                    className="group relative rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_8px_35px_rgba(15,23,42,0.05)] dark:border-dark-800 dark:bg-dark-900"
                  >

                    {/* Image */}

                    <div className="relative h-44 overflow-hidden rounded-[18px] bg-green-50">

                      <img
                        src={image}
                        alt={title}
                        className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                      />

                      <div className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white shadow-md">
                        {number}
                      </div>
                    </div>

                    <div className="px-2 pb-3 pt-5">
                      <h3 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                        {title}
                      </h3>

                      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-dark-300">
                        {text}
                      </p>
                    </div>

                    {index !==
                      recyclingSteps.length - 1 && (
                      <div className="absolute -right-[17px] top-[105px] z-20 hidden h-9 w-9 items-center justify-center rounded-full border border-green-100 bg-white shadow-md lg:flex">
                        <ArrowRight
                          size={16}
                          className="text-green-600"
                        />
                      </div>
                    )}
                  </motion.article>
                )
              )}
            </motion.div>

            {/* Benefits */}

            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="mt-10 grid overflow-hidden rounded-2xl border border-green-100 bg-green-50/70 sm:grid-cols-2 lg:grid-cols-4 dark:border-green-900/30 dark:bg-green-950/10"
            >
              {benefits.map(
                ({ icon: Icon, title, text }) => (
                  <motion.div
                    key={title}
                    variants={fadeUp}
                    className="flex items-center justify-center gap-4 p-5 lg:border-r lg:border-green-100 lg:last:border-0 dark:lg:border-green-900/30"
                  >
                    <Icon
                      size={27}
                      className="text-green-600"
                    />

                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">
                        {title}
                      </p>

                      <p className="text-sm text-slate-500">
                        {text}
                      </p>
                    </div>
                  </motion.div>
                )
              )}
            </motion.div>
          </div>
        </section>

       
        {/* =====================================================
            4. EARN POINTS
        ====================================================== */}

        <section className="flex justify-center bg-slate-50 py-20 dark:bg-dark-900/40">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">

            <SectionHeading
              eyebrow="Earn"
              title="Small actions. Real rewards."
              description="Earn points through the actions that create the most meaningful impact."
            />

            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-2"
            >
              {earningMethods.map(
                ({
                  icon: Icon,
                  title,
                  text,
                  points,
                }) => (
                  <motion.div
                    key={title}
                    variants={fadeUp}
                    whileHover={{
                      y: -7,
                      scale: 1.01,
                    }}
                    className="group rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-xl dark:border-dark-800 dark:bg-dark-900"
                  >
                    <div className="flex items-start justify-between">

                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-green-50 text-green-600 transition group-hover:scale-110 dark:bg-green-950/30">
                        <Icon size={28} />
                      </div>

                      <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                        {points}
                      </span>
                    </div>

                    <h3 className="mt-6 text-lg font-bold text-slate-950 dark:text-white">
                      {title}
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {text}
                    </p>
                  </motion.div>
                )
              )}
            </motion.div>
          </div>
        </section>

       
        {/* =====================================================
            6. MEMBERSHIP
        ====================================================== */}

        <section className="border-y border-slate-100 bg-slate-50 py-20 dark:border-dark-800 dark:bg-dark-900/40">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">

            <SectionHeading
              eyebrow="Membership"
              title="Grow your impact. Unlock more."
              description="Your contribution moves you through membership levels with better benefits."
            />

            <motion.div
              initial={{ opacity: 0, y: 35 }}
              whileInView={{
                opacity: 1,
                y: 0,
              }}
              viewport={{ once: true }}
              className="mt-10"
            >
              <TierGrid />
            </motion.div>
          </div>
        </section>

       
       
      </main>
    </PageShell>
  );
}