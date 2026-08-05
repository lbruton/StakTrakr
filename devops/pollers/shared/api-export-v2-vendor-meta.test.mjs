/**
 * VENDOR_META registration pins (STRK-322).
 *
 * The v2 manifest publisher falls back to `{ name: vid, color: "#94a3b8",
 * url: null }` for any vendor missing from VENDOR_META — that silent fallback
 * is how mintbuilder shipped half-registered after the scrape rollout. These
 * tests pin mintbuilder's real display metadata and the shape invariant for
 * every entry, so the published manifest never carries the placeholder for a
 * registered vendor again.
 *
 * api-export-v2.js is import-safe: better-sqlite3 is lazy-imported inside
 * main(), and main() only runs when the module is the process entrypoint.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { VENDOR_META } from "./api-export-v2.js";

test("VENDOR_META registers mintbuilder with real display metadata (STRK-322)", () => {
  const mb = VENDOR_META.mintbuilder;
  assert.ok(mb, "mintbuilder missing from VENDOR_META — manifest emits the placeholder");
  assert.equal(mb.name, "MintBuilder");
  assert.equal(mb.url, "https://mintbuilder.com");
  assert.match(mb.color, /^#[0-9a-f]{6}$/i);
});

test("every VENDOR_META entry carries name, color, and https url (STRK-322)", () => {
  for (const [vid, meta] of Object.entries(VENDOR_META)) {
    assert.equal(typeof meta.name, "string", `${vid}: name must be a string`);
    assert.ok(meta.name.length > 0, `${vid}: name must be non-empty`);
    assert.match(meta.color, /^#[0-9a-f]{6}$/i, `${vid}: color must be a hex color`);
    assert.ok(
      typeof meta.url === "string" && meta.url.startsWith("https://"),
      `${vid}: url must be an https homepage`
    );
  }
});
