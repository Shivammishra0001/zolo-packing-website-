// AdSens by Zolo: public consultation intake and the admin lead pipeline.
// The public endpoint is the only unauthenticated write in this feature, so
// most of these tests are about what a visitor must NOT be able to do.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken, registerBuyer } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const rnd = () => Math.random().toString(36).slice(2, 8);
let ADMIN;
const madeServices = [];

before(async () => {
  await startServer();
  ADMIN = await adminToken();
  // Two real services so slug validation has something to validate against.
  for (const [slug, name, order] of [["adsens-test-ads", "Digital Advertising", 1], ["adsens-test-seo", "SEO", 2]]) {
    const row = await prisma.marketingService.create({
      data: { slug, name, summary: "Test service", deliverables: ["A", "B"], isActive: true, sortOrder: order },
    });
    madeServices.push(row.id);
  }
  // An inactive one: it must never be accepted or shown.
  const hidden = await prisma.marketingService.create({
    data: { slug: "adsens-test-hidden", name: "Hidden", isActive: false, deliverables: [] },
  });
  madeServices.push(hidden.id);
});

after(async () => {
  await prisma.marketingLeadActivity.deleteMany({ where: { lead: { leadNumber: { startsWith: "ADS-" } } } });
  await prisma.marketingLead.deleteMany({ where: { email: { contains: "adsens-test" } } });
  await prisma.marketingService.deleteMany({ where: { id: { in: madeServices } } });
  await prisma.marketingPackage.deleteMany({ where: { slug: { startsWith: "adsens-test-" } } });
  await stopServer();
});

const admin = (p, o = {}) => api(p, { token: ADMIN, ...o });
const lead = (over = {}) => ({
  fullName: "Ravi Sharma",
  email: `adsens-test-${rnd()}@example.test`,
  phone: `9${String(Date.now()).slice(-9)}`,
  companyName: "Sharma Textiles",
  industry: "Apparel",
  services: ["adsens-test-ads"],
  budgetRange: "25k-50k",
  requirement: "We want more online orders.",
  preferredContact: "phone",
  consent: true,
  ...over,
});
const submit = (body) => api("/public/adsens/consultation", { method: "POST", body });

// ---------------------------------------------------------------------------

test("the public catalog shows active services only, and needs no login", async () => {
  const res = await api("/public/adsens/catalog");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const slugs = res.body.data.services.map((s) => s.slug);
  assert.ok(slugs.includes("adsens-test-ads"));
  assert.ok(!slugs.includes("adsens-test-hidden"), "an inactive service must not be published");
});

test("a visitor can submit a consultation and it is really saved", async () => {
  const body = lead();
  const res = await submit(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.data.leadNumber, /^ADS-[0-9A-F]{8}$/);

  // §10: never report success unless the row exists.
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: res.body.data.leadNumber } });
  assert.ok(row, "lead must be in PostgreSQL");
  assert.equal(row.email, body.email.toLowerCase());
  assert.equal(row.status, "NEW");
  assert.equal(row.source, "adsens_web");
  assert.equal(row.consent, true);
  assert.deepEqual(row.services, ["adsens-test-ads"]);

  // The first activity explains where the lead came from.
  const acts = await prisma.marketingLeadActivity.findMany({ where: { leadId: row.id } });
  assert.equal(acts.length, 1);
});

test("validation: name, email, phone and consent are all required", async () => {
  assert.equal((await submit(lead({ fullName: "  " }))).status, 400);
  assert.equal((await submit(lead({ email: "not-an-email" }))).status, 400);
  assert.equal((await submit(lead({ phone: "12345" }))).status, 400);

  const noConsent = await submit(lead({ consent: false }));
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.body.code, "CONSENT_REQUIRED");
});

test("a visitor cannot set pipeline fields by posting them", async () => {
  const res = await submit(lead({
    status: "WON",
    assignedToId: "someone",
    convertedUserId: "someone",
    leadNumber: "ADS-HACKED1",
    source: "trusted_partner",
  }));
  assert.equal(res.status, 201);
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: res.body.data.leadNumber } });
  assert.equal(row.status, "NEW", "status is ours, not the request's");
  assert.equal(row.assignedToId, null);
  assert.equal(row.convertedUserId, null);
  assert.equal(row.source, "adsens_web");
  assert.notEqual(row.leadNumber, "ADS-HACKED1");
});

test("unknown or inactive service slugs are dropped, not stored", async () => {
  const res = await submit(lead({ services: ["adsens-test-ads", "adsens-test-hidden", "totally-made-up"] }));
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: res.body.data.leadNumber } });
  assert.deepEqual(row.services, ["adsens-test-ads"], "only real, active services survive");
});

test("a double submission returns the first lead instead of creating two", async () => {
  const body = lead();
  const first = await submit(body);
  const second = await submit(body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.duplicate, true);
  assert.equal(second.body.data.leadNumber, first.body.data.leadNumber);

  const count = await prisma.marketingLead.count({ where: { email: body.email.toLowerCase() } });
  assert.equal(count, 1, "one enquiry, one row");
});

test("the public endpoint never leaks stored lead data", async () => {
  const res = await submit(lead({ requirement: "Secret budget details" }));
  const keys = Object.keys(res.body.data);
  assert.deepEqual(keys.sort(), ["duplicate", "leadNumber", "message"], "only a reference comes back");
  assert.ok(!JSON.stringify(res.body).includes("Secret budget details"));
});

