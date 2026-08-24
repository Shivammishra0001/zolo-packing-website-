import { z } from "zod";
import {
  EMAIL_REGEX,
  INDIAN_MOBILE_REGEX,
  PASSWORD_MIN_LENGTH,
} from "./constants";
import { isStrongPassword } from "./password-strength";

// ---------- Zod schemas: the single source of validation truth ----------
// NOTE: client-side validation is a UX convenience only. The backend must
// re-validate everything server-side.

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters`)
  .refine(isStrongPassword, {
    message: "Must include uppercase, lowercase, a number and a special character",
  });

export const loginSchema = z.object({
  // Email OR Indian mobile — the backend resolves either against a unique
  // email / unique normalized phone.
  identifier: z
    .string()
    .trim()
    .min(1, "Enter your email or phone number")
    .refine(
      (v) => EMAIL_REGEX.test(v) || INDIAN_MOBILE_REGEX.test(v),
      "Enter a valid email or Indian mobile number",
    ),
  password: z.string().min(1, "Enter your password"),
  rememberMe: z.boolean(),
});

export const registerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name is required"),
  phone: z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .regex(INDIAN_MOBILE_REGEX, "Enter a valid Indian mobile number (10 digits, starts 6–9)"),
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .regex(EMAIL_REGEX, "Enter a valid email address"),
  password: passwordSchema,
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterFormValues = z.infer<typeof registerSchema>;
