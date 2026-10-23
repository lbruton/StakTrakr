// The real storage compression codec for unit tests: the vendored lz-string engine
// and the codec block of js/utils-storage.js, evaluated through the source harness.

import assert from "node:assert/strict";
import { evalSource, readSource } from "./source-extract.js";

const CODEC_FILE = "js/utils-storage.js";

/**
 * Loads vendor/lz-string.min.js through a synthetic CommonJS module. The UMD assigns
 * the engine to module.exports, the same object a browser exposes as window.LZString.
 * @returns {object} LZString.
 */
export function loadLZString() {
  const lzModule = { exports: {} };
  evalSource("vendor/lz-string.min.js", {
    params: { module: lzModule, exports: lzModule.exports, window: undefined },
  });
  return lzModule.exports;
}

/**
 * Evaluates the codec block of js/utils-storage.js, from the prefix constants up to
 * the boot-migration marker.
 * @param {object} [lz] - Engine injected as __LZ; defaults to the real lz-string.
 * @param {boolean} [real] - Value of __LZ_REAL (false models a failed vendor load).
 * @returns {{__compressIfNeeded: Function, __decompressIfNeeded: Function,
 *   __ST_COMP_PREFIX: string, __ST_LEGACY_PREFIX: string}}
 */
export function loadStorageCodec(lz = loadLZString(), real = true) {
  const src = readSource(CODEC_FILE);
  const start = src.indexOf("const __ST_COMP_PREFIX");
  const end = src.indexOf("// Kick off the one-time");
  assert.ok(start !== -1 && end > start, `could not locate the codec block in ${CODEC_FILE}`);
  return evalSource(CODEC_FILE, {
    params: { __LZ: lz, __LZ_REAL: real },
    slice: { start, end },
    suffix:
      "\nreturn { __compressIfNeeded, __decompressIfNeeded, __ST_COMP_PREFIX, __ST_LEGACY_PREFIX };",
  });
}
