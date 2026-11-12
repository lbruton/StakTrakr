#!/usr/bin/env node
/**
 * Contract tests for the provider_coins schema + coin round-trip.
 *
 * provider-db.js talks to a libSQL client (createClient from @libsql/client),
 * whose native/better-sqlite3 stack cannot build in this repo's dev/CI
 * environment (no Xcode CLT; the poller only runs it inside Docker — see
 * dashboard-hygiene.test.mjs for the same constraint). To still exercise a
 * REAL schema round-trip, this test drives provider-db against a thin
 * libSQL-compatible adapter over Node's built-in `node:sqlite` (no native
 * build), so `initProviderSchema` / `upsertCoin` / `getAllCoins` run their
 * real SQL against a genuine in-memory SQLite database.
 *
 * fbp_url is hand-assigned per coin (STRK-334); the STRK-334 slug resolver and
 * its fbp_match keyword-hint column were removed as unused (STRK-346), so the
 * round-trip here asserts fbp_url only.
 *
 * Run with:
 *   node --test devops/pollers/shared/provider-db.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  initProviderSchema,
  upsertCoin,
  getAllCoins,
  upsertVendor,
  getProvidersByVendor,
  updateCoinFbpUrl,
  getCoverageStats,
} from "./provider-db.js";

/**
 * Minimal libSQL-client shim over node:sqlite, exposing the `execute` /
 * `batch` surface provider-db.js consumes ({ rows, rowsAffected }).
 * @returns {{execute: Function, batch: Function}}
 */
function makeMemoryClient() {
  const db = new DatabaseSync(":memory:");
  const run = (sql, args = []) => {
    const trimmed = sql.trim();
    if (/^(select|with|pragma)/i.test(trimmed)) {
      const rows = db.prepare(sql).all(...args);
      return { rows, rowsAffected: 0 };
    }
    const info = db.prepare(sql).run(...args);
    return { rows: [], rowsAffected: Number(info.changes ?? 0) };
  };
  return {
    async execute(input) {
      if (typeof input === "string") return run(input);
      return run(input.sql, input.args ?? []);
    },
    async batch(statements) {
      const results = [];
      for (const stmt of statements) results.push(run(stmt.sql, stmt.args ?? []));
      return results;
    },
  };
}

test("provider_coins carries fbp_url but not fbp_match after schema init", async () => {
  const client = makeMemoryClient();
  await initProviderSchema(client);

  const { rows } = await client.execute("PRAGMA table_info(provider_coins)");
  const columns = rows.map((row) => row.name);
  assert.ok(
    columns.includes("fbp_url"),
    `provider_coins should carry an fbp_url column; got: ${columns.join(", ")}`
  );
  assert.ok(
    !columns.includes("fbp_match"),
    `provider_coins should NOT carry fbp_match (removed in STRK-346); got: ${columns.join(", ")}`
  );
});

test("upsertCoin + getAllCoins round-trip fbp_url", async () => {
  const client = makeMemoryClient();
  await initProviderSchema(client);

  await upsertCoin(client, {
    slug: "ase",
    metal: "silver",
    name: "American Silver Eagle 1 oz",
    weight_oz: 1,
    fbp_url: "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/",
  });

  const coins = await getAllCoins(client);
  const ase = coins.find((coin) => coin.slug === "ase");
  assert.ok(ase, "the upserted coin must round-trip");
  assert.equal(
    ase.fbp_url,
    "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/",
    "fbp_url must survive the upsert → getAllCoins round-trip"
  );
});

test("getProvidersByVendor surfaces each coin's fbp_url (STRK-347)", async () => {
  const client = makeMemoryClient();
  await initProviderSchema(client);

  await upsertCoin(client, {
    slug: "ase",
    metal: "silver",
    name: "American Silver Eagle 1 oz",
    weight_oz: 1,
    fbp_url: "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/",
  });
  await upsertVendor(client, {
    coin_slug: "ase",
    vendor_id: "jmbullion",
    vendor_name: "JM Bullion",
    url: "https://www.jmbullion.com/2026-american-silver-eagle/",
  });

  const groups = await getProvidersByVendor(client);
  const jm = groups.find((group) => group.vendorId === "jmbullion");
  assert.ok(jm, "the jmbullion vendor group must exist");
  const ase = jm.items.find((item) => item.coinSlug === "ase");
  assert.ok(ase, "the ase item must be present under jmbullion");
  assert.equal(
    ase.url,
    "https://www.jmbullion.com/2026-american-silver-eagle/",
    "the vendor buy url must be preserved"
  );
  assert.equal(
    ase.fbpUrl,
    "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/",
    "getProvidersByVendor must surface the coin's fbp_url so the dashboard can show the price source (STRK-347)"
  );
});

