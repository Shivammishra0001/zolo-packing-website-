import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AtSign } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useAuthSession } from "./AuthContext";
import { PasswordInput } from "./PasswordInput";
import { SocialDivider } from "./SocialDivider";
import { SubmitButton } from "./SubmitButton";
import { TextField } from "./TextField";
import { loginSchema, type LoginFormValues } from "@/lib/auth/validation";
import { AuthUnavailableError } from "@/lib/auth/service";

/** Login with email OR Indian mobile number, plus password. */
export function LoginForm() {
  const { login } = useAuthSession();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: "onChange",
    defaultValues: { identifier: "", password: "", rememberMe: false },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitting(true);
    try {
      // Password lives only in this call's arguments — never stored anywhere.
      await login(values);
      toast.success("Signed in", "Welcome back to Zolo Packaging.");
    } catch (err) {
      if (err instanceof AuthUnavailableError) {
        toast.error(
          "Can't reach the server",
          "The sign-in service is unavailable right now. Please try again shortly.",
        );
      } else {
        // Invalid credentials (generic — never reveals whether the email exists).
        toast.error("Sign-in failed", "That email or password doesn't match. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <TextField
        label="Email or Phone"
        icon={AtSign}
        placeholder="you@example.com or 98xxxxxxxx"
        autoComplete="username"
        autoFocus
        error={errors.identifier?.message}
        {...register("identifier")}
      />

      <PasswordInput
        label="Password"
        placeholder="Enter your password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />

      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-dark-600 dark:text-dark-300">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-dark-300 text-primary-500 focus:ring-primary-500 dark:border-dark-600 dark:bg-dark-800"
            {...register("rememberMe")}
          />
          Remember me
        </label>
        <button
          type="button"
          onClick={() =>
            toast.info("Password reset", "A reset flow will be available once the backend is connected.")
          }
          className="text-sm font-semibold text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400"
        >
          Forgot password?
        </button>
      </div>

      <SubmitButton loading={submitting} disabled={!isValid}>
        {submitting ? "Signing in…" : "Log In"}
      </SubmitButton>

      <SocialDivider label="or continue with" />

      <button
        type="button"
        onClick={() => toast.info("Social sign-in", "Google sign-in connects with the backend integration.")}
        className="inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-dark-200 bg-white text-sm font-semibold text-dark-700 transition-colors hover:bg-dark-50 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-100 dark:hover:bg-dark-700"
      >
        <GoogleGlyph /> Continue with Google
      </button>
    </form>
  );
}

function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.22V7.04H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  );
}
