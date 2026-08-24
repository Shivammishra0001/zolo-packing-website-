import type { ReactNode } from "react";
import { motion } from "framer-motion";

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "left",
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className={`max-w-3xl ${align === "center" ? "mx-auto text-center" : ""}`}
    >
      {eyebrow && (
        <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-primary-600">
          <span className="h-1 w-6 rounded-full bg-primary-500" />
          {eyebrow}
        </div>
      )}
      <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-dark-900 dark:text-white leading-[1.05]">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-3 text-base sm:text-lg text-dark-500 dark:text-dark-300 leading-relaxed">{subtitle}</p>
      )}
    </motion.div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = {
    sm: "px-3.5 py-2 text-sm",
    md: "px-5 py-2.5 text-sm",
    lg: "px-7 py-3.5 text-base",
  };
  const variants = {
    primary: "bg-dark-900 text-white hover:bg-primary-500 shadow-sm",
    secondary: "bg-primary-500 text-white hover:bg-primary-600 shadow-sm shadow-primary-500/30",
    outline: "bg-white text-dark-800 border border-dark-200 hover:border-dark-900 hover:bg-dark-50",
    ghost: "bg-transparent text-dark-700 hover:bg-dark-50",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border ${
        active
          ? "bg-dark-900 text-white border-dark-900"
          : "bg-white text-dark-600 border-dark-200 hover:border-dark-400"
      }`}
    >
      {children}
    </button>
  );
}

// Legacy ProductCard wrapper that uses NewProductCard
export { ProductCard } from "./NewProductCard";
