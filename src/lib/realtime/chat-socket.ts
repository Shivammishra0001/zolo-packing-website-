import { io, type Socket } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api-config";
import { chatApi, fileToUploadPayload, type ChatContext, type ChatMessage } from "@/lib/api/rfq";
import { describeApiError } from "@/lib/api/client";

// ============================================================
// RFQ negotiation chat — Socket.IO client + useRfqChat() hook.
//
// A SINGLE shared socket (refcounted) carries every open conversation; the hook
// joins/leaves the per-RFQ room and filters events by rfqId. Identity comes from
// the same storefront access token the REST client uses, re-read on every
// (re)connect so a refreshed token is picked up. socket.io handles reconnection;
// on reconnect the hook re-joins its room and reloads the latest page so no
// message is missed. Messages are de-duplicated by id (and optimistic tempId).
// ============================================================

const TOKEN_KEY = "zolo.store.accessToken";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

// Derive the socket origin from API_BASE ("http://host:port/api/v1" → origin;
// a relative "/api/v1" means same-origin, so let socket.io default).
const WS_ORIGIN = /^https?:\/\//.test(API_BASE) ? new URL(API_BASE).origin : undefined;

let socket: Socket | null = null;
let refCount = 0;

function acquireSocket(): Socket {
  if (!socket) {
    socket = io(WS_ORIGIN, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: (cb) => cb({ token: getToken() }), // re-read token on every (re)connect
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });
  }
  refCount += 1;
  return socket;
}

function releaseSocket() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && socket) {
    socket.disconnect();
    socket = null;
  }
}

export type ConnState = "connecting" | "connected" | "reconnecting" | "disconnected";
export interface Presence { admin: boolean; customer: boolean }

interface UseRfqChat {
  messages: ChatMessage[];
  context: ChatContext | null;
  conn: ConnState;
  presence: Presence;
  typingOther: boolean;
  unread: number;
  hasMore: boolean;
  loadingOlder: boolean;
  loading: boolean;
  error: string | null;
  send: (body: string) => void;
  sendFile: (file: File) => Promise<void>;
  loadOlder: () => Promise<void>;
  markRead: () => void;
  notifyTyping: () => void;
  reload: () => Promise<void>;
}

