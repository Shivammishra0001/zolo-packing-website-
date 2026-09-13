// Auth service: registration, login, refresh, logout. All DB access here.
import { prisma } from "../lib/prisma.mjs";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  newRefreshToken,
  hashToken,
} from "../lib/crypto.mjs";
import { env } from "../lib/env.mjs";
import { conflict, unauthorized } from "../lib/http.mjs";
import { recordEvent, notifyRoles } from "./events.mjs";

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "org";

// An identifier that is all digits (optionally with +, spaces, dashes) is a
// phone; otherwise it's treated as an email.
const looksLikePhone = (s) => /^[+\d][\d\s-]{5,}$/.test(s.trim());

// Normalize a phone to a comparable key: digits only, last 10 (Indian mobile).
// Stored and queried in this form so "+91 98…", "098…", "98…" all match.
const normalizePhone = (s) => {
  const digits = String(s).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

async function uniqueSlug(base, tx) {
  let slug = slugify(base);
  let n = 1;
  // Retry with a numeric suffix until free (bounded).
  while (await tx.organization.findUnique({ where: { slug } })) {
    slug = `${slugify(base)}-${++n}`;
    if (n > 50) { slug = `${slugify(base)}-${Date.now().toString(36)}`; break; }
  }
  return slug;
}

/**
 * Mint an access token BOUND to a session (`sid`).
 *
 * Without `sid` an access token is a free-standing bearer credential: logging
 * out revokes the refresh token, but the access token keeps working until it
 * expires — up to 15 minutes of access after "sign out". Carrying the session
 * id lets `authenticate` reject a token whose session was revoked.
 */
function accessFor(user, sessionId) {
  return signAccessToken({ sub: user.id, role: user.role, email: user.email, sid: sessionId });
}

async function issueSession(user, meta, tx) {
  const refresh = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.jwtRefreshTtlDays * 86400_000);
  const session = await tx.session.create({
    data: { userId: user.id, tokenHash: hashToken(refresh), expiresAt, userAgent: meta.userAgent, ip: meta.ip },
  });
  return { accessToken: accessFor(user, session.id), refreshToken: refresh, expiresAt };
}

// The user as the client may see it. NEVER includes passwordHash.
const publicUser = (u) => ({
  id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName,
  role: u.role, phone: u.phone,
  // Customer profile
  avatarUrl: u.avatarUrl ?? null,
  alternatePhone: u.alternatePhone ?? null,
  company: u.company ?? null,
  businessType: u.businessType ?? null,
  gstin: u.gstin ?? null,
  pan: u.pan ?? null,
  website: u.website ?? null,
  industry: u.industry ?? null,
  // Date-only: serialised as YYYY-MM-DD so the client never has to fight timezones.
  dateOfBirth: u.dateOfBirth ? new Date(u.dateOfBirth).toISOString().slice(0, 10) : null,
  gender: u.gender ?? null,
  preferences: u.preferences && typeof u.preferences === "object" ? u.preferences : {},
  createdAt: u.createdAt ?? null,
});

/**
 * Register a new account. accountType "seller" provisions the full seller
 * scaffold — Organization(kind=supplier) + OrganizationMember(owner) +
 * SupplierProfile(DRAFT) — atomically, so onboarding can start immediately.
 */
export async function register({ email, password, firstName, lastName, phone, accountType, companyName }, meta) {
  const normEmail = email.trim().toLowerCase();
  const normPhone = phone ? normalizePhone(phone) : null;
  const existing = await prisma.user.findUnique({ where: { email: normEmail } });
  if (existing) throw conflict("An account with this email already exists", "EMAIL_TAKEN");
  // Phone is a unique login identifier — reject if already registered.
  if (normPhone) {
    const phoneTaken = await prisma.user.findUnique({ where: { phone: normPhone } });
    if (phoneTaken) throw conflict("An account with this phone already exists", "PHONE_TAKEN");
  }

  const passwordHash = await hashPassword(password);
  const role = accountType === "seller" ? "seller_owner" : "buyer";

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: normEmail, passwordHash, firstName, lastName: lastName || null, phone: normPhone, role,
        // Buyers keep their business name on the profile (sellers get an
        // Organization below instead). Previously this was silently dropped.
        company: accountType !== "seller" && companyName ? String(companyName).trim() || null : null,
      },
    });

    let organizationId = null;
    if (accountType === "seller") {
      const orgName = (companyName || `${firstName}'s Company`).trim();
      const org = await tx.organization.create({
        data: {
          kind: "supplier",
          name: orgName,
          slug: await uniqueSlug(orgName, tx),
          members: { create: { userId: user.id, memberRole: "owner" } },
          supplierProfile: {
            create: { displayName: orgName, contactName: `${firstName} ${lastName || ""}`.trim(), contactEmail: normEmail, contactPhone: phone || null },
          },
        },
      });
      organizationId = org.id;
      await recordEvent(
        { eventType: "seller.created", actorId: user.id, organizationId, entityType: "Organization", entityId: org.id, metadata: { orgName } },
        tx,
      );
    }

    // Every registration is a business event: it drives the admin activity feed
    // and the Customers module, and notifies admins of a new signup.
    await recordEvent(
      {
        eventType: "user.registered",
        actorId: user.id,
        organizationId,
        entityType: "User",
        entityId: user.id,
        metadata: { role, accountType: accountType ?? "buyer" },
      },
      tx,
    );
    await notifyRoles(
      ["admin", "operations_admin"],
      {
        type: "user.registered",
        title: "New customer registered",
        body: `${firstName} ${lastName || ""}`.trim() + ` signed up as ${role}.`,
        entityType: "User",
        entityId: user.id,
      },
      tx,
    );

    const tokens = await issueSession(user, meta, tx);
    return { user: publicUser(user), organizationId, ...tokens };
  });
}

