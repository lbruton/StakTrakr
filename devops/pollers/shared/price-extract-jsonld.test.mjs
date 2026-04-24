#!/usr/bin/env node
/**
 * Fixture tests for extractJsonLdPrice() — run with:
 *   node devops/pollers/shared/price-extract-jsonld.test.mjs
 *
 * Covers STAK-577: prefer wire/eCheck price from priceSpecification
 * over the Card/PayPal price in offer.price.
 */

// ---------------------------------------------------------------------------
// Inline the function under test.
// extractJsonLdPrice() is not exported, so we duplicate the closure here.
// Keep this in sync with the implementation in price-extract.js.
// ---------------------------------------------------------------------------

const JSONLD_ZERO_PRICE = Symbol("jsonld-zero-price");

const METAL_PRICE_RANGE_PER_OZ = {
  silver: { min: 40, max: 200 },
  gold: { min: 1500, max: 15000 },
};

function extractJsonLdPrice(jsonLdScripts, metal, weightOz = 1) {
  if (!jsonLdScripts || jsonLdScripts.length === 0) return null;
  const perOz = METAL_PRICE_RANGE_PER_OZ[metal];
  if (!perOz) return null;
  const min = perOz.min * weightOz;
  const max = perOz.max * weightOz;

  function inRange(p) {
    return !isNaN(p) && p >= min && p <= max;
  }

  function isBankTransfer(method) {
    if (!method) return false;
    if (typeof method === "string") return method.includes("ByBankTransferInAdvance");
    if (method["@id"]) return method["@id"].includes("ByBankTransferInAdvance");
    if (method.name) return /bank|wire|check/i.test(method.name);
    return false;
  }

  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const typeVal = item["@type"];
        const types = Array.isArray(typeVal) ? typeVal : [typeVal];
        if (!types.includes("Product")) continue;
        const offers = item.offers;
        if (!offers) continue;
        const offerList = Array.isArray(offers) ? offers : [offers];
        for (const offer of offerList) {
          const specs = offer.priceSpecification;
          if (Array.isArray(specs) && specs.length > 0) {
            let wirePrice = null;
            for (const spec of specs) {
              const methods = Array.isArray(spec.appliesToPaymentMethod)
                ? spec.appliesToPaymentMethod
                : [spec.appliesToPaymentMethod];
              if (!methods.some(isBankTransfer)) continue;
              const qty = spec.eligibleQuantity;
              if (qty && String(qty.minValue) !== "1") continue;
              const p = parseFloat(String(spec.price ?? "").replace(/,/g, ""));
              if (inRange(p)) {
                wirePrice = p;
                break;
              }
            }
            if (wirePrice !== null) return wirePrice;
          }

          const price = parseFloat(String(offer.price ?? "").replace(/,/g, ""));
          if (!isNaN(price) && price === 0) return JSONLD_ZERO_PRICE;
          if (inRange(price)) return price;
        }
      }
    } catch {
      /* invalid JSON — skip */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: wrap a JSON-LD object in a script string array (as extractJsonLdPrice expects)
// ---------------------------------------------------------------------------

function scripts(...objs) {
  return objs.map((o) => JSON.stringify(o));
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function assert(label, actual, expected) {
  const actualDisplay = typeof actual === "symbol" ? actual.toString() : actual;
  const expectedDisplay = typeof expected === "symbol" ? expected.toString() : expected;
  if (actual === expected) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    console.error(`        expected: ${expectedDisplay}`);
    console.error(`        actual:   ${actualDisplay}`);
    fail++;
  }
}

// ---------------------------------------------------------------------------
// 1. Wire price preferred over Card/PayPal when priceSpecification exists
// ---------------------------------------------------------------------------

console.log("\n--- Wire price extraction (STAK-577) ---");

assert(
  "1. prefer wire price from priceSpecification over offer.price",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: [
          {
            appliesToPaymentMethod: [
              { "@id": "http://purl.org/goodrelations/v1#PaymentMethodCreditCard" },
            ],
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "895.42",
          },
          {
            appliesToPaymentMethod:
              "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "859.60",
          },
        ],
      },
    }),
    "silver",
    10
  ),
  859.6
);

// ---------------------------------------------------------------------------
// 2. Fallback to offer.price when no bank transfer spec exists
// ---------------------------------------------------------------------------

console.log("\n--- Fallback behavior ---");

