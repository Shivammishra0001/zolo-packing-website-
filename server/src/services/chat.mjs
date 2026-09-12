// ============================================================
// Customer <-> Admin RFQ negotiation chat.
//
// REUSES the existing `Message` model on the buyer<->admin thread (supplierId
// null — this is distinct from the buyer<->seller threads in marketplace.mjs).
// Quote cards are real `Quotation` rows (existing versioning) referenced from a
// QUOTE message; attachments are real `RfqFile` rows referenced from a FILE
// message. Nothing here duplicates users, orders or the quotation system.
//
// Permission is ALWAYS derived from the authenticated user, never the client:
//   - the RFQ's owner (buyer) may use its admin thread
//   - any admin-role user may use any RFQ's admin thread
//   - everyone else (sellers included) is refused
// This gate backs both the REST routes and the Socket.IO gateway.
// ============================================================
import { prisma } from "../lib/prisma.mjs";
import { badRequest, forbidden, notFound } from "../lib/http.mjs";
import { notify, notifyRoles } from "./events.mjs";
import { isAdminRole } from "../middleware/auth.mjs";
import { attach as attachRfqFile } from "./rfq-files.mjs";

const PAGE_SIZE = 50;

/** Resolve the caller's role on an RFQ's admin thread, or throw. */
export async function assertRfqChatAccess(user, rfqId) {
  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    select: { id: true, rfqNumber: true, userId: true, status: true },
  });
  if (!rfq) throw notFound("RFQ not found");
  const admin = isAdminRole(user.role);
  const owner = rfq.userId === user.id;
  if (!admin && !owner) throw forbidden("You cannot access this conversation", "CHAT_FORBIDDEN");
  return { rfq, role: admin ? "ADMIN" : "CUSTOMER" };
}

const senderTypeFor = (rfq, senderId) => (senderId === rfq.userId ? "CUSTOMER" : "ADMIN");

/** Resolve the FILE/QUOTE payloads referenced by a batch of messages. */
async function resolveRefs(messages) {
  const fileIds = [...new Set(messages.filter((m) => m.fileId).map((m) => m.fileId))];
  const quoteIds = [...new Set(messages.filter((m) => m.quotationId).map((m) => m.quotationId))];
  const [files, quotes] = await Promise.all([
    fileIds.length
      ? prisma.rfqFile.findMany({ where: { id: { in: fileIds } }, select: { id: true, fileName: true, mimeType: true, size: true } })
      : [],
    quoteIds.length
      ? prisma.quotation.findMany({
          where: { id: { in: quoteIds } },
          select: {
            id: true, quotationNumber: true, version: true, status: true,
            grandTotalMinor: true, subtotalMinor: true, shippingMinor: true, taxMinor: true,
            currency: true, leadTimeDays: true, validUntil: true,
            items: { select: { quantity: true, unit: true, unitPriceMinor: true, productName: true } },
          },
        })
      : [],
  ]);
  return {
    files: new Map(files.map((f) => [f.id, f])),
    quotes: new Map(quotes.map((q) => [q.id, q])),
  };
}

function shapeMessage(m, rfq, refs, senders) {
  return {
    id: m.id,
    rfqId: m.rfqId,
    senderId: m.senderId,
    senderType: senderTypeFor(rfq, m.senderId),
    senderName: senders?.get(m.senderId) ?? (senderTypeFor(rfq, m.senderId) === "ADMIN" ? "ZOLO Packaging" : "Customer"),
    type: m.type || "TEXT",
    body: m.body,
    file: m.fileId ? refs.files.get(m.fileId) ?? null : null,
    quote: m.quotationId ? refs.quotes.get(m.quotationId) ?? null : null,
    readAt: m.readAt ? m.readAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

async function senderNames(ids) {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, firstName: true, lastName: true, role: true, email: true },
  });
  return new Map(
    users.map((u) => [
      u.id,
      isAdminRole(u.role) ? "ZOLO Packaging" : [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email,
    ]),
  );
}

/**
 * Paginated history (newest last). `before` = ISO cursor of the oldest message
 * already loaded; omit for the latest page. Always returns chronological order.
 */
