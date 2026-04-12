#!/usr/bin/env node
/**
 * Generate providers.json from sqld → write to DATA_DIR/retail/providers.json.
 * Called by run-publish.sh before git-adding data/ to the api branch.
 * Non-fatal — if sqld is down, the existing file on the volume is used as-is.
 *
 * @see STAK-348 — Migrate providers.json to sqld
 */

import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createSqldClient } from "./sqld-client.js";
import { initProviderSchema, exportProvidersJson } from "./provider-db.js";

const DATA_DIR = resolve(process.env.DATA_DIR || "../../data");
const outPath = join(DATA_DIR, "retail", "providers.json");
const tmpPath = outPath + ".tmp";

try {
  mkdirSync(dirname(outPath), { recursive: true });
  const client = createSqldClient();
  await initProviderSchema(client);
  const json = await exportProvidersJson(client);
  const parsed = JSON.parse(json);
  const coinCount = parsed.coins ? Object.keys(parsed.coins).length : 0;
  writeFileSync(tmpPath, json);
  renameSync(tmpPath, outPath);
  console.log(`[export-providers] Exported ${coinCount} coins to providers.json at ${new Date().toISOString()}`);
} catch (err) {
  console.warn(`[export-providers] sqld unavailable — keeping existing providers.json: ${err.message}`);
}
