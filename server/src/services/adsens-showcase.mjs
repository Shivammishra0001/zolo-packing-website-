// ===========================================================================
// AdSens showcase — campaign previews and portfolio case studies.
//
// These feed the "Active Campaigns" and "Our Portfolio" sections of /adsens.
// The design brief asked for sections that LOOK like an agency's results
// wall; the same brief forbids inventing the results. Both are satisfiable
// only if the content is admin-owned, so this module exists to make the
// frontend incapable of fabricating any of it:
//
//   * A campaign may claim LIVE only when an admin set status = "live" AND
//     marked it as a real campaign (isIllustrative = false). Anything else is
//     badged as an illustrative preview on the page itself.
//   * Metrics are two optional label/value PAIRS. A pair renders only when
//     both halves are filled, so there is no slot for a placeholder number.
//   * Case-study `results` are returned ONLY when resultsVerified is true.
//     This is enforced here, on the server, not left to the page: an
//     unverified outcome never reaches the browser at all.
//
// Admin functions assume authenticate + requireAdmin upstream.
// ===========================================================================
import { prisma } from "../lib/prisma.mjs";
import { badRequest, notFound } from "../lib/http.mjs";
import { recordEvent } from "./events.mjs";

const PLATFORMS = ["meta", "google", "linkedin", "email", "youtube", "whatsapp", "other"];
const CAMPAIGN_STATUSES = ["live", "completed", "paused"];

const text = (v, max = 4000) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** String[] column: trimmed, de-blanked, capped. Never null — Prisma scalar
 *  lists reject null and an empty list is the honest "none given". */
const list = (v, max = 20, len = 300) =>
  Array.isArray(v) ? v.map((x) => text(x, len)).filter(Boolean).slice(0, max) : [];

const slugify = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** Slug that does not collide, so two "Festive launch" entries can coexist. */
async function uniqueSlug(model, base, ignoreId = null) {
  const root = slugify(base) || "entry";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const clash = await prisma[model].findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash || clash.id === ignoreId) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Shaping — what the public page is allowed to see
// ---------------------------------------------------------------------------

/** A metric renders only as a complete pair. Half a metric is no metric. */
function metricsOf(row) {
  const out = [];
  if (row.metric1Label && row.metric1Value) out.push({ label: row.metric1Label, value: row.metric1Value });
  if (row.metric2Label && row.metric2Value) out.push({ label: row.metric2Label, value: row.metric2Value });
  return out;
}

function publicCampaign(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    clientName: row.clientName,
    platform: row.platform,
    imageUrl: row.imageUrl,
    // An illustrative preview can never report itself as live, whatever the
    // status column says — this is the last gate before the wire.
    status: row.isIllustrative ? "illustrative" : row.status,
    isIllustrative: row.isIllustrative,
    metrics: metricsOf(row),
    caseStudySlug: row.caseStudy?.slug ?? null,
  };
}

function publicCaseStudyCard(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    clientName: row.clientName,
    industry: row.industry,
    category: row.category,
    coverImage: row.coverImage,
    summary: row.summary,
    resultsVerified: row.resultsVerified,
  };
}

function publicCaseStudyFull(row) {
  return {
    ...publicCaseStudyCard(row),
    overview: row.overview,
    strategy: row.strategy,
    execution: row.execution,
    servicesProvided: row.servicesProvided,
    gallery: row.gallery,
    // Unverified results do not leave the server. The page cannot leak what
    // it was never sent.
    results: row.resultsVerified ? row.results : [],
  };
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

/** Published campaigns + case studies for the /adsens showcase sections. */
export async function publicShowcase() {
  const [campaigns, caseStudies] = await Promise.all([
    prisma.marketingCampaign.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 12,
      include: { caseStudy: { select: { slug: true, isPublished: true } } },
    }),
    prisma.marketingCaseStudy.findMany({
      where: { isPublished: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 24,
    }),
  ]);

  return {
    campaigns: campaigns.map((c) =>
      // Don't advertise a case study the admin has not published: the link
      // would 404 for the visitor.
      publicCampaign({ ...c, caseStudy: c.caseStudy?.isPublished ? c.caseStudy : null }),
    ),
    caseStudies: caseStudies.map(publicCaseStudyCard),
    /** Filter chips, built from what actually exists — never a fixed list
     *  that offers a category with nothing behind it. */
    categories: [...new Set(caseStudies.map((c) => c.category).filter(Boolean))],
  };
}

/** One published case study, by slug. Unpublished ⇒ 404, as for any record
 *  the caller is not entitled to. */
export async function publicCaseStudy(slug) {
  const row = await prisma.marketingCaseStudy.findFirst({
    where: { slug: String(slug ?? ""), isPublished: true },
  });
  if (!row) throw notFound("Case study not found");
  return publicCaseStudyFull(row);
}

