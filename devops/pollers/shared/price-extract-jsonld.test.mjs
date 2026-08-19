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

// STRK-99: vendors whose JSON-LD offer.price is the deepest "As Low As" bulk
// tier. For these vendors, skip the bare offer.price fallback so extractPrice()
// can read the correct 1-unit price from the markdown table instead.
const UNTRUSTED_OFFER_PRICE_VENDORS = new Set(["sdbullion", "bullionexchanges"]);

function extractJsonLdPrice(jsonLdScripts, metal, weightOz = 1, providerId = "") {
  if (!jsonLdScripts || jsonLdScripts.length === 0) return null;
  const perOz = METAL_PRICE_RANGE_PER_OZ[metal];
  if (!perOz) return null;
  const min = perOz.min * weightOz;
  const max = perOz.max * weightOz;

  function inRange(p) {
    return !isNaN(p) && p >= min && p <= max;
  }

  const WIRE_METHOD_RE = /bank|wire|check|ach/i;
  function isBankTransfer(method) {
    if (!method) return false;
    if (typeof method === "string")
      return method.includes("ByBankTransferInAdvance") || WIRE_METHOD_RE.test(method);
    if (method["@id"])
      return (
        method["@id"].includes("ByBankTransferInAdvance") || WIRE_METHOD_RE.test(method["@id"])
      );
    if (method.name) return WIRE_METHOD_RE.test(method.name);
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
          const rawSpecs = offer.priceSpecification;
          const specs = rawSpecs == null ? [] : Array.isArray(rawSpecs) ? rawSpecs : [rawSpecs];
          if (specs.length > 0) {
            let wirePrice = null;
            for (const spec of specs) {
              const methods = Array.isArray(spec.appliesToPaymentMethod)
                ? spec.appliesToPaymentMethod
                : [spec.appliesToPaymentMethod];
              if (!methods.some(isBankTransfer)) continue;
              const qty = spec.eligibleQuantity;
              const qtyMin = qty ? String(qty.minValue ?? qty.value ?? "") : "";
              if (qtyMin && qtyMin !== "1") continue;
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
          if (UNTRUSTED_OFFER_PRICE_VENDORS.has(providerId)) continue;
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
            appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
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
            appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            eligibleQuantity: { minValue: "10", maxValue: "19" },
            price: "857.60",
          },
          {
            appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
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
  "5. single priceSpecification object (not wrapped in array) is normalized and extracted",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: {
          appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
          eligibleQuantity: { minValue: "1", maxValue: "9" },
          price: "859.60",
        },
      },
    }),
    "silver",
    10
  ),
  859.6
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
            appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
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
            appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
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
// PR review hardening (T1/T2/T3)
// ---------------------------------------------------------------------------

console.log("\n--- PR review hardening ---");

assert(
  "13. plain string 'wire' matches isBankTransfer",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: [
          {
            appliesToPaymentMethod: "wire",
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
  "14. plain string 'eCheck' matches isBankTransfer",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "100.00",
        priceSpecification: [
          {
            appliesToPaymentMethod: "eCheck",
            eligibleQuantity: { minValue: "1", maxValue: "9" },
            price: "95.00",
          },
        ],
      },
    }),
    "silver",
    1
  ),
  95.0
);

assert(
  "15. plain string 'ACH' matches isBankTransfer",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "5350.00",
        priceSpecification: [
          {
            appliesToPaymentMethod: "ACH",
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
  "16. eligibleQuantity.value (not minValue) for qty-1",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "895.42",
        priceSpecification: [
          {
            appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            eligibleQuantity: { value: 1 },
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
  "17. eligibleQuantity.value > 1 is rejected (bulk tier)",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "893.33",
        priceSpecification: [
          {
            appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            eligibleQuantity: { value: 10 },
            price: "857.60",
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
// STRK-99: UNTRUSTED_OFFER_PRICE_VENDORS — SDB + BE publish bulk-tier in
// offer.price with no priceSpecification. The denylist must skip the bare
// offer.price fallback so extractPrice() can read the correct 1-unit price
// from the markdown table. Fixture captured live from SDB on 2026-05-23.
// ---------------------------------------------------------------------------

// Live SDB Product JSON-LD payload (captured via Playwright with real Chrome UA
// against https://sdbullion.com/canadian-silver-maple-leaf-coin-random-year).
// The visible 1-unit Check/Wire price was $79.23 at capture time; SDB publishes
// the 50+ bulk tier ($78.23) as offer.price.
const SDB_LIVE_JSONLD_2026_05_23 = {
  "@context": "http://schema.org",
  "@type": "Product",
  "@id": "https://sdbullion.com/canadian-silver-maple-leaf-coin-random-year",
  name: "Canadian Silver Maple Leaf Coin - Random Year",
  sku: "SRCMAPLE-1",
  offers: {
    "@type": "Offer",
    price: "78.23",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url: "https://sdbullion.com/canadian-silver-maple-leaf-coin-random-year",
    seller: { "@type": "Organization", name: "SD Bullion" },
    itemCondition: "https://schema.org/NewCondition",
  },
};

assert(
  "18. STRK-99: bare offer.price skipped for sdbullion (no priceSpecification)",
  extractJsonLdPrice(scripts(SDB_LIVE_JSONLD_2026_05_23), "silver", 1, "sdbullion"),
  null
);

assert(
  "19. STRK-99: bare offer.price skipped for bullionexchanges (no priceSpecification)",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        "@type": "Offer",
        price: "77.22",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    }),
    "silver",
    1,
    "bullionexchanges"
  ),
  null
);

assert(
  "20. STRK-99: bare offer.price honored for non-denied vendor (jmbullion)",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: { "@type": "Offer", price: "79.23", priceCurrency: "USD" },
    }),
    "silver",
    1,
    "jmbullion"
  ),
  79.23
);

assert(
  "21. STRK-99: tiered priceSpecification still honored for denied vendor",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: {
        price: "78.23", // bulk in offer.price — would be picked without the fix
        priceSpecification: [
          {
            appliesToPaymentMethod: "http://purl.org/goodrelations/v1#ByBankTransferInAdvance",
            eligibleQuantity: { minValue: "1", maxValue: "49" },
            price: "79.23", // single-unit wire — should win
          },
        ],
      },
    }),
    "silver",
    1,
    "sdbullion"
  ),
  79.23
);

assert(
  "22. STRK-99: zero-price OOS sentinel still returned for denied vendor",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    }),
    "silver",
    1,
    "sdbullion"
  ),
  JSONLD_ZERO_PRICE
);

assert(
  "23. STRK-99: empty providerId (legacy callers) keeps old behavior",
  extractJsonLdPrice(
    scripts({
      "@type": "Product",
      offers: { "@type": "Offer", price: "79.23", priceCurrency: "USD" },
    }),
    "silver",
    1
  ),
  79.23
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
