#!/usr/bin/env node
/**
 * StakTrakr Retail Price — Gemini Vision Extractor
 * ==================================================
 * Reads a Browserbase screenshot manifest, sends each image to Gemini Vision,
 * and writes per-coin daily JSON files to data/retail/{coin-slug}/{YYYY-MM-DD}-vision.json
 *
 * Usage:
 *   GEMINI_API_KEY=... node extract-vision.js [manifest.json]
 *
 * Environment:
 *   GEMINI_API_KEY   Required. Google AI Studio API key.
 *   MANIFEST_PATH    Path to manifest.json (overrides positional arg)
 *   DATA_DIR         Path to repo data/ folder (default: ../../data)
 *   DRY_RUN          Set to "1" to skip writing files
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openTursoDb, writeSnapshot, windowFloor } from "./db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const DRY_RUN = process.env.DRY_RUN === "1";

// Manifest path: env var > positional arg > auto-detect today's
const MANIFEST_PATH = (() => {
  if (process.env.MANIFEST_PATH) return resolve(process.env.MANIFEST_PATH);
  if (process.argv[2]) return resolve(process.argv[2]);
  const today = new Date().toISOString().slice(0, 10);
  return join(DATA_DIR, "retail", "_artifacts", today, "manifest.json");
})();

const GEMINI_MODEL = "gemini-2.5-flash";
const CONCURRENCY = 4; // Gemini free tier allows higher concurrency

const PRICE_RANGE_HINTS = {
  silver: { min: 65, max: 200 },
  gold: { min: 3000, max: 15000 },
  platinum: { min: 800, max: 6000 },
  palladium: { min: 800, max: 6000 },
};

/**
 * Vendor-specific extraction hints to guide Gemini Vision to the correct price
 * on each dealer's page layout. Overrides the generic "look in the pricing table"
 * instruction with vendor-specific guidance.
 */
const VENDOR_PRICE_HINTS = {
  jmbullion: `JM Bullion specific: Look in the **pricing table** (usually below product images).
- Find the row for quantity "1-19" or "1-9"
- Use the **eCheck/Wire column** (usually leftmost price column, NOT Card/PayPal)
- The "As Low As" banner shows bulk discounts (500+ qty) — ignore it unless table is missing
- eCheck/Wire price is typically 2-4% lower than Card/PayPal price`,

  apmex: `APMEX specific: Look in the **quantity pricing table** near product details.
- Find row "1-19" or "1+"
- Use the **Check/Wire price** (leftmost column)
- Ignore "Starting At" or "As Low As" labels (those are bulk discounts)`,

  monumentmetals: `Monument Metals specific: Look in the **pricing table** (below "As Low As" banner).
- Find the row for quantity "1-24" or "1-99"
- Use the **(e)Check/Wire column** (leftmost price column)
- The "As Low As" banner shows bulk discounts (500+ qty) — ignore it, use the table`,

  sdbullion: `SD Bullion specific: Look for the **quantity pricing table**.
- Find the "1-19" or "1+" row
- Use the **eCheck/Wire column** (first price column)
- Ignore credit card pricing (usually higher)`,

  herobullion: `Hero Bullion specific: Check the **pricing grid** (quantity table).
- Find the "1-19" or "1+" quantity tier
- Use the **wire/check price** (typically the lower price shown)`,

  bullionexchanges: `Bullion Exchanges specific: Look for the **quantity discount table**.
- Find row for "1-9" or "1-19" units
- Use the **wire transfer/check price** (usually shown as the primary price)`,

  summitmetals: `Summit Metals specific: Look in the **pricing table by quantity**.
- Find the "1-19" or single unit row
- Use the **check/wire price** (lower price, not credit card)`,
};

/**
 * Build vendor-specific instruction for Gemini Vision prompt.
 * Returns the hint string if available, or empty string if generic handling.
 */
function getVendorHint(vendorId) {
  return VENDOR_PRICE_HINTS[vendorId] || "";
}

/**
 * Load today's Firecrawl prices from sqld.
 * Returns { slugSlug: { vendorId: price, ... }, ... } or {} if DB unavailable.
 */
