// ============================================================
// Socket.IO gateway for the RFQ negotiation chat.
//
// Attaches to the EXISTING Express HTTP server (no separate process, no Redis —
// single-instance in-memory rooms are sufficient here). Identity is taken ONLY
// from the JWT in the handshake, validated exactly like the REST `authenticate`
// middleware (signature + live session). Room membership is gated by the same
// chat.assertRfqChatAccess used by the REST routes, so the socket layer can
// never widen access beyond what HTTP allows.
//
// Rooms:   rfq:<rfqId>            (one per RFQ admin thread)
// Events in:  join_rfq_chat, leave_rfq_chat, send_message, typing_start,
//             typing_stop, message_read
// Events out: new_message, typing, message_read, presence, error
//
// REST handlers reuse emitToRfq()/emitUnread() so a message sent over HTTP
// still reaches connected sockets in real time.
// ============================================================
import { Server } from "socket.io";
import { prisma } from "../lib/prisma.mjs";
import { verifyAccessToken } from "../lib/crypto.mjs";
import { isAllowedOrigin } from "../lib/env.mjs";
import { isAdminRole } from "../middleware/auth.mjs";
import * as chat from "../services/chat.mjs";

let io = null;

// presence: rfqId -> Map(userId -> { role, count })
const presence = new Map();

function roomOf(rfqId) {
  return `rfq:${rfqId}`;
}

async function authenticateSocket(token) {
  if (!token) throw new Error("No token");
  const claims = verifyAccessToken(token); // throws on bad/expired signature
  if (!claims.sid) throw new Error("Session expired");
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || !user.isActive) throw new Error("Account inactive");
  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session || session.userId !== user.id || session.revokedAt || session.expiresAt <= new Date()) {
    throw new Error("Session invalid");
  }
  return user;
}

function presenceSnapshot(rfqId) {
  const m = presence.get(rfqId);
  if (!m) return { admin: false, customer: false };
  let admin = false;
  let customer = false;
  for (const p of m.values()) {
    if (p.role === "ADMIN") admin = true;
    else customer = true;
  }
  return { admin, customer };
}

function addPresence(rfqId, userId, role) {
  let m = presence.get(rfqId);
  if (!m) { m = new Map(); presence.set(rfqId, m); }
  const cur = m.get(userId);
  if (cur) cur.count += 1;
  else m.set(userId, { role, count: 1 });
}

function removePresence(rfqId, userId) {
  const m = presence.get(rfqId);
  if (!m) return;
  const cur = m.get(userId);
  if (!cur) return;
  cur.count -= 1;
  if (cur.count <= 0) m.delete(userId);
  if (m.size === 0) presence.delete(rfqId);
}

export function initChatGateway(httpServer) {
  io = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    cors: {
      origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  // ---- Handshake auth --------------------------------------------------
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      const user = await authenticateSocket(String(token || ""));
      socket.data.user = user;
      socket.data.isAdmin = isAdminRole(user.role);
      socket.data.rooms = new Set();
      next();
    } catch (e) {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;

    socket.on("join_rfq_chat", async ({ rfqId } = {}, ack) => {
      try {
        const { role } = await chat.assertRfqChatAccess(user, String(rfqId));
        const room = roomOf(rfqId);
        socket.join(room);
        if (process.env.CHAT_DEBUG) console.log(`[chat] join room=${room} user=${user.id} role=${role} size=${io.sockets.adapter.rooms.get(room)?.size}`);
        socket.data.rooms.add(rfqId);
        addPresence(rfqId, user.id, role);
        // Tell the room someone came online, and tell the joiner the snapshot.
        io.to(room).emit("presence", { rfqId, ...presenceSnapshot(rfqId) });
        ack?.({ ok: true, role });
      } catch (e) {
        ack?.({ ok: false, error: e.code || "FORBIDDEN", message: e.message });
        socket.emit("error", { scope: "join", message: e.message });
      }
    });

    socket.on("leave_rfq_chat", ({ rfqId } = {}) => {
      if (!rfqId) return;
      socket.leave(roomOf(rfqId));
      if (socket.data.rooms.delete(rfqId)) {
        removePresence(rfqId, user.id);
        io.to(roomOf(rfqId)).emit("presence", { rfqId, ...presenceSnapshot(rfqId) });
      }
    });

    socket.on("send_message", async ({ rfqId, body, tempId } = {}, ack) => {
      try {
        const msg = await chat.postMessage(user, String(rfqId), { body });
        io.to(roomOf(rfqId)).emit("new_message", { ...msg, tempId });
        emitUnread(rfqId).catch(() => {});
        ack?.({ ok: true, message: msg });
      } catch (e) {
        ack?.({ ok: false, error: e.code || "SEND_FAILED", message: e.message });
      }
    });

    socket.on("typing_start", ({ rfqId } = {}) => {
      if (!socket.data.rooms.has(rfqId)) return;
      socket.to(roomOf(rfqId)).emit("typing", { rfqId, senderType: socket.data.isAdmin ? "ADMIN" : "CUSTOMER", typing: true });
    });
    socket.on("typing_stop", ({ rfqId } = {}) => {
      if (!socket.data.rooms.has(rfqId)) return;
      socket.to(roomOf(rfqId)).emit("typing", { rfqId, senderType: socket.data.isAdmin ? "ADMIN" : "CUSTOMER", typing: false });
    });

    socket.on("message_read", async ({ rfqId } = {}) => {
      try {
        await chat.markRead(user, String(rfqId));
        socket.to(roomOf(rfqId)).emit("message_read", { rfqId, by: socket.data.isAdmin ? "ADMIN" : "CUSTOMER" });
        emitUnread(rfqId).catch(() => {});
      } catch {/* ignore */}
    });

    socket.on("disconnect", () => {
      for (const rfqId of socket.data.rooms) {
        removePresence(rfqId, user.id);
        io.to(roomOf(rfqId)).emit("presence", { rfqId, ...presenceSnapshot(rfqId) });
      }
    });
  });

  return io;
}

/** Broadcast a chat event to everyone in an RFQ room (used by REST handlers). */
export function emitToRfq(rfqId, event, payload) {
  if (!io) return;
  if (process.env.CHAT_DEBUG) console.log(`[chat] emit ${event} room=${roomOf(rfqId)} clients=${io.sockets.adapter.rooms.get(roomOf(rfqId))?.size ?? 0}`);
  io.to(roomOf(rfqId)).emit(event, payload);
}

/** Recompute + broadcast unread counts for a room (best-effort). */
export async function emitUnread(rfqId) {
  if (!io) return;
  const total = await prisma.message.count({ where: { rfqId, supplierId: null, readAt: null } });
  io.to(roomOf(rfqId)).emit("unread", { rfqId, total });
}

export function getIo() {
  return io;
}
