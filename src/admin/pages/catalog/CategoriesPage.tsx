import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, FolderTree, GripVertical, ImageIcon, LayoutGrid, Layers, List, MoveRight, Pencil, Plus, Power, PowerOff, Settings2, Trash2,
} from "lucide-react";
import { ApiError, describeApiError } from "@/lib/api/client";
import { categoriesApi, type CategoryInput, type CategoryNode, type CategoryTreeNode } from "@/lib/api/categories";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/utils/cn";
import { Badge, Button, Dialog, PageHeader, SearchInput, Select, Toolbar } from "../../components/ui";
import { EmptyState, Panel } from "../../components/Panel";
import { TableSkeleton } from "../../components/DataTable";
import { archiveCategory, hydrateCategories, reorderCategories, saveCategory, setCategoryStatus, useCategories } from "../../categories-store";
import { hydrateCatalog } from "../../catalog-store";
import { AREA, CampaignImageField, errorsFrom, Field, FIELD, FIELD_ERR, RowActions, SwitchRow, type FormErrors } from "../marketing/shared";
import { BulkImportButton } from "./BulkImport";

// ============================================================
// Product Catalog → Categories. The whole catalog structure, managed here and
// read by the storefront (nav, filters, category pages) straight from
// PostgreSQL. Subcategories are rows of the same table with a parent.
//
// Two views of the same tree: CARDS (default — image, DB product/subcategory
// counts, status, Manage/Edit/Delete, multi-select with a bulk toolbar) and
// TABLE (drag a row onto a sibling or use the arrows → the full sibling order
// is persisted as sortOrder). Counts are COUNT(*) queries on the server, never
// stored numbers. Deleting is the existing soft archive and is refused while
// products reference the row: the admin views, moves or archives instead —
// products are never touched from here.
// ============================================================

/** URL-safe slug preview, same rule as the server. */
const slugOf = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------- modal (category + subcategory share one form) ----------

