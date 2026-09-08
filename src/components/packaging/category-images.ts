// Curated, relevant packaging PNGs per category for the homepage showcase.
//
// These bundled transparent PNGs (from /images) are chosen to represent each
// packaging TYPE cleanly, rather than whatever product happens to be first in
// the category. Resolution order in the card:
//   1. curated asset matched by slug (below)         ← this file
//   2. curated asset matched by keyword in the slug  ← future categories
//   3. the category's representative product image   ← API
//   4. the brand emoji                               ← last-resort fallback
//
// Vite hashes and optimizes each import; unused ones are tree-shaken.
import corrugatedBox from "../../../images/box-1.png";
import containers from "../../../images/bottle-1.png";
import food from "../../../images/food.png";
import tapes from "../../../images/tape.png";
import packingTape from "../../../images/tape-1.png";
import tubes from "../../../images/plastic tube.png";
import pouches from "../../../images/flex-1-1.png";
import pouch from "../../../images/pouch.png";
import mailer from "../../../images/mailer.png";
import polyMailer from "../../../images/poly mailer.png";
import compostableMailer from "../../../images/compostable mailer.png";
import sticker from "../../../images/packing-tape.png";
import hangTag from "../../../images/hang tag.png";
import shoppingBag from "../../../images/bag-1-1.png";
import print from "../../../images/category_print.png";
import device from "../../../images/category_device.png";
import coffeeCup from "../../../images/cup-1-1.png";
import glassJar from "../../../images/glass jar.png";
import jars from "../../../images/category_jars.png";
import plasticJar from "../../../images/plastic jar.png";
import tinCan from "../../../images/tin can.png";
import cans from "../../../images/can-1.png";
import medicineBox from "../../../images/box-1.png";
import apparel from "../../../images/box-1.png";

// Exact match on the canonical category slug (the 12 live categories).
const BY_SLUG: Record<string, string> = {
  boxes: corrugatedBox,
  containers,
  "food-packaging": food,
  tapes,
  tubes,
  "flexible-packaging": pouches,
  mailers: mailer,
  "packaging-accessories": sticker,
  bags: shoppingBag,
  "digital-files": print,
  drinkware: coffeeCup,
  packaging: corrugatedBox,
};

// Keyword fallbacks — first hit wins — so categories added later (or the
// brief's names like "Paper Bags", "Bottles & Jars", "Labels & Stickers")
// still get a relevant image without a code change.
const BY_KEYWORD: [test: RegExp, image: string][] = [
  [/corrugat|custom|gift|carton|rigid|shipper/, corrugatedBox],
  [/paper.?bag|shopping|tote|\bbag/, shoppingBag],
  [/pouch|sachet|flexible|flat/, pouch],
  [/mailer|envelope|courier/, polyMailer],
  [/eco|compost|kraft|sustainab|recycl|biodegrad/, compostableMailer],
  [/label|sticker|decal/, sticker],
  [/tag|accessor|tool/, hangTag],
  [/adhesive|\btape/, packingTape],
  [/bottle|jar/, glassJar],
  [/plastic/, plasticJar],
  [/\bcan\b|cans|tin|alumin|metal/, tinCan],
  [/tube/, tubes],
  [/pharma|medicine|pill|blister/, medicineBox],
  [/food|meal|takeaway|restaurant/, food],
  [/drink|cup|beverage|coffee/, coffeeCup],
  [/container|box/, containers],
  [/print|digital|device|electronic/, device],
  [/apparel|cloth|fashion/, apparel],
  [/glass|vial/, jars],
  [/cans/, cans],
  [/plastic.?jar/, plasticJar],
];

/** Best curated PNG for a category, or null to defer to the API/emoji. */
export function curatedCategoryImage(slug: string, name = ""): string | null {
  if (BY_SLUG[slug]) return BY_SLUG[slug];
  const hay = `${slug} ${name}`.toLowerCase();
  for (const [re, img] of BY_KEYWORD) if (re.test(hay)) return img;
  return null;
}