// ---------------------------------------------------------------------------
// Admin — campaigns
// ---------------------------------------------------------------------------

export async function listCampaigns() {
  const campaigns = await prisma.marketingCampaign.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { caseStudy: { select: { id: true, title: true } } },
  });
  return { campaigns };
}

/** Shared field validation for create and update. */
function campaignData(input, { partial = false } = {}) {
  const data = {};

  if (input.title !== undefined || !partial) {
    const title = text(input.title, 160);
    if (!title) throw badRequest("Give the campaign a title", "TITLE_REQUIRED");
    data.title = title;
  }
  if (input.clientName !== undefined) data.clientName = text(input.clientName, 160);
  if (input.platform !== undefined) {
    const platform = String(input.platform ?? "").toLowerCase();
    if (!PLATFORMS.includes(platform)) throw badRequest(`Unknown platform: ${input.platform}`, "PLATFORM_INVALID");
    data.platform = platform;
  }
  if (input.imageUrl !== undefined) data.imageUrl = text(input.imageUrl, 600);
  if (input.status !== undefined) {
    const status = String(input.status ?? "").toLowerCase();
    if (!CAMPAIGN_STATUSES.includes(status)) throw badRequest(`Unknown status: ${input.status}`, "STATUS_INVALID");
    data.status = status;
  }
  for (const n of [1, 2]) {
    if (input[`metric${n}Label`] !== undefined) data[`metric${n}Label`] = text(input[`metric${n}Label`], 60);
    if (input[`metric${n}Value`] !== undefined) data[`metric${n}Value`] = text(input[`metric${n}Value`], 60);
  }
  if (input.isIllustrative !== undefined) data.isIllustrative = input.isIllustrative === true;
  if (input.isPublished !== undefined) data.isPublished = input.isPublished === true;
  if (input.sortOrder !== undefined) data.sortOrder = Number(input.sortOrder) || 0;
  if (input.caseStudyId !== undefined) data.caseStudyId = text(input.caseStudyId, 60);

  return data;
}

/**
 * A real (non-illustrative) campaign is a public claim about a client's work,
 * so it needs a client name attached. An illustrative preview must NOT carry
 * one — a sample card with a real brand on it is exactly the fabrication the
 * brief rules out.
 */
function assertCampaignHonesty(row) {
  if (row.isIllustrative === false && !row.clientName) {
    throw badRequest(
      "A real campaign needs the client or brand name. Mark it as an illustrative preview if there is no client behind it.",
      "CLIENT_REQUIRED",
    );
  }
}

export async function createCampaign(adminId, input = {}) {
  const data = campaignData(input);
  // Default to illustrative: a half-filled new row must not be able to claim
  // it is a live client campaign by accident.
  if (data.isIllustrative === undefined) data.isIllustrative = true;
  assertCampaignHonesty(data);
  data.slug = await uniqueSlug("marketingCampaign", input.slug || data.title);

  if (data.caseStudyId) {
    const cs = await prisma.marketingCaseStudy.findUnique({ where: { id: data.caseStudyId }, select: { id: true } });
    if (!cs) throw badRequest("That case study does not exist", "CASE_STUDY_INVALID");
  }

  const campaign = await prisma.marketingCampaign.create({ data });
  await recordEvent({
    actorId: adminId,
    eventType: "marketing.campaign.created",
    entityType: "MarketingCampaign",
    entityId: campaign.id,
    metadata: { title: campaign.title, isIllustrative: campaign.isIllustrative },
  });
  return campaign;
}

export async function updateCampaign(adminId, id, input = {}) {
  const existing = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!existing) throw notFound("Campaign not found");

  const data = campaignData(input, { partial: true });
  // Validate the row as it WILL be, not just the fields that arrived: turning
  // off isIllustrative without supplying a client must still be refused.
  assertCampaignHonesty({ ...existing, ...data });

  if (data.title && input.slug === undefined && existing.title !== data.title) {
    // Keep the slug stable once published — a public URL that moves is a
    // broken link for anyone who shared it.
    if (!existing.isPublished) data.slug = await uniqueSlug("marketingCampaign", data.title, id);
  }
  if (data.caseStudyId) {
    const cs = await prisma.marketingCaseStudy.findUnique({ where: { id: data.caseStudyId }, select: { id: true } });
    if (!cs) throw badRequest("That case study does not exist", "CASE_STUDY_INVALID");
  }

  const campaign = await prisma.marketingCampaign.update({ where: { id }, data });
  await recordEvent({
    actorId: adminId,
    eventType: "marketing.campaign.updated",
    entityType: "MarketingCampaign",
    entityId: id,
    metadata: { fields: Object.keys(data) },
  });
  return campaign;
}

