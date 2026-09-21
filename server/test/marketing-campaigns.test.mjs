// Marketing → Campaigns. Structured content only, normalized placements,
// server-derived status, priority ordering, typed CTA links, uploaded images,
// and a public endpoint that only ever exposes live campaigns.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, api, adminToken, registerBuyer, makeProduct, fetchUpload } from "./helpers.mjs";
import { prisma } from "../src/lib/prisma.mjs";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DAY = 86_400_000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const ids = [];

let ADMIN;
before(async () => { await startServer(); ADMIN = await adminToken(); });
after(async () => {
  if (ids.length) await prisma.campaign.deleteMany({ where: { id: { in: ids } } });
  await stopServer();
});

const base = (body) => ({
  name: `TST Campaign ${rnd()}`, contentType: "text", title: "Festive Packaging Sale",
  placements: ["homepage_promo_card"], startAt: iso(-DAY), endAt: iso(DAY), ...body,
});
async function create(body) {
  const res = await api("/admin/campaigns", { method: "POST", token: ADMIN, body: base(body) });
  if (res.status === 201) ids.push(res.body.data.id);
  return res;
}
const active = async (placement) =>
  (await api(`/campaigns/active${placement ? `?placement=${placement}` : ""}`)).body.data.campaigns;
const upload = async () =>
  (await api("/uploads", { method: "POST", token: ADMIN, body: { name: "promo.png", mime: "image/png", dataBase64: PNG_B64 } })).body.data.url;

