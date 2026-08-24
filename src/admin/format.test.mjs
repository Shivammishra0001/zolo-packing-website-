// Money formatting: the API returns integer minor units (paise), the UI shows
// rupees. Confusing the two renders every amount 100x too large, which is
// exactly the bug this file exists to prevent regressing.
// Run: npx tsx --test src/admin/format.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inr, inrMinor } from "./format.ts";

test("inr formats rupees with Indian grouping", () => {
  assert.equal(inr(654), "₹654");
  assert.equal(inr(184300), "₹1,84,300");
  assert.equal(inr(0), "₹0");
});

test("inrMinor converts paise to rupees", () => {
  assert.equal(inrMinor(65400), "₹654");
  assert.equal(inrMinor(18430000), "₹1,84,300");
  assert.equal(inrMinor(0), "₹0");
});

test("a paise value passed to inr would be 100x wrong — hence the two helpers", () => {
  const paise = 65400; // ₹654.00
  assert.equal(inrMinor(paise), "₹654");
  assert.notEqual(inr(paise), inrMinor(paise));
});

test("inrMinor tolerates null/undefined amounts", () => {
  assert.equal(inrMinor(null), "₹0");
  assert.equal(inrMinor(undefined), "₹0");
});

// ---------------------------------------------------------------------------
// Static guard: no source file may hand a `*Minor` value to the rupee helper.
// ---------------------------------------------------------------------------

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) yield full;
  }
}

test("no file passes a *Minor amount to inr() instead of inrMinor()", () => {
  // `inr(` (not `inrMinor(`) whose argument mentions a Minor field, unless it
  // is explicitly divided by 100 at the call site.
  const offending = /(?<!Minor)\binr\(([^()]*Minor[^()]*)\)/g;
  const bad = [];

  for (const file of sourceFiles("src")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(offending)) {
      if (m[1].includes("/ 100") || m[1].includes("/100")) continue;
      // Files that define their own paise-aware local `inr` are fine.
      if (/const inr = \([^)]*\) =>[^\n]*\/ 100/.test(src)) continue;
      bad.push(`${file}: ${m[0]}`);
    }
  }

  assert.deepEqual(bad, [], `these call sites would render 100x too large:\n${bad.join("\n")}`);
});
