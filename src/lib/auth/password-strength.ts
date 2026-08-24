import { PASSWORD_MIN_LENGTH } from "./constants";
import type {
  PasswordRuleResult,
  PasswordStrengthLevel,
  PasswordStrengthResult,
} from "./types";

/** The rules shown as a live checklist while the user types */
const RULES: { id: string; label: string; test: (pw: string) => boolean }[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
  },
  { id: "upper", label: "An uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { id: "lower", label: "A lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { id: "number", label: "A number", test: (pw) => /\d/.test(pw) },
  {
    id: "special",
    label: "A special character",
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

export function isStrongPassword(pw: string): boolean {
  return RULES.every((r) => r.test(pw));
}

/**
 * Score 0–4 → Weak / Medium / Strong / Very Strong.
 * All five rules must pass to reach "strong"; extra length pushes to
 * "very strong". This is UX guidance only — the backend must enforce its
 * own password policy server-side.
 */
export function assessPassword(pw: string): PasswordStrengthResult {
  const rules: PasswordRuleResult[] = RULES.map((r) => ({
    id: r.id,
    label: r.label,
    passed: r.test(pw),
  }));
  const passed = rules.filter((r) => r.passed).length;

  let level: PasswordStrengthLevel;
  let score: number;
  if (passed <= 2) {
    level = "weak";
    score = pw.length === 0 ? 0 : 1;
  } else if (passed <= 4) {
    level = "medium";
    score = 2;
  } else if (pw.length >= 12) {
    level = "very-strong";
    score = 4;
  } else {
    level = "strong";
    score = 3;
  }
  return { level, score, rules };
}

export const STRENGTH_LABEL: Record<PasswordStrengthLevel, string> = {
  weak: "Weak",
  medium: "Medium",
  strong: "Strong",
  "very-strong": "Very Strong",
};
