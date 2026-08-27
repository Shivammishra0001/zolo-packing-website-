// Tiered B2B pricing + commission snapshotting.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveUnitPriceMinor,
  commissionFor,
  commissionBpsFor,
  DEFAULT_COMMISSION_BPS,
} from "../src/services/pricing.mjs";

// The ladder from the spec: base 1800, tiers 500 -> 1650, 2000 -> 1475.
const ladder = {
  basePriceMinor: 1800,
  priceTiers: [
    { minQty: 500, unitPriceMinor: 1650 },
    { minQty: 2000, unitPriceMinor: 1475 },
  ],
};

test("the highest tier at or below the quantity wins", () => {
  assert.equal(resolveUnitPriceMinor(ladder, 400), 1800, "below the first tier -> base price");
  assert.equal(resolveUnitPriceMinor(ladder, 499), 1800, "one short of the tier -> base price");
  assert.equal(resolveUnitPriceMinor(ladder, 500), 1650, "exactly on a tier -> that tier");
  assert.equal(resolveUnitPriceMinor(ladder, 1200), 1650);
  assert.equal(resolveUnitPriceMinor(ladder, 1999), 1650, "one short of the next tier");
  assert.equal(resolveUnitPriceMinor(ladder, 2000), 1475, "exactly on the second tier");
  assert.equal(resolveUnitPriceMinor(ladder, 5000), 1475);
  assert.equal(resolveUnitPriceMinor(ladder, 1_000_000), 1475, "above every tier -> the last one");
});

test("tiers supplied out of order still resolve correctly", () => {
  const shuffled = { basePriceMinor: 1800, priceTiers: [ladder.priceTiers[1], ladder.priceTiers[0]] };
  assert.equal(resolveUnitPriceMinor(shuffled, 1200), 1650);
  assert.equal(resolveUnitPriceMinor(shuffled, 5000), 1475);
});

test("a product with no ladder always uses its base price", () => {
  const flat = { basePriceMinor: 2500, priceTiers: [] };
  for (const q of [1, 500, 100_000]) assert.equal(resolveUnitPriceMinor(flat, q), 2500);
});

test("a non-positive or fractional quantity is refused", () => {
  for (const q of [0, -1, 2.5, "x", null]) {
    assert.throws(() => resolveUnitPriceMinor(ladder, q), /quantity/i, `quantity ${q} must be refused`);
  }
});

test("commission is integer basis points with no float drift", () => {
  assert.equal(commissionFor(100_000, 800), 8_000, "8% of 1000.00 is 80.00");
  assert.equal(commissionFor(0, 800), 0);
  assert.equal(commissionFor(100_000, 0), 0, "a zero rate takes nothing");
  assert.equal(commissionFor(100_000, 10_000), 100_000, "100% takes the whole line");
  // 7.5% of 333.33 — the case where a float would drift.
  assert.equal(commissionFor(33_333, 750), Math.round((33_333 * 750) / 10_000));
  assert.equal(Number.isInteger(commissionFor(33_333, 750)), true, "always a whole number of paise");
});

test("commission falls back to the platform default when a product sets none", () => {
  assert.equal(commissionBpsFor({ commissionBps: 1250 }), 1250, "an explicit rate wins");
  assert.equal(commissionBpsFor({ commissionBps: 0 }), 0, "zero is explicit, not missing");
  assert.equal(commissionBpsFor({ commissionBps: null }), DEFAULT_COMMISSION_BPS);
  assert.equal(commissionBpsFor({}), DEFAULT_COMMISSION_BPS);
  assert.equal(commissionBpsFor(undefined), DEFAULT_COMMISSION_BPS);
});
