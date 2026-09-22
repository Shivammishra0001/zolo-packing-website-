import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Download, FileText, Loader2, MapPin, MessageSquare, Paperclip, Plus, Send, Users } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { rfqApi, chatApi, type Rfq, type Quotation, type RfqMessage } from "@/lib/api/rfq";
import { describeApiError, saveBlob } from "@/lib/api/client";
import { useAuthSession } from "@/components/auth/AuthContext";
import { RfqChat } from "@/components/rfq/RfqChat";
import { inrMinor } from "@/admin/format";
import { Badge, Button, ButtonLink, EmptyState, ErrorState } from "@/components/UI";

// The buyer's quotation history: every RFQ they sent, the quotations received
// (house + competing sellers), a comparison view, and accept / reject /
// request-changes. Rendered inside the buyer portal at /account/quotations.

type BadgeTone = "green" | "orange" | "navy" | "neutral" | "red" | "amber";

/** Status → badge tone: pending = amber, quoted/accepted = green, rejected = red. */
function statusTone(status: string): BadgeTone {
  const s = status.toUpperCase();
  if (s.includes("REJECT") || s.includes("CANCEL") || s.includes("EXPIRED")) return "red";
  if (s.includes("ACCEPT") || s.includes("QUOTED") || s === "SENT" || s.includes("ORDER")) return "green";
  if (s.includes("PENDING") || s.includes("SUBMIT") || s.includes("OPEN") || s.includes("REVIEW") || s.includes("CHANGES")) return "amber";
  return "neutral";
}

const prettyStatus = (status: string) => status.replace(/_/g, " ").toLowerCase();

