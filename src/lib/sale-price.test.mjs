// A discount badge is the easiest thing on a storefront to show dishonestly:
// an absent sale price read as 0, or a "sale" at or above list rendering as
// a 0% saving. These pin the rule that decides whether an offer exists at all.
//
// The rule lives in toStoreProduct (lib/products.ts) and is re-checked in the
// card, so it is expressed here as the predicate both use.
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Mirror of the mapper's rule: a sale price counts ONLY when it is present,
 * positive, and genuinely below the list price.
 */
const saleMinorFor = (basePrice, salePrice) =>
  salePrice != null && salePrice > 0 && salePrice < basePrice ? Math.round(salePrice * 100) : undefined;

const discountPercent = (listMinor, saleMinor) =>
  saleMinor != null && saleMinor > 0 && saleMinor < listMinor
    ? Math.round(((listMinor - saleMinor) / listMinor) * 100)
    : 0;

test("a real discount yields a sale price and a correct percentage", () => {
  const sale = saleMinorFor(1000, 800);
  assert.equal(sale, 80_000, "800 rupees is 80000 paise");
  assert.equal(discountPercent(100_000, sale), 20);
});

test("no sale price means no offer — never zero", () => {
  // 0 would render as "free"; undefined renders as no badge at all.
  assert.equal(saleMinorFor(1000, null), undefined);
  assert.equal(saleMinorFor(1000, undefined), undefined);
  assert.equal(discountPercent(100_000, undefined), 0);
});

test("a sale price of zero is ignored rather than shown as free", () => {
  assert.equal(saleMinorFor(1000, 0), undefined);
});

test("a sale price at or above list is a data error, not an offer", () => {
  // Rendering these would produce "-0%" and a strikethrough of an equal or
  // lower number, which reads as a trick.
  assert.equal(saleMinorFor(1000, 1000), undefined, "equal to list is not a discount");
  assert.equal(saleMinorFor(1000, 1200), undefined, "above list is not a discount");
});

test("a quote-only product (no list price) can never show a discount", () => {
  // basePrice 0 means quotation-based; any sale price here is meaningless.
  assert.equal(saleMinorFor(0, 500), undefined);
  assert.equal(discountPercent(0, 50_000), 0, "no division by zero, no badge");
});

test("percentages round to whole numbers a buyer can check", () => {
  // 999 -> 899 is 10.01%; showing "10%" is honest, "10.01%" is noise.
  assert.equal(discountPercent(99_900, 89_900), 10);
  assert.equal(discountPercent(100_000, 1), 100, "a near-total discount still computes");
});
