import { useState } from "react";
import { ChevronDown, Globe, Image as ImageIcon, LayoutTemplate, Pencil, Plus, ScrollText, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Badge, Button, Dialog, PageHeader, Tabs } from "../components/ui";
import { categories, catalogProducts } from "../mock-data-ext";
import { PRODUCT_STATUS } from "../statuses-ext";
import { cn } from "@/utils/cn";

const HERO_BLOCKS = [
  { id: "H1", title: "Custom packaging, delivered fast", subtitle: "Hero banner · homepage top", emoji: "📦" },
  { id: "H2", title: "Rigid gift boxes from ₹96", subtitle: "Promo strip · below fold", emoji: "🎁" },
  { id: "H3", title: "Get a quote in 4 hours", subtitle: "CTA band · mid-page", emoji: "⚡" },
];

const BLOG_POSTS = [
  { id: "B1", title: "5 sustainable packaging trends for 2026", status: "published" as const, date: "24 Jul 2026" },
  { id: "B2", title: "How to design a mailer box that converts", status: "published" as const, date: "18 Jul 2026" },
  { id: "B3", title: "Understanding GSM: a paper weight guide", status: "draft" as const, date: "—" },
];

const FAQS = [
  { q: "What is the minimum order quantity?", a: "MOQs vary by product — mailer boxes start at 500 units, folding cartons at 1,000. Each product page lists its MOQ." },
  { q: "How long does production take?", a: "Standard turnaround is 7–10 business days after artwork approval. Rush options are available on request." },
  { q: "Can I get a physical sample?", a: "Yes. We offer paid pre-production samples that are credited back on bulk orders above ₹50,000." },
  { q: "Do you ship pan-India?", a: "We ship across India via BlueDart, Delhivery, DTDC and Ekart. Freight is calculated at checkout by weight and destination." },
];

const MEDIA = ["📦", "🎁", "📮", "🛍️", "🍫", "📕", "🏷️", "✨"];

