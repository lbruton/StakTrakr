/**
 * @fileoverview Cloudflare Pages middleware — 404s repo-internal paths (STRK-410).
 *
 * Pages publishes the repo root as-is (no build command, no output dir), so agent and
 * tooling files (CLAUDE.md, .context/, .claude/, devops/, tests/, docs/, package.json, …)
 * would otherwise be served publicly. `_routes.json` excludes the public static paths, so
 * this middleware only runs for everything else: it returns 404 for internal paths and
 * passes the rest (Functions under /api/, SPA deep links) through to `next()`.
 *
 * Paths are decoded and normalized before matching, so percent-encoding (`/%2Econtext/`),
 * duplicate slashes, `..` traversal, backslashes and case variants cannot slip past.
 */

// Top-level directories that are never part of the public app.
const BLOCKED_DIRS = new Set([
  "artifacts",
  "devops",
  "docs",
  "docvault",
  "functions",
  "node_modules",
  "playground",
  "test-results",
  "tests",
  "ui-standards",
]);

// Top-level tooling files (root *.md and dotfiles are caught by the generic rules below).
const BLOCKED_ROOT_FILES = new Set([
  "_routes.json",
  "eslint.config.cjs",
  "package-lock.json",
  "package.json",
  "playwright.config.js",
]);

const MAX_DECODE_PASSES = 4;

/**
 * Decodes and normalizes a URL pathname: repeated percent-decoding, backslashes to
 * slashes, empty and `.` segments dropped, `..` resolved.
 * @param {string} rawPath - Request pathname, possibly encoded.
 * @returns {string[]|null} Lower-cased path segments, or null when the path cannot be
 *   decoded to a stable value (caller fails closed).
 */
function normalizeSegments(rawPath) {
  let path = String(rawPath).replace(/\\/g, "/");
  let stable = false;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    let decoded;
    try {
      decoded = decodeURIComponent(path).replace(/\\/g, "/");
    } catch {
      return null;
    }
    if (decoded === path) {
      stable = true;
      break;
    }
    path = decoded;
  }
  if (!stable) return null;

  const segments = [];
  for (const segment of path.toLowerCase().split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments;
}

/**
 * Reports whether a request path points at a repo-internal file or directory.
 * @param {string} rawPath - Request pathname, possibly encoded.
 * @returns {boolean} True when the path must not be served.
 */
export function isInternalPath(rawPath) {
  const segments = normalizeSegments(rawPath);
  if (segments === null) return true;
  if (segments.length === 0) return false;

  const top = segments[0];
  if (top === ".well-known") return false;
  if (segments.some((segment) => segment.startsWith("."))) return true;
  if (BLOCKED_DIRS.has(top)) return true;
  if (segments.length === 1 && BLOCKED_ROOT_FILES.has(top)) return true;
  return segments[segments.length - 1].endsWith(".md");
}

/**
 * Pages middleware entry point: 404 for internal paths, otherwise continue the chain.
 * @param {{request: Request, next: () => Promise<Response>}} context - Pages Functions context.
 * @returns {Promise<Response>} A 404 response or the downstream response.
 */
export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);
  if (isInternalPath(pathname)) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  }
  return context.next();
}