assert(
  "2. fallback to offer.price when priceSpecification has no bank transfer entry",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: [
          {
            appliesToPaymentMethod: [
              { "@id": "http://purl.org/goodrelations/v1#PaymentMethodCreditCard" },
            ],
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "895.42",
          },
          {
            appliesToPaymentMethod: { "@type": "PaymentMethod", name: "Bitcoin" },
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "868.55",
          },
        ],
      },
    }),
    "silver",
    10
  ),
  895.42
);

// ---------------------------------------------------------------------------
// 3. Reject priceSpecification entries where minValue > 1 (bulk tier)
// ---------------------------------------------------------------------------

console.log("\n--- Tiered pricing ---");

assert(
  "3. skip bulk-tier (minValue=10) and fall back to offer.price",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "893.33",
        priceSpecification: [
          {
            appliesToPaymentMethod:
              "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            eligibleQuantity: { minValue: "10", maxValue: "19" },
            price: "857.60",
          },
          {
            appliesToPaymentMethod:
              "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            eligibleQuantity: { minValue: "50", maxValue: "10000" },
            price: "849.60",
          },
        ],
      },
    }),
    "silver",
    10
  ),
  893.33
);

// ---------------------------------------------------------------------------
// 4. Payment method matching via name property with regex
// ---------------------------------------------------------------------------

console.log("\n--- Payment method name matching ---");

assert(
  "4a. match 'Electronic Check' via name regex",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: [
          {
            appliesToPaymentMethod: { name: "Electronic Check" },
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "859.60",
          },
        ],
      },
    }),
    "silver",
    10
  ),
  859.6
);

assert(
  "4b. match 'ACH / Wire Transfer' via name regex",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "5350.00",
        priceSpecification: [
          {
            appliesToPaymentMethod: { name: "ACH / Wire Transfer" },
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "5200.00",
          },
        ],
      },
    }),
    "gold",
    1
  ),
  5200.0
);

assert(
  "4c. match 'Bank Wire' via name regex",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "100.00",
        priceSpecification: [
          {
            appliesToPaymentMethod: { name: "Bank Wire" },
            eligibleQuantity: { minValue: "1", maxValue: "19" },
            price: "95.50",
          },
        ],
      },
    }),
    "silver",
    1
  ),
  95.5
);

// ---------------------------------------------------------------------------
// 5. Single priceSpecification object (not array)
// ---------------------------------------------------------------------------

console.log("\n--- Edge cases ---");

assert(
  "5. single priceSpecification object (not wrapped in array) is ignored — falls back to offer.price",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: {
          appliesToPaymentMethod:
            "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
          eligibleQuantity: { minValue: "1", maxValue: "9" },
          price: "859.60",
        },
      },
    }),
    "silver",
    10
  ),
  895.42
);

// ---------------------------------------------------------------------------
// Existing behavior preserved
// ---------------------------------------------------------------------------

console.log("\n--- Existing behavior ---");

assert(
  "6. no priceSpecification — reads offer.price directly",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: { price: "810.50" },
    }),
    "silver",
    10
  ),
  810.5
);

assert(
  "7. offer.price=0 returns JSONLD_ZERO_PRICE sentinel",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: { price: "0" },
    }),
    "silver",
    1
  ),
  JSONLD_ZERO_PRICE
);

assert(
  "8. out-of-range offer.price returns null",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: { price: "5.00" },
    }),
    "silver",
    1
  ),
  null
);

assert(
  "9. non-Product @type returns null",
  extractJsonLdPrice(
    scripts({
      "@type": "Organization",
      offers: { price: "100.00" },
    }),
    "silver",
    1
  ),
  null
);

assert(
  "10. nested @id for bank transfer method",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: [
          {
            appliesToPaymentMethod: {
              "@type": "PaymentMethod",
              "@id": "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            },
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "859.60",
          },
        ],
      },
    }),
    "silver",
    10
  ),
  859.6
);

assert(
  "11. thousands separator in priceSpecification price",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "5,350.14",
        priceSpecification: [
          {
            appliesToPaymentMethod:
              "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "5,200.00",
          },
        ],
      },
    }),
    "gold",
    1
  ),
  5200.0
);

assert(
  "12. no eligibleQuantity — still matches (no qty filter to fail)",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: [
          {
            appliesToPaymentMethod:
              "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            price: "859.60",
          },
        ],
      },
    }),
    "silver",
    10
  ),
  859.6
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
