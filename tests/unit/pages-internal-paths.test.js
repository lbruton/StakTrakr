// Unit tests for the Cloudflare Pages middleware that 404s repo-internal paths (STRK-410).
//
// Cloudflare Pages publishes the repo root as-is (no build command, no output dir), so
// agent/tooling files (CLAUDE.md, .context/, .claude/, devops/, tests/, docs/, package.json)
// were publicly served. functions/_middleware.js blocks them; _routes.json keeps public
// static paths out of Functions so ordinary page loads never invoke (or bill) a Function.
//
// These tests import the REAL middleware module and read the REAL _routes.json, and assert
// that every tracked top-level repo entry is classified as either public (excluded in
// _routes.json) or blocked by the middleware, so a new root file cannot silently go public.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const mw = await import(new URL("../../functions/_middleware.js", import.meta.url));
const routes = JSON.parse(readFileSync(new URL("../../_routes.json", import.meta.url), "utf-8"));

const BLOCKED = [
  "/CLAUDE.md",
  "/AGENTS.md",
  "/README.md",
  "/DESIGN.md",
  "/package.json",
  "/package-lock.json",
  "/eslint.config.cjs",
  "/playwright.config.js",
  "/.context/infrastructure.md",
  "/.claude/settings.json",
  "/.agents/skills/ship/SKILL.md",
  "/.github/workflows/ci.yml",
  "/.gitignore",
  "/.nojekyll",
  "/.pre-commit-config.yaml",
  "/devops/pollers/remote-poller/fly.toml",
  "/devops/",
  "/devops",
  "/tests/unit/x.test.js",
  "/docs/specs/",
  "/DocVault/Overview.md",
  "/functions/api/token-exchange.js",
  "/playground/metal-detail-modal-playground.html",
  "/artifacts/playground.html",
  "/ui-standards/index.html",
];

// Encoding, slash, traversal and case tricks must normalize onto a blocked path.
const BYPASS_ATTEMPTS = [
  "/%2Econtext/infrastructure.md",
  "/%2econtext/infrastructure.md",
  "/%252Econtext/infrastructure.md",
  "//CLAUDE.md",
  "///devops/pollers/remote-poller/fly.toml",
  "/js/../CLAUDE.md",
  "/js/%2E%2E/CLAUDE.md",
  "/./CLAUDE.md",
  "/claude.md",
  "/Devops/pollers/remote-poller/fly.toml",
  "/CLAUDE%2Emd",
  "/js\\..\\CLAUDE.md",
];

const PUBLIC = [
  "/",
  "/index.html",
  "/about.html",
  "/privacy.html",
  "/preview.html",
  "/oauth-callback.html",
  "/manifest.json",
  "/sw.js",
  "/sw-router.js",
  "/version.json",
  "/sample.csv",
  "/favicon.svg",
  "/js/constants.js",
  "/css/styles.css",
  "/data/spot-history-bundle.js",
  "/ratios/",
  "/api/token-exchange",
  "/.well-known/acme-challenge/abc",
  "/some-spa-deep-link",
];

describe("isInternalPath", () => {
  for (const p of BLOCKED) {
    test(`blocks ${p}`, () => assert.equal(mw.isInternalPath(p), true));
  }
  for (const p of BYPASS_ATTEMPTS) {
    test(`blocks bypass ${p}`, () => assert.equal(mw.isInternalPath(p), true));
  }
  for (const p of PUBLIC) {
    test(`allows ${p}`, () => assert.equal(mw.isInternalPath(p), false));
  }
  test("treats malformed percent-encoding as internal (fail closed)", () => {
    assert.equal(mw.isInternalPath("/%E0%A4%A"), true);
  });
});

describe("onRequest", () => {
  const nextResponse = new Response("asset", { status: 200 });
  const ctx = (path) => ({
    request: new Request(`https://www.staktrakr.com${path}`),
    next: async () => nextResponse,
  });

  test("returns 404 for an internal path without calling next", async () => {
    let called = false;
    const c = ctx("/CLAUDE.md");
    c.next = async () => {
      called = true;
      return nextResponse;
    };
    const res = await mw.onRequest(c);
    assert.equal(res.status, 404);
    assert.equal(called, false);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("passes public and API paths through to next()", async () => {
    assert.equal(await mw.onRequest(ctx("/api/token-exchange")), nextResponse);
    assert.equal(await mw.onRequest(ctx("/index.html")), nextResponse);
  });
});

describe("_routes.json", () => {
  const rules = [...routes.include, ...routes.exclude];

  test("uses schema version 1 with a catch-all include", () => {
    assert.equal(routes.version, 1);
    assert.deepEqual(routes.include, ["/*"]);
  });

  test("stays within Cloudflare limits (<=100 rules, <=100 chars each)", () => {
    assert.ok(rules.length <= 100, `${rules.length} rules`);
    for (const r of rules) assert.ok(r.length <= 100, r);
  });

  test("never excludes the Functions API or an internal path", () => {
    for (const r of routes.exclude) {
      assert.ok(!r.startsWith("/api"), r);
      assert.equal(mw.isInternalPath(r.replace(/\*$/, "")), false, r);
    }
  });

  test("classifies every tracked top-level repo entry as public or internal", () => {
    let names;
    try {
      names = execFileSync("git", ["ls-tree", "--name-only", "HEAD"], {
        cwd: new URL("../..", import.meta.url),
        encoding: "utf-8",
      })
        .trim()
        .split("\n");
    } catch {
      return; // not a git checkout (e.g. packaged run) — nothing to classify
    }
    const excluded = new Set(routes.exclude.map((r) => r.replace(/\/\*$/, "").replace(/^\//, "")));
    const unclassified = names.filter((n) => !excluded.has(n) && !mw.isInternalPath(`/${n}`));
    assert.deepEqual(
      unclassified,
      [],
      "add to _routes.json exclude (public) or the middleware blocklist"
    );
  });
});
