import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Archive, Boxes, ImagePlus, Pencil, Save } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, Panel } from "../components/Panel";
import { Badge, Button, KeyValue, PageHeader, Tabs, type TabItem } from "../components/ui";
import { formatDate, inr } from "../format";
import { useCatalogProduct } from "../catalog-store";
import { PRODUCT_STATUS } from "../statuses-ext";
import type { ProductVariant } from "../types";
import { MediaThumb, priceLabel } from "./catalog/CatalogComponents";

// ---------- Pricing slabs ----------

const SLABS = [
  { qty: 500, discount: 0 },
  { qty: 1000, discount: 0.08 },
  { qty: 3000, discount: 0.15 },
  { qty: 5000, discount: 0.22 },
];

// ---------- SEO tab ----------

function SeoTab({ productName, sku }: { productName: string; sku: string }) {
  const toast = useToast();
  const [metaTitle, setMetaTitle] = useState(`${productName} | Zolo Packaging`);
  const [metaDesc, setMetaDesc] = useState(`Buy ${productName} in bulk. Custom printing, low MOQ, fast dispatch.`);
  const [slug, setSlug] = useState(sku.toLowerCase());
  const [keywords, setKeywords] = useState("packaging, custom boxes, wholesale");

  const field = "h-10 w-full rounded-lg border erp-border erp-surface px-3 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20";

  return (
    <Panel>
      <div className="max-w-xl space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Meta title</span>
          <input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Meta description</span>
          <textarea
            value={metaDesc}
            onChange={(e) => setMetaDesc(e.target.value)}
            rows={3}
            className="w-full rounded-lg border erp-border erp-surface px-3 py-2 text-sm erp-text outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-500/20"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Slug</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold erp-text-muted">Keywords</span>
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className={field} />
        </label>
        <Button variant="primary" icon={Save} onClick={() => toast.success("SEO saved", "Metadata updated for this product.")}>
          Save
        </Button>
      </div>
    </Panel>
  );
}

// ---------- Media tab ----------

function MediaTab({ emoji }: { emoji: string }) {
  const toast = useToast();
  const tiles = [emoji, "📐", "🖼️", "📸", "🎨"];
  return (
    <Panel>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div
            key={i}
            className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border erp-border erp-surface-2 text-4xl"
            aria-hidden
          >
            <MediaThumb src={t} imgClass="h-full w-full object-cover" />
          </div>
        ))}
        <button
          type="button"
          onClick={() => toast.info("Upload media", "Drag files here to add images.")}
          className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed erp-border erp-text-muted transition-colors hover:erp-surface-2"
        >
          <ImagePlus className="h-6 w-6" aria-hidden />
          <span className="text-xs font-semibold">Upload</span>
        </button>
      </div>
    </Panel>
  );
}

// ---------- Pricing tab ----------