function CategoryDialog({ open, node, parentId: initialParent, categories, onClose, onSaved }: {
  open: boolean;
  /** Edit this row… */
  node: CategoryNode | null;
  /** …or create a new subcategory under this parent (null = new top-level category). */
  parentId: string | null;
  categories: CategoryTreeNode[];
  onClose: () => void;
  onSaved: (saved: CategoryNode) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [parentId, setParentId] = useState<string>("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const isSub = Boolean(node ? node.parentId : initialParent);
  const parent = isSub ? categories.find((c) => c.id === parentId) : undefined;

  useEffect(() => {
    if (!open) return;
    setName(node?.name ?? ""); setSlug(node?.slug ?? ""); setSlugTouched(Boolean(node));
    setDescription(node?.description ?? ""); setImage(node?.imageSource === "uploaded" ? node.image : null);
    setSortOrder(node ? String(node.sortOrder) : ""); setIsActive(node?.isActive ?? true);
    setParentId(node?.parentId ?? initialParent ?? ""); setErrors({}); setSaving(false);
  }, [open, node, initialParent]);

  // Slug follows the name (and, for a subcategory, the parent) until the
  // admin edits it by hand. Derived in the handlers, not an effect, so the
  // saved slug loaded on open is never overwritten.
  const derivedSlug = (n: string, pid: string) => {
    const p = isSub ? categories.find((c) => c.id === pid) : undefined;
    return n.trim() ? (p ? `${p.slug}-${slugOf(n)}` : slugOf(n)) : "";
  };
  const changeName = (n: string) => { setName(n); if (!slugTouched) setSlug(derivedSlug(n, parentId)); };
  const changeParent = (pid: string) => { setParentId(pid); if (!slugTouched) setSlug(derivedSlug(name, pid)); };

  const save = async () => {
    const e: FormErrors = {};
    if (name.trim().length < 2) e.name = `Enter the ${isSub ? "subcategory" : "category"} name.`;
    if (!SLUG_RE.test(slug.trim())) e.slug = "Use lowercase letters, numbers and hyphens only.";
    if (isSub && !parentId) e.parentId = "Choose the parent category.";
    if (sortOrder.trim() && !/^\d+$/.test(sortOrder.trim())) e.sortOrder = "Enter a whole number.";
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: CategoryInput = {
      name: name.trim(), slug: slug.trim(), description: description.trim() || null, image, isActive,
      ...(sortOrder.trim() ? { sortOrder: Number(sortOrder) } : {}),
      ...(isSub ? { parentId } : node ? {} : { parentId: null }),
    };
    setSaving(true);
    try {
      const saved = await saveCategory(node?.id ?? null, body);
      toast.success(node ? "Saved" : isSub ? "Subcategory created" : "Category created", `${saved.name} is ${saved.isActive ? "active" : "inactive"}.`);
      onSaved(saved);
    } catch (err) {
      setErrors(errorsFrom(err, "Could not save."));
    } finally { setSaving(false); }
  };

  const kind = isSub ? "Subcategory" : "Category";
  return (
    <Dialog
      open={open} onClose={onClose}
      title={node ? `Edit ${kind}` : `Add ${kind}`}
      description={isSub ? "Shown to customers under its parent category in the storefront navigation and filters." : "A top-level group in the storefront navigation, filters and category pages."}
      footer={<><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save {kind}</Button></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        {errors.form && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">{errors.form}</p>}
        {isSub && (
          <Field label="Parent category" required error={errors.parentId} hint={node ? "Change it to move this subcategory (its products move with it)." : undefined}>
            <select value={parentId} onChange={(e) => changeParent(e.target.value)} className={cn(FIELD, errors.parentId && FIELD_ERR)}>
              <option value="">Select a category…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isActive ? "" : " (inactive)"}</option>)}
            </select>
          </Field>
        )}
        <Field label={`${kind} name`} required error={errors.name}>
          <input value={name} onChange={(e) => changeName(e.target.value)} placeholder={isSub ? "5 Ply Boxes" : "Corrugated Boxes"} maxLength={80} className={cn(FIELD, errors.name && FIELD_ERR)} autoFocus />
        </Field>
        <Field label="Slug" required error={errors.slug} hint={<>URL: <span className="font-mono">/category/{isSub ? `${parent?.slug ?? "…"}/` : ""}{isSub && parent && slug.startsWith(`${parent.slug}-`) ? slug.slice(parent.slug.length + 1) : slug || "…"}</span></>}>
          <input value={slug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} maxLength={80} className={cn(FIELD, "font-mono", errors.slug && FIELD_ERR)} />
        </Field>
        <Field label="Description" hint="Optional. Shown on the category page.">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className={AREA} />
        </Field>
        <CampaignImageField label={`${kind} image`} value={image} onChange={setImage} hint="Optional. Without one the storefront shows a product image from this category." error={errors.image} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display order" hint="Lower shows first. Leave empty to keep / append." error={errors.sortOrder}>
            <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} inputMode="numeric" className={cn(FIELD, errors.sortOrder && FIELD_ERR)} />
          </Field>
        </div>
        <SwitchRow title="Active" hint="Inactive: hidden from customers and filters; no new products can be assigned. Existing products are kept." checked={isActive} onChange={setIsActive} />
      </form>
    </Dialog>
  );
}

// ---------- page ----------

type Filter = "all" | "active" | "inactive";
type View = "cards" | "table";
type BulkAction = "activate" | "deactivate" | "archive" | "delete";

