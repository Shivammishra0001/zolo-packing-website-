// Shared zod schemas. The backend is the final authority on validation.
import { z } from "zod";

// Password policy: 8+ chars, at least one letter and one digit.
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a digit");

export const registerSchema = z.object({
  email: z.string().email(),
  password,
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  phone: z.string().max(20).optional(),
  accountType: z.enum(["buyer", "seller"]).default("buyer"),
  companyName: z.string().max(160).optional(),
});

// Login accepts an email OR a phone number in a single `identifier` field.
// (Legacy `email` is still accepted for backward compatibility.)
export const loginSchema = z
  .object({
    identifier: z.string().min(1).optional(),
    email: z.string().optional(),
    password: z.string().min(1),
  })
  .refine((v) => (v.identifier && v.identifier.trim()) || (v.email && v.email.trim()), {
    message: "Email or phone is required",
    path: ["identifier"],
  });

// --- Indian tax identifiers (format only; not government-verified) ----------
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const CIN_RE = /^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const optionalStr = z.string().trim().max(500).optional().nullable();

// Onboarding patch — every field optional (drafts persist partial data). The
// heavier "is this complete enough to submit?" check runs at submission time.
export const onboardingPatchSchema = z.object({
  // business
  legalName: optionalStr,
  displayName: optionalStr,
  businessType: z.enum(["MANUFACTURER", "CONVERTER", "TRADER", "DISTRIBUTOR", "PRINTING", "PACKAGING_SPECIALIST", "OTHER"]).optional().nullable(),
  registrationNumber: optionalStr,
  website: z.string().url().optional().nullable().or(z.literal("")),
  yearEstablished: z.number().int().min(1800).max(2100).optional().nullable(),
  employeeCount: z.number().int().min(0).optional().nullable(),
  annualTurnoverMinor: z.number().int().min(0).optional().nullable(),
  description: optionalStr,
  contactName: optionalStr,
  contactEmail: z.string().email().optional().nullable().or(z.literal("")),
  contactPhone: optionalStr,
  // legal & tax (normalised uppercase; format-validated when present)
  gstNumber: z.string().trim().transform((s) => s.toUpperCase()).refine((s) => s === "" || GSTIN_RE.test(s), "Invalid GSTIN format").optional().nullable(),
  panNumber: z.string().trim().transform((s) => s.toUpperCase()).refine((s) => s === "" || PAN_RE.test(s), "Invalid PAN format").optional().nullable(),
  cinNumber: z.string().trim().transform((s) => s.toUpperCase()).refine((s) => s === "" || CIN_RE.test(s), "Invalid CIN format").optional().nullable(),
  // wizard cursor
  onboardingStep: z.number().int().min(0).max(30).optional(),
});

export const locationSchema = z.object({
  locationType: z.enum(["HEAD_OFFICE", "FACTORY", "WAREHOUSE", "DISPATCH", "BILLING"]),
  isPrimary: z.boolean().optional(),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  postalCode: z.string().min(3).max(12),
  country: z.string().max(80).optional(),
  contactName: z.string().max(120).optional().nullable(),
  contactPhone: z.string().max(20).optional().nullable(),
});

export const capabilitySchema = z.object({
  category: z.string().min(1).max(120),
  subCategory: z.string().max(120).optional().nullable(),
  materials: z.array(z.string().max(80)).max(50).optional(),
  finishes: z.array(z.string().max(80)).max(50).optional(),
  printingMethods: z.array(z.string().max(80)).max(50).optional(),
  minimumOrderQuantity: z.number().int().min(0).optional().nullable(),
  maximumOrderQuantity: z.number().int().min(0).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
  customization: z.boolean().optional(),
  sampleAvailable: z.boolean().optional(),
});

export const capacitySchema = z.object({
  monthlyCapacity: z.number().int().min(0).optional().nullable(),
  dailyCapacity: z.number().int().min(0).optional().nullable(),
  minimumOrderQuantity: z.number().int().min(0).optional().nullable(),
  maximumOrderQuantity: z.number().int().min(0).optional().nullable(),
  standardLeadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
  rushCapacity: z.boolean().optional(),
  productionShifts: z.number().int().min(0).max(10).optional().nullable(),
  workingDays: z.number().int().min(0).max(7).optional().nullable(),
  seasonalNotes: z.string().max(1000).optional().nullable(),
});