export async function listMessages(user, rfqId, { before, limit = PAGE_SIZE } = {}) {
  const { rfq } = await assertRfqChatAccess(user, rfqId);
  const take = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), PAGE_SIZE);
  const where = { rfqId, supplierId: null, ...(before ? { createdAt: { lt: new Date(before) } } : {}) };
  // Fetch newest `take`, then reverse to chronological.
  const rows = await prisma.message.findMany({ where, orderBy: { createdAt: "desc" }, take: take + 1 });
  const hasMore = rows.length > take;
  const page = rows.slice(0, take).reverse();
  const refs = await resolveRefs(page);
  const names = await senderNames(page.map((m) => m.senderId));
  return {
    messages: page.map((m) => shapeMessage(m, rfq, refs, names)),
    hasMore,
    oldestCursor: page.length ? page[0].createdAt.toISOString() : null,
  };
}

/** Create a message on the admin thread and notify the other side in-app. */
export async function postMessage(user, rfqId, { body, type = "TEXT", fileId = null, quotationId = null } = {}) {
  const { rfq, role } = await assertRfqChatAccess(user, rfqId);
  const text = String(body ?? "").trim();
  if (type === "TEXT" && !text) throw badRequest("Message cannot be empty", "EMPTY_MESSAGE");

  const created = await prisma.message.create({
    data: { rfqId, supplierId: null, senderId: user.id, body: text || "", type, fileId, quotationId },
  });

  // Notify the other party (in-app only — WhatsApp stays for RFQ lifecycle events).
  const preview = type === "FILE" ? "📎 Sent an attachment" : type === "QUOTE" ? "💬 Sent a revised quotation" : text.slice(0, 120);
  if (role === "CUSTOMER") {
    await notifyRoles(["admin"], {
      type: "chat.message",
      title: `New message on ${rfq.rfqNumber}`,
      body: preview,
      entityType: "Rfq",
      entityId: rfqId,
    });
  } else {
    await notify({
      userId: rfq.userId,
      type: "chat.message",
      title: "New message from ZOLO Packaging",
      body: preview,
      entityType: "Rfq",
      entityId: rfqId,
    });
  }

  const refs = await resolveRefs([created]);
  const names = await senderNames([created.senderId]);
  return shapeMessage(created, rfq, refs, names);
}

/** Attach a file (reuses RfqFile storage) and post it as a FILE message. */
export async function attachAndPost(user, rfqId, filePayload) {
  await assertRfqChatAccess(user, rfqId);
  const file = await attachRfqFile(user.id, rfqId, filePayload); // validates type/size/magic bytes
  return postMessage(user, rfqId, { body: file.fileName, type: "FILE", fileId: file.id });
}

/** Post a QUOTE card message pointing at an existing (just-created) quotation. */
export async function postQuoteCard(user, rfqId, quotationId, note = "") {
  return postMessage(user, rfqId, { body: note || "Revised quotation", type: "QUOTE", quotationId });
}

