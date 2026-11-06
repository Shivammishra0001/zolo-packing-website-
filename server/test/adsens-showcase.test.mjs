// AdSens showcase: campaign previews and portfolio case studies.
//
// The design brief asked for sections that look like an agency results wall
// and, in the same breath, forbade inventing any of the results. These tests
// exist because that guarantee has to be enforced by the server rather than
// promised by a comment: the question each one asks is "can a wrong-looking
// claim reach the public endpoint?".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

let ADMIN;
const TAG = "showcase-test";

before(async () => {
  await startServer();
  ADMIN = await adminToken();
});

after(async () => {
  await prisma.marketingCampaign.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.marketingCaseStudy.deleteMany({ where: { title: { startsWith: TAG } } });
  await stopServer();
});

const admin = (p, o = {}) => api(p, { token: ADMIN, ...o });
const mkCampaign = (body) => admin("/admin/marketing/campaigns", { method: "POST", body });
const mkCaseStudy = (body) => admin("/admin/marketing/case-studies", { method: "POST", body });

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

test("showcase admin endpoints reject an anonymous caller", async () => {
  for (const path of ["/admin/marketing/campaigns", "/admin/marketing/case-studies"]) {
    const res = await api(path);
    assert.equal(res.status, 401, `${path} should need a token`);
  }
  const write = await api("/admin/marketing/campaigns", { method: "POST", body: { title: `${TAG} anon` } });
  assert.equal(write.status, 401);
});

test("the public showcase endpoint needs no token", async () => {
  const res = await api("/public/adsens/showcase");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data.campaigns));
  assert.ok(Array.isArray(res.body.data.caseStudies));
  assert.ok(Array.isArray(res.body.data.categories));
});

// ---------------------------------------------------------------------------
// Campaigns: the LIVE claim
// ---------------------------------------------------------------------------

test("a real campaign cannot be created without a client name", async () => {
  const res = await mkCampaign({ title: `${TAG} nameless`, isIllustrative: false, platform: "meta" });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "CLIENT_REQUIRED");
});

test("a campaign cannot be flipped to real without a client name", async () => {
  const made = await mkCampaign({ title: `${TAG} sample`, isIllustrative: true });
  assert.equal(made.status, 201);
  const res = await admin(`/admin/marketing/campaigns/${made.body.data.campaign.id}`, {
    method: "PATCH",
    body: { isIllustrative: false },
  });
  assert.equal(res.status, 400, "the stored row must be validated, not just the patch");
  assert.equal(res.body.code, "CLIENT_REQUIRED");
});

test("an illustrative campaign never reports itself as live to the public", async () => {
  const made = await mkCampaign({
    title: `${TAG} illustrative live`,
    // The admin set "live" AND left it illustrative: the public shape must
    // not let the two combine into a LIVE badge.
    status: "live",
    isIllustrative: true,
    isPublished: true,
    // Distinct negative orders across these tests: four rows all claiming
    // -1 would tie, and the createdAt tiebreak could still push an early
    // one past the listing's 12-row limit.
    sortOrder: -40,
  });
  assert.equal(made.status, 201);

  const res = await api("/public/adsens/showcase");
  const row = res.body.data.campaigns.find((c) => c.id === made.body.data.campaign.id);
  assert.ok(row, "the published campaign should be listed");
  assert.equal(row.status, "illustrative");
  assert.equal(row.isIllustrative, true);
});

test("a real, live campaign does keep its live status", async () => {
  const made = await mkCampaign({
    title: `${TAG} genuine`,
    clientName: "A Real Client",
    status: "live",
    isIllustrative: false,
    isPublished: true,
    sortOrder: -39,
  });
  const res = await api("/public/adsens/showcase");
  const row = res.body.data.campaigns.find((c) => c.id === made.body.data.campaign.id);
  assert.ok(row, "the published campaign should be listed");
  assert.equal(row.status, "live");
  assert.equal(row.isIllustrative, false);
});

test("a half-filled metric pair is dropped rather than rendered", async () => {
  const made = await mkCampaign({
    title: `${TAG} metrics`,
    isPublished: true,
    // A distinct negative sortOrder keeps this row at the front. `publicShowcase`
    // takes only 12 campaigns and this suite creates more than that, so a
    // row left at the default order can fall off the end — and a lookup by
    // title would then match nothing, or worse, the wrong row.
    sortOrder: -38,
    metric1Label: "Reach",
    metric1Value: "Growing",
    // Label with no value: this pair must not survive.
    metric2Label: "Clicks",
  });
  assert.equal(made.status, 201);

  const res = await api("/public/adsens/showcase");
  const row = res.body.data.campaigns.find((c) => c.id === made.body.data.campaign.id);
  assert.ok(row, "the campaign should be within the public listing");
  assert.equal(row.metrics.length, 1);
  assert.deepEqual(row.metrics[0], { label: "Reach", value: "Growing" });
});

test("an unpublished campaign is invisible to the public", async () => {
  await mkCampaign({ title: `${TAG} draft`, isPublished: false });
  const res = await api("/public/adsens/showcase");
  assert.equal(res.body.data.campaigns.some((c) => c.title === `${TAG} draft`), false);
});

test("an unknown platform or status is refused", async () => {
  const bad = await mkCampaign({ title: `${TAG} bad platform`, platform: "tiktok-ultra" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "PLATFORM_INVALID");

  const badStatus = await mkCampaign({ title: `${TAG} bad status`, status: "smashing" });
  assert.equal(badStatus.status, 400);
  assert.equal(badStatus.body.code, "STATUS_INVALID");
});

// ---------------------------------------------------------------------------
// Case studies: the results claim
// ---------------------------------------------------------------------------

test("results cannot be marked verified when there are none", async () => {
  const res = await mkCaseStudy({ title: `${TAG} empty results`, category: "seo", resultsVerified: true });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "RESULTS_REQUIRED");
});