function EditableRow({ label, sub, right, onEdit }: { label: string; sub?: string; right?: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b erp-border-soft py-3 last:border-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold erp-text">{label}</div>
        {sub && <div className="truncate text-xs erp-text-faint">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit}>Edit</Button>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors", on ? "bg-primary-500" : "erp-surface-2 border erp-border")}
    >
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform", on ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

export default function CMS() {
  const toast = useToast();
  const [tab, setTab] = useState("homepage");
  const [openFaq, setOpenFaq] = useState<string | null>(FAQS[0].q);
  const [blogOpen, setBlogOpen] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries([...categories, ...catalogProducts].map((x) => [x.id, true])),
  );

  const TABS = [
    { key: "homepage", label: "Homepage", icon: LayoutTemplate },
    { key: "categories", label: "Categories" },
    { key: "products", label: "Products" },
    { key: "blogs", label: "Blogs", icon: ScrollText },
    { key: "faq", label: "FAQ" },
    { key: "media", label: "Media", icon: ImageIcon },
    { key: "seo", label: "SEO", icon: Globe },
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Website CMS" }]}
        title="Website CMS"
        subtitle="Manage the public storefront content, catalog visibility and SEO."
      />
      <div className="mb-5">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {tab === "homepage" && (
        <div className="erp-card card-shadow p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold erp-text">Hero & banner blocks</h3>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => toast.info("Add block", "New content block editor would open here.")}>Add Block</Button>
          </div>
          {HERO_BLOCKS.map((b) => (
            <EditableRow key={b.id} label={`${b.emoji}  ${b.title}`} sub={b.subtitle} onEdit={() => toast.info("Editing block", b.title)} />
          ))}
        </div>
      )}

      {tab === "categories" && (
        <div className="erp-card card-shadow p-4 sm:p-5">
          <h3 className="mb-2 text-sm font-bold erp-text">Categories</h3>
          {categories.map((c) => (
            <EditableRow
              key={c.id}
              label={c.name}
              sub={`${c.productCount} products · ${c.subcategories.join(", ")}`}
              right={<Toggle on={visible[c.id]} onChange={(v) => setVisible((s) => ({ ...s, [c.id]: v }))} label={`Show ${c.name} on site`} />}
              onEdit={() => toast.info("Editing category", c.name)}
            />
          ))}
        </div>
      )}

      {tab === "products" && (
        <div className="erp-card card-shadow p-4 sm:p-5">
          <h3 className="mb-2 text-sm font-bold erp-text">Products</h3>
          {catalogProducts.map((p) => (
            <EditableRow
              key={p.id}
              label={`${p.imageEmoji}  ${p.name}`}
              sub={`${p.sku} · ${p.category}`}
              right={
                <div className="flex items-center gap-2">
                  <Badge tone={PRODUCT_STATUS[p.status].tone}>{PRODUCT_STATUS[p.status].label}</Badge>
                  <Toggle on={visible[p.id]} onChange={(v) => setVisible((s) => ({ ...s, [p.id]: v }))} label={`Show ${p.name} on site`} />
                </div>
              }
              onEdit={() => toast.info("Editing product", p.name)}
            />
          ))}
        </div>
      )}

      {tab === "blogs" && (
        <div className="erp-card card-shadow p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold erp-text">Blog posts</h3>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setBlogOpen(true)}>New Post</Button>
          </div>
          {BLOG_POSTS.map((b) => (
            <EditableRow
              key={b.id}
              label={b.title}
              sub={b.date}
              right={<Badge tone={b.status === "published" ? "success" : "warning"}>{b.status === "published" ? "Published" : "Draft"}</Badge>}
              onEdit={() => toast.info("Editing post", b.title)}
            />
          ))}
        </div>
      )}

      {tab === "faq" && (
        <div className="erp-card card-shadow p-2 sm:p-3">
          {FAQS.map((f) => {
            const open = openFaq === f.q;
            return (
              <div key={f.q} className="border-b erp-border-soft last:border-0">
                <button
                  onClick={() => setOpenFaq(open ? null : f.q)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-3 px-3 py-3.5 text-left"
                >
                  <span className="text-sm font-semibold erp-text">{f.q}</span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 erp-text-faint transition-transform", open && "rotate-180")} aria-hidden />
                </button>
                {open && <p className="px-3 pb-4 text-sm erp-text-muted">{f.a}</p>}
              </div>
            );
          })}
        </div>
      )}

      {tab === "media" && (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {MEDIA.map((m, i) => (
            <div key={i} className="flex aspect-square items-center justify-center rounded-xl border erp-border erp-surface-2 text-4xl">
              {m}
            </div>
          ))}
          <button
            onClick={() => toast.info("Upload media", "File picker would open here.")}
            className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed erp-border erp-surface text-primary-500 hover:erp-surface-2"
          >
            <Upload className="h-5 w-5" aria-hidden />
            <span className="text-xs font-semibold">Upload</span>
          </button>
        </div>
      )}

      {tab === "seo" && (
        <div className="erp-card card-shadow max-w-2xl p-5">
          <h3 className="mb-4 text-sm font-bold erp-text">Global SEO meta</h3>
          <div className="space-y-4">
            {[
              { label: "Site title", value: "Zolo Packaging — Custom Boxes & Cartons" },
              { label: "Meta description", value: "Premium custom packaging for D2C brands. Mailer boxes, rigid boxes, cartons — quoted in 4 hours." },
              { label: "Keywords", value: "custom packaging, mailer boxes, rigid boxes, india" },
              { label: "Canonical URL", value: "https://zolopackaging.example" },
            ].map((f) => (
              <label key={f.label} className="block">
                <span className="text-xs font-semibold erp-text-muted">{f.label}</span>
                <input defaultValue={f.value} className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
              </label>
            ))}
            <Button variant="primary" onClick={() => toast.success("SEO saved", "Global meta fields updated.")}>Save changes</Button>
          </div>
        </div>
      )}

      <Dialog
        open={blogOpen}
        onClose={() => setBlogOpen(false)}
        title="New Blog Post"
        description="Draft a post for the website blog."
        footer={
          <>
            <Button variant="ghost" onClick={() => setBlogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setBlogOpen(false); toast.success("Draft created", "New blog post saved as draft."); }}>Create Draft</Button>
          </>
        }
      >
        <label className="block">
          <span className="text-xs font-semibold erp-text-muted">Post title</span>
          <input placeholder="e.g. Sustainable packaging in 2026" className="mt-1 h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500" />
        </label>
      </Dialog>
    </div>
  );
}