async function loadFirecrawlPrices() {
  try {
    const db = await openTursoDb();
    const today = new Date().toISOString().slice(0, 10);
    const result = await db.execute({
      sql: `SELECT coin_slug, vendor, price FROM price_snapshots
            WHERE date(scraped_at) = ? AND price IS NOT NULL`,
      args: [today],
    });
    db.close();
    const out = {};
    for (const row of result.rows) {
      const coin_slug = row.coin_slug || row[0];
      const vendor = row.vendor || row[1];
      const price = row.price || row[2];
      if (!out[coin_slug]) out[coin_slug] = {};
      out[coin_slug][vendor] = price;
    }
    return out;
  } catch (err) {
    warn(`Could not load Firecrawl prices from sqld: ${err.message}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function warn(msg) {
  console.warn(`[${new Date().toISOString().slice(11, 19)}] WARN: ${msg}`);
}

// ---------------------------------------------------------------------------
// Gemini Vision API
// ---------------------------------------------------------------------------

async function extractPriceFromImage(
  imagePath,
  coinName,
  metal,
  weightOz,
  firecrawlPrice = null,
  vendorId = null
) {
  if (!existsSync(imagePath)) {
    throw new Error(`Screenshot not found: ${imagePath}`);
  }

  const imageBytes = readFileSync(imagePath);
  const base64Image = imageBytes.toString("base64");
  const mimeType = "image/png";

  const range = PRICE_RANGE_HINTS[metal] || { min: 0, max: 99999 };
  const minPrice = Math.round(range.min * weightOz);
  const maxPrice = Math.round(range.max * weightOz);
  const firecrawlHint =
    firecrawlPrice !== null
      ? `Firecrawl text-parser extracted: $${firecrawlPrice.toFixed(2)} — does the screenshot confirm this?`
      : "Firecrawl text-parser found no price for this vendor.";

  const vendorHint = vendorId ? getVendorHint(vendorId) : "";
  const vendorGuidance = vendorHint ? `\n\n**VENDOR-SPECIFIC GUIDANCE:**\n${vendorHint}\n` : "";

  const prompt = `You are a price extraction bot for a precious metals price tracker.

Look at this screenshot of a coin dealer product page.
Coin: ${coinName} (${metal}, ${weightOz} troy oz)
Expected 1-unit price range: $${minPrice}–$${maxPrice}
${firecrawlHint}${vendorGuidance}
**STOCK STATUS CHECK:**
- Is this product currently in stock and available to purchase?
- Look for: "Out of Stock" badges, red "Sold Out" labels, "Notify Me" buttons, disabled "Add to Cart" buttons
- Check the product title in the screenshot: does it show ${weightOz} troy oz (or ${weightOz} oz)?
  If you see "1/2 oz" or "1/4 oz" or any fractional weight when expecting ${weightOz} oz, mark as out of stock
  (this means the main product is unavailable and a related fractional product is shown instead)
- If out of stock, return: in_stock = false, stock_label = "description of what you saw"
- If in stock, return: in_stock = true, stock_label = "Add to Cart enabled" or similar

Find the **1-unit Check/Wire price** — the price a customer pays for exactly 1 coin using check or wire transfer.
- Look in the pricing/quantity table for the "1" or "1-9" row under Check/Wire columns
- Do NOT use "As Low As" bulk discount prices (those are for large quantities)
- Do NOT use credit card prices (usually higher)
- Do NOT use roll, tube, or accessory prices
- For gold: use the 1 troy oz version, ignore 1/2 oz or 1/4 oz
- If the price clearly matches what Firecrawl found (within 3%), say agrees_with_firecrawl = true

Respond ONLY as JSON (no markdown, no explanation):
{"price": 99.99, "confidence": "high", "agrees_with_firecrawl": true, "label": "1-unit wire row", "in_stock": true, "stock_label": "Add to Cart button enabled"}

Where:
- price: numeric USD price or null if not found OR if out of stock
- confidence: "high" (unambiguous), "medium" (best guess), "low" (uncertain), or "none" if out of stock
- agrees_with_firecrawl: true if price matches Firecrawl within ~3%, false if not, null if Firecrawl had no price
- label: brief description of where you found the price
- in_stock: true if product is available to purchase, false if out of stock
- stock_label: description of stock status indicator you observed`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      // Disable thinking for gemini-2.5-flash to avoid token budget issues
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  // With thinking models, parts[0] may be thinking content — get the last text part
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const rawText = (
    parts.filter((p) => p.text && !p.thought).pop()?.text ??
    parts[0]?.text ??
    ""
  ).trim();

  if (!rawText) {
    throw new Error("Empty response from Gemini");
  }

  // Parse the JSON response — handle markdown fences and trailing content
  try {
    // Try direct parse first
    return JSON.parse(rawText);
  } catch {
    // Strip markdown fences and extract the first {...} object
    const stripped = rawText
      .replace(/^```json?\s*/i, "")
      .replace(/```[\s\S]*$/m, "")
      .trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new Error(`Could not parse Gemini response: ${rawText.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function runConcurrent(tasks, concurrency) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// File writer
// ---------------------------------------------------------------------------

function writeVisionJson(coinSlug, dateStr, data) {
  const dir = join(DATA_DIR, "retail", coinSlug);
  const filePath = join(dir, `${dateStr}-vision.json`);
  if (DRY_RUN) {
    log(`[DRY RUN] ${filePath}`);
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  log(`Wrote ${filePath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is required.");
    process.exit(1);
  }

  if (!existsSync(MANIFEST_PATH)) {
    console.error(`Error: manifest.json not found at ${MANIFEST_PATH}`);
    console.error("Run capture.js first to take screenshots.");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const artifactDir = dirname(MANIFEST_PATH);
  const dateStr = manifest.date || new Date().toISOString().slice(0, 10);
  const generatedAt = new Date().toISOString();

  // Load providers.json for coin metadata
  const providersPath = join(DATA_DIR, "retail", "providers.json");
  const providersJson = JSON.parse(readFileSync(providersPath, "utf-8"));

  log(`Vision extraction: ${manifest.results.length} screenshots from ${MANIFEST_PATH}`);
  if (DRY_RUN) log("DRY RUN — no files written");

  const firecrawlPrices = await loadFirecrawlPrices();
  log(`Loaded Firecrawl prices for ${Object.keys(firecrawlPrices).length} coin(s) from sqld`);

  // Open sqld database for writing vision results
  const db = DRY_RUN ? null : await openTursoDb();
  const scrapedAt = new Date().toISOString();
  const winStart = windowFloor();

  try {
    // Only process successful captures
    const targets = manifest.results.filter((r) => r.ok && r.screenshot);

    const extractionResults = [];
    const tasks = targets.map((result) => async () => {
      const imagePath = join(artifactDir, result.screenshot);
      const coin = providersJson.coins[result.coin];
      if (!coin) {
        warn(`Unknown coin slug: ${result.coin}`);
        return;
      }

      log(`Vision: ${result.coin}/${result.provider}`);
      try {
        const firecrawlPrice = firecrawlPrices[result.coin]?.[result.provider] ?? null;
        const extracted = await extractPriceFromImage(
          imagePath,
          coin.name,
          coin.metal,
          coin.weight_oz || 1,
          firecrawlPrice,
          result.provider // Pass vendor ID for vendor-specific hints
        );

        // Vision detected out of stock
        if (extracted.in_stock === false) {
          log(
            `  ⚠ ${result.coin}/${result.provider}: OUT OF STOCK — ${extracted.stock_label || "vision detected"}`
          );
          if (extracted.price !== null) {
            warn(`  ⚠ Vision returned price despite in_stock=false: $${extracted.price}`);
          }
          extractionResults.push({
            coinSlug: result.coin,
            providerId: result.provider,
            price: null,
            confidence: "none",
            agreesWithFirecrawl: null,
            firecrawlPrice: firecrawlPrice,
            label: extracted.stock_label || "out of stock",
            inStock: false,
            stockLabel: extracted.stock_label ? extracted.stock_label.slice(0, 200) : null,
            ok: false, // OOS counts as failed extraction
            error: `out_of_stock: ${extracted.stock_label || "detected"}`,
          });

          // Record out-of-stock result to sqld
          if (db) {
            await writeSnapshot(db, {
              scrapedAt,
              windowStart: winStart,
              coinSlug: result.coin,
              vendor: result.provider,
              price: null,
              source: "gemini-vision",
              isFailed: true,
              inStock: false,
            });
          }
          return;
        }

        // Continue with normal price handling
        if (extracted.price !== null) {
          log(
            `  ✓ ${result.coin}/${result.provider}: $${extracted.price} [${extracted.confidence}] — ${extracted.label}`
          );
        } else {
          warn(`  ? ${result.coin}/${result.provider}: no price found — ${extracted.label}`);
        }

        extractionResults.push({
          coinSlug: result.coin,
          providerId: result.provider,
          price: extracted.price,
          confidence: extracted.confidence,
          agreesWithFirecrawl: extracted.agrees_with_firecrawl ?? null,
          firecrawlPrice: firecrawlPrice,
          label: extracted.label,
          inStock: extracted.in_stock === true, // explicit check: missing field defaults to false
          stockLabel: extracted.stock_label ? extracted.stock_label.slice(0, 200) : null,
          ok: extracted.price !== null,
          error:
            extracted.price === null
              ? extracted.label
                ? `no price: ${extracted.label}`
                : "no price returned"
              : undefined,
        });

        // Record vision extraction result to sqld
        if (db) {
          await writeSnapshot(db, {
            scrapedAt,
            windowStart: winStart,
            coinSlug: result.coin,
            vendor: result.provider,
            price: extracted.price,
            source: "gemini-vision",
            isFailed: extracted.price === null,
            inStock: extracted.in_stock === true,
          });
        }
      } catch (err) {
        warn(`  ✗ ${result.coin}/${result.provider}: ${err.message.slice(0, 120)}`);
        extractionResults.push({
          coinSlug: result.coin,
          providerId: result.provider,
          price: null,
          confidence: "none",
          agreesWithFirecrawl: null,
          firecrawlPrice: firecrawlPrice,
          label: null,
          ok: false,
          error: err.message.slice(0, 200),
        });

        // Record error result to sqld
        if (db) {
          await writeSnapshot(db, {
            scrapedAt,
            windowStart: winStart,
            coinSlug: result.coin,
            vendor: result.provider,
            price: null,
            source: "gemini-vision",
            isFailed: true,
            inStock: true, // assume in stock unless we know otherwise
          });
        }
      }
    });

    await runConcurrent(tasks, CONCURRENCY);

    // Aggregate per coin and write output
    const coinSlugs = [...new Set(extractionResults.map((r) => r.coinSlug))];

    for (const coinSlug of coinSlugs) {
      const coinResults = extractionResults.filter((r) => r.coinSlug === coinSlug);
      const successful = coinResults.filter((r) => r.ok);
      const failed = coinResults.filter((r) => !r.ok);

      const pricesBySite = {};
      const confidenceBySite = {};
      const firecrawlBySite = {};
      const agreementBySite = {};
      const availabilityBySite = {};
      for (const r of successful) {
        pricesBySite[r.providerId] = r.price;
        confidenceBySite[r.providerId] = r.confidence;
        availabilityBySite[r.providerId] = r.inStock;
        if (r.firecrawlPrice !== null) firecrawlBySite[r.providerId] = r.firecrawlPrice;
        if (r.agreesWithFirecrawl !== null) agreementBySite[r.providerId] = r.agreesWithFirecrawl;
      }

      // Also mark failed sites as out of stock if stockLabel indicates OOS
      for (const r of failed) {
        if (r.inStock === false) {
          availabilityBySite[r.providerId] = false;
        }
      }

      const prices = Object.values(pricesBySite);
      const sorted = [...prices].sort((a, b) => a - b);

      if (failed.length > 0) {
        warn(
          `[vision] ${coinSlug}: ${failed.length} vendor(s) failed — ` +
            failed.map((f) => `${f.providerId}(${f.error || "unknown error"})`).join(", ")
        );
      }
      writeVisionJson(coinSlug, dateStr, {
        date: dateStr,
        generated_at_utc: generatedAt,
        method: "gemini-vision",
        model: GEMINI_MODEL,
        currency: "USD",
        prices_by_site: pricesBySite,
        confidence_by_site: confidenceBySite,
        firecrawl_by_site: firecrawlBySite,
        agreement_by_site: agreementBySite,
        availability_by_site: availabilityBySite,
        source_count: prices.length,
        average_price: prices.length
          ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100
          : null,
        median_price: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        failed_sites: failed.map((r) => r.providerId),
      });
    }

    const ok = extractionResults.filter((r) => r.ok).length;
    const fail = extractionResults.length - ok;
    log(`Done: ${ok}/${extractionResults.length} prices extracted, ${fail} failures`);

    if (ok === 0 && extractionResults.length > 0) {
      console.error("All vision extractions failed.");
      process.exit(1);
    }
  } finally {
    if (db) db.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