/** Live chat for one RFQ. `admin` switches REST paths to the admin endpoints. */
export function useRfqChat(rfqId: string | null, { admin = false }: { admin?: boolean } = {}): UseRfqChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [presence, setPresence] = useState<Presence>({ admin: false, customer: false });
  const [typingOther, setTypingOther] = useState(false);
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const oldestCursor = useRef<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingOffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sockRef = useRef<Socket | null>(null);

  // PURE updater: dedup is computed against `prev`, never a mutable ref, so
  // React StrictMode's double-invocation of the updater is idempotent (the
  // earlier version mutated a `seenIds` ref here and StrictMode dropped every
  // real-time message on the second invocation).
  const addMessages = useCallback((incoming: ChatMessage[], where: "append" | "prepend") => {
    setMessages((prev) => {
      let base = prev;
      // Swap any optimistic entries for their confirmed server versions.
      for (const m of incoming) {
        if (m.tempId) base = base.map((x) => (x.id === m.tempId ? m : x));
      }
      const existing = new Set(base.map((m) => m.id));
      const fresh = incoming.filter((m) => !existing.has(m.id) && !(m.tempId && existing.has(m.tempId)));
      if (fresh.length === 0) return base;
      return where === "append" ? [...base, ...fresh] : [...fresh, ...base];
    });
  }, []);

  const reload = useCallback(async () => {
    if (!rfqId) return;
    try {
      const res = await chatApi.messages(rfqId, { limit: 50 }, admin);
      setMessages(res.messages);
      setHasMore(res.hasMore);
      oldestCursor.current = res.oldestCursor;
    } catch (e) {
      setError(describeApiError(e).message);
    }
  }, [rfqId, admin]);

  // Initial load (context + latest page).
  useEffect(() => {
    if (!rfqId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [ctx, res] = await Promise.all([chatApi.context(rfqId, admin), chatApi.messages(rfqId, { limit: 50 }, admin)]);
        if (cancelled) return;
        setContext(ctx);
          setMessages(res.messages);
        setHasMore(res.hasMore);
        oldestCursor.current = res.oldestCursor;
      } catch (e) {
        if (!cancelled) setError(describeApiError(e).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rfqId, admin]);

  // Socket lifecycle + room join + event wiring.
  useEffect(() => {
    if (!rfqId) return;
    const s = acquireSocket();
    sockRef.current = s;

    const join = () => s.emit("join_rfq_chat", { rfqId }, () => {});
    const onConnect = () => { setConn("connected"); join(); };
    const onDisconnect = () => setConn("disconnected");
    const onReconnectAttempt = () => setConn("reconnecting");
    const onReconnect = () => { setConn("connected"); join(); void reload(); };

    const onNewMessage = (m: ChatMessage) => { if (m.rfqId === rfqId) addMessages([m], "append"); };
    const onTyping = (t: { rfqId: string; senderType: string; typing: boolean }) => {
      if (t.rfqId !== rfqId) return;
      const mine = admin ? "ADMIN" : "CUSTOMER";
      if (t.senderType === mine) return;
      setTypingOther(t.typing);
      if (t.typing) {
        if (typingOffTimer.current) clearTimeout(typingOffTimer.current);
        typingOffTimer.current = setTimeout(() => setTypingOther(false), 4000);
      }
    };
    const onRead = (r: { rfqId: string }) => {
      if (r.rfqId !== rfqId) return;
      const mine = admin ? "ADMIN" : "CUSTOMER";
      setMessages((prev) => prev.map((x) => (x.senderType === mine && !x.readAt ? { ...x, readAt: new Date().toISOString() } : x)));
    };
    const onPresence = (p: { rfqId: string; admin: boolean; customer: boolean }) => { if (p.rfqId === rfqId) setPresence({ admin: p.admin, customer: p.customer }); };
    const onUnread = (u: { rfqId: string; total: number }) => { if (u.rfqId === rfqId) setUnread(u.total); };

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.io.on("reconnect_attempt", onReconnectAttempt);
    s.io.on("reconnect", onReconnect);
    s.on("new_message", onNewMessage);
    s.on("typing", onTyping);
    s.on("message_read", onRead);
    s.on("presence", onPresence);
    s.on("unread", onUnread);

    if (s.connected) onConnect();
    else setConn("connecting");

    return () => {
      s.emit("leave_rfq_chat", { rfqId });
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.io.off("reconnect_attempt", onReconnectAttempt);
      s.io.off("reconnect", onReconnect);
      s.off("new_message", onNewMessage);
      s.off("typing", onTyping);
      s.off("message_read", onRead);
      s.off("presence", onPresence);
      s.off("unread", onUnread);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (typingOffTimer.current) clearTimeout(typingOffTimer.current);
      sockRef.current = null;
      releaseSocket();
    };
  }, [rfqId, admin, addMessages, reload]);

  const send = useCallback((body: string) => {
    const text = body.trim();
    if (!text || !rfqId) return;
    const s = sockRef.current;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const mine = admin ? "ADMIN" : "CUSTOMER";
    // Optimistic echo.
    setMessages((prev) => [...prev, {
      id: tempId, tempId, rfqId, senderId: "me", senderType: mine, senderName: admin ? "ZOLO Packaging" : "You",
      type: "TEXT", body: text, file: null, quote: null, readAt: null, createdAt: new Date().toISOString(),
    }]);
    if (s && s.connected) {
      s.emit("send_message", { rfqId, body: text, tempId }, (resp: { ok: boolean }) => {
        if (!resp?.ok) setError("Your message couldn't be sent. Please try again.");
      });
    } else {
      // Offline: persist via REST so it isn't lost; the socket echo will dedup.
      chatApi.send(rfqId, text, admin).catch((e) => setError(describeApiError(e).message));
    }
  }, [rfqId, admin]);

  const sendFile = useCallback(async (file: File) => {
    if (!rfqId) return;
    try {
      const payload = await fileToUploadPayload(file);
      const msg = await chatApi.attach(rfqId, payload, admin);
      addMessages([msg], "append"); // REST path: add now; socket echo dedups
    } catch (e) {
      setError(describeApiError(e).message);
      throw e;
    }
  }, [rfqId, admin, addMessages]);

  const loadOlder = useCallback(async () => {
    if (!rfqId || !hasMore || loadingOlder || !oldestCursor.current) return;
    setLoadingOlder(true);
    try {
      const res = await chatApi.messages(rfqId, { before: oldestCursor.current, limit: 50 }, admin);
      addMessages(res.messages, "prepend");
      setHasMore(res.hasMore);
      if (res.oldestCursor) oldestCursor.current = res.oldestCursor;
    } catch (e) {
      setError(describeApiError(e).message);
    } finally {
      setLoadingOlder(false);
    }
  }, [rfqId, admin, hasMore, loadingOlder, addMessages]);

  const markRead = useCallback(() => {
    if (!rfqId) return;
    const s = sockRef.current;
    if (s && s.connected) s.emit("message_read", { rfqId });
    else chatApi.read(rfqId, admin).catch(() => {});
    setUnread(0);
  }, [rfqId, admin]);

  const notifyTyping = useCallback(() => {
    const s = sockRef.current;
    if (!s || !s.connected || !rfqId) return;
    s.emit("typing_start", { rfqId });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => s.emit("typing_stop", { rfqId }), 1500);
  }, [rfqId]);

  return { messages, context, conn, presence, typingOther, unread, hasMore, loadingOlder, loading, error, send, sendFile, loadOlder, markRead, notifyTyping, reload };
}
