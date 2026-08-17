#!/usr/bin/env node
/**
 * FindBullionPrices (FBP) year-preferring slug resolver (STRK-334, design C5).
 *
 * Cold path — run on demand. Fetches FBP's product sitemap ONCE, matches each
 * coin to its product slug via the stored `fbp_match` keyword hint, prefers the
 * current-year slug, verifies the candidate page's JSON-LD `name` before
 * committing, and upserts the resolved `fbp_url` back to `provider_coins`.
 *
 * Fail closed: a coin is skipped (its existing `fbp_url` untouched) whenever no
 * slug matches, the candidate fetch fails, or the candidate's ItemList name does
 * not contain every keyword — never store an unverified URL.
 *
 * Pure functions (`extractSitemapLocs`, `matchCoinSlugs`, `rankByYear`) carry
 * the ranking contract and are unit-tested in isolation from network I/O.
 *
 * CLI:
 *   node resolve-fbp-slugs.js [--dry-run] [COINS=ase,gae]
 *   COINS=ase node resolve-fbp-slugs.js --dry-run
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { fetchFbpPage } from "./fbp-jsonld.js";
import { getAllCoins, upsertCoin, initProviderSchema } from "./provider-db.js";

const SITEMAP_URL = "https://findbullionprices.com/sitemap.xml";

const LOC_TAG = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
const LD_JSON_BLOCK =
  /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Extract every `<loc>` URL from a sitemap XML string.
 *
 * @param {string} xml - Raw sitemap XML.
 * @returns {string[]} Every `<loc>` value, in document order; `[]` when none.
 */
function extractSitemapLocs(xml) {
  if (typeof xml !== "string" || xml.length === 0) {
    return [];
  }
  const locs = [];
  let match;
  LOC_TAG.lastIndex = 0;
  while ((match = LOC_TAG.exec(xml)) !== null) {
    locs.push(match[1].trim());
  }
  return locs;
}

/**
 * Normalize a candidate URL to its product slug words: take the last non-empty
 * path segment, lowercase it, and turn hyphens into spaces.
 *
 * @param {string} loc - A product URL.
 * @returns {string} The normalized slug (space-separated words).
 */
function normalizeSlug(loc) {
  const segments = String(loc).split("/").filter(Boolean);
  const basename = segments.length > 0 ? segments[segments.length - 1] : "";
  return basename.toLowerCase().replace(/-/g, " ");
}

/**
 * Split a keyword hint (space-separated string or array) into lowercase tokens.
 *
 * @param {string|string[]} keywords
 * @returns {string[]}
 */
function toKeywordTokens(keywords) {
  const raw = Array.isArray(keywords) ? keywords : String(keywords ?? "").split(/\s+/);
  return raw.map((k) => String(k).toLowerCase().trim()).filter(Boolean);
}

/**
 * Keep only the URLs whose normalized product slug contains EVERY keyword.
 *
 * @param {string[]} locs - Candidate URLs (e.g. from `extractSitemapLocs`).
 * @param {string|string[]} keywords - Space-separated string or token array.
 * @returns {string[]} The matching subset of `locs`, in input order.
 */
function matchCoinSlugs(locs, keywords) {
  const tokens = toKeywordTokens(keywords);
  if (!Array.isArray(locs) || tokens.length === 0) {
    return [];
  }
  return locs.filter((loc) => {
    const normalized = normalizeSlug(loc);
    return tokens.every((token) => normalized.includes(token));
  });
}

/**
 * Classify a slug into a ranking tier for `rankByYear`.
 *
 * @param {string} loc
 * @param {number} currentYear
 * @returns {{ tier: number, year: number }} Lower `tier` ranks first; within the
 *   dated tier, higher `year` ranks first.
 */
function slugRank(loc, currentYear) {
  const segments = String(loc).split("/").filter(Boolean);
  const basename = (segments.length > 0 ? segments[segments.length - 1] : "").toLowerCase();
  if (basename.startsWith(`${currentYear}-`)) {
    return { tier: 0, year: currentYear };
  }
  if (basename.includes("random-year")) {
    return { tier: 1, year: 0 };
  }
  const yearMatch = basename.match(/^(\d{4})-/);
  if (yearMatch) {
    return { tier: 2, year: Number(yearMatch[1]) };
  }
  return { tier: 3, year: 0 };
}

/**
 * Order slugs by preference: current-year ▸ random-year ▸ older-dated
 * (descending) ▸ undated. Does not mutate the input.
 *
 * @param {string[]} slugs
 * @param {number} currentYear
 * @returns {string[]} A new, preference-ordered array.
 */
function rankByYear(slugs, currentYear) {
  if (!Array.isArray(slugs)) {
    return [];
  }
  return [...slugs].sort((a, b) => {
    const ra = slugRank(a, currentYear);
    const rb = slugRank(b, currentYear);
    if (ra.tier !== rb.tier) {
      return ra.tier - rb.tier;
    }
    if (ra.tier === 2) {
      return rb.year - ra.year;
    }
    return 0;
  });
}