test("the spec workflow: promo card + popup, scheduled → preview data → activate → live on the public API → CTA", async () => {
  const imageUrl = await upload();
  assert.equal((await fetchUpload(imageUrl)).status, 200, "image went through the existing storage pipeline");

  const res = await create({
    name: "Festive Packaging Sale", contentType: "promo_card",
    title: "Festive Packaging Sale", description: "Save more on bulk packaging orders.",
    imageUrl, imageAlt: "Festive boxes", badgeText: "Limited", buttonText: "Shop Now", ctaType: "shop",
    placements: ["homepage_promo_card", "homepage_popup"], priority: 1,
    startAt: iso(4 * DAY), endAt: iso(19 * DAY),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const c = res.body.data;
  assert.equal(c.status, "scheduled");
  assert.deepEqual([...c.placements].sort(), ["homepage_popup", "homepage_promo_card"]);
  assert.equal(c.buttonLink, "/products");
  assert.equal(c.buttonExternal, false);

  // Placements are rows, not a comma-separated string.
  assert.equal(await prisma.campaignPlacement.count({ where: { campaignId: c.id } }), 2);

  // Scheduled ⇒ customers do not get it yet.
  assert.ok(!(await active("homepage_popup")).some((x) => x.id === c.id));

  // The schedule arrives (start moved into the past) ⇒ it is served automatically.
  const live = await api(`/admin/campaigns/${c.id}`, { method: "PATCH", token: ADMIN, body: { startAt: iso(-1000), isActive: true } });
  assert.equal(live.body.data.status, "active");
  for (const placement of ["homepage_popup", "homepage_promo_card"]) {
    const hit = (await active(placement)).find((x) => x.id === c.id);
    assert.ok(hit, placement);
    assert.equal(hit.title, "Festive Packaging Sale");
    assert.equal(hit.buttonText, "Shop Now");
    assert.equal(hit.buttonLink, "/products");
    assert.equal(hit.imageUrl, imageUrl);
    assert.equal(hit.name, undefined, "the internal name is never sent to customers");
  }
  assert.ok(!(await active("cart")).some((x) => x.id === c.id), "not in a placement it was not given");
});

test("status is derived: draft / scheduled / active / paused / expired — and only ACTIVE is public", async () => {
  const mk = async (body) => (await create(body)).body.data;
  const a = await mk({});
  const scheduled = await mk({ startAt: iso(DAY), endAt: iso(2 * DAY) });
  const expired = await mk({ startAt: iso(-2 * DAY), endAt: iso(-DAY) });
  const paused = await mk({ isActive: false });
  const draft = await mk({ isDraft: true });
  assert.deepEqual([a, scheduled, expired, paused, draft].map((c) => c.status), ["active", "scheduled", "expired", "paused", "draft"]);

  const publicIds = (await active("homepage_promo_card")).map((c) => c.id);
  assert.ok(publicIds.includes(a.id));
  for (const hidden of [scheduled, expired, paused, draft]) assert.ok(!publicIds.includes(hidden.id), hidden.status);

  // Pause / activate round trip.
  assert.equal((await api(`/admin/campaigns/${a.id}`, { method: "PATCH", token: ADMIN, body: { isActive: false } })).body.data.status, "paused");
  assert.ok(!(await active("homepage_promo_card")).some((c) => c.id === a.id));
  assert.equal((await api(`/admin/campaigns/${a.id}`, { method: "PATCH", token: ADMIN, body: { isActive: true } })).body.data.status, "active");

  // Archive hides it everywhere but keeps the row.
  assert.equal((await api(`/admin/campaigns/${a.id}`, { method: "DELETE", token: ADMIN })).status, 200);
  assert.ok(!(await active()).some((c) => c.id === a.id));
  assert.equal((await api(`/admin/campaigns/${a.id}`, { token: ADMIN })).status, 404);
  assert.ok(await prisma.campaign.findUnique({ where: { id: a.id } }));

  const filtered = await api("/admin/campaigns?status=expired", { token: ADMIN });
  assert.ok(filtered.body.data.campaigns.length > 0 && filtered.body.data.campaigns.every((c) => c.status === "expired"));
});

test("priority: lower number first, deterministically", async () => {
  const third = (await create({ placements: ["checkout"], priority: 30, title: "third" })).body.data;
  const first = (await create({ placements: ["checkout"], priority: 10, title: "first" })).body.data;
  const second = (await create({ placements: ["checkout"], priority: 20, title: "second" })).body.data;
  const mine = new Set([first.id, second.id, third.id]);
  for (let i = 0; i < 3; i++) {
    const order = (await active("checkout")).filter((c) => mine.has(c.id)).map((c) => c.title);
    assert.deepEqual(order, ["first", "second", "third"]);
  }
});

test("CTA targets use real products/categories and resolve to internal routes", async () => {
  const product = await makeProduct({ name: "CTA Box" });
  const category = await prisma.category.create({ data: { name: `TST CTA ${rnd()}`, slug: `tst-cta-${rnd().toLowerCase()}` } });

  const p = (await create({ buttonText: "View", ctaType: "product", ctaProductId: product.id })).body.data;
  assert.equal(p.buttonLink, `/product/${product.slug}`);
  const c = (await create({ buttonText: "Browse", ctaType: "category", ctaCategoryId: category.id })).body.data;
  assert.equal(c.buttonLink, `/products?category=${category.slug}`);
  assert.equal((await create({ buttonText: "Cart", ctaType: "cart" })).body.data.buttonLink, "/cart");
  const ext = (await create({ buttonText: "Read", ctaType: "external", ctaUrl: "https://example.org/sale" })).body.data;
  assert.equal(ext.buttonLink, "https://example.org/sale");
  assert.equal(ext.buttonExternal, true);

  // An archived product stops being a destination — the button is simply not sent.
  await prisma.product.update({ where: { id: product.id }, data: { deletedAt: new Date() } });
  const hit = (await active("homepage_promo_card")).find((x) => x.id === p.id);
  assert.equal(hit.buttonLink, null);
  assert.equal(hit.buttonText, null);

  const bad = async (body, path) => {
    const res = await create({ buttonText: "Go", ...body });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.issues.some((i) => i.path === path), JSON.stringify(res.body.issues));
  };
  await bad({ ctaType: "product", ctaProductId: "PRD-NOPE" }, "ctaProductId");
  await bad({ ctaType: "category" }, "ctaCategoryId");
  for (const ctaUrl of ["javascript:alert(1)", "data:text/html,<script>1</script>", "//evil.example", "/relative", "ftp://x.y"]) {
    await bad({ ctaType: "external", ctaUrl }, "ctaUrl");
  }
  await bad({ ctaType: "shop", buttonText: "" }, "buttonText");
  await prisma.category.delete({ where: { id: category.id } });
});

test("content is structured + plain text: markup is stripped, unknown fields and foreign images are refused", async () => {
  const res = await create({
    title: "<script>alert(1)</script>Big <b>Sale</b>", description: "<img src=x onerror=alert(1)>Save now",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.title, "alert(1)Big Sale");
  assert.equal(res.body.data.description, "Save now");
  assert.ok(!/[<>]/.test(JSON.stringify(res.body.data)));

  assert.equal((await create({ html: "<marquee>hi</marquee>" })).status, 400, "no free-form HTML field exists");
  for (const imageUrl of ["https://evil.example/x.png", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
    const r = await create({ contentType: "image", imageUrl, imageAlt: "x" });
    assert.equal(r.status, 400, imageUrl);
    assert.ok(r.body.issues.some((i) => i.path === "imageUrl"));
  }
});

test("per-type required fields, dates, placements and popup settings are validated; type switch clears stale content", async () => {
  const bad = async (body, path) => {
    const res = await create(body);
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.ok(res.body.issues.some((i) => i.path === path), `${path}: ${JSON.stringify(res.body.issues)}`);
  };
  await bad({ contentType: "image", title: null }, "imageUrl");
  await bad({ contentType: "quote", title: null }, "quote");
  await bad({ contentType: "text_image" }, "imageUrl");
  await bad({ contentType: "promo_card", title: "" }, "title");
  await bad({ startAt: iso(DAY), endAt: iso(-DAY) }, "endAt");
  await bad({ placements: [] }, "placements");
  await bad({ placements: ["sidebar"] }, "placements.0");
  await bad({ popupDelaySeconds: 61 }, "popupDelaySeconds");
  await bad({ popupFrequency: "hourly" }, "popupFrequency");
  await bad({ priority: 0 }, "priority");

  const imageUrl = await upload();
  const made = (await create({
    contentType: "quote", title: null, quote: "Packaging is the first handshake.", quoteAuthor: "Zolo",
    imageUrl, mobileImageUrl: imageUrl, placements: ["homepage_popup"],
    popupPosition: "bottom_right", popupFrequency: "once_per_day", popupDelaySeconds: 5, popupAllowClose: false, popupOverlay: false,
  })).body.data;
  assert.deepEqual(made.popup, { position: "bottom_right", frequency: "once_per_day", delaySeconds: 5, allowClose: false, overlay: false });
  assert.equal(made.mobileImageUrl, imageUrl);

  const switched = (await api(`/admin/campaigns/${made.id}`, { method: "PATCH", token: ADMIN, body: { contentType: "text", title: "Now text" } })).body.data;
  assert.equal(switched.quote, null);
  assert.equal(switched.imageUrl, null);
  assert.equal(switched.title, "Now text");
});

test("campaign admin APIs are admin-only; the public endpoint is read-only and needs no session", async () => {
  const { token } = await registerBuyer();
  for (const [method, path] of [["GET", "/admin/campaigns"], ["POST", "/admin/campaigns"], ["PATCH", "/admin/campaigns/x"], ["DELETE", "/admin/campaigns/x"]]) {
    assert.equal((await api(path, { method, token, body: method === "GET" ? undefined : {} })).status, 403, `${method} ${path} as buyer`);
    assert.equal((await api(path, { method, body: method === "GET" ? undefined : {} })).status, 401, `${method} ${path} anonymous`);
  }
  assert.equal((await api("/campaigns/active")).status, 200);
  assert.deepEqual(await active("not_a_placement"), []);
  assert.equal((await api("/campaigns/active", { method: "POST", token, body: base({}) })).status, 404);
});