/** Mark all messages from the OTHER party as read; returns how many changed. */
export async function markRead(user, rfqId) {
  const { rfq } = await assertRfqChatAccess(user, rfqId);
  const res = await prisma.message.updateMany({
    where: { rfqId, supplierId: null, senderId: { not: user.id }, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: res.count };
}

/** Unread messages (from the other party) on this RFQ's admin thread. */
export async function unreadCount(user, rfqId) {
  await assertRfqChatAccess(user, rfqId);
  return prisma.message.count({ where: { rfqId, supplierId: null, senderId: { not: user.id }, readAt: null } });
}

/** Per-RFQ unread admin-thread counts for the buyer's own RFQs (one query). */
export async function unreadCountsForBuyer(user) {
  const rows = await prisma.message.groupBy({
    by: ["rfqId"],
    where: { supplierId: null, readAt: null, senderId: { not: user.id }, rfq: { userId: user.id } },
    _count: { _all: true },
  });
  const counts = {};
  for (const r of rows) counts[r.rfqId] = r._count._all;
  return counts;
}

/**
 * Admin inbox: every RFQ that has an admin-thread conversation, with its last
 * message, unread count (messages from the customer), and customer context.
 */
export async function adminInbox(_admin, { sort = "unread" } = {}) {
  // Distinct RFQs that have at least one admin-thread message.
  const threads = await prisma.message.groupBy({
    by: ["rfqId"],
    where: { supplierId: null },
    _max: { createdAt: true },
  });
  if (threads.length === 0) return { conversations: [] };
  const rfqIds = threads.map((t) => t.rfqId);

  const [rfqs, lasts, unreadRows] = await Promise.all([
    prisma.rfq.findMany({
      where: { id: { in: rfqIds } },
      select: {
        id: true, rfqNumber: true, status: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.message.findMany({
      where: { rfqId: { in: rfqIds }, supplierId: null },
      orderBy: { createdAt: "desc" },
      distinct: ["rfqId"],
      select: { rfqId: true, body: true, type: true, senderId: true, createdAt: true },
    }),
    // Unread = messages from the CUSTOMER (thread's rfq owner) not yet read.
    prisma.message.findMany({
      where: { rfqId: { in: rfqIds }, supplierId: null, readAt: null },
      select: { rfqId: true, senderId: true, rfq: { select: { userId: true } } },
    }),
  ]);

  const rfqById = new Map(rfqs.map((r) => [r.id, r]));
  const lastById = new Map(lasts.map((l) => [l.rfqId, l]));
  const unreadByRfq = new Map();
  for (const m of unreadRows) {
    if (m.senderId === m.rfq.userId) unreadByRfq.set(m.rfqId, (unreadByRfq.get(m.rfqId) || 0) + 1);
  }

  let conversations = rfqIds
    .map((id) => {
      const r = rfqById.get(id);
      if (!r) return null;
      const last = lastById.get(id);
      const name = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ").trim() || r.user?.email || "Customer";
      return {
        rfqId: id,
        rfqNumber: r.rfqNumber,
        status: r.status,
        customer: { id: r.user?.id, name, email: r.user?.email ?? null, phone: r.user?.phone ?? null },
        productCount: r._count.items,
        unread: unreadByRfq.get(id) || 0,
        lastMessage: last
          ? { preview: last.type === "FILE" ? "📎 Attachment" : last.type === "QUOTE" ? "💬 Revised quotation" : last.body.slice(0, 140), at: last.createdAt.toISOString(), fromCustomer: last.senderId === r.user?.id }
          : null,
        lastAt: last ? last.createdAt.toISOString() : null,
      };
    })
    .filter(Boolean);

  if (sort === "unread") conversations.sort((a, b) => b.unread - a.unread || (b.lastAt || "").localeCompare(a.lastAt || ""));
  else if (sort === "rfq") conversations.sort((a, b) => a.rfqNumber.localeCompare(b.rfqNumber));
  else if (sort === "customer") conversations.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  else conversations.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || "")); // latest

  return { conversations };
}

/**
 * Chat context header: RFQ number, status, current best quotation and the item
 * requirements, plus the customer identity (for the admin side). The customer
 * never needs to retype RFQ details into the chat.
 */
export async function chatContext(user, rfqId) {
  const { rfq, role } = await assertRfqChatAccess(user, rfqId);
  const full = await prisma.rfq.findUnique({
    where: { id: rfqId },
    select: {
      id: true, rfqNumber: true, status: true, shipCity: true, shipState: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      items: { select: { id: true, productName: true, sku: true, quantity: true, unit: true, specs: true } },
      quotations: {
        where: { status: { in: ["SENT", "ACCEPTED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, quotationNumber: true, version: true, status: true, grandTotalMinor: true, currency: true, leadTimeDays: true, validUntil: true },
      },
    },
  });
  const name = [full.user?.firstName, full.user?.lastName].filter(Boolean).join(" ").trim() || full.user?.email || "Customer";
  return {
    rfqId: full.id,
    rfqNumber: full.rfqNumber,
    status: full.status,
    role,
    ship: { city: full.shipCity, state: full.shipState },
    // Customer identity is only exposed to the admin side.
    customer: role === "ADMIN" ? { id: full.user?.id, name, email: full.user?.email ?? null, phone: full.user?.phone ?? null } : null,
    items: full.items.map((i) => ({ id: i.id, productName: i.productName, sku: i.sku, quantity: i.quantity, unit: i.unit, specs: i.specs })),
    currentQuote: full.quotations[0] ?? null,
    _rfq: rfq, // internal
  };
}
