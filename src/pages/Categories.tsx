import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Package, ArrowLeft } from "lucide-react";
import { useBuyerProducts } from "../lib/products";
import { useCategoryTree } from "../lib/categories";
import { SectionHeader } from "../components/UI";
import { useState } from "react";

// Import category images
import catFood from "../../images/category_food.png";
import catPouches from "../../images/category_pouches.png";
import catCans from "../../images/category_cans.png";
import catJars from "../../images/category_jars.png";
import catTubes from "../../images/category_tubes.png";
import catContainers from "../../images/category_containers.png";
import catApparel from "../../images/category_apparel.png";
import catDevice from "../../images/category_device.png";
import catPrint from "../../images/category_print.png";
import catOthers from "../../images/category_others.svg";
import catTapes from "../../images/category_tapes.png";
import catPharma from "../../images/category_pharma.png";

// Import subcategory product images
import burgerBox from "../../images/burger box.png";
import cakeBox from "../../images/cake box.png";
import coffeeCup from "../../images/coffee cup.png";
import compostableMailer from "../../images/compostable mailer.png";
import dryFruitBox from "../../images/dry fruit box.png";
import electronicBox from "../../images/electronic box.png";
import giftBox from "../../images/gift box.png";
import kraftMailerBox from "../../images/kraft mailer box.png";
import magneticBox from "../../images/magnetic box.png";
import medicineBox from "../../images/medicine box.png";
import petTakeawayContainer from "../../images/pet takeaway container.png";
import pizzaBox from "../../images/pizza box.png";
import polyMailerWithZip from "../../images/poly mailer with zip.png";
import polyMailer from "../../images/poly mailer.png";
import pouch from "../../images/pouch.png";
import shoppingBag from "../../images/shopping bag.png";
import sticker from "../../images/sticker.png";
import sweetBox from "../../images/sweet box.png";

// Import newly generated images
import flatSachet from "../../images/flat sachet.png";
import tinCan from "../../images/tin can.png";
import aluminumCan from "../../images/aluminum can.png";
import compositeCan from "../../images/composite can.png";
import glassJar from "../../images/glass jar.png";
import plasticJar from "../../images/plastic jar.png";
import masonJar from "../../images/mason jar.png";
import aluminumTube from "../../images/aluminum tube.png";
import plasticTube from "../../images/plastic tube.png";
import laminateTube from "../../images/laminate tube.png";
import foodBowl from "../../images/food bowl.png";
import saladContainer from "../../images/salad container.png";
import tissuePaper from "../../images/tissue paper.png";
import hangTag from "../../images/hang tag.png";
import corrugatedBox from "../../images/corrugated box.png";
import clearPackingTape from "../../images/clear packing tape.png";
import brownKraftTape from "../../images/brown kraft tape.png";
import printedBrandingTape from "../../images/printed branding tape.png";
import fragileTape from "../../images/fragile tape.png";
import glassVial from "../../images/glass vial.png";
import pillBottle from "../../images/pill bottle.png";
import pillBlister from "../../images/pill blister.png";

// Maps the REAL category slugs (derived from catalog data) onto the existing
// artwork. An unmapped category falls back to catOthers rather than breaking.
const catImages: Record<string, string> = {
  // real catalog slugs
  "food-packaging": catFood,
  "flexible-packaging": catPouches,
  containers: catContainers,
  tubes: catTubes,
  drinkware: catContainers,
  boxes: catPrint,
  mailers: catPrint,
  bags: catApparel,
  "packaging-accessories": catOthers,
  "digital-files": catOthers,
  packaging: catOthers,
  // legacy demo slugs (kept so nothing that still references them breaks)
  food: catFood,
  pouches: catPouches,
  cans: catCans,
  jars: catJars,
  cups: catContainers,
  apparel: catApparel,
  device: catDevice,
  print: catPrint,
  others: catOthers,
  tapes: catTapes,
  pharma: catPharma,
};

const subcatImages: Record<string, string> = {
  // Food
  "pizza-boxes": pizzaBox,
  "bakery-boxes": cakeBox,
  "takeaway-containers": petTakeawayContainer,
  "cupcake-boxes": sweetBox,
  "burger-boxes": burgerBox,

  // Pouches
  "stand-up-pouches": pouch,
  "flat-sachets": flatSachet,
  "ziplock-bags": polyMailerWithZip,
  "mylar-bags": dryFruitBox,

  // Cans
  "tin-cans": tinCan,
  "aluminum-cans": aluminumCan,
  "composite-cans": compositeCan,

  // Jars
  "glass-jars": glassJar,
  "plastic-jars": plasticJar,
  "mason-jars": masonJar,

  // Tubes
  "aluminum-tubes": aluminumTube,
  "plastic-tubes": plasticTube,
  "laminate-tubes": laminateTube,

  // Containers & Bowls
  "paper-cups": coffeeCup,
  "food-bowls": foodBowl,
  "clamshells": petTakeawayContainer,
  "salad-containers": saladContainer,

  // Apparel
  "mailer-boxes": compostableMailer,
  "tissue-paper": tissuePaper,
  "hang-tags": hangTag,
  "shopping-bags": shoppingBag,

  // Device
  "phone-boxes": electronicBox,
  "tablet-boxes": giftBox,
  "accessory-boxes": magneticBox,

  // Print
  "shipping-boxes": kraftMailerBox,
  "rigid-boxes": magneticBox,
  "corrugated-boxes": corrugatedBox,

  // Others
  "stickers-labels": sticker,
  "bubble-wrap": polyMailer,
  "paper-straws": coffeeCup,

  // Tapes
  "clear-packing-tape": clearPackingTape,
  "brown-kraft-tape": brownKraftTape,
  "printed-branding-tape": printedBrandingTape,
  "fragile-tape": fragileTape,

  // Pharma
  "medicine-boxes": medicineBox,
  "glass-vials": glassVial,
  "pill-bottles": pillBottle,
  "pill-blisters": pillBlister,
};



