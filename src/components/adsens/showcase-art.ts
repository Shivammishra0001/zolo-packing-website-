// ============================================================
// Decorative artwork for the AdSens showcase.
//
// These are Zolo's OWN product photographs from /images — the packaging we
// actually sell. Using them here is honest in a way stock agency screenshots
// would not be: an AdSens campaign preview showing Zolo packaging is showing
// the thing the campaign would be for.
//
// Every one of these mockups carries a visible "YOUR LOGO HERE" on the pack,
// so the image itself announces that it is a template rather than a real
// client's branded run. That is why they are only ever used for ILLUSTRATIVE
// placeholders — the moment an admin publishes a real campaign, its own
// uploaded creative replaces them.
// ============================================================

import giftBox from "../../../images/gift box.png";
import perfumeBox from "../../../images/perfume box.png";
import cosmeticBox from "../../../images/cosmetic box.png";
import coffeeCup from "../../../images/coffee cup.png";
import shoppingBag from "../../../images/shopping bag.png";
import chocolateBox from "../../../images/chocolate box.png";
import magneticBox from "../../../images/magnetic box.png";
import jewelryBox from "../../../images/jewelry box.png";
import kraftMailer from "../../../images/kraft mailer box.png";
import pouch from "../../../images/pouch.png";
import glassJar from "../../../images/glass jar.png";
import tinCan from "../../../images/tin can.png";

export interface ArtPlate {
  src: string;
  /** Describes the packaging, never a campaign result. */
  alt: string;
  /** Which service this plate illustrates, for the placeholder captions. */
  craft: string;
}

/**
 * Ordered so the rail alternates warm/cool and portrait/landscape rather
 * than showing four brown boxes in a row.
 */
export const ART_PLATES: ArtPlate[] = [
  { src: giftBox, alt: "Kraft gift box with a woven ribbon", craft: "Unboxing & gifting" },
  { src: perfumeBox, alt: "Slim kraft perfume carton", craft: "Premium retail cartons" },
  { src: coffeeCup, alt: "Branded takeaway coffee cup", craft: "Food & beverage" },
  { src: cosmeticBox, alt: "Cosmetic carton set", craft: "Beauty & personal care" },
  { src: shoppingBag, alt: "Printed paper shopping bag", craft: "Retail & carry" },
  { src: chocolateBox, alt: "Confectionery presentation box", craft: "Confectionery" },
  { src: magneticBox, alt: "Rigid magnetic-closure box", craft: "Luxury rigid boxes" },
  { src: jewelryBox, alt: "Small jewellery presentation box", craft: "Jewellery & small goods" },
  { src: kraftMailer, alt: "Kraft e-commerce mailer box", craft: "E-commerce shipping" },
  { src: pouch, alt: "Stand-up pouch", craft: "Flexible packaging" },
  { src: glassJar, alt: "Glass jar with a label", craft: "Jars & preserves" },
  { src: tinCan, alt: "Printed tin can", craft: "Cans & tins" },
];

/** Stable pick, so a given slot shows the same plate on every render. */
export const plateAt = (i: number) => ART_PLATES[i % ART_PLATES.length];

/** The ribbon marquee's words. Services, not claims. */
export const RIBBON_WORDS = [
  "Digital Advertising",
  "SEO",
  "Social Media",
  "Lead Generation",
  "Creative & Content",
  "WhatsApp Marketing",
  "Website Development",
  "Marketing Strategy",
];
