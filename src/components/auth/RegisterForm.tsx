import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Phone, User } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useAuthSession } from "./AuthContext";
import { PasswordInput } from "./PasswordInput";
import { PasswordStrength } from "./PasswordStrength";
import { SubmitButton } from "./SubmitButton";
import { TextField } from "./TextField";
import { registerSchema, type RegisterFormValues } from "@/lib/auth/validation";
import { AuthUnavailableError } from "@/lib/auth/service";

/** Create a BUYER account — Full Name, Phone, Email, Password (all required). */
export function RegisterForm() {
  const { register: registerUser } = useAuthSession();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const strengthId = "register-password-strength";

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: "onChange",
    defaultValues: { fullName: "", phone: "", email: "", password: "" },
  });

  // Watched only to drive the live strength meter — not persisted anywhere.
  const password = watch("password");

  const onSubmit = async (values: RegisterFormValues) => {
    setSubmitting(true);
    try {
      // Password is passed straight to the service and then discarded.
      // On success AuthContext closes the modal and resumes the pending action.
      await registerUser(values);
      toast.success("Account created", "Welcome to Zolo Packaging!");
    } catch (err) {
      if (err instanceof AuthUnavailableError) {
        toast.error(
          "Can't reach the server",
          "The registration service is unavailable right now. Please try again shortly.",
        );
      } else {
        // Surfaces "email already exists" and other server messages.
        toast.error("Couldn't create account", err instanceof Error ? err.message : "Please try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <TextField
        label="Full Name"
        icon={User}
        placeholder="e.g. Priya Nair"
        autoComplete="name"
        error={errors.fullName?.message}
        {...register("fullName")}
      />

      <TextField
        label="Phone Number"
        type="tel"
        inputMode="tel"
        icon={Phone}
        placeholder="98xxxxxxxx"
        autoComplete="tel"
        error={errors.phone?.message}
        {...register("phone")}
      />

      <TextField
        label="Email Address"
        type="email"
        icon={Mail}
        placeholder="you@example.com"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />

      <div className="space-y-2">
        <PasswordInput
          label="Password"
          placeholder="Create a strong password"
          autoComplete="new-password"
          describedById={strengthId}
          error={errors.password?.message}
          {...register("password")}
        />
        <PasswordStrength password={password} id={strengthId} />
      </div>

      <SubmitButton loading={submitting} disabled={!isValid}>
        {submitting ? "Creating account…" : "Create Account"}
      </SubmitButton>
    </form>
  );
}
