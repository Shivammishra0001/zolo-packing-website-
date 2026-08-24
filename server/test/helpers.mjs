// Test helpers: boot the app on an ephemeral port, provide a fetch client, and
// generate unique identifiers so runs don't collide on unique constraints.
import { createApp } from "../src/app.mjs";
import { prisma } from "../src/lib/prisma.mjs";
import { hashPassword } from "../src/lib/crypto.mjs";

let server, base;

export async function startServer() {
  if (server) return base;
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return base;
}

export async function stopServer() {
  if (server) await new Promise((r) => server.close(r));
  await prisma.$disconnect();
}

export async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

/**
 * Raw fetch against the test server, for endpoints that return bytes rather
 * than JSON (e.g. the authorized document stream).
 */
export async function apiRaw(path, { method = "GET", token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, contentType: res.headers.get("content-type"), res };
}

const rnd = () => Math.random().toString(36).slice(2, 10);
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const letters = (n) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

export const unique = {
  email: () => `test_${rnd()}@example.com`,
  gst: () => `29${letters(5)}${digits(4)}${letters(1)}1Z5`,
  pan: () => `${letters(5)}${digits(4)}${letters(1)}`,
  company: () => `Test Co ${rnd()}`,
};

// Register a seller and return { token, supplierId, email }.
export async function registerSeller() {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "Test", accountType: "seller", companyName: unique.company() } });
  const token = reg.body.data.accessToken;
  const me = await api("/auth/me", { token });
  return { token, supplierId: me.body.data.supplier.id, email, organizationId: reg.body.data.organizationId };
}

// Fill the minimum required onboarding data so a profile can be submitted.
export async function completeMinimum(token) {
  await api("/sellers/me/onboarding", { method: "PATCH", token, body: {
    legalName: "Test Legal", displayName: "TestCo", businessType: "MANUFACTURER",
    contactName: "T", contactEmail: "t@example.com", contactPhone: "9876543210",
    gstNumber: unique.gst(), panNumber: unique.pan(),
  } });
  await api("/sellers/me/locations", { method: "POST", token, body: { locationType: "FACTORY", addressLine1: "1 St", city: "City", state: "Karnataka", postalCode: "560001" } });
  await api("/sellers/me/capabilities", { method: "POST", token, body: { category: "Gift Boxes" } });
  await api("/sellers/me/bank-accounts", { method: "POST", token, body: { accountHolderName: "T", bankName: "HDFC", accountNumber: digits(12), ifsc: "HDFC0001234" } });
  await api("/sellers/me/documents", { method: "POST", token, body: { type: "GST_CERTIFICATE", fileName: "gst.pdf", mime: "application/pdf", dataBase64: Buffer.from("%PDF-1.4 test").toString("base64") } });
}

// Ensure an admin exists and return its access token.
export async function adminToken() {
  const email = `admin_${rnd()}@zolo.com`;
  await prisma.user.create({ data: { email, passwordHash: await hashPassword("Admin@1234"), firstName: "Admin", role: "admin" } });
  const login = await api("/auth/login", { method: "POST", body: { email, password: "Admin@1234" } });
  return login.body.data.accessToken;
}

// ---- Commerce fixtures ----

// Register a buyer and return { token, userId, email }.
export async function registerBuyer() {
  const email = unique.email();
  const reg = await api("/auth/register", { method: "POST", body: { email, password: "Passw0rd1", firstName: "Buyer", accountType: "buyer" } });
  const token = reg.body.data.accessToken;
  return { token, userId: reg.body.data.user.id, email };
}

// Create a purchasable (active, priced, in-stock) product directly in the DB.
export async function makeProduct({ priceMinor = 50000, stock = 100, name = "Test Box" } = {}) {
  const suffix = rnd();
  return prisma.product.create({
    data: {
      id: `PRD-${suffix.toUpperCase()}`,
      sku: `SKU-${suffix.toUpperCase()}`,
      slug: `test-box-${suffix}`,
      name: `${name} ${suffix}`,
      category: "Gift Boxes",
      status: "active",
      basePriceMinor: priceMinor,
      moq: 1,
      stock,
    },
  });
}

// Create an address for a buyer and return its id.
export async function makeAddress(token, overrides = {}) {
  const res = await api("/addresses", { method: "POST", token, body: {
    name: "Buyer One", phone: "9811100002", line1: "12 MG Road", city: "Bengaluru",
    state: "Karnataka", postalCode: "560001", isDefault: true, ...overrides,
  } });
  return res.body.data.id;
}

// Create a coupon directly in the DB. discountValue is basis points for percent.
export async function makeCoupon({ code, type = "percent", value = 1000, ...rest } = {}) {
  return prisma.coupon.create({
    data: { code: (code ?? `SAVE${rnd().toUpperCase()}`).toUpperCase(), discountType: type, discountValue: value, isActive: true, ...rest },
  });
}
