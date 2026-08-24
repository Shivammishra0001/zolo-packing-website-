import { Check, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { assessPassword, STRENGTH_LABEL } from "@/lib/auth/password-strength";
import type { PasswordStrengthLevel } from "@/lib/auth/types";

const LEVEL_STYLE: Record<
  PasswordStrengthLevel,
  { bar: string; text: string; segments: number }
> = {
  weak: { bar: "bg-red-500", text: "text-red-600 dark:text-red-400", segments: 1 },
  medium: { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", segments: 2 },
  strong: { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", segments: 3 },
  "very-strong": { bar: "bg-emerald-600", text: "text-emerald-700 dark:text-emerald-400", segments: 4 },
};

/** Live meter + rule checklist. Purely advisory — server enforces its own policy. */
export function PasswordStrength({ password, id }: { password: string; id?: string }) {
  const { level, rules } = assessPassword(password);
  const style = LEVEL_STYLE[level];
  const active = password.length > 0;

  return (
    <div id={id} className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors duration-300",
                active && i < style.segments ? style.bar : "bg-dark-200 dark:bg-dark-700",
              )}
            />
          ))}
        </div>
        <span className={cn("w-20 text-right text-xs font-bold", active ? style.text : "text-dark-400")}>
          {active ? STRENGTH_LABEL[level] : "—"}
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {active ? `Password strength: ${STRENGTH_LABEL[level]}` : ""}
      </p>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-1.5 text-xs transition-colors",
              rule.passed ? "text-emerald-600 dark:text-emerald-400" : "text-dark-400",
            )}
          >
            {rule.passed ? (
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {rule.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