export default function Categories() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Derived from the live catalog, so new categories from an import appear here
  // automatically and counts are always real.
  const products = useBuyerProducts();
  const CATEGORIES = useCategoryTree(products);
  const activeCategory = CATEGORIES.find(c => c.id === selectedCategory);

  return (
    <main className="py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <AnimatePresence mode="wait">
          {!selectedCategory ? (
            <motion.div
              key="main-categories"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <SectionHeader
                eyebrow="Categories"
                title={<>Shop by <span className="grad-text">packaging type</span></>}
                subtitle="Explore our full catalog organized by packaging type."
                align="center"
              />

              <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {CATEGORIES.filter(c => c.id !== "others").map((c, i) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.05 }}
                    whileHover={{ y: -6 }}
                    className="bg-white rounded-2xl border border-dark-100 overflow-hidden card-shadow card-shadow-hover group cursor-pointer"
                    onClick={() => setSelectedCategory(c.id)}
                  >
                    <div className="relative h-48 bg-white flex items-center justify-center overflow-hidden border-b border-dark-100 p-4">
                      <img
                        src={catImages[c.id]}
                        alt={c.name}
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-dark-50/80 backdrop-blur text-xs font-semibold text-dark-700">
                        <Package className="h-3 w-3" />
                        {c.count}
                      </div>
                    </div>
                    <div className="p-5">
                      <h3 className="font-display text-lg font-bold text-dark-900 group-hover:text-primary-600 transition-colors">
                        {c.name}
                      </h3>
                      <div className="text-xs text-dark-500 mt-1">{c.subcategories.length} types available</div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex flex-wrap gap-1">
                          {c.subcategories.slice(0, 2).map((sub) => (
                            <span key={sub.slug} className="text-[10px] px-2 py-0.5 rounded-full bg-dark-50 text-dark-600 font-medium">
                              {sub.name}
                            </span>
                          ))}
                          {c.subcategories.length > 2 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-dark-50 text-dark-500">
                              +{c.subcategories.length - 2}
                            </span>
                          )}
                        </div>
                        <span className="inline-flex items-center gap-1 text-sm font-bold text-dark-700 group-hover:text-primary-500">
                          View <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="subcategories"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <button
                onClick={() => setSelectedCategory(null)}
                className="inline-flex items-center gap-2 text-sm font-bold text-dark-600 hover:text-dark-900 mb-6 group"
              >
                <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                Back to all categories
              </button>

              <SectionHeader
                eyebrow={activeCategory?.name}
                title={<>{activeCategory?.name} — <span className="grad-text">All Types</span></>}
                subtitle={`Explore ${activeCategory?.count} products across ${activeCategory?.subcategories.length} different types.`}
              />

              <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {activeCategory?.subcategories.map((sub, i) => (
                  <motion.div
                    key={sub.slug}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    whileHover={{ y: -6 }}
                    className="bg-white rounded-2xl border border-dark-100 overflow-hidden card-shadow card-shadow-hover group"
                  >
                    <Link to={`/products?category=${activeCategory.slug}&subcategory=${sub.slug}`} className="block">
                      <div className="relative h-48 bg-white flex items-center justify-center overflow-hidden border-b border-dark-100 p-4">
                        <img
                          src={subcatImages[sub.slug] || catImages[activeCategory.id]}
                          alt={sub.name}
                          className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-dark-50/80 backdrop-blur text-xs font-semibold text-dark-700">
                          <Package className="h-3 w-3" />
                          {sub.count}
                        </div>
                      </div>
                      <div className="p-5">
                        <h3 className="font-display text-lg font-bold text-dark-900 group-hover:text-primary-600 transition-colors">
                          {sub.name}
                        </h3>
                        <div className="text-xs text-dark-500 mt-1">{sub.count} products</div>
                        <div className="mt-3 flex items-center justify-end">
                          <span className="inline-flex items-center gap-1 text-sm font-bold text-dark-700 group-hover:text-primary-500">
                            Shop now <ArrowRight className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