export const machineSchema = z.object({
  machineName: z.string().min(1).max(160),
  machineType: z.string().max(120).optional().nullable(),
  manufacturer: z.string().max(120).optional().nullable(),
  model: z.string().max(120).optional().nullable(),
  quantity: z.number().int().min(1).max(9999).optional(),
  capacity: z.string().max(120).optional().nullable(),
  year: z.number().int().min(1900).max(2100).optional().nullable(),
  status: z.string().max(60).optional().nullable(),
});

export const materialSchema = z.object({
  material: z.string().min(1).max(120),
  grade: z.string().max(80).optional().nullable(),
  thickness: z.string().max(60).optional().nullable(),
  gsm: z.number().int().min(0).optional().nullable(),
  bf: z.number().int().min(0).optional().nullable(),
  flute: z.string().max(40).optional().nullable(),
  paperType: z.string().max(80).optional().nullable(),
  boardType: z.string().max(80).optional().nullable(),
  coating: z.string().max(80).optional().nullable(),
  lamination: z.string().max(80).optional().nullable(),
});

export const certificationSchema = z.object({
  name: z.string().min(1).max(120),
  certificateNumber: z.string().max(120).optional().nullable(),
  issuer: z.string().max(120).optional().nullable(),
  issueDate: z.string().datetime().optional().nullable().or(z.literal("")),
  expiryDate: z.string().datetime().optional().nullable().or(z.literal("")),
  documentId: z.string().optional().nullable(),
});

export const bankSchema = z.object({
  accountHolderName: z.string().min(1).max(160),
  bankName: z.string().min(1).max(160),
  accountNumber: z.string().min(6).max(30).regex(/^[0-9]+$/, "Account number must be digits"),
  ifsc: z.string().trim().transform((s) => s.toUpperCase()).refine((s) => IFSC_RE.test(s), "Invalid IFSC format"),
  branch: z.string().max(160).optional().nullable(),
  paymentTerms: z.string().max(200).optional().nullable(),
  currency: z.string().max(8).optional(),
  isPrimary: z.boolean().optional(),
});

export const qualitySchema = z.object({
  qualityProcess: z.string().max(4000).optional().nullable(),
  inspectionProcess: z.string().max(4000).optional().nullable(),
  testingCapability: z.string().max(4000).optional().nullable(),
  qcCertifications: z.array(z.string().max(120)).max(50).optional(),
  samplingProcess: z.string().max(4000).optional().nullable(),
  defectHandling: z.string().max(4000).optional().nullable(),
  returnReworkProcess: z.string().max(4000).optional().nullable(),
});

export const logisticsSchema = z.object({
  serviceableRegions: z.array(z.string().max(120)).max(100).optional(),
  deliveryLocations: z.array(z.string().max(120)).max(100).optional(),
  dispatchCapability: z.string().max(2000).optional().nullable(),
  shippingMethods: z.array(z.string().max(80)).max(50).optional(),
  avgDispatchDays: z.number().int().min(0).max(365).optional().nullable(),
  preferredPartners: z.array(z.string().max(120)).max(50).optional(),
  pickupAvailable: z.boolean().optional(),
});

export const changeRequestSchema = z.object({
  issues: z.array(z.object({ section: z.string().min(1).max(80), message: z.string().min(1).max(500) })).min(1),
});

export const rejectSchema = z.object({ reason: z.string().min(1).max(1000) });
export const suspendSchema = z.object({ reason: z.string().min(1).max(1000) });

// ============================================================
// COMMERCE (cart / address / checkout / orders / admin)
// ============================================================

const PINCODE_RE = /^[1-9][0-9]{5}$/; // Indian 6-digit pincode
const MOBILE_RE = /^[6-9]\d{9}$/; // Indian mobile (normalized digits)

// Self-service profile update (PATCH /auth/me). Every field optional — the
// service only touches what is present. Phone accepts common Indian formats;
// the service normalizes to the last 10 digits before the uniqueness check.
const INDIAN_MOBILE_RE = /^(\+?91[\s-]?)?[6-9]\d{9}$/;
// Optional text that the client may clear: accepts a value, "" or null.
const clearableText = (max) => z.union([z.string().trim().max(max), z.null()]).optional();

