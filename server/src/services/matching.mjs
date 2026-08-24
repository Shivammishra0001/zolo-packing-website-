// RFQ matching + supplier scoring foundations. These query REAL data only.
// No fabricated matches or scores: new sellers with no history return
// "Insufficient data" rather than an invented number.
import { prisma } from "../lib/prisma.mjs";

// Only APPROVED suppliers are eligible to receive RFQs.
const ELIGIBLE = { status: "APPROVED" };

/**
 * Find suppliers whose capabilities/capacity/location match an RFQ.
 * @param {{category?:string, quantity?:number, leadTimeDays?:number, state?:string}} rfq
 */
export async function findEligibleSuppliers(rfq = {}) {
  const where = { ...ELIGIBLE };
  const and = [];

  if (rfq.category) {
    and.push({ capabilities: { some: { category: { equals: rfq.category, mode: "insensitive" } } } });
  }
  if (rfq.quantity != null) {
    // capability MOQ <= quantity <= capability max (nulls treated as no bound)
    and.push({ capabilities: { some: {
      AND: [
        { OR: [{ minimumOrderQuantity: null }, { minimumOrderQuantity: { lte: rfq.quantity } }] },
        { OR: [{ maximumOrderQuantity: null }, { maximumOrderQuantity: { gte: rfq.quantity } }] },
      ],
    } } });
  }
  if (rfq.state) {
    and.push({ locations: { some: { state: { equals: rfq.state, mode: "insensitive" }, isActive: true } } });
  }
  if (and.length) where.AND = and;

  const suppliers = await prisma.supplierProfile.findMany({
    where,
    select: {
      id: true, displayName: true, businessType: true, verificationStatus: true,
      capabilities: { select: { category: true, leadTimeDays: true, minimumOrderQuantity: true, maximumOrderQuantity: true } },
      locations: { select: { state: true, city: true, locationType: true } },
    },
    take: 100,
  });

  // Rank by a transparent, explainable match score (not a fabricated rating).
  return suppliers
    .map((s) => ({ supplier: s, match: matchSupplier(s, rfq) }))
    .sort((a, b) => b.match.score - a.match.score);
}

export function matchSupplier(supplier, rfq = {}) {
  const reasons = [];
  let score = 0;
  if (rfq.category) {
    const cap = supplier.capabilities.find((c) => c.category?.toLowerCase() === rfq.category.toLowerCase());
    if (cap) { score += 40; reasons.push("category match"); }
  }
  if (rfq.leadTimeDays != null) {
    const best = supplier.capabilities.map((c) => c.leadTimeDays).filter((x) => x != null).sort((a, b) => a - b)[0];
    if (best != null && best <= rfq.leadTimeDays) { score += 30; reasons.push("lead time OK"); }
  }
  if (rfq.state && supplier.locations.some((l) => l.state?.toLowerCase() === rfq.state.toLowerCase())) {
    score += 30; reasons.push("in-state");
  }
  return { score, reasons };
}

/**
 * Supplier score across dimensions. For a new seller with no order/QC history
 * we do NOT invent numbers — dimensions without evidence report insufficient data.
 */
export async function scoreSupplier(supplierId) {
  const profile = await prisma.supplierProfile.findUnique({
    where: { id: supplierId },
    include: { certifications: true, capabilities: true, capacity: true },
  });
  if (!profile) return null;

  const dimensions = {
    // Certification is derivable from onboarding data today.
    certification: profile.certifications.length > 0
      ? { value: Math.min(100, profile.certifications.length * 25), basis: `${profile.certifications.length} certification(s)` }
      : { value: null, basis: "Insufficient data" },
    capacity: profile.capacity?.monthlyCapacity
      ? { value: null, basis: "Declared, not yet validated" }
      : { value: null, basis: "Insufficient data" },
    // These require operational history the platform hasn't accrued yet.
    quality: { value: null, basis: "Insufficient data" },
    delivery: { value: null, basis: "Insufficient data" },
    quoteResponsiveness: { value: null, basis: "Insufficient data" },
    priceCompetitiveness: { value: null, basis: "Insufficient data" },
    customerRating: { value: null, basis: "Insufficient data" },
    orderHistory: { value: null, basis: "Insufficient data" },
    qcPerformance: { value: null, basis: "Insufficient data" },
  };
  const scored = Object.values(dimensions).filter((d) => d.value != null);
  const overall = scored.length ? Math.round(scored.reduce((a, d) => a + d.value, 0) / scored.length) : null;
  return { supplierId, overall, overallBasis: overall == null ? "Insufficient data" : `${scored.length} dimension(s)`, dimensions };
}