test("unverified results never leave the server", async () => {
  const made = await mkCaseStudy({
    title: `${TAG} unverified`,
    category: "ppc",
    isPublished: true,
    results: ["Cost per lead down 38%"],
    resultsVerified: false,
  });
  assert.equal(made.status, 201);
  // Stored, so the admin keeps their draft…
  assert.equal(made.body.data.caseStudy.results.length, 1);

  // …but the public payload must not carry it.
  const res = await api(`/public/adsens/case-studies/${made.body.data.caseStudy.slug}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.caseStudy.results, []);
  assert.equal(res.body.data.caseStudy.resultsVerified, false);
});

test("verified results are published", async () => {
  const made = await mkCaseStudy({
    title: `${TAG} verified`,
    category: "ppc",
    isPublished: true,
    results: ["Cost per lead down 38%"],
    resultsVerified: true,
  });
  const res = await api(`/public/adsens/case-studies/${made.body.data.caseStudy.slug}`);
  assert.deepEqual(res.body.data.caseStudy.results, ["Cost per lead down 38%"]);
  assert.equal(res.body.data.caseStudy.resultsVerified, true);
});

test("an unpublished case study is a 404, not a 403", async () => {
  const made = await mkCaseStudy({ title: `${TAG} hidden`, category: "seo", isPublished: false });
  const res = await api(`/public/adsens/case-studies/${made.body.data.caseStudy.slug}`);
  assert.equal(res.status, 404, "never confirm that a draft exists");
});

test("a case study needs a category so the portfolio filter can place it", async () => {
  const res = await mkCaseStudy({ title: `${TAG} no category` });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "CATEGORY_REQUIRED");
});

test("filter categories are derived from published work, not a fixed list", async () => {
  await mkCaseStudy({ title: `${TAG} cat published`, category: "branding", isPublished: true });
  await mkCaseStudy({ title: `${TAG} cat draft`, category: "email-marketing", isPublished: false });

  const res = await api("/public/adsens/showcase");
  const { categories } = res.body.data;
  assert.ok(categories.includes("branding"));
  assert.equal(categories.includes("email-marketing"), false, "a draft must not offer an empty filter chip");
});

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

test("a campaign only links to a case study the public can actually open", async () => {
  const draft = await mkCaseStudy({ title: `${TAG} link draft`, category: "seo", isPublished: false });
  const made = await mkCampaign({
    title: `${TAG} links to draft`,
    isPublished: true,
    sortOrder: -37,
    caseStudyId: draft.body.data.caseStudy.id,
  });
  const campaignId = made.body.data.campaign.id;

  const res = await api("/public/adsens/showcase");
  const row = res.body.data.campaigns.find((c) => c.id === campaignId);
  assert.ok(row, "the published campaign should be listed");
  assert.equal(row.caseStudySlug, null, "a link to an unpublished study would 404 for the visitor");

  // Publishing the study should surface the link.
  await admin(`/admin/marketing/case-studies/${draft.body.data.caseStudy.id}`, {
    method: "PATCH",
    body: { isPublished: true },
  });
  const after2 = await api("/public/adsens/showcase");
  const row2 = after2.body.data.campaigns.find((c) => c.id === campaignId);
  assert.ok(row2, "the published campaign should be listed");
  assert.equal(row2.caseStudySlug, draft.body.data.caseStudy.slug);
});

test("a bogus case study id is refused rather than stored", async () => {
  const res = await mkCampaign({ title: `${TAG} bogus link`, caseStudyId: "does-not-exist" });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "CASE_STUDY_INVALID");
});

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

test("deleting a case study leaves its campaigns standing", async () => {
  const cs = await mkCaseStudy({ title: `${TAG} doomed`, category: "seo", isPublished: true });
  const camp = await mkCampaign({
    title: `${TAG} survivor`,
    isPublished: true,
    caseStudyId: cs.body.data.caseStudy.id,
  });

  const del = await admin(`/admin/marketing/case-studies/${cs.body.data.caseStudy.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);

  const still = await prisma.marketingCampaign.findUnique({ where: { id: camp.body.data.campaign.id } });
  assert.ok(still, "the campaign must survive its case study");
  assert.equal(still.caseStudyId, null, "the dangling link is cleared");
});

test("two entries with the same title get distinct slugs", async () => {
  const a = await mkCaseStudy({ title: `${TAG} same name`, category: "seo" });
  const b = await mkCaseStudy({ title: `${TAG} same name`, category: "seo" });
  assert.notEqual(a.body.data.caseStudy.slug, b.body.data.caseStudy.slug);
});

test("a published entry keeps its slug when renamed", async () => {
  const made = await mkCaseStudy({ title: `${TAG} stable slug`, category: "seo", isPublished: true });
  const slug = made.body.data.caseStudy.slug;
  const res = await admin(`/admin/marketing/case-studies/${made.body.data.caseStudy.id}`, {
    method: "PATCH",
    body: { title: `${TAG} renamed entirely` },
  });
  assert.equal(res.body.data.caseStudy.slug, slug, "a shared public URL must not break on a rename");
});

test("a missing record is a 404 on every admin verb", async () => {
  assert.equal((await admin("/admin/marketing/campaigns/nope", { method: "PATCH", body: { title: "x" } })).status, 404);
  assert.equal((await admin("/admin/marketing/campaigns/nope", { method: "DELETE" })).status, 404);
  assert.equal((await admin("/admin/marketing/case-studies/nope")).status, 404);
  assert.equal((await admin("/admin/marketing/case-studies/nope", { method: "DELETE" })).status, 404);
});