export const profileUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80).optional(),
    lastName: z.string().trim().max(80).nullable().optional(),
    email: z.string().trim().email("Enter a valid email").max(200).optional(),
    phone: z
      .union([z.string().trim().regex(INDIAN_MOBILE_RE, "Enter a valid Indian mobile number"), z.null()])
      .optional(),
    // ---- Business / contact profile (all optional, all clearable) ----
    alternatePhone: z
      .union([z.string().trim().regex(INDIAN_MOBILE_RE, "Enter a valid Indian mobile number"), z.literal(""), z.null()])
      .optional(),
    company: clearableText(160),
    businessType: clearableText(80),
    gstin: z
      .union([z.string().trim().toUpperCase().regex(GSTIN_RE, "Enter a valid 15-character GSTIN"), z.literal(""), z.null()])
      .optional(),
    pan: z
      .union([z.string().trim().toUpperCase().regex(PAN_RE, "Enter a valid 10-character PAN"), z.literal(""), z.null()])
      .optional(),
    website: z
      .union([z.string().trim().url("Enter a valid URL (include https://)").max(200), z.literal(""), z.null()])
      .optional(),
    industry: clearableText(80),
    // Date of birth as YYYY-MM-DD; must be a real date in the past.
    dateOfBirth: z
      .union([
        z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
          .refine((s) => {
            const d = new Date(`${s}T00:00:00Z`);
            return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d < new Date() && d >= new Date("1900-01-01T00:00:00Z");
          }, "Enter a valid date of birth in the past"),
        z.literal(""),
        z.null(),
      ])
      .optional(),
    gender: z.union([z.enum(["male", "female", "other", "prefer_not_to_say"]), z.literal(""), z.null()]).optional(),
    // Notification / communication opt-ins — a flat map of booleans.
    preferences: z.record(z.string().max(40), z.boolean()).optional(),
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), { message: "Nothing to update" });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(100),
});

export const addToCartSchema = z.object({
  productId: z.string().min(1),
  variant: z.string().max(200).optional().nullable(),
  quantity: z.number().int().min(1).max(1_000_000),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(1_000_000),
});

export const addressSchema = z.object({
  kind: z.enum(["billing", "shipping"]).default("shipping"),
  label: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(MOBILE_RE, "Enter a valid Indian mobile number"),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().regex(PINCODE_RE, "Enter a valid 6-digit pincode"),
  country: z.string().trim().max(80).default("India"),
  isDefault: z.boolean().optional(),
});

export const addressUpdateSchema = addressSchema.partial();

// Preview pricing without placing an order (cart page / review page).
export const quoteSchema = z.object({
  couponCode: z.string().trim().max(40).optional().nullable(),
  // So the preview can include the COD surcharge when COD is selected.
  paymentMethod: z.enum(["cod", "upi", "neft", "cheque", "bank_transfer"]).optional().nullable(),
});

// Place an order from the caller's cart. Prices/totals are NOT accepted from
// the client — only which address, coupon and payment method to use.
export const placeOrderSchema = z.object({
  shippingAddressId: z.string().min(1),
  billingAddressId: z.string().min(1).optional().nullable(),
  couponCode: z.string().trim().max(40).optional().nullable(),
  // Methods are gated by Settings → Payments (enabled flag, COD limits). COD
  // captures on delivery; upi (manual QR, verified by admin), neft, cheque and
  // bank_transfer stay PENDING until an admin verifies receipt. Card/gateway
  // methods are deliberately absent until a real payment gateway is integrated.
  paymentMethod: z.enum(["cod", "upi", "neft", "cheque", "bank_transfer"]).default("cod"),
  notes: z.string().trim().max(500).optional().nullable(),
  // Idempotency key: repeated submits with the same key return the same order.
  idempotencyKey: z.string().trim().min(8).max(100).optional().nullable(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

export const orderStatusUpdateSchema = z.object({
  status: z.enum([
    "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
    "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURN_REQUESTED", "RETURNED",
  ]),
  note: z.string().trim().max(500).optional().nullable(),
  courier: z.string().trim().max(120).optional().nullable(),
  trackingNumber: z.string().trim().max(120).optional().nullable(),
});
