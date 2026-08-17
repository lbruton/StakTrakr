#!/usr/bin/env node
/**
 * TDD contract tests for the provider_coins fbp_match migration + round-trip
 * (STRK-334, design C5 / Data Models).
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
 * RED phase: the schema has no `fbp_match` column and neither the upsert nor
 * getAllCoins carry it, so the round-trip assertion on `fbp_match` fails.
 *
 * Run with:
 *   node --test devops/pollers/shared/provider-db.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { initProviderSchema, upsertCoin, getAllCoins } from "./provider-db.js";

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

test("provider_coins gains an fbp_match column after schema init", async () => {
  const client = makeMemoryClient();
  await initProviderSchema(client);

  const { rows } = await client.execute("PRAGMA table_info(provider_coins)");
  const columns = rows.map((row) => row.name);
  assert.ok(
    columns.includes("fbp_match"),
    `provider_coins should carry an fbp_match column; got: ${columns.join(", ")}`
  );
});

test("upsertCoin + getAllCoins round-trip both fbp_match and fbp_url", async () => {
  const client = makeMemoryClient();
  await initProviderSchema(client);

  await upsertCoin(client, {
    slug: "ase",
    metal: "silver",
    name: "American Silver Eagle 1 oz",
    weight_oz: 1,
    fbp_url: "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/",
    fbp_match: "american silver eagle 1 oz",
  });

  const coins = await getAllCoins(client);
  const ase = coins.find((coin) => coin.slug === "ase");
  assert.ok(ase, "the upserted coin must round-trip");
  assert.equal(
    ase.fbp_url,
    "https://findbullionprices.com/p/2026-american-silver-eagle-1-oz-bu-coin/"
  );
  assert.equal(
    ase.fbp_match,
    "american silver eagle 1 oz",
    "fbp_match must survive the upsert → getAllCoins round-trip"
  );
});