test("updateCoinFbpUrl changes only fbp_url, never the coin's identity fields (STRK-347)", async () => {
  const client = makeMemoryClient();
  await initProviderSchema(client);

  await upsertCoin(client, {
    slug: "ase",
    metal: "silver",
    name: "American Silver Eagle 1 oz",
    weight_oz: 1,
    fbp_url: "https://findbullionprices.com/p/old-ase-slug/",
  });

  const result = await updateCoinFbpUrl(
    client,
    "ase",
    "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/"
  );
  assert.equal(result.rowsAffected, 1, "the update must affect exactly the target coin row");

  const ase = (await getAllCoins(client)).find((coin) => coin.slug === "ase");
  assert.equal(
    ase.fbp_url,
    "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/",
    "fbp_url must be updated"
  );
  // The whole point of a dedicated updater: unlike upsertCoin, it must NOT
  // touch the coin's identity columns (an upsert with partial data would null them).
  assert.equal(ase.name, "American Silver Eagle 1 oz", "name must be untouched");
  assert.equal(ase.metal, "silver", "metal must be untouched");
  assert.equal(ase.weight_oz, 1, "weight_oz must be untouched");
});

const COVERAGE_NOW = new Date("2026-11-12T04:16:13.000Z");

/**
 * Seeds four enabled vendor-coin pairs and the snapshots of one retail run
 * (03:30), one Goldback scrape in the current hour (04:05) and two edge rows
 * around the 48-hour cutoff.
 * @returns {Promise<{execute: Function, batch: Function}>}
 */
async function makeCoverageClient() {
  const client = makeMemoryClient();
  await initProviderSchema(client);
  await client.execute(
    "CREATE TABLE price_snapshots (scraped_at TEXT, coin_slug TEXT, vendor TEXT, is_failed INTEGER NOT NULL DEFAULT 0)"
  );
  for (const [coin, vendor] of [
    ["ase", "apmex"],
    ["ase", "sdbullion"],
    ["maple-gold", "apmex"],
    ["goldback-g1", "goldback"],
  ]) {
    await upsertCoin(client, { slug: coin, metal: "silver", name: coin, weight_oz: 1 });
    await client.execute({
      sql: "INSERT INTO provider_vendors (coin_slug, vendor_id, vendor_name, enabled) VALUES (?, ?, ?, 1)",
      args: [coin, vendor, vendor],
    });
  }
  const rows = [
    ["2026-11-12T03:30:02.087Z", "ase", "apmex", 0],
    ["2026-11-12T03:30:02.087Z", "ase", "sdbullion", 0],
    ["2026-11-12T03:30:02.087Z", "maple-gold", "apmex", 0],
    ["2026-11-12T03:30:02.087Z", "goldback-g1", "goldback", 1],
    ["2026-11-12T04:05:01.204Z", "goldback-g1", "goldback", 0],
    ["2026-11-10T04:05:00.000Z", "ase", "apmex", 0],
    ["2026-11-10T03:30:00.000Z", "ase", "apmex", 0],
  ];
  for (const args of rows) {
    await client.execute({
      sql: "INSERT INTO price_snapshots (scraped_at, coin_slug, vendor, is_failed) VALUES (?, ?, ?, ?)",
      args,
    });
  }
  return client;
}

test("coverage reports the in-progress clock hour apart from the completed hours", async () => {
  const client = await makeCoverageClient();
  const stats = await getCoverageStats(client, 48, COVERAGE_NOW);

  assert.equal(stats.totalEnabled, 4);
  assert.deepEqual(stats.hours[0], { hour: "2026-11-12T03:00", covered: 3, pct: 75 });
  assert.ok(
    !stats.hours.some((h) => h.hour === "2026-11-12T04:00"),
    "the completed hours must not include the current clock hour"
  );
  assert.deepEqual(stats.current, { hour: "2026-11-12T04:00", covered: 1, pct: 25 });
});

test("coverage window starts on the hour N hours before the current hour", async () => {
  const client = await makeCoverageClient();
  const stats = await getCoverageStats(client, 48, COVERAGE_NOW);
  const hours = stats.hours.map((h) => h.hour);

  assert.equal(hours.at(-1), "2026-11-10T04:00", "the oldest completed hour is 48 hours back");
  assert.ok(!hours.includes("2026-11-10T03:00"), "rows before the cutoff hour must be excluded");
});
