import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, MessageSquare, RefreshCw, Search } from "lucide-react";
import { chatApi, type ChatInboxItem } from "@/lib/api/rfq";
import { describeApiError } from "@/lib/api/client";
import { RfqChat } from "@/components/rfq/RfqChat";

// Admin negotiation inbox (spec §11): a list of every RFQ conversation with
// unread counts + last message, and a live chat pane for the selected RFQ.
// Two-pane on desktop; list → chat with a Back button on mobile.

const SORTS = [
  { value: "unread", label: "Unread" },
  { value: "latest", label: "Latest" },
  { value: "rfq", label: "RFQ" },
  { value: "customer", label: "Customer" },
] as const;

type Sort = (typeof SORTS)[number]["value"];

export default function ChatInbox() {
  const [items, setItems] = useState<ChatInboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("unread");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await chatApi.inbox(sort);
      setItems(res.conversations);
    } catch (e) {
      setError(describeApiError(e).message);
      setItems([]);
    }
  }, [sort]);

  useEffect(() => { void load(); }, [load]);

  const filtered = (items ?? []).filter((c) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return c.rfqNumber.toLowerCase().includes(t) || c.customer.name.toLowerCase().includes(t) || (c.customer.email ?? "").toLowerCase().includes(t);
  });

  const selectConv = (rfqId: string) => {
    setSelected(rfqId);
    setItems((prev) => (prev ? prev.map((c) => (c.rfqId === rfqId ? { ...c, unread: 0 } : c)) : prev));
  };

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[32rem] flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold erp-text">Chat / Negotiations</h1>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border erp-border px-3 py-1.5 text-xs font-bold erp-text-muted hover:erp-surface-2">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_1fr]">
        {/* Inbox list */}
        <div className={`flex min-h-0 flex-col rounded-2xl border erp-border erp-surface ${selected ? "hidden lg:flex" : "flex"}`}>
          <div className="shrink-0 border-b erp-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search RFQ or customer…" className="w-full rounded-lg border erp-border bg-transparent py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
            </div>
            <div className="mt-2 flex gap-1">
              {SORTS.map((s) => (
                <button key={s.value} type="button" onClick={() => setSort(s.value)} className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${sort === s.value ? "bg-primary-500 text-white" : "erp-surface-2 erp-text-muted hover:erp-surface"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items === null ? (
              <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-dark-300" /></div>
            ) : error ? (
              <div className="p-6 text-center text-sm text-red-600">{error}</div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <MessageSquare className="h-8 w-8 text-dark-200" />
                <p className="text-sm font-semibold erp-text-muted">No conversations yet</p>
                <p className="text-xs erp-text-faint">Negotiations started by customers appear here.</p>
              </div>
            ) : (
              <ul>
                {filtered.map((c) => (
                  <li key={c.rfqId}>
                    <button
                      type="button"
                      onClick={() => selectConv(c.rfqId)}
                      className={`flex w-full items-start gap-3 border-b erp-border-soft p-3 text-left transition hover:erp-surface-2 ${selected === c.rfqId ? "erp-surface-2" : ""}`}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white">
                        {(c.customer.name[0] || "C").toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-bold erp-text">{c.customer.name}</span>
                          {c.lastAt && <span className="shrink-0 text-[10px] erp-text-faint">{new Date(c.lastAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] erp-text-faint">
                          <span className="font-semibold text-primary-600">{c.rfqNumber}</span>
                          <span>· {c.productCount} product{c.productCount === 1 ? "" : "s"}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-xs erp-text-muted">{c.lastMessage?.preview ?? "No messages yet"}</span>
                          {c.unread > 0 && <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{c.unread}</span>}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Chat pane */}
        <div className={`min-h-0 ${selected ? "flex" : "hidden lg:flex"} flex-col`}>
          {selected ? (
            <>
              <button type="button" onClick={() => setSelected(null)} className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold erp-text-muted hover:erp-text lg:hidden">
                <ArrowLeft className="h-4 w-4" /> Back to inbox
              </button>
              <div className="min-h-0 flex-1">
                <RfqChat key={selected} rfqId={selected} admin onQuoteAccepted={() => void load()} />
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed erp-border text-center">
              <MessageSquare className="h-10 w-10 text-dark-200" />
              <p className="text-sm font-semibold erp-text-muted">Select a conversation</p>
              <p className="text-xs erp-text-faint">Choose an RFQ on the left to chat and send revised quotes.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