test("leads are private: a visitor and a buyer cannot read the admin lead API", async () => {
  const anon = await api("/admin/marketing/leads");
  assert.ok([401, 403].includes(anon.status), `anon got ${anon.status}`);

  const buyer = await registerBuyer();
  const asBuyer = await api("/admin/marketing/leads", { token: buyer.token });
  assert.ok([401, 403].includes(asBuyer.status), `buyer got ${asBuyer.status}`);
});

test("admin sees the lead, can search it and gets status counts", async () => {
  const body = lead({ companyName: `Findme ${rnd()}` });
  const created = await submit(body);

  // Search by the lead's own reference, which is unique — asserting on a
  // global count makes the test depend on whatever else the suite left behind.
  const list = await admin(`/admin/marketing/leads?q=${created.body.data.leadNumber}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.leads.length, 1, "a lead number matches exactly one lead");
  assert.equal(list.body.data.leads[0].leadNumber, created.body.data.leadNumber);

  // And a company-name search finds it among whatever else exists.
  const byCompany = await admin(`/admin/marketing/leads?q=${encodeURIComponent(body.companyName)}`);
  assert.ok(byCompany.body.data.leads.some((l) => l.leadNumber === created.body.data.leadNumber), "found by company name");
  assert.ok(list.body.data.byStatus.NEW >= 1);
  for (const k of ["total", "page", "limit", "pages"]) assert.ok(k in list.body.data, `envelope has ${k}`);
});

test("admin moves a lead through the pipeline and every change is recorded", async () => {
  const created = await submit(lead());
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: created.body.data.leadNumber } });

  const contacted = await admin(`/admin/marketing/leads/${row.id}`, {
    method: "PATCH", body: { status: "CONTACTED", note: "Called, asked for a proposal." },
  });
  assert.equal(contacted.status, 200, JSON.stringify(contacted.body));
  assert.equal(contacted.body.data.lead.status, "CONTACTED");

  const follow = new Date(Date.now() + 3 * 86_400_000).toISOString();
  await admin(`/admin/marketing/leads/${row.id}`, { method: "PATCH", body: { nextFollowUpAt: follow } });

  const detail = await admin(`/admin/marketing/leads/${row.id}`);
  const kinds = detail.body.data.lead.activities.map((a) => a.kind);
  assert.ok(kinds.includes("status_changed"));
  assert.ok(kinds.includes("note"));
  assert.ok(kinds.includes("follow_up"));
  assert.ok(detail.body.data.lead.nextFollowUpAt, "follow-up date stored");
});

test("marking a lead LOST requires a reason", async () => {
  const created = await submit(lead());
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: created.body.data.leadNumber } });

  const noReason = await admin(`/admin/marketing/leads/${row.id}`, { method: "PATCH", body: { status: "LOST" } });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, "LOST_REASON_REQUIRED");

  const ok = await admin(`/admin/marketing/leads/${row.id}`, { method: "PATCH", body: { status: "LOST", lostReason: "Budget too low" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.lead.lostReason, "Budget too low");
});

test("an unknown status is refused", async () => {
  const created = await submit(lead());
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: created.body.data.leadNumber } });
  const res = await admin(`/admin/marketing/leads/${row.id}`, { method: "PATCH", body: { status: "ASCENDED" } });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "STATUS_INVALID");
});

test("converting a WON lead links an EXISTING customer and never duplicates one", async () => {
  const buyer = await registerBuyer();
  const before = await prisma.user.count();

  const created = await submit(lead({ email: buyer.email }));
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: created.body.data.leadNumber } });

  // Must be WON first.
  const tooEarly = await admin(`/admin/marketing/leads/${row.id}/convert`, { method: "POST", body: {} });
  assert.equal(tooEarly.status, 400);
  assert.equal(tooEarly.body.code, "NOT_WON");

  await admin(`/admin/marketing/leads/${row.id}`, { method: "PATCH", body: { status: "WON" } });
  const res = await admin(`/admin/marketing/leads/${row.id}/convert`, { method: "POST", body: {} });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after = await prisma.marketingLead.findUnique({ where: { id: row.id } });
  assert.ok(after.convertedUserId, "linked to a customer");
  assert.ok(after.convertedAt);
  assert.equal(await prisma.user.count(), before + 0, "no customer record was duplicated");
});

test("converting a lead with no matching customer explains what to do", async () => {
  const created = await submit(lead());
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: created.body.data.leadNumber } });
  await admin(`/admin/marketing/leads/${row.id}`, { method: "PATCH", body: { status: "WON" } });

  const res = await admin(`/admin/marketing/leads/${row.id}/convert`, { method: "POST", body: {} });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "CUSTOMER_NOT_FOUND");
  assert.match(res.body.error, /never makes a duplicate/i);
});

test("the acknowledgement reports real delivery outcomes, never a fake send", async () => {
  const { notifyNewLead } = await import("../src/services/adsens.mjs");
  const created = await submit(lead());
  const row = await prisma.marketingLead.findUnique({ where: { leadNumber: created.body.data.leadNumber } });

  const out = await notifyNewLead(row);
  for (const ch of ["email", "whatsapp"]) {
    if (out[ch]) assert.ok(["SENT", "FAILED", "SKIPPED"].includes(out[ch].status), `${ch}: ${JSON.stringify(out[ch])}`);
  }
  // Whatever happened, it is written down.
  const deliveries = await prisma.notificationDelivery.count({ where: { entityType: "MarketingLead", entityId: row.id } });
  assert.ok(deliveries >= 1, "the attempt is logged either way");
});