/**
 * Read the first schema.org ItemList `name` from an FBP page's JSON-LD.
 *
 * @param {string} html
 * @returns {string|null} The ItemList `name`, or `null` when absent/malformed.
 */
function extractItemListName(html) {
  if (typeof html !== "string" || html.length === 0) {
    return null;
  }
  let match;
  LD_JSON_BLOCK.lastIndex = 0;
  while ((match = LD_JSON_BLOCK.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (parsed && parsed["@type"] === "ItemList" && typeof parsed.name === "string") {
      return parsed.name;
    }
  }
  return null;
}

/**
 * Verify a candidate page's ItemList name contains every keyword (fail closed).
 *
 * @param {string} html - The fetched candidate page HTML.
 * @param {string|string[]} keywords
 * @returns {boolean} `true` only when a name is present and matches all keywords.
 */
function verifyCandidateName(html, keywords) {
  const name = extractItemListName(html);
  if (!name) {
    return false;
  }
  const normalized = name.toLowerCase();
  const tokens = toKeywordTokens(keywords);
  return tokens.length > 0 && tokens.every((token) => normalized.includes(token));
}

/**
 * Cold-path resolver entry point.
 *
 * Loads coins, fetches the FBP sitemap once, and for each coin carrying an
 * `fbp_match` hint: match → rank → pick top → fetch + verify → upsert. Any coin
 * that fails to match, fetch, or verify is skipped with its existing `fbp_url`
 * left intact (fail closed).
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Print intended upserts, write nothing.
 * @param {string[]|null} [options.coinsFilter=null] - Restrict to these slugs.
 * @returns {Promise<{ resolved: number, skipped: number }>}
 */
async function main({ dryRun = false, coinsFilter = null } = {}) {
  const { createSqldClient } = await import("./sqld-client.js");
  const client = createSqldClient();
  await initProviderSchema(client);

  const currentYear = new Date().getUTCFullYear();
  const allCoins = await getAllCoins(client);
  const coins =
    coinsFilter && coinsFilter.length > 0
      ? allCoins.filter((coin) => coinsFilter.includes(coin.slug))
      : allCoins;

  const sitemapXml = await fetchFbpPage(SITEMAP_URL);
  const locs = extractSitemapLocs(sitemapXml);
  console.log(
    `[resolve-fbp-slugs] sitemap: ${locs.length} <loc> URLs; ${coins.length} coin(s) in scope`
  );

  let resolved = 0;
  let skipped = 0;

  for (const coin of coins) {
    if (!coin.fbp_match) {
      continue;
    }

    const matches = matchCoinSlugs(locs, coin.fbp_match);
    const candidate = rankByYear(matches, currentYear)[0];
    if (!candidate) {
      console.warn(`[resolve-fbp-slugs] SKIP ${coin.slug}: no slug matches "${coin.fbp_match}"`);
      skipped += 1;
      continue;
    }

    let candidateHost;
    try {
      candidateHost = new URL(candidate).host;
    } catch {
      candidateHost = "";
    }
    if (candidateHost !== "findbullionprices.com") {
      console.warn(`[resolve-fbp-slugs] SKIP ${coin.slug}: candidate off-host (${candidate})`);
      skipped += 1;
      continue;
    }

    let html;
    try {
      html = await fetchFbpPage(candidate);
    } catch (err) {
      console.warn(
        `[resolve-fbp-slugs] SKIP ${coin.slug}: fetch failed (${candidate}): ${err.message}`
      );
      skipped += 1;
      continue;
    }

    if (!verifyCandidateName(html, coin.fbp_match)) {
      console.warn(`[resolve-fbp-slugs] SKIP ${coin.slug}: JSON-LD name mismatch (${candidate})`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[resolve-fbp-slugs] DRY-RUN ${coin.slug} → ${candidate}`);
      resolved += 1;
      continue;
    }

    await upsertCoin(client, { ...coin, fbp_url: candidate });
    console.log(`[resolve-fbp-slugs] OK ${coin.slug} → ${candidate}`);
    resolved += 1;
  }

  console.log(
    `[resolve-fbp-slugs] done: ${resolved} resolved, ${skipped} skipped${dryRun ? " (dry-run)" : ""}`
  );
  return { resolved, skipped };
}

/**
 * Parse CLI args into `main()` options. Supports `--dry-run` and a `COINS=`
 * comma-separated slug filter (arg or environment variable).
 *
 * @param {string[]} argv - Typically `process.argv.slice(2)`.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{ dryRun: boolean, coinsFilter: string[]|null }}
 */
function parseArgs(argv, env = process.env) {
  let dryRun = false;
  let coinsRaw = env.COINS ?? null;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("COINS=")) {
      coinsRaw = arg.slice("COINS=".length);
    }
  }
  const coinsFilter = coinsRaw
    ? coinsRaw
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean)
    : null;
  return { dryRun, coinsFilter };
}

const isMain = realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) {
  main(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(`[resolve-fbp-slugs] fatal: ${err.message}`);
    process.exitCode = 1;
  });
}

export {
  extractSitemapLocs,
  matchCoinSlugs,
  rankByYear,
  extractItemListName,
  verifyCandidateName,
  parseArgs,
  main,
};