function PricingTab({ basePrice }: { basePrice: number }) {
  if (!basePrice) {
    return (
      <Panel>
        <p className="text-sm erp-text-muted">
          Quotation-based product — no fixed catalog price. Buyers use{" "}
          <span className="font-semibold erp-text">Request a Quote</span>; pricing is agreed per RFQ.
        </p>
      </Panel>
    );
  }
  return (
    <Panel bodyClassName="p-0">
      <div className="overflow-x-auto px-4 sm:px-5">
        <table className="w-full text-sm">
          <caption className="sr-only">Quantity slab pricing</caption>
          <thead>
            <tr className="border-b erp-border text-left">
              <th className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint first:pl-0">Quantity</th>
              <th className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint">Discount</th>
              <th className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint">Unit Price</th>
              <th className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide erp-text-faint last:pr-0">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {SLABS.map((s) => {
              const unit = basePrice * (1 - s.discount);
              return (
                <tr key={s.qty} className="border-b erp-border-soft last:border-0">
                  <td className="px-3 py-3 font-semibold erp-text first:pl-0">{s.qty.toLocaleString("en-IN")} pcs</td>
                  <td className="px-3 py-3">
                    {s.discount > 0 ? (
                      <Badge tone="success">{Math.round(s.discount * 100)}% off</Badge>
                    ) : (
                      <span className="erp-text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums erp-text">{inr(unit)}</td>
                  <td className="px-3 py-3 tabular-nums font-semibold erp-text last:pr-0">{inr(unit * s.qty)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- Page ----------

export default function ProductDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [tab, setTab] = useState("overview");

  // Reactive: reflects Update Stock / Mark Out of Stock / Archive edits live.
  const product = useCatalogProduct(id);

  if (!product) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader
          breadcrumb={[{ label: "Home", to: "/admin" }, { label: "Catalog", to: "/admin/catalog" }, { label: "Not found" }]}
          title="Product not found"
        />
        <Panel>
          <EmptyState
            icon={Boxes}
            title="No such product"
            message="This product may have been removed or the link is incorrect."
            action={
              <Link to="/admin/catalog" className="text-sm font-bold text-primary-600 hover:text-primary-700">
                Back to catalog
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const m = PRODUCT_STATUS[product.status];

  const variantColumns: Column<ProductVariant>[] = [
    { key: "label", header: "Variant", render: (v) => <span className="font-semibold erp-text">{v.label}</span> },
    { key: "sku", header: "SKU", render: (v) => <span className="font-mono text-xs erp-text-muted">{v.sku}</span> },
    { key: "moq", header: "MOQ", render: (v) => <span className="tabular-nums erp-text-muted">{v.moq.toLocaleString("en-IN")}</span>, hideBelow: "sm" },
    { key: "price", header: "Base Price", render: (v) => <span className="tabular-nums erp-text">{priceLabel(v.basePrice)}</span> },
    {
      key: "stock",
      header: "In Stock",
      render: (v) => (
        <span className={v.inStock === 0 ? "font-semibold text-red-600 dark:text-red-400" : "erp-text"}>
          {v.inStock.toLocaleString("en-IN")}
        </span>
      ),
    },
  ];

  const tabs: TabItem[] = [
    { key: "overview", label: "Overview" },
    { key: "variants", label: "Variants", count: product.variants.length },
    { key: "media", label: "Media Gallery" },
    { key: "seo", label: "SEO" },
    { key: "pricing", label: "Pricing" },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader
        breadcrumb={[
          { label: "Home", to: "/admin" },
          { label: "Catalog", to: "/admin/catalog" },
          { label: product.name },
        ]}
        title={
          <span className="flex items-center gap-2.5">
            <span aria-hidden>{product.imageEmoji}</span>
            {product.name}
            <Badge tone={m.tone} dot>
              {m.label}
            </Badge>
          </span>
        }
        subtitle={<span className="font-mono">{product.sku}</span>}
        actions={
          <>
            <Button variant="secondary" icon={Pencil} onClick={() => toast.info("Edit product", "Opening the product editor.")}>
              Edit
            </Button>
            <Button variant="danger" icon={Archive} onClick={() => toast.success("Product archived", `${product.name} moved to archive.`)}>
              Archive
            </Button>
          </>
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <Panel>
          <KeyValue
            items={[
              { label: "SKU", value: <span className="font-mono">{product.sku}</span> },
              { label: "Category", value: product.category },
              { label: "Subcategory", value: product.subcategory },
              { label: "Base Price", value: priceLabel(product.basePrice) },
              { label: "MOQ", value: product.moq.toLocaleString("en-IN") },
              { label: "Status", value: <Badge tone={m.tone}>{m.label}</Badge> },
              { label: "Variants", value: product.variants.length },
              { label: "Last Updated", value: formatDate(product.updatedAt) },
            ]}
          />
        </Panel>
      )}

      {tab === "variants" && (
        <Panel bodyClassName="p-0">
          <div className="px-4 sm:px-5">
            <DataTable caption="Variants" columns={variantColumns} rows={product.variants} rowKey={(v) => v.id} />
          </div>
        </Panel>
      )}

      {tab === "media" && <MediaTab emoji={product.imageEmoji} />}
      {tab === "seo" && <SeoTab productName={product.name} sku={product.sku} />}
      {tab === "pricing" && <PricingTab basePrice={product.basePrice} />}
    </div>
  );
}
