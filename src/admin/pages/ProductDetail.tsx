import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Archive, ArchiveRestore, Boxes, ImagePlus, Pencil } from "lucide-react";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState, Panel } from "../components/Panel";
import { Badge, Button, KeyValue, PageHeader, Tabs, type TabItem } from "../components/ui";
import { formatDate, inr } from "../format";
import { useCatalogProduct } from "../catalog-store";
import { PRODUCT_STATUS, STOCK_STATUS } from "../statuses-ext";
import type { CatalogProduct, ProductVariant } from "../types";
import { ArchiveDialog, ImageLightbox, MediaThumb, priceLabel } from "./catalog/CatalogComponents";
import { ProductFormDrawer } from "./catalog/ProductForm";
import { UploadImageDialog } from "./catalog/ImageUpload";

// ---------- Pricing slabs ----------

const SLABS = [
  { qty: 500, discount: 0 },
  { qty: 1000, discount: 0.08 },
  { qty: 3000, discount: 0.15 },
  { qty: 5000, discount: 0.22 },
];

const isStoredUrl = (s: string) => /^(https?:\/\/|\/)/.test(s) && !/^(blob:|data:)/.test(s);

// ---------- Media tab (real stored images) ----------

function MediaTab({ product, onUpload, onOpen }: { product: CatalogProduct; onUpload: () => void; onOpen: (i: number) => void }) {
  const images = (product.images ?? []).filter(isStoredUrl);
  return (
    <Panel>
      {images.length === 0 && (
        <p className="mb-4 text-sm erp-text-muted">No images stored for this product yet — it shows the {product.imageEmoji} placeholder in the catalog and storefront.</p>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => onOpen(i)}
            aria-label={`Open image ${i + 1}`}
            className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border erp-border erp-surface-2 transition-colors hover:border-primary-500"
          >
            <MediaThumb src={src} imgClass="h-full w-full object-cover" />
            {i === 0 && <span className="absolute left-2 top-2 rounded bg-primary-500 px-1.5 py-0.5 text-[10px] font-bold text-white">PRIMARY</span>}
          </button>
        ))}
        <button
          type="button"
          onClick={onUpload}
          className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed erp-border erp-text-muted transition-colors hover:erp-surface-2"
        >
          <ImagePlus className="h-6 w-6" aria-hidden />
          <span className="text-xs font-semibold">Upload image</span>
        </button>
      </div>
      <p className="mt-3 text-xs erp-text-faint">To reorder, replace or remove images, use Edit → Images.</p>
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
      <p className="px-4 pb-4 text-xs erp-text-faint sm:px-5">Illustrative slabs from the base price. Real tiered pricing is managed per product under Inventory → price tiers.</p>
    </Panel>
  );
}

// ---------- Page ----------

export default function ProductDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);

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
  const ss = product.stockStatus ? STOCK_STATUS[product.stockStatus] : null;
  const archived = product.status === "archived";
  const primary = (product.images ?? []).find(isStoredUrl);

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
    { key: "media", label: "Media Gallery", count: (product.images ?? []).filter(isStoredUrl).length },
    { key: "variants", label: "Variants", count: product.variants.length },
    { key: "pricing", label: "Pricing" },
  ];

  const dims = product.dimensions;

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
            {primary ? <img src={primary} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <span aria-hidden>{product.imageEmoji}</span>}
            {product.name}
            <Badge tone={m.tone} dot>{m.label}</Badge>
            {ss && <Badge tone={ss.tone}>{ss.label}</Badge>}
          </span>
        }
        subtitle={<span className="font-mono">{product.sku} · {product.id}</span>}
        actions={
          <>
            <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>
            <Button variant={archived ? "primary" : "danger"} icon={archived ? ArchiveRestore : Archive} onClick={() => setArchiveOpen(true)}>
              {archived ? "Unarchive" : "Archive"}
            </Button>
          </>
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && (
        <Panel>
          <KeyValue
            items={[
              { label: "Product ID", value: <span className="font-mono">{product.id}</span> },
              { label: "SKU", value: <span className="font-mono">{product.sku}</span> },
              { label: "Category", value: product.category },
              { label: "Subcategory", value: product.subcategory },
              { label: "Type", value: product.productType ?? "—" },
              { label: "Material", value: product.material ?? "—" },
              { label: "Dimensions", value: dims ? `${dims.length} × ${dims.width} × ${dims.height} ${dims.unit}` : "—" },
              { label: "GSM", value: product.gsm ?? "—" },
              { label: "Color", value: product.color ?? "—" },
              { label: "Base Price", value: priceLabel(product.basePrice) },
              { label: "MOQ", value: product.moq.toLocaleString("en-IN") },
              { label: "Stock on hand", value: (product.stock ?? 0).toLocaleString("en-IN") },
              { label: "Product status", value: <Badge tone={m.tone}>{m.label}</Badge> },
              { label: "Stock status", value: ss ? <Badge tone={ss.tone}>{ss.label}</Badge> : "—" },
              { label: "Last Updated", value: formatDate(product.updatedAt) },
            ]}
          />
          {product.description && <p className="mt-4 text-sm erp-text-muted">{product.description}</p>}
        </Panel>
      )}

      {tab === "variants" && (
        <Panel bodyClassName="p-0">
          <div className="px-4 sm:px-5">
            {product.variants.length ? (
              <DataTable caption="Variants" columns={variantColumns} rows={product.variants} rowKey={(v) => v.id} />
            ) : (
              <EmptyState icon={Boxes} title="No variants" message="This product is sold as a single configuration." />
            )}
          </div>
        </Panel>
      )}

      {tab === "media" && <MediaTab product={product} onUpload={() => setUploadOpen(true)} onOpen={(i) => setLightbox(i)} />}
      {tab === "pricing" && <PricingTab basePrice={product.basePrice} />}

      <ProductFormDrawer product={product} open={editOpen} onClose={() => setEditOpen(false)} />
      {archiveOpen && <ArchiveDialog product={product} open onClose={() => setArchiveOpen(false)} />}
      <UploadImageDialog product={uploadOpen ? product : null} open={uploadOpen} onClose={() => setUploadOpen(false)} />
      {lightbox != null && <ImageLightbox product={product} startIndex={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
