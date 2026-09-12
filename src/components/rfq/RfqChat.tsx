import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, Send, Wifi, WifiOff, FileText, Check, CheckCheck, Quote as QuoteIcon, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useAuthSession } from "@/components/auth/AuthContext";
import { rfqApi, chatApi, type ChatMessage, type ChatQuoteRef } from "@/lib/api/rfq";
import { describeApiError } from "@/lib/api/client";
import { useRfqChat } from "@/lib/realtime/chat-socket";
import { inrMinor } from "@/admin/format";

// ============================================================
// RfqChat — the live customer <-> admin negotiation panel.
// One component, two roles: `admin` switches endpoints, the quote composer and
// the identity shown in the header. Quote cards render inline; the customer can
// Accept a quote (existing order flow) straight from the card.
// ============================================================

const ACCEPT = ".pdf,.xlsx,.xls,.csv,.doc,.docx,.jpg,.jpeg,.png,.webp";
const CLOSED_STATUSES = ["ACCEPTED", "CANCELLED", "REJECTED", "EXPIRED"];

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const prettySize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function RfqChat({ rfqId, admin = false, onQuoteAccepted }: { rfqId: string; admin?: boolean; onQuoteAccepted?: () => void }) {
  const chat = useRfqChat(rfqId, { admin });
  const toast = useToast();
  const { user } = useAuthSession();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true);

  const closed = chat.context ? CLOSED_STATUSES.includes(chat.context.status) : false;
  const otherOnline = admin ? chat.presence.customer : chat.presence.admin;

  // Auto-scroll to newest when the viewer is already near the bottom.
  useEffect(() => {
    if (nearBottom.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages.length]);

  // Mark the thread read on load and whenever new inbound messages arrive.
  useEffect(() => { if (!chat.loading) chat.markRead(); }, [chat.loading, chat.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && chat.hasMore && !chat.loadingOlder) {
      const prevH = el.scrollHeight;
      void chat.loadOlder().then(() => {
        const el2 = scrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight - prevH; // keep position after prepend
      });
    }
  };

  const doSend = () => {
    if (!text.trim() || closed) return;
    chat.send(text);
    setText("");
    nearBottom.current = true;
  };

  const onPickFile = async (f: File | null) => {
    if (!f) return;
    setUploading(true);
    try {
      await chat.sendFile(f);
      nearBottom.current = true;
    } catch (e) {
      toast.error("Upload failed", describeApiError(e).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Group messages by day for date separators.
  const grouped = useMemo(() => {
    const out: { day: string; items: ChatMessage[] }[] = [];
    for (const m of chat.messages) {
      const d = day(m.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === d) last.items.push(m);
      else out.push({ day: d, items: [m] });
    }
    return out;
  }, [chat.messages]);

  const headerName = admin ? chat.context?.customer?.name ?? "Customer" : "ZOLO Packaging";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-dark-100 bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-dark-100 p-3 sm:p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white">
            {admin ? (headerName[0] || "C").toUpperCase() : "Z"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-dark-900">{headerName}</p>
            <p className="flex items-center gap-1.5 text-xs text-dark-500">
              <span className={`h-2 w-2 rounded-full ${otherOnline ? "bg-emerald-500" : "bg-dark-300"}`} />
              {otherOnline ? "Online" : "Offline"}
              {chat.context && <span className="hidden sm:inline">· {chat.context.rfqNumber} · {chat.context.status.replace(/_/g, " ").toLowerCase()}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {admin && chat.context && !closed && (
            <button type="button" onClick={() => setShowQuote((v) => !v)} className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-dark-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-dark-800">
              <QuoteIcon className="h-3.5 w-3.5" /> Send Revised Quote
            </button>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${chat.conn === "connected" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
            {chat.conn === "connected" ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {chat.conn === "connected" ? "Live" : chat.conn === "reconnecting" ? "Reconnecting…" : chat.conn === "connecting" ? "Connecting…" : "Offline"}
          </span>
        </div>
      </div>

      {/* Admin quote composer */}
      {admin && showQuote && chat.context && (
        <QuoteComposer
          rfqId={rfqId}
          items={chat.context.items}
          onClose={() => setShowQuote(false)}
          onSent={() => { setShowQuote(false); toast.success("Revised quote sent"); }}
        />
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-h-0 space-y-1 overflow-y-auto p-3 sm:p-4">
        {chat.loading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-dark-300" /></div>
        ) : chat.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-semibold text-red-600">{chat.error}</p>
            <button type="button" onClick={() => void chat.reload()} className="rounded-lg border border-dark-200 px-3 py-1.5 text-xs font-bold">Retry</button>
          </div>
        ) : chat.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <QuoteIcon className="h-8 w-8 text-dark-200" />
            <p className="text-sm font-bold text-dark-800">Start a conversation with ZOLO Packaging</p>
            <p className="text-xs text-dark-400">Ask about price, MOQ, customization, delivery or your packaging requirements.</p>
          </div>
        ) : (
          <>
            {chat.loadingOlder && <div className="py-2 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-dark-300" /></div>}
            {grouped.map((g) => (
              <div key={g.day}>
                <div className="my-3 flex items-center justify-center"><span className="rounded-full bg-dark-50 px-3 py-1 text-[10px] font-semibold text-dark-500">{g.day}</span></div>
                {g.items.map((m) => (
                  <MessageBubble key={m.id} m={m} admin={admin} meId={user?.id} onQuoteAccepted={onQuoteAccepted} />
                ))}
              </div>
            ))}
            {chat.typingOther && (
              <div className="flex items-center gap-1 px-1 py-1 text-xs text-dark-400">
                <span className="inline-flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-dark-300" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-dark-300" style={{ animationDelay: "120ms" }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-dark-300" style={{ animationDelay: "240ms" }} />
                </span>
                {admin ? "Customer" : "Admin"} is typing…
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-dark-100 p-2 sm:p-3">
        {closed ? (
          <p className="py-2 text-center text-xs text-dark-400">This conversation is closed. History remains available.</p>
        ) : (
          <div className="flex items-end gap-2">
            <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Attach file" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-dark-500 hover:bg-dark-50 disabled:opacity-50">
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
            </button>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); chat.notifyTyping(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }}
              rows={1}
              placeholder="Type your message…"
              className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-dark-200 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
            />
            <button type="button" onClick={doSend} disabled={!text.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ m, admin, meId, onQuoteAccepted }: { m: ChatMessage; admin: boolean; meId?: string; onQuoteAccepted?: () => void }) {
  const mineType = admin ? "ADMIN" : "CUSTOMER";
  const mine = m.senderId === meId || m.senderId === "me" || m.senderType === mineType;
  if (m.type === "SYSTEM") {
    return <div className="my-2 text-center"><span className="rounded-full bg-dark-50 px-3 py-1 text-[11px] text-dark-500">{m.body}</span></div>;
  }
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} mb-1.5`}>
      <div className={`max-w-[85%] sm:max-w-[75%] ${m.type === "QUOTE" ? "w-full sm:w-auto" : ""}`}>
        {m.type === "QUOTE" && m.quote ? (
          <QuoteCard quote={m.quote} mine={mine} admin={admin} onAccepted={onQuoteAccepted} />
        ) : m.type === "FILE" && m.file ? (
          <FileBubble m={m} mine={mine} />
        ) : (
          <div className={`rounded-2xl px-3.5 py-2 text-sm ${mine ? "rounded-br-md bg-primary-500 text-white" : "rounded-bl-md bg-dark-50 text-dark-900"}`}>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          </div>
        )}
        <div className={`mt-0.5 flex items-center gap-1 px-1 text-[10px] text-dark-400 ${mine ? "justify-end" : "justify-start"}`}>
          <span>{time(m.createdAt)}</span>
          {mine && m.type !== "QUOTE" && (m.readAt ? <CheckCheck className="h-3 w-3 text-primary-500" /> : <Check className="h-3 w-3" />)}
        </div>
      </div>
    </div>
  );
}

function FileBubble({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const toast = useToast();
  const dl = async () => {
    if (!m.file) return;
    try {
      const blob = await rfqApi.downloadFile(m.rfqId, m.file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = m.file.fileName; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error("Download failed", describeApiError(e).message);
    }
  };
  return (
    <button type="button" onClick={dl} className={`flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-left text-sm ${mine ? "rounded-br-md bg-primary-500 text-white" : "rounded-bl-md bg-dark-50 text-dark-900"}`}>
      <FileText className={`h-5 w-5 shrink-0 ${mine ? "text-white" : "text-primary-500"}`} />
      <span className="min-w-0">
        <span className="block max-w-[200px] truncate font-semibold">{m.file?.fileName}</span>
        {m.file && <span className={`text-[10px] ${mine ? "text-white/70" : "text-dark-400"}`}>{prettySize(m.file.size)} · tap to download</span>}
      </span>
    </button>
  );
}

function QuoteCard({ quote, mine, admin, onAccepted }: { quote: ChatQuoteRef; mine: boolean; admin: boolean; onAccepted?: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const accepted = quote.status === "ACCEPTED";
  const perPiece = quote.items[0] ? quote.items[0].unitPriceMinor : null;
  const totalQty = quote.items.reduce((s, i) => s + i.quantity, 0);

  const accept = async () => {
    setBusy(true);
    try {
      const { order } = await rfqApi.accept(quote.id);
      toast.success(`Order ${order.orderNumber} created`, "Your quote was accepted.");
      onAccepted?.();
    } catch (e) {
      toast.error("Couldn't accept", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-2xl border-2 p-4 ${mine ? "border-primary-200 bg-primary-50/60" : "border-dark-200 bg-white"}`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary-600"><QuoteIcon className="h-3.5 w-3.5" /> Revised quotation</span>
        <span className="text-[10px] font-semibold text-dark-400">{quote.quotationNumber} · v{quote.version}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {perPiece != null && <div><dt className="text-[11px] text-dark-500">Price</dt><dd className="font-bold text-dark-900">{inrMinor(perPiece)}/pc</dd></div>}
        <div><dt className="text-[11px] text-dark-500">Quantity</dt><dd className="font-bold text-dark-900">{totalQty.toLocaleString("en-IN")}</dd></div>
        {quote.leadTimeDays != null && <div><dt className="text-[11px] text-dark-500">Delivery</dt><dd className="font-semibold text-dark-800">{quote.leadTimeDays} days</dd></div>}
        <div><dt className="text-[11px] text-dark-500">Total</dt><dd className="font-bold text-dark-900">{inrMinor(quote.grandTotalMinor)}</dd></div>
        {quote.validUntil && <div className="col-span-2"><dt className="text-[11px] text-dark-500">Valid until</dt><dd className="font-semibold text-dark-800">{day(quote.validUntil)}</dd></div>}
      </dl>
      {!admin && (
        <div className="mt-3 flex gap-2">
          {accepted ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><Check className="h-3.5 w-3.5" /> Accepted</span>
          ) : (
            <button type="button" onClick={accept} disabled={busy} className="flex-1 rounded-lg bg-primary-500 px-4 py-2 text-xs font-bold text-white hover:bg-primary-600 disabled:opacity-50">
              {busy ? "Accepting…" : "Accept Quote"}
            </button>
          )}
        </div>
      )}
      {admin && accepted && <p className="mt-2 text-xs font-semibold text-emerald-600">Accepted by customer</p>}
    </div>
  );
}

function QuoteComposer({ rfqId, items, onClose, onSent }: {
  rfqId: string;
  items: { id: string; productName: string; quantity: number; unit: string }[];
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const [price, setPrice] = useState(""); // price per piece (₹)
  const [leadTimeDays, setLead] = useState("");
  const [validDays, setValidDays] = useState("14");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) { toast.error("Enter a valid price per piece"); return; }
    setBusy(true);
    try {
      const validUntil = validDays ? new Date(Date.now() + Number(validDays) * 86400000).toISOString() : undefined;
      await chatApi.sendQuote(rfqId, {
        items: items.map((it) => ({ rfqItemId: it.id, unitPriceMinor: Math.round(p * 100), quantity: it.quantity })),
        leadTimeDays: leadTimeDays ? Number(leadTimeDays) : undefined,
        validUntil,
        note: note.trim() || undefined,
      });
      onSent();
    } catch (e) {
      toast.error("Couldn't send quote", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-primary-100 bg-primary-50/40 p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-bold text-dark-900">Send a revised quotation</p>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-dark-400 hover:text-dark-700"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs font-bold text-dark-700">Price / piece (₹)
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full rounded-lg border border-dark-200 px-2 py-1.5 text-sm font-normal" />
        </label>
        <label className="text-xs font-bold text-dark-700">Lead time (days)
          <input type="number" min={0} value={leadTimeDays} onChange={(e) => setLead(e.target.value)} className="mt-1 w-full rounded-lg border border-dark-200 px-2 py-1.5 text-sm font-normal" />
        </label>
        <label className="text-xs font-bold text-dark-700">Valid (days)
          <input type="number" min={1} value={validDays} onChange={(e) => setValidDays(e.target.value)} className="mt-1 w-full rounded-lg border border-dark-200 px-2 py-1.5 text-sm font-normal" />
        </label>
        <label className="text-xs font-bold text-dark-700 sm:col-span-1 col-span-2">Note
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="mt-1 w-full rounded-lg border border-dark-200 px-2 py-1.5 text-sm font-normal" />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-dark-500">Applies the price to all {items.length} product line{items.length === 1 ? "" : "s"} at their requested quantities. Creates a new quotation version.</p>
      <button type="button" onClick={submit} disabled={busy} className="mt-2 rounded-lg bg-dark-900 px-4 py-2 text-xs font-bold text-white hover:bg-dark-800 disabled:opacity-50">
        {busy ? "Sending…" : "Send quote to customer"}
      </button>
    </div>
  );
}
