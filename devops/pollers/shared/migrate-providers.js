#!/usr/bin/env node
/**
 * StakTrakr Provider Migration Script
 * ====================================
 * One-time import of providers.json into sqld provider tables.
 * Idempotent — safe to re-run (uses INSERT OR REPLACE via upsertCoin/upsertVendor).
 *
 * Usage:
 *   node migrate-providers.js                     # dry-run by default against local
 *   node migrate-providers.js --dry-run            # explicit dry-run
 *   node migrate-providers.js --production         # required for non-localhost sqld URLs
 *   DATA_DIR=/path/to/data node migrate-providers.js --production
 *
 * @see STAK-348 — Migrate providers.json to sqld
 */

import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { createSqldClient } from "./sqld-client.js";
import { initProviderSchema, upsertCoin, upsertVendor } from "./provider-db.js";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run") || !args.includes("--production");
const PRODUCTION = args.includes("--production");

const DATA_DIR = resolve(process.env.DATA_DIR || "../../data");
const PROVIDERS_PATH = join(DATA_DIR, "retail", "providers.json");

// ---------------------------------------------------------------------------
// Safety check
// ---------------------------------------------------------------------------

function checkProductionSafety() {
  const url = process.env.TURSO_DATABASE_URL || "";
  const isLocal =
    url.includes("localhost") || url.includes("127.0.0.1") || url.includes(":memory:");

  if (!isLocal && !PRODUCTION) {
    console.error("ERROR: TURSO_DATABASE_URL points to a remote database.");
    console.error("       Pass --production to confirm you want to write to production.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

async function migrate() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  StakTrakr Provider Migration            ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();

  if (DRY_RUN) {
    console.log("  Mode:  DRY RUN (no writes — pass --production to execute)");
  } else {
    console.log("  Mode:  PRODUCTION (writing to sqld)");
  }
  console.log(`  Source: ${PROVIDERS_PATH}`);
  console.log();

  // Read providers.json
  let providersJson;
  try {
    providersJson = JSON.parse(readFileSync(PROVIDERS_PATH, "utf-8"));
  } catch (err) {
    console.error(`Failed to read ${PROVIDERS_PATH}: ${err.message}`);
    process.exit(1);
  }

  const coins = providersJson.coins || {};
  const slugs = Object.keys(coins);

  if (slugs.length === 0) {
    console.error("No coins found in providers.json");
    process.exit(1);
  }

  // Count totals
  let totalCoins = 0;
  let totalVendors = 0;
  let skippedVendors = 0;

  const coinRows = [];
  const vendorRows = [];

  for (const slug of slugs) {
    const coin = coins[slug];
    totalCoins++;

    coinRows.push({
      slug,
      metal: coin.metal,
      name: coin.name,
      weight_oz: coin.weight_oz ?? 1.0,
      fbp_url: coin.fbp_url ?? null,
      notes: coin.notes ?? null,
      enabled: true,
    });

    for (const provider of coin.providers || []) {
      if (!provider.id) {
        skippedVendors++;
        console.warn(`  SKIP: vendor without id in coin "${slug}"`);
        continue;
      }

      totalVendors++;
      vendorRows.push({
        coin_slug: slug,
        vendor_id: provider.id,
        vendor_name: provider.name || provider.id,
        url: provider.url ?? null,
        enabled: provider.enabled !== false,
        selector: provider.selector ?? null,
        hints: provider.hints ?? null,
      });
    }
  }

  // Print summary
  console.log("┌─────────────────────────────────────────┐");
  console.log(`│  Coins:    ${String(totalCoins).padStart(5)}                       │`);
  console.log(`│  Vendors:  ${String(totalVendors).padStart(5)}                       │`);
  if (skippedVendors > 0) {
    console.log(`│  Skipped:  ${String(skippedVendors).padStart(5)}                       │`);
  }
  console.log("└─────────────────────────────────────────┘");
  console.log();

  // Metal breakdown
  const metalCounts = {};
  for (const row of coinRows) {
    metalCounts[row.metal] = (metalCounts[row.metal] || 0) + 1;
  }
  console.log("  By metal:");
  for (const [metal, count] of Object.entries(metalCounts).sort()) {
    console.log(`    ${metal.padEnd(12)} ${count} coins`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("  DRY RUN complete — no rows written.");
    console.log("  Run with --production to execute the migration.");
    return;
  }

  // Production write
  checkProductionSafety();

  const client = createSqldClient();
  console.log("  Initializing schema...");
  await initProviderSchema(client);

  console.log("  Writing coins...");
  for (const row of coinRows) {
    await upsertCoin(client, row);
  }

  console.log("  Writing vendors...");
  for (const row of vendorRows) {
    await upsertVendor(client, row);
  }

  console.log();
  console.log("  ✓ Migration complete.");
  console.log(`    ${totalCoins} coins, ${totalVendors} vendors written to sqld.`);

  // Verify counts
  const coinCount = await client.execute("SELECT COUNT(*) as n FROM provider_coins");
  const vendorCount = await client.execute("SELECT COUNT(*) as n FROM provider_vendors");
  console.log(`    Verify: ${coinCount.rows[0].n} coins, ${vendorCount.rows[0].n} vendors in DB.`);
}

migrate().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
