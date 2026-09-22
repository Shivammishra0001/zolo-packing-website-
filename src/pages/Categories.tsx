import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useBuyerProducts } from "../lib/products";
import { useCategoryTree } from "../lib/categories";
import { Breadcrumb, EmptyState, SectionHeader } from "../components/UI";

// Import category images
import catFood from "../../images/category_food.png";
import catPouches from "../../images/category_pouches.png";
import catCans from "../../images/category_cans.png";
import catJars from "../../images/category_jars.png";
import catTubes from "../../images/category_tubes.png";
import catContainers from "../../images/pizza.png";
import catApparel from "../../images/category_apparel.png";
import catDevice from "../../images/category_device.png";
import catOthers from "../../images/category_others.svg";
import catTapes from "../../images/category_tapes.png";
import catPharma from "../../images/category_pharma.png";

// Bundled artwork per category slug — used only when the admin has NOT
// uploaded an image for the category (Product Catalog → Categories). Order:
// admin image → this artwork → a product image from the category → placeholder.
const catImages: Record<string, string> = {
  // real catalog slugs
  "food-packaging": catFood,
  "flexible-packaging": catPouches,
  containers: catContainers,
  tubes: catTubes,
  drinkware: catCans,
  bags: catApparel,
  "packaging-accessories": catOthers,
  packaging: catOthers,
  // legacy demo slugs (kept so nothing that still references them breaks)
  food: catFood,
  pouches: catPouches,
  cans: catCans,
  jars: catJars,
  cups: catContainers,
  apparel: catApparel,
  device: catDevice,
  others: catOthers,
  tapes: catTapes,
  pharma: catPharma,
};

export default function Categories() {
  // The admin-managed tree (active categories, in the admin's display order),
  // so a category created in Admin appears here without a deployment.
  // Subcategories are listed as quick links under each card.
  const products = useBuyerProducts();
  const CATEGORIES = useCategoryTree(products);
  const imageFor = (c: (typeof CATEGORIES)[number]) =>
    (c.imageSource === "uploaded" ? c.image : null) ?? catImages[c.id] ?? c.image ?? catOthers;

  return (
    <main className="section-sm">
      <div className="shell">
        <Breadcrumb items={[{ label: "Home", to: "/" }, { label: "Categories" }]} className="mb-4" />
        <SectionHeader
          eyebrow="Categories"
          title="Shop by packaging type"
          subtitle="Explore the full catalog organised by packaging type."
        />

        {CATEGORIES.length === 0 ? (
          <EmptyState className="mt-6" title="No categories yet" message="Categories appear here as soon as products are published." />
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((c, i) => (
              <motion.article
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.2) }}
                className="group card card-hover flex flex-col overflow-hidden"
              >
                <Link to={`/category/${c.slug}`} className="block">
                  <div className="aspect-[4/3] overflow-hidden bg-green-50 p-5">
                    <img
                      src={imageFor(c)}
                      alt={c.name}
                      loading="lazy"
                      className="h-full w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                    />
                  </div>
                  <div className="px-4 pt-4">
                    <h3 className="h3 text-dark-900 transition-colors group-hover:text-green-600">{c.name}</h3>
                    <p className="mt-1 text-sm text-dark-500">
                      {c.count} {c.count === 1 ? "product" : "products"}
                    </p>
                  </div>
                </Link>
                <div className="px-4 pb-4 pt-3">
                  {c.subcategories.length > 0 ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {c.subcategories.map((sc) => (
                        <li key={sc.slug}>
                          <Link
                            to={`/category/${c.slug}/${sc.pathSlug}`}
                            className="chip h-8 px-3 text-xs hover:border-green-500 hover:bg-green-100 hover:text-green-700"
                          >
                            {sc.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Link to={`/category/${c.slug}`} className="text-sm font-semibold text-green-600 hover:underline">
                      View products →
                    </Link>
                  )}
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