export default function MyQuotations() {
  const [rfqs, setRfqs] = useState<Rfq[] | null>(null);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await rfqApi.list();
      setRfqs(res.rfqs);
      chatApi.unreadCounts().then((r) => setUnread(r.counts)).catch(() => {});
    } catch (e) {
      // Distinguish "session expired" from "server broke" from "offline" —
      // never collapse errors into an empty list or a fake not-found.
      setError(describeApiError(e));
      setRfqs(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleChat = (rfqId: string) => {
    setOpenChat((cur) => (cur === rfqId ? null : rfqId));
    setUnread((u) => ({ ...u, [rfqId]: 0 })); // opening clears the badge
  };

  const act = async (fn: () => Promise<unknown>, id: string, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error("That didn't work", describeApiError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const downloadFile = async (rfqId: string, fileId: string, fileName: string) => {
    try {
      saveBlob(await rfqApi.downloadFile(rfqId, fileId), fileName);
    } catch (e) {
      toast.error("Download failed", describeApiError(e).message);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        {error.kind === "unauthorized" ? (
          <EmptyState icon={FileText} title="Please sign in" message={error.message} action={<ButtonLink to="/" variant="outline">Go to sign in</ButtonLink>} />
        ) : (
          <ErrorState title="Couldn't load your quotations" message={error.message} onRetry={() => void load()} />
        )}
      </div>
    );
  }

  if (rfqs === null) {
    return (
      <div className="mx-auto max-w-5xl" aria-busy="true" aria-label="Loading your quotation requests">
        <div className="flex items-center justify-between gap-3">
          <div className="skeleton h-8 w-40" />
          <div className="skeleton h-11 w-44" />
        </div>
        <div className="mt-6 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="skeleton h-4 w-32" />
                  <div className="skeleton h-3 w-52" />
                </div>
                <div className="skeleton h-6 w-20 rounded-full" />
              </div>
              <div className="mt-4 space-y-2">
                <div className="skeleton h-3 w-3/4" />
                <div className="skeleton h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (rfqs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <EmptyState
          icon={FileText}
          title="No quotation requests yet"
          message="Request a bulk quote and the sellers' offers will appear here."
          action={<ButtonLink to="/rfq" variant="primary" icon={Plus}>Request a quote</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Quotations</p>
          <h1 className="h2 mt-1 text-dark-900">My quotes</h1>
        </div>
        <ButtonLink to="/rfq" variant="secondary" icon={Plus}>Request a quote</ButtonLink>
      </div>

      <div className="mt-6 space-y-4">
        {rfqs.map((r) => {
          const sent = r.quotations.filter((q) => q.status === "SENT");
          const chatOpen = openChat === r.id;
          return (
            <section key={r.id} className="card p-4 sm:p-5">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-dark-900">{r.rfqNumber}</p>
                  <p className="mt-0.5 text-xs text-dark-500">
                    {r.itemCount} product{r.itemCount === 1 ? "" : "s"} · {r.totalQuantity.toLocaleString("en-IN")} units
                    {r.ship.city && (
                      <span className="ml-2 inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3" aria-hidden /> {[r.ship.city, r.ship.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.matchCount > 0 && (
                    <Badge tone="neutral">
                      <Users className="h-3 w-3" aria-hidden /> {r.matchCount} seller{r.matchCount === 1 ? "" : "s"} matched
                    </Badge>
                  )}
                  <Badge tone={statusTone(r.status)}>{prettyStatus(r.status)}</Badge>
                  <button
                    type="button"
                    onClick={() => toggleChat(r.id)}
                    aria-pressed={chatOpen}
                    className={`chip relative ${chatOpen ? "chip-active" : ""}`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Chat / Negotiate
                    {(unread[r.id] ?? 0) > 0 && !chatOpen && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {unread[r.id]}
                      </span>
                    )}
                  </button>
                </div>
              </header>

              <div className={chatOpen ? "mt-3 lg:grid lg:grid-cols-[1fr_minmax(320px,26rem)] lg:gap-4" : ""}>
              <div className="min-w-0">
              <ul className="mt-3 divide-y divide-dark-100 text-sm text-dark-700">
                {r.items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-4 py-1.5 first:pt-0">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-dark-900">{i.productName}</span>
                      {Object.entries(i.specs ?? {}).filter(([, v]) => v).length > 0 && (
                        <span className="block truncate text-xs text-dark-500">
                          {Object.entries(i.specs ?? {})
                            .filter(([, v]) => v)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-dark-500">
                      {i.quantity.toLocaleString("en-IN")} {i.unit}
                    </span>
                  </li>
                ))}
              </ul>

              {r.files.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.files.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => void downloadFile(r.id, f.id, f.fileName)}
                      className="btn btn-outline btn-sm max-w-full"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{f.fileName}</span>
                      <Download className="h-3 w-3 shrink-0" aria-hidden />
                    </button>
                  ))}
                </div>
              )}

              {/* Comparison strip when several sellers are competing. */}
              {sent.length > 1 && (
                <div className="card-flat mt-4 overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-left text-xs">
                    <caption className="sr-only">Compare quotations for {r.rfqNumber}</caption>
                    <thead>
                      <tr className="border-b border-dark-200 bg-dark-50 text-dark-500">
                        <th className="px-3 py-2 font-bold">Seller</th>
                        <th className="px-3 py-2 font-bold">Total</th>
                        <th className="px-3 py-2 font-bold">Shipping</th>
                        <th className="px-3 py-2 font-bold">Tax</th>
                        <th className="px-3 py-2 font-bold">Lead time</th>
                        <th className="px-3 py-2 font-bold">Valid until</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sent.map((q) => (
                        <tr key={q.id} className="border-b border-dark-100 last:border-0">
                          <td className="px-3 py-2 font-semibold text-dark-900">{q.seller?.name ?? "Zolo Packaging"}</td>
                          <td className="px-3 py-2 font-bold text-dark-900">{inrMinor(q.grandTotalMinor)}</td>
                          <td className="px-3 py-2 text-dark-600">{inrMinor(q.shippingMinor)}</td>
                          <td className="px-3 py-2 text-dark-600">{inrMinor(q.taxMinor)}</td>
                          <td className="px-3 py-2 text-dark-600">{q.leadTimeDays != null ? `${q.leadTimeDays} days` : "—"}</td>
                          <td className="px-3 py-2 text-dark-600">{q.validUntil ? new Date(q.validUntil).toLocaleDateString("en-IN") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {r.quotations.map((q) => (
                <QuotationCard key={q.id} q={q} rfqId={r.id} busy={busy} act={act} toast={toast} />
              ))}
              </div>
              {chatOpen && (
                <div className="mt-4 h-[560px] lg:mt-0">
                  <RfqChat rfqId={r.id} onQuoteAccepted={() => void load()} />
                </div>
              )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function QuotationCard({
  q,
  rfqId,
  busy,
  act,
  toast,
}: {
  q: Quotation;
  rfqId: string;
  busy: string | null;
  act: (fn: () => Promise<unknown>, id: string, done: string) => Promise<void>;
  toast: ReturnType<typeof useToast>;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <div className="card-flat mt-4 bg-dark-50/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-dark-900">
            {q.quotationNumber}
            {q.version > 1 && <span className="ml-1 text-xs font-medium text-dark-400">v{q.version}</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-dark-500">
            {q.seller?.name ?? "Zolo Packaging"}
            {(q.seller == null || q.seller.verificationStatus === "VERIFIED") && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-green-600">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified
              </span>
            )}
          </p>
        </div>
        <p className="text-sm font-bold text-dark-900">{inrMinor(q.grandTotalMinor)}</p>
      </div>

      {q.items.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-dark-600">
          {q.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span className="truncate">{i.productName} × {i.quantity.toLocaleString("en-IN")}</span>
              <span className="shrink-0">{inrMinor(i.unitPriceMinor)}/{i.unit} · {inrMinor(i.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-dark-500">
        {q.leadTimeDays != null && <span>Lead time {q.leadTimeDays} days</span>}
        {q.shippingMinor > 0 && <span>Shipping {inrMinor(q.shippingMinor)}</span>}
        {q.taxMinor > 0 && <span>Tax {inrMinor(q.taxMinor)}</span>}
        {q.paymentTerms && <span>{q.paymentTerms}</span>}
        {q.validUntil && <span>Valid until {new Date(q.validUntil).toLocaleDateString("en-IN")}</span>}
      </div>

      {q.status === "SENT" && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant="primary"
            size="sm"
            disabled={busy === q.id}
            onClick={() =>
              act(
                async () => {
                  const { order } = await rfqApi.accept(q.id);
                  toast.success(`Order ${order.orderNumber} created`);
                },
                q.id,
                "Quotation accepted",
              )
            }
          >
            Accept &amp; create order
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy === q.id}
            onClick={() => act(() => rfqApi.respond(q.id, "request_changes"), q.id, "Changes requested")}
          >
            Request changes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50"
            disabled={busy === q.id}
            onClick={() => act(() => rfqApi.respond(q.id, "reject"), q.id, "Quotation rejected")}
          >
            Reject
          </Button>
        </div>
      )}
      {q.status !== "SENT" && (
        <div className="mt-2"><Badge tone={statusTone(q.status)}>{prettyStatus(q.status)}</Badge></div>
      )}

      {/* Negotiate / message the seller (buyer↔seller thread). House quotes
          (no seller) have no messaging thread. */}
      {q.seller && (
        <div className="mt-3 border-t border-dark-200 pt-3">
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-green-600 transition-colors duration-150 hover:text-green-700"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden /> {chatOpen ? "Hide messages" : `Message ${q.seller.name}`}
          </button>
          {chatOpen && <MessageThread rfqId={rfqId} supplierId={q.seller.id} toast={toast} />}
        </div>
      )}
    </div>
  );
}

/** Buyer↔seller negotiation thread for one supplier on one RFQ. */
function MessageThread({
  rfqId,
  supplierId,
  toast,
}: {
  rfqId: string;
  supplierId: string;
  toast: ReturnType<typeof useToast>;
}) {
  const { user } = useAuthSession();
  const [messages, setMessages] = useState<RfqMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await rfqApi.listMessages(rfqId, supplierId);
      setMessages(res.messages);
    } catch (e) {
      toast.error("Couldn't load messages", describeApiError(e).message);
      setMessages([]);
    }
  }, [rfqId, supplierId, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await rfqApi.postMessage(rfqId, supplierId, body);
      setDraft("");
      await load();
    } catch (e) {
      toast.error("Message not sent", describeApiError(e).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="card-flat max-h-48 space-y-2 overflow-y-auto p-3">
        {messages === null ? (
          <p className="text-center text-xs text-dark-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-dark-400">No messages yet — start the conversation.</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-[12px] px-3 py-1.5 text-xs ${mine ? "bg-green-500 text-white" : "bg-dark-50 text-dark-900"}`}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-0.5 text-[10px] ${mine ? "text-white/70" : "text-dark-400"}`}>
                    {new Date(m.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Type a message or negotiate…"
          aria-label="Message"
          className="input min-h-[2.375rem] flex-1 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          className="btn btn-primary btn-sm shrink-0"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />} Send
        </button>
      </div>
    </div>
  );
}