export async function deleteCampaign(adminId, id) {
  const existing = await prisma.marketingCampaign.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!existing) throw notFound("Campaign not found");
  await prisma.marketingCampaign.delete({ where: { id } });
  await recordEvent({
    actorId: adminId,
    eventType: "marketing.campaign.deleted",
    entityType: "MarketingCampaign",
    entityId: id,
    metadata: { title: existing.title },
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Admin — case studies
// ---------------------------------------------------------------------------

export async function listCaseStudies() {
  const caseStudies = await prisma.marketingCaseStudy.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return { caseStudies };
}

export async function getCaseStudy(id) {
  const row = await prisma.marketingCaseStudy.findUnique({
    where: { id },
    include: { campaigns: { select: { id: true, title: true } } },
  });
  if (!row) throw notFound("Case study not found");
  return row;
}

function caseStudyData(input, { partial = false } = {}) {
  const data = {};

  if (input.title !== undefined || !partial) {
    const title = text(input.title, 160);
    if (!title) throw badRequest("Give the case study a title", "TITLE_REQUIRED");
    data.title = title;
  }
  if (input.category !== undefined || !partial) {
    const category = text(input.category, 60);
    if (!category) throw badRequest("Choose a category so the portfolio filter can find it", "CATEGORY_REQUIRED");
    data.category = category;
  }
  if (input.clientName !== undefined) data.clientName = text(input.clientName, 160);
  if (input.industry !== undefined) data.industry = text(input.industry, 120);
  if (input.coverImage !== undefined) data.coverImage = text(input.coverImage, 600);
  if (input.summary !== undefined) data.summary = text(input.summary, 400);
  if (input.overview !== undefined) data.overview = text(input.overview, 4000);
  if (input.strategy !== undefined) data.strategy = text(input.strategy, 4000);
  if (input.execution !== undefined) data.execution = text(input.execution, 4000);
  if (input.servicesProvided !== undefined) data.servicesProvided = list(input.servicesProvided, 20, 120);
  if (input.gallery !== undefined) data.gallery = list(input.gallery, 12, 600);
  if (input.results !== undefined) data.results = list(input.results, 12, 300);
  if (input.resultsVerified !== undefined) data.resultsVerified = input.resultsVerified === true;
  if (input.isPublished !== undefined) data.isPublished = input.isPublished === true;
  if (input.sortOrder !== undefined) data.sortOrder = Number(input.sortOrder) || 0;

  return data;
}

/** Verification is a statement about numbers, so there have to be numbers. */
function assertCaseStudyHonesty(row) {
  if (row.resultsVerified === true && (!row.results || row.results.length === 0)) {
    throw badRequest("There are no results to verify — add them, or leave verification off.", "RESULTS_REQUIRED");
  }
}

export async function createCaseStudy(adminId, input = {}) {
  const data = caseStudyData(input);
  assertCaseStudyHonesty(data);
  data.slug = await uniqueSlug("marketingCaseStudy", input.slug || data.title);

  const row = await prisma.marketingCaseStudy.create({ data });
  await recordEvent({
    actorId: adminId,
    eventType: "marketing.case_study.created",
    entityType: "MarketingCaseStudy",
    entityId: row.id,
    metadata: { title: row.title, category: row.category },
  });
  return row;
}

export async function updateCaseStudy(adminId, id, input = {}) {
  const existing = await prisma.marketingCaseStudy.findUnique({ where: { id } });
  if (!existing) throw notFound("Case study not found");

  const data = caseStudyData(input, { partial: true });
  assertCaseStudyHonesty({ ...existing, ...data });

  if (data.title && input.slug === undefined && existing.title !== data.title && !existing.isPublished) {
    data.slug = await uniqueSlug("marketingCaseStudy", data.title, id);
  }

  const row = await prisma.marketingCaseStudy.update({ where: { id }, data });
  await recordEvent({
    actorId: adminId,
    eventType: "marketing.case_study.updated",
    entityType: "MarketingCaseStudy",
    entityId: id,
    // Verification is the field most worth being able to audit later.
    metadata: { fields: Object.keys(data), resultsVerified: row.resultsVerified },
  });
  return row;
}

export async function deleteCaseStudy(adminId, id) {
  const existing = await prisma.marketingCaseStudy.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!existing) throw notFound("Case study not found");
  // Campaigns pointing here keep existing; the FK is SetNull, so a linked
  // card simply loses its "View case study" link rather than vanishing.
  await prisma.marketingCaseStudy.delete({ where: { id } });
  await recordEvent({
    actorId: adminId,
    eventType: "marketing.case_study.deleted",
    entityType: "MarketingCaseStudy",
    entityId: id,
    metadata: { title: existing.title },
  });
  return { id };
}
