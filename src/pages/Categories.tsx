import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Package } from "lucide-react";
import { useBuyerProducts } from "../lib/products";
import { useCategoryTree } from "../lib/categories";
import { SectionHeader } from "../components/UI";

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
    <main className="py-12">
      <div className="shell">
        <SectionHeader
          eyebrow="Categories"
          title={<>Shop by <span className="grad-text">packaging type</span></>}
          subtitle="Explore our full catalog organized by packaging type."
          align="center"
        />

        <div className="mt-12 grid-cards-lg">
          {CATEGORIES.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ y: -6 }}
              className="bg-white rounded-2xl border border-dark-100 overflow-hidden card-shadow card-shadow-hover group"
            >
              <Link to={`/category/${c.slug}`} className="block">
                <div className="relative h-48 bg-white flex items-center justify-center overflow-hidden border-b border-dark-100 p-4">
                  <img
                    src={imageFor(c)}
                    alt={c.name}
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-dark-50/80 backdrop-blur text-xs font-semibold text-dark-700">
                    <Package className="h-3 w-3" />
                    {c.count}
                  </div>
                </div>
                <div className="p-5 flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg font-bold text-dark-900 group-hover:text-primary-600 transition-colors">
                    {c.name}
                  </h3>
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-dark-700 group-hover:text-primary-500 shrink-0">
                    View <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </Link>
              {c.subcategories.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 px-5 pb-5">
                  {c.subcategories.map((sc) => (
                    <li key={sc.slug}>
                      <Link to={`/category/${c.slug}/${sc.pathSlug}`} className="inline-block rounded-full bg-dark-50 px-2.5 py-1 text-xs font-semibold text-dark-600 hover:bg-primary-50 hover:text-primary-700">
                        {sc.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </main>
  );
}