export async function login({ identifier, email, password }, meta) {
  // Accept either the new `identifier` (email or phone) or the legacy `email`.
  const raw = (identifier ?? email ?? "").trim();
  const user = looksLikePhone(raw)
    ? await prisma.user.findUnique({ where: { phone: normalizePhone(raw) } })
    : await prisma.user.findUnique({ where: { email: raw.toLowerCase() } });
  // Generic error — never reveal whether the email/phone exists.
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw unauthorized("Invalid email or password");
  if (!user.isActive) throw unauthorized("Account is inactive");

  const tokens = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return issueSession(user, meta, tx);
  });
  return { user: publicUser(user), ...tokens };
}

/**
 * Exchange a refresh token for a new access token, ROTATING the refresh token.
 *
 * Rotation: each refresh mints a fresh token and revokes the one presented, so
 * a leaked token is useful at most once. Reuse detection: presenting a token
 * that is already revoked means either a replay or a stolen token being raced
 * against the legitimate user — we revoke that user's ENTIRE session family
 * and force a full re-login rather than let the attacker keep refreshing.
 */
export async function refresh({ refreshToken }, meta = {}) {
  if (!refreshToken) throw unauthorized("Missing refresh token");
  const tokenHash = hashToken(refreshToken);
  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) throw unauthorized("Session expired");

  if (session.revokedAt) {
    // Reuse of an already-rotated token → treat the family as compromised.
    await prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    console.warn(`[auth] refresh-token reuse detected for user ${session.userId}; all sessions revoked`);
    throw unauthorized("Session expired");
  }
  if (session.expiresAt < new Date()) throw unauthorized("Session expired");
  if (!session.user.isActive) throw unauthorized("Account is inactive");

  return prisma.$transaction(async (tx) => {
    await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const next = newRefreshToken();
    const expiresAt = new Date(Date.now() + env.jwtRefreshTtlDays * 86400_000);
    const rotated = await tx.session.create({
      data: {
        userId: session.userId,
        tokenHash: hashToken(next),
        expiresAt,
        userAgent: meta.userAgent ?? session.userAgent,
        ip: meta.ip ?? session.ip,
      },
    });
    return {
      accessToken: accessFor(session.user, rotated.id),
      refreshToken: next,
      expiresAt,
      user: publicUser(session.user),
    };
  });
}