/** CSV export of the whole structure with live counts. */
function exportCsv(categories: CategoryTreeNode[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["Category,Subcategory,Slug,Products,Subcategories,Status"];
  for (const c of categories) {
    lines.push([c.name, "", c.slug, c.productCount, c.subcategoryCount, c.isActive ? "active" : "inactive"].map(esc).join(","));
    for (const s of c.subcategories) lines.push([c.name, s.name, s.slug, s.productCount, "", s.isActive ? "active" : "inactive"].map(esc).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "zolo-categories.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CategoriesPage() {
  const toast = useToast();
  const nav = useNavigate();
  const categories = useCategories();
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // The list (table) is the default — the same view as before, with checkboxes
  // and bulk actions added; cards are an alternative, never paginated.
  const [view, setView] = useState<View>("table");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ node: CategoryNode | null; parentId: string | null } | null>(null);
  // Delete flow: confirm → (refused with products) blocked → move products.
  const [deleting, setDeleting] = useState<CategoryNode[] | null>(null);
  const [blocked, setBlocked] = useState<{ node: CategoryNode; message: string } | null>(null);
  const [moving, setMoving] = useState<CategoryNode | null>(null);
  const [moveTo, setMoveTo] = useState<{ categoryId: string; subcategoryId: string }>({ categoryId: "", subcategoryId: "" });
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ id: string; parentId: string | null } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  useEffect(() => { void hydrateCategories(true).finally(() => setLoaded(true)); }, []);

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const keep = (n: CategoryNode) => filter === "all" || (filter === "active" ? n.isActive : !n.isActive);
    return categories
      .map((c) => {
        const subs = c.subcategories.filter((s) => keep(s) && (!q || s.name.toLowerCase().includes(q) || s.slug.includes(q)));
        const selfHit = !q || c.name.toLowerCase().includes(q) || c.slug.includes(q);
        // A category stays visible when it matches, or when a subcategory does.
        if (!(keep(c) && selfHit) && subs.length === 0) return null;
        return { ...c, subcategories: q && !selfHit ? subs : c.subcategories.filter(keep) };
      })
      .filter((c): c is CategoryTreeNode => Boolean(c));
  }, [categories, q, filter]);
  const filtering = Boolean(q) || filter !== "all";

  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const isOpen = (id: string) => filtering || expanded.has(id);
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const byId = useMemo(() => new Map<string, CategoryNode>(categories.flatMap((c) => [[c.id, c] as const, ...c.subcategories.map((s) => [s.id, s] as const)])), [categories]);

  const refreshEverything = async () => { await hydrateCategories(true); void hydrateCatalog(); };

  const setStatus = async (n: CategoryNode) => {
    try {
      await setCategoryStatus(n.id, !n.isActive);
      toast.success(n.isActive ? "Deactivated" : "Activated", n.isActive ? `${n.name} is hidden from customers. Its products are kept.` : `${n.name} is visible to customers again.`);
      void hydrateCatalog();
    } catch (e) { toast.error("Couldn't change status", describeApiError(e).message); }
  };

  /** Bulk toolbar. Delete goes through the confirmation dialog first. */
  const runBulk = async (action: BulkAction, ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await categoriesApi.bulk(ids, action);
      await refreshEverything();
      const verb = { activate: "activated", deactivate: "deactivated", archive: "archived", delete: "deleted" }[action];
      if (r.failed === 0) toast.success(`${r.done} categor${r.done === 1 ? "y" : "ies"} ${verb}`);
      else {
        const refused = r.results.filter((x) => !x.ok);
        toast.error(`${r.done} ${verb}, ${r.failed} refused`, refused.map((x) => `${byId.get(x.id)?.name ?? x.id}: ${x.error}`).join(" · "));
        // Single blocked delete → offer the safe options.
        if (action === "delete" && refused.length === 1 && refused[0].code === "CATEGORY_HAS_PRODUCTS") {
          const node = byId.get(refused[0].id);
          if (node) setBlocked({ node, message: refused[0].error ?? "" });
        }
      }
      setSelected(new Set()); setDeleting(null);
    } catch (e) { toast.error("Action failed", describeApiError(e).message); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    // Single delete keeps the precise 409 path (message + options).
    if (deleting.length === 1) {
      const n = deleting[0];
      setBusy(true);
      try {
        await archiveCategory(n.id);
        toast.success("Deleted", `${n.name} was removed from the catalog structure.`);
        setDeleting(null); void hydrateCatalog();
      } catch (e) {
        const msg = describeApiError(e).message;
        setDeleting(null);
        if (e instanceof ApiError && (e.code === "CATEGORY_HAS_PRODUCTS" || e.code === "CATEGORY_HAS_SUBCATEGORIES")) setBlocked({ node: n, message: msg });
        else toast.error("Couldn't delete", msg);
      } finally { setBusy(false); }
      return;
    }
    await runBulk("delete", deleting.map((n) => n.id));
  };

  const doMove = async () => {
    if (!moving || !moveTo.categoryId) return;
    setBusy(true);
    try {
      const r = await categoriesApi.moveProducts(moving.id, moveTo.categoryId, moveTo.subcategoryId || null);
      toast.success(`${r.moved} product${r.moved === 1 ? "" : "s"} moved`, `${moving.name} is now empty and can be deleted.`);
      setMoving(null); setBlocked(null);
      await refreshEverything();
    } catch (e) { toast.error("Couldn't move products", describeApiError(e).message); }
    finally { setBusy(false); }
  };

  /** Move `id` to `position` (1-based) among its siblings and persist. */
  const move = async (parentId: string | null, ids: string[], id: string, position: number) => {
    const rest = ids.filter((x) => x !== id);
    rest.splice(Math.max(0, Math.min(position - 1, rest.length)), 0, id);
    if (rest.join() === ids.join()) return;
    try { await reorderCategories(parentId, rest); toast.success("Order saved", "The storefront shows the new order."); }
    catch (e) { toast.error("Couldn't reorder", describeApiError(e).message); }
  };

  // Native drag & drop between siblings only (a category onto a category, a
  // subcategory onto one of the same parent). Filtered views cannot reorder,
  // because a partial list would be a wrong full order.
  const onDragStart = (e: DragEvent, id: string, parentId: string | null) => { if (filtering) { e.preventDefault(); return; } setDrag({ id, parentId }); e.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (e: DragEvent, id: string, parentId: string | null) => { if (drag && drag.parentId === parentId && drag.id !== id) { e.preventDefault(); setOver(id); } };
  const onDrop = async (e: DragEvent, targetId: string, parentId: string | null, siblings: string[]) => {
    e.preventDefault(); setOver(null);
    if (!drag || drag.parentId !== parentId || drag.id === targetId) { setDrag(null); return; }
    const to = siblings.indexOf(targetId) + 1;
    setDrag(null);
    await move(parentId, siblings, drag.id, to);
  };

  const topIds = categories.map((c) => c.id);
  const th = "px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wide erp-text-faint";
  const manage = (id: string) => nav(`/admin/catalog/categories/${id}`);
  const nodeActions = (n: CategoryNode, depth: 0 | 1) => [
    { label: "Manage products", icon: Settings2, onClick: () => manage(n.id) },
    { label: "Edit", icon: Pencil, onClick: () => setDialog({ node: n, parentId: n.parentId }) },
    { label: "Add subcategory", icon: Plus, onClick: () => setDialog({ node: null, parentId: n.id }), hidden: depth !== 0 },
    { label: "Manage subcategories", icon: Layers, onClick: () => setExpanded((s) => new Set(s).add(n.id)), hidden: depth !== 0 },
    { label: "Move to another category", icon: MoveRight, onClick: () => setDialog({ node: n, parentId: n.parentId }), hidden: depth !== 1 },
    { label: n.isActive ? "Deactivate" : "Activate", icon: n.isActive ? PowerOff : Power, onClick: () => void setStatus(n) },
    { label: "Delete", icon: Trash2, danger: true, onClick: () => setDeleting([n]) },
  ];

  const Row = ({ n, depth, siblings, parentId, expandable }: { n: CategoryNode; depth: 0 | 1; siblings: string[]; parentId: string | null; expandable?: { open: boolean; count: number } }) => {
    const idx = siblings.indexOf(n.id);
    return (
      <tr
        draggable={!filtering}
        onDragStart={(e) => onDragStart(e, n.id, parentId)} onDragOver={(e) => onDragOver(e, n.id, parentId)} onDrop={(e) => void onDrop(e, n.id, parentId, siblings)} onDragEnd={() => { setDrag(null); setOver(null); }}
        className={cn("border-b erp-border-soft last:border-0 erp-hover", !n.isActive && "opacity-70", over === n.id && "ring-2 ring-inset ring-primary-400", drag?.id === n.id && "opacity-40")}
        data-depth={depth}
      >
        <td className="px-2 py-2.5">
          <div className={cn("flex items-center gap-1.5", depth === 1 && "pl-8")}>
            <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggleSelect(n.id)} aria-label={`Select ${n.name}`} className="h-3.5 w-3.5 accent-primary-500" />
            <span className={cn("cursor-grab erp-text-faint", filtering && "invisible")} title="Drag to reorder" aria-hidden><GripVertical className="h-4 w-4" /></span>
            {expandable ? (
              <button type="button" onClick={() => toggle(n.id)} aria-expanded={expandable.open} aria-label={`${expandable.open ? "Collapse" : "Expand"} ${n.name}`} className="flex h-7 w-7 items-center justify-center rounded-md erp-text-muted hover:erp-surface-2">
                {expandable.count ? (expandable.open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="h-4 w-4" />}
              </button>
            ) : <span className="text-[13px] erp-text-faint">└</span>}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md erp-surface-2">
              {n.image ? <img src={n.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon className="h-4 w-4 erp-text-faint" aria-hidden />}
            </span>
            <div className="min-w-0">
              <div className={cn("truncate erp-text", depth === 0 ? "font-bold" : "font-semibold text-[13px]")}>{n.name}</div>
              <div className="truncate font-mono text-[11px] erp-text-faint">/{n.slug}</div>
            </div>
          </div>
        </td>
        <td className="px-4 py-2.5 text-sm erp-text-muted">{depth === 0 ? (expandable?.count ?? 0) : <span className="erp-text-faint">—</span>}</td>
        <td className="px-4 py-2.5 text-sm">
          {n.productCount > 0
            ? <Link to={`/admin/catalog/categories/${n.id}`} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">{n.productCount}</Link>
            : <span className="erp-text-faint">0</span>}
        </td>
        <td className="px-4 py-2.5"><Badge tone={n.isActive ? "success" : "neutral"} dot>{n.isActive ? "Active" : "Inactive"}</Badge></td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1">
            <span className="w-6 text-sm font-semibold erp-text">{idx + 1}</span>
            <button type="button" disabled={filtering || idx <= 0} onClick={() => void move(parentId, siblings, n.id, idx)} aria-label={`Move ${n.name} up`} className="flex h-7 w-7 items-center justify-center rounded-md erp-text-muted hover:erp-surface-2 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" disabled={filtering || idx >= siblings.length - 1} onClick={() => void move(parentId, siblings, n.id, idx + 2)} aria-label={`Move ${n.name} down`} className="flex h-7 w-7 items-center justify-center rounded-md erp-text-muted hover:erp-surface-2 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
          </div>
        </td>
        <td className="px-2 py-2.5"><RowActions label={`Actions for ${n.name}`} actions={nodeActions(n, depth)} /></td>
      </tr>
    );
  };

  /** Category card (spec §17): image, name, counts, status, Manage/Edit/Delete, expandable subcategories. */
  const Card = ({ c }: { c: CategoryTreeNode }) => {
    const open = isOpen(c.id);
    const full = categories.find((x) => x.id === c.id) ?? c;
    return (
      <article className={cn("flex flex-col rounded-xl border erp-border erp-surface", selected.has(c.id) && "ring-2 ring-primary-400", !c.isActive && "opacity-80")} data-category-card={c.id}>
        <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-t-xl erp-surface-2">
          <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} aria-label={`Select ${c.name}`} className="absolute left-3 top-3 z-10 h-4 w-4 accent-primary-500" />
          {c.image ? <img src={c.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <ImageIcon className="h-8 w-8 erp-text-faint" aria-hidden />}
          <span className="absolute right-3 top-3"><Badge tone={c.isActive ? "success" : "neutral"} dot>{c.isActive ? "Active" : "Inactive"}</Badge></span>
        </div>
        <div className="flex flex-1 flex-col p-3">
          <div className="truncate text-sm font-bold erp-text" title={c.name}>{c.name}</div>
          <div className="mt-0.5 text-xs erp-text-muted" data-testid="category-counts">
            <span className="font-semibold erp-text">{c.productCount}</span> Product{c.productCount === 1 ? "" : "s"} • <span className="font-semibold erp-text">{full.subcategoryCount}</span> Subcategor{full.subcategoryCount === 1 ? "y" : "ies"}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="primary" icon={Settings2} onClick={() => manage(c.id)}>Manage</Button>
            <Button size="sm" icon={Pencil} onClick={() => setDialog({ node: c, parentId: null })}>Edit</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => setDeleting([c])}>Delete</Button>
            <span className="ml-auto"><RowActions label={`More actions for ${c.name}`} actions={nodeActions(c, 0)} /></span>
          </div>
          <button type="button" onClick={() => toggle(c.id)} aria-expanded={open} className="mt-3 flex items-center gap-1 text-xs font-semibold erp-text-muted hover:erp-text">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} {full.subcategoryCount} subcategor{full.subcategoryCount === 1 ? "y" : "ies"}
          </button>
          {open && (
            <ul className="mt-1.5 space-y-1 border-l erp-border pl-2">
              {c.subcategories.length === 0 && <li className="text-xs erp-text-faint">No subcategories. <button type="button" onClick={() => setDialog({ node: null, parentId: c.id })} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">Add one</button></li>}
              {c.subcategories.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5 text-xs" data-subcategory-row={s.id}>
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} aria-label={`Select ${s.name}`} className="h-3 w-3 accent-primary-500" />
                  <span className={cn("min-w-0 flex-1 truncate font-semibold erp-text", !s.isActive && "line-through opacity-60")} title={s.name}>{s.name}</span>
                  <Link to={`/admin/catalog/categories/${s.id}`} className="whitespace-nowrap font-semibold text-primary-600 hover:underline dark:text-primary-400">{s.productCount} Product{s.productCount === 1 ? "" : "s"}</Link>
                  <RowActions label={`Actions for ${s.name}`} actions={nodeActions(s, 1)} />
                </li>
              ))}
              {c.subcategories.length > 0 && <li><button type="button" onClick={() => setDialog({ node: null, parentId: c.id })} className="text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400">+ Add subcategory</button></li>}
            </ul>
          )}
        </div>
      </article>
    );
  };

  const total = categories.length;
  const totalSubs = categories.reduce((n, c) => n + c.subcategories.length, 0);
  const selectedNodes = [...selected].map((id) => byId.get(id)).filter((n): n is CategoryNode => Boolean(n));
  const deleteStats = (nodes: CategoryNode[]) => ({
    products: nodes.reduce((n, x) => n + x.productCount, 0),
    subcategories: nodes.reduce((n, x) => n + (x.parentId ? 0 : (categories.find((c) => c.id === x.id)?.subcategoryCount ?? 0)), 0),
  });
  // Any top-level category except the one being emptied (a subcategory's own parent is a valid target).
  const moveTargets = categories.filter((c) => c.id !== moving?.id);

  return (
    <div className="shell-admin space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Catalog", to: "/admin/catalog" }, { label: "Categories" }]}
        title="Categories"
        subtitle="The catalog structure customers browse. Product counts are live database counts. Changes are live in the storefront on its next load."
        actions={<>
          <Button icon={Download} onClick={() => exportCsv(categories)} disabled={!categories.length}>Export</Button>
          <BulkImportButton />
          <Button icon={Plus} onClick={() => setDialog({ node: null, parentId: categories[0]?.id ?? null })} disabled={!categories.length}>Add Subcategory</Button>
          <Button variant="primary" icon={Plus} onClick={() => setDialog({ node: null, parentId: null })}>Add Category</Button>
        </>}
      />

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search categories…" className="w-full sm:w-80" aria-label="Search categories" />
        <Select value={filter} onChange={(v) => setFilter(v as Filter)} aria-label="Status filter">
          <option value="all">Active & inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </Select>
        <div className="flex rounded-lg border erp-border p-0.5" role="group" aria-label="View">
          <button type="button" onClick={() => setView("cards")} aria-pressed={view === "cards"} aria-label="Card view" className={cn("flex h-8 w-8 items-center justify-center rounded-md", view === "cards" ? "erp-surface-2 erp-text" : "erp-text-muted")}><LayoutGrid className="h-4 w-4" /></button>
          <button type="button" onClick={() => setView("table")} aria-pressed={view === "table"} aria-label="Table view (reorder)" className={cn("flex h-8 w-8 items-center justify-center rounded-md", view === "table" ? "erp-surface-2 erp-text" : "erp-text-muted")}><List className="h-4 w-4" /></button>
        </div>
        <span className="text-xs erp-text-faint sm:ml-auto">{total} categories · {totalSubs} subcategories{filtering && view === "table" ? " · reordering is available without filters" : ""}</span>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(expanded.size === total ? [] : topIds))}>{expanded.size === total && total > 0 ? "Collapse all" : "Expand all"}</Button>
      </Toolbar>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm dark:border-primary-500/30 dark:bg-primary-500/10" role="region" aria-label="Bulk actions">
          <span className="font-bold erp-text">{selected.size} selected</span>
          <Button size="sm" icon={Power} disabled={busy} onClick={() => void runBulk("activate", [...selected])}>Activate</Button>
          <Button size="sm" icon={PowerOff} disabled={busy} onClick={() => void runBulk("deactivate", [...selected])}>Deactivate</Button>
          <Button size="sm" icon={Archive} disabled={busy} onClick={() => void runBulk("archive", [...selected])}>Archive</Button>
          <Button size="sm" variant="danger" icon={Trash2} disabled={busy} onClick={() => setDeleting(selectedNodes)}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Panel bodyClassName="p-0">
        {!loaded && categories.length === 0 && <div className="p-4"><TableSkeleton rows={5} cols={6} /></div>}
        {loaded && categories.length === 0 && <EmptyState icon={FolderTree} title="No categories yet" message="Add a category, or import an Excel file — its Category / Subcategory columns build the structure." action={<Button variant="primary" icon={Plus} onClick={() => setDialog({ node: null, parentId: null })}>Add Category</Button>} />}
        {categories.length > 0 && rows.length === 0 && <EmptyState icon={FolderTree} title="No categories match" message="Try another search or filter." />}
        {rows.length > 0 && view === "cards" && (
          <div className="p-4">
            <div className="grid-cards grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="category-grid">
              {rows.map((c) => <Card key={c.id} c={c} />)}
            </div>
          </div>
        )}
        {rows.length > 0 && view === "table" && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Categories and subcategories</caption>
              <thead><tr className="border-b erp-border">
                <th scope="col" className={th}>Category</th><th scope="col" className={th}>Subcategories</th><th scope="col" className={th}>Products</th><th scope="col" className={th}>Status</th><th scope="col" className={th}>Order</th><th scope="col" className={cn(th, "text-right")}><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {rows.map((c) => {
                  const open = isOpen(c.id);
                  const subIds = categories.find((x) => x.id === c.id)?.subcategories.map((s) => s.id) ?? [];
                  return [
                    <Row key={c.id} n={c} depth={0} siblings={topIds} parentId={null} expandable={{ open, count: c.subcategoryCount }} />,
                    ...(open ? c.subcategories.map((s) => <Row key={s.id} n={s} depth={1} siblings={subIds} parentId={c.id} />) : []),
                    ...(open && c.subcategories.length === 0 ? [
                      <tr key={`${c.id}-empty`} className="border-b erp-border-soft"><td colSpan={6} className="px-4 py-2 pl-16 text-xs erp-text-faint">No subcategories. <button type="button" onClick={() => setDialog({ node: null, parentId: c.id })} className="font-semibold text-primary-600 hover:underline dark:text-primary-400">Add one</button></td></tr>,
                    ] : []),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <CategoryDialog
        open={!!dialog} node={dialog?.node ?? null} parentId={dialog?.parentId ?? null} categories={categories}
        onClose={() => setDialog(null)}
        onSaved={(saved) => { setDialog(null); if (saved.parentId) setExpanded((s) => new Set(s).add(saved.parentId!)); void refreshEverything(); }}
      />

      {/* Delete confirmation — always shows what the selection contains. */}
      <Dialog
        open={!!deleting} onClose={() => setDeleting(null)}
        title={deleting?.length === 1 ? `Delete ${deleting[0].name}?` : `Delete ${deleting?.length ?? 0} categories?`}
        description={deleting ? (() => {
          const st = deleteStats(deleting);
          if (st.products > 0) return `${deleting.length === 1 ? "This category contains" : "These categories contain"} ${st.products} product${st.products === 1 ? "" : "s"}${st.subcategories ? ` and ${st.subcategories} subcategor${st.subcategories === 1 ? "y" : "ies"}` : ""}. Please reassign or archive these products before deleting the categor${deleting.length === 1 ? "y" : "ies"} — products are never deleted from here.`;
          if (st.subcategories > 0) return `${deleting.length === 1 ? "This category has" : "These categories have"} ${st.subcategories} subcategor${st.subcategories === 1 ? "y" : "ies"}. Delete or move them first.`;
          return "It disappears from the storefront and this list (soft delete, restorable from the database). Products are never deleted.";
        })() : ""}
        footer={<>
          <Button onClick={() => setDeleting(null)} disabled={busy}>Cancel</Button>
          {deleting && deleteStats(deleting).products > 0 && deleting.length === 1 && <>
            <Button icon={Settings2} onClick={() => { const n = deleting[0]; setDeleting(null); manage(n.id); }}>View Products</Button>
            <Button icon={MoveRight} onClick={() => { const n = deleting[0]; setDeleting(null); setMoving(n); setMoveTo({ categoryId: "", subcategoryId: "" }); }}>Move Products</Button>
            {deleting[0].isActive && <Button variant="primary" icon={Archive} onClick={() => { const n = deleting[0]; setDeleting(null); void runBulk("archive", [n.id]); }}>Archive Category</Button>}
          </>}
          {deleting && deleteStats(deleting).products === 0 && <Button variant="danger" icon={Trash2} loading={busy} onClick={confirmDelete}>Delete</Button>}
          {deleting && deleteStats(deleting).products > 0 && deleting.length > 1 && <Button variant="danger" icon={Trash2} loading={busy} onClick={confirmDelete}>Delete empty ones only</Button>}
        </>}
      />

      <Dialog
        open={!!blocked} onClose={() => setBlocked(null)}
        title="Cannot delete"
        description={blocked?.message}
        footer={<>
          <Button onClick={() => setBlocked(null)}>Cancel</Button>
          {blocked && blocked.node.productCount > 0 && <>
            <Button icon={Settings2} onClick={() => { const n = blocked.node; setBlocked(null); manage(n.id); }}>View Products</Button>
            <Button icon={MoveRight} onClick={() => { const n = blocked.node; setBlocked(null); setMoving(n); setMoveTo({ categoryId: "", subcategoryId: "" }); }}>Move Products</Button>
          </>}
          {blocked && blocked.node.isActive && <Button variant="primary" icon={Archive} onClick={() => { const n = blocked.node; setBlocked(null); void runBulk("archive", [n.id]); }}>Archive Category</Button>}
        </>}
      />

      <Dialog
        open={!!moving} onClose={() => setMoving(null)}
        title={`Move ${moving?.productCount ?? 0} product${moving?.productCount === 1 ? "" : "s"} from ${moving?.name ?? ""}`}
        description="Every product of this category is reassigned to the destination. Nothing is deleted; counts update immediately."
        footer={<><Button onClick={() => setMoving(null)} disabled={busy}>Cancel</Button><Button variant="primary" icon={MoveRight} loading={busy} disabled={!moveTo.categoryId} onClick={doMove}>Move Products</Button></>}
      >
        <div className="space-y-3">
          <Field label="Destination category" required>
            <select value={moveTo.categoryId} onChange={(e) => setMoveTo({ categoryId: e.target.value, subcategoryId: "" })} className={FIELD} aria-label="Destination category">
              <option value="">Select a category…</option>
              {moveTargets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Destination subcategory" hint="Optional.">
            <select value={moveTo.subcategoryId} onChange={(e) => setMoveTo((m) => ({ ...m, subcategoryId: e.target.value }))} className={FIELD} aria-label="Destination subcategory" disabled={!moveTo.categoryId}>
              <option value="">None</option>
              {(categories.find((c) => c.id === moveTo.categoryId)?.subcategories ?? []).filter((s) => s.id !== moving?.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
