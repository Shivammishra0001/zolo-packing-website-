import { useState } from "react";
import { Eye, EyeOff, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, PageHeader } from "../components/ui";
import { EmptyState, ErrorState, ListSkeleton, Panel } from "../components/Panel";
import { formatDateTime } from "../format";
import { request } from "@/lib/api/client";
import { describeApiError } from "@/lib/api/client";
import { useAdminQuery } from "../dashboard-api";

// CMS — REAL homepage merchandising blocks from /api/v1/admin/cms.
//
// The previous page rendered hardcoded fake hero blocks, blog posts, FAQs and
// media rows, with buttons that only toasted "Saved" — while this backend API
// sat unused. Blog/media management has no backend yet and is therefore not
// shown at all rather than faked.

interface CmsBlockRow {
  id: string;
  key: string;
  title: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
}

interface EditorState {
  key: string;
  title: string;
  body: string;
  sortOrder: string;
  isNew: boolean;
}

export default function CMS() {
  const toast = useToast();
  const q = useAdminQuery<{ blocks: CmsBlockRow[] }>("/admin/cms", 0);
  const blocks = q.data?.blocks ?? [];
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (input: { key: string; title?: string; body?: string; isActive?: boolean; sortOrder?: number }) => {
    setBusy(true);
    try {
      await request("/admin/cms", { method: "PUT", body: input });
      q.refetch();
      return true;
    } catch (e) {
      toast.error("Couldn't save the block", describeApiError(e).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: string) => {
    setBusy(true);
    try {
      await request(`/admin/cms/${encodeURIComponent(key)}`, { method: "DELETE" });
      toast.success("Block deleted", key);
      q.refetch();
    } catch (e) {
      toast.error("Couldn't delete the block", describeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "CMS" }]}
        title="Content Blocks"
        subtitle="Homepage merchandising blocks served to the storefront via /public/cms. Only active blocks are visible to visitors."
        actions={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => setEditor({ key: "", title: "", body: "", sortOrder: String(blocks.length + 1), isNew: true })}
          >
            New Block
          </Button>
        }
      />

      <Panel>
        {q.status === "loading" ? (
          <ListSkeleton rows={4} />
        ) : q.status === "error" ? (
          <ErrorState message={q.error} onRetry={q.refetch} />
        ) : blocks.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No content blocks yet"
            message="Create a block (e.g. key “hero” or “banner-strip”) and the storefront can render it."
          />
        ) : (
          <ul className="space-y-2.5">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-3 rounded-lg border erp-border-soft p-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold erp-text">
                    <span className="font-mono text-xs erp-text-faint">{b.key}</span>
                    {b.title ?? <span className="erp-text-faint">Untitled</span>}
                    <Badge tone={b.isActive ? "success" : "neutral"}>{b.isActive ? "Active" : "Hidden"}</Badge>
                  </p>
                  {b.body && <p className="mt-1 line-clamp-2 text-xs erp-text-muted">{b.body}</p>}
                  <p className="mt-1 text-[11px] erp-text-faint">Order {b.sortOrder} · updated {formatDateTime(b.updatedAt)}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={b.isActive ? EyeOff : Eye}
                    disabled={busy}
                    onClick={() => void save({ key: b.key, isActive: !b.isActive }).then((okd) => okd && toast.success(b.isActive ? "Block hidden" : "Block published", b.key))}
                  >
                    {b.isActive ? "Hide" : "Publish"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Pencil}
                    onClick={() => setEditor({ key: b.key, title: b.title ?? "", body: b.body ?? "", sortOrder: String(b.sortOrder), isNew: false })}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" icon={Trash2} disabled={busy} onClick={() => void remove(b.key)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        title={editor?.isNew ? "New Block" : `Edit · ${editor?.key}`}
        description="Saved to the database and served live to the storefront."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || !editor?.key.trim()}
              onClick={() => {
                if (!editor) return;
                void save({
                  key: editor.key.trim(),
                  title: editor.title.trim() || undefined,
                  body: editor.body.trim() || undefined,
                  sortOrder: Number(editor.sortOrder) || 0,
                }).then((okd) => {
                  if (okd) {
                    toast.success("Block saved", editor.key.trim());
                    setEditor(null);
                  }
                });
              }}
            >
              Save
            </Button>
          </>
        }
      >
        {editor && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold erp-text-muted">Key (unique, e.g. hero, banner-strip)</span>
              <input
                value={editor.key}
                disabled={!editor.isNew}
                onChange={(e) => setEditor({ ...editor, key: e.target.value })}
                className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 font-mono text-sm erp-text outline-none focus:border-primary-500 disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold erp-text-muted">Title</span>
              <input
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold erp-text-muted">Body</span>
              <textarea
                value={editor.body}
                rows={4}
                onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                className="mt-1 w-full rounded-lg border erp-border erp-surface p-3 text-sm erp-text outline-none focus:border-primary-500"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold erp-text-muted">Sort order</span>
              <input
                type="number"
                value={editor.sortOrder}
                onChange={(e) => setEditor({ ...editor, sortOrder: e.target.value })}
                className="mt-1 h-10 w-28 rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500"
              />
            </label>
          </div>
        )}
      </Dialog>
    </div>
  );
}