export async function logout({ refreshToken }) {
  if (!refreshToken) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revoke every active session for a user ("sign out everywhere"). Used after a
 * password change or when an account is suspected compromised.
 */
export async function logoutAll(userId) {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { revoked: count };
}

/**
 * Update the caller's OWN profile (name / phone / email).
 *
 * The identity comes from the authenticated session — a user can only ever
 * update themselves; there is no path to another user's row. Email and phone
 * stay login identifiers, so uniqueness conflicts answer 409 with the same
 * codes registration uses (EMAIL_TAKEN / PHONE_TAKEN).
 */
export async function updateProfile(
  userId,
  { firstName, lastName, email, phone, alternatePhone, company, businessType, gstin, pan, website, industry, dateOfBirth, gender, preferences },
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();

  const data = {};
  if (firstName !== undefined) data.firstName = firstName.trim();
  if (lastName !== undefined) data.lastName = lastName === null ? null : lastName.trim() || null;

  // Business / contact profile. "" and null both clear the field.
  const text = (v) => (v === null ? null : String(v).trim() || null);
  if (alternatePhone !== undefined) data.alternatePhone = alternatePhone ? normalizePhone(alternatePhone) : null;
  if (company !== undefined) data.company = text(company);
  if (businessType !== undefined) data.businessType = text(businessType);
  if (gstin !== undefined) data.gstin = gstin ? String(gstin).trim().toUpperCase() : null;
  if (pan !== undefined) data.pan = pan ? String(pan).trim().toUpperCase() : null;
  if (website !== undefined) data.website = text(website);
  if (industry !== undefined) data.industry = text(industry);
  if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth ? new Date(`${dateOfBirth}T00:00:00Z`) : null;
  if (gender !== undefined) data.gender = gender || null;
  // Merge so a partial preferences update never wipes the other toggles.
  if (preferences !== undefined) {
    const current = user.preferences && typeof user.preferences === "object" ? user.preferences : {};
    data.preferences = { ...current, ...preferences };
  }

  if (email !== undefined) {
    const nextEmail = email.trim().toLowerCase();
    if (nextEmail !== user.email) {
      const taken = await prisma.user.findUnique({ where: { email: nextEmail }, select: { id: true } });
      if (taken) throw conflict("An account with this email already exists", "EMAIL_TAKEN");
      data.email = nextEmail;
    }
  }

  if (phone !== undefined) {
    const nextPhone = phone === null || phone === "" ? null : normalizePhone(phone);
    if (nextPhone !== user.phone) {
      if (nextPhone) {
        const taken = await prisma.user.findUnique({ where: { phone: nextPhone }, select: { id: true } });
        if (taken) throw conflict("An account with this phone already exists", "PHONE_TAKEN");
      }
      data.phone = nextPhone;
    }
  }

  const updated = Object.keys(data).length
    ? await prisma.user.update({ where: { id: userId }, data })
    : user;

  await recordEvent({
    eventType: "user.profile.updated",
    actorId: userId,
    entityType: "User",
    entityId: userId,
    metadata: { fields: Object.keys(data) },
  });

  return { user: publicUser(updated) };
}

/**
 * Change the caller's password. Requires the CURRENT password (a stolen access
 * token must not be enough to lock the owner out), and revokes every OTHER
 * session so a compromised device loses access immediately. The caller's own
 * session stays alive — no forced re-login after changing your own password.
 */
export async function changePassword(userId, { currentPassword, newPassword }, currentSessionId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw unauthorized("Current password is incorrect");
  }

  const passwordHash = await hashPassword(newPassword);
  const [, revoked] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(currentSessionId ? { id: { not: currentSessionId } } : {}) },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordEvent({
    eventType: "user.password.changed",
    actorId: userId,
    entityType: "User",
    entityId: userId,
    metadata: { otherSessionsRevoked: revoked.count },
  });

  return { changed: true, otherSessionsRevoked: revoked.count };
}

/**
 * Replace the caller's profile photo. Reuses the catalogue image validator
 * (MIME allow-list, base64 decode, size cap, magic-byte check) and the public
 * upload store; the previous file is deleted so replaced photos don't pile up.
 * Only the resulting URL is persisted — never the bytes — in PostgreSQL.
 */
export async function updatePhoto(userId, { name, mime, dataBase64 }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, avatarUrl: true } });
  if (!user) throw unauthorized();
  const { storeImage } = await import("./catalog.mjs");
  const url = storeImage({ name: name || "avatar", mime, dataBase64 });
  const updated = await prisma.user.update({ where: { id: userId }, data: { avatarUrl: url } });
  await removeStoredPhoto(user.avatarUrl);
  await recordEvent({ eventType: "user.photo.updated", actorId: userId, entityType: "User", entityId: userId, metadata: {} });
  return { user: publicUser(updated) };
}

/** Remove the caller's profile photo (file + URL). Falls back to the default avatar. */
export async function removePhoto(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, avatarUrl: true } });
  if (!user) throw unauthorized();
  const updated = await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
  await removeStoredPhoto(user.avatarUrl);
  await recordEvent({ eventType: "user.photo.removed", actorId: userId, entityType: "User", entityId: userId, metadata: {} });
  return { user: publicUser(updated) };
}

// Storage keys are flat filenames, so the key is the URL's last path segment.
// Best-effort: a missing file must never fail the profile update.
async function removeStoredPhoto(url) {
  if (!url) return;
  try {
    const { remove } = await import("../lib/storage.mjs");
    const key = String(url).split("/").pop();
    if (key) remove(key);
  } catch {
    /* ignore */
  }
}

export async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organization: { kind: "supplier" } },
    include: { organization: { include: { supplierProfile: { select: { id: true, status: true, verificationStatus: true, onboardingStep: true } } } } },
  });
  return {
    user: publicUser(user),
    organizationId: membership?.organizationId || null,
    supplier: membership?.organization?.supplierProfile || null,
  };
}
