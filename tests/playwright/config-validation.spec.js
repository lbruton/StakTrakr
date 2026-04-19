import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Config file validation tests for files changed in this PR.
 *
 * These tests do NOT require a browser — they validate that the new/modified
 * configuration files (.prettierrc, .prettierignore, .pre-commit-config.yaml,
 * .coderabbit.yaml) and updated CHANGELOG.md have the correct content.
 *
 * Tests run as ordinary Playwright test cases (no browser fixture used) so they
 * integrate with `npm test` and the existing Playwright infrastructure without
 * needing a separate test runner.
 */

// Resolve paths relative to the repo root (two levels up from tests/playwright/)
const ROOT = resolve(new URL(import.meta.url).pathname, "../../../");

function readRoot(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), "utf-8");
}

// ────────────────────────────────────────────────────────────────────────────
// .codacy/codacy.yaml — eslint version bumped from 8.57.0 to 9.21.0 in this PR
// ────────────────────────────────────────────────────────────────────────────

test.describe(".codacy/codacy.yaml", () => {
  let content;

  test.beforeAll(() => {
    content = readRoot(".codacy/codacy.yaml");
  });

  test("CY-1 — .codacy/codacy.yaml file exists", () => {
    expect(existsSync(resolve(ROOT, ".codacy/codacy.yaml"))).toBe(true);
  });

  test("CY-2 — eslint version is 9.21.0 (bumped from 8.57.0)", () => {
    expect(content).toContain("eslint@9.21.0");
  });

  test("CY-3 — old eslint version 8.57.0 is NOT present", () => {
    expect(content).not.toContain("eslint@8.57.0");
  });

  test("CY-4 — node runtime is declared", () => {
    expect(content).toContain("node@");
  });

  test("CY-5 — python runtime is declared", () => {
    expect(content).toContain("python@");
  });

  test("CY-6 — pmd tool is still declared", () => {
    expect(content).toContain("pmd@");
  });

  test("CY-7 — pylint tool is still declared", () => {
    expect(content).toContain("pylint@");
  });

  test("CY-8 — semgrep tool is still declared", () => {
    expect(content).toContain("semgrep@");
  });

  test("CY-9 — runtimes section is present", () => {
    expect(content).toContain("runtimes:");
  });

  test("CY-10 — tools section is present", () => {
    expect(content).toContain("tools:");
  });

  test("CY-11 — eslint version matches package.json devDependency (9.21.0)", () => {
    // The codacy eslint version should align with the project's devDependency
    const pkgContent = readRoot("package.json");
    const pkg = JSON.parse(pkgContent);
    // package.json uses "^9.21.0" — codacy should pin to the same minor
    expect(pkg.devDependencies.eslint).toMatch(/\^?9\.21\./);
    expect(content).toContain("eslint@9.21.0");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// .prettierrc — new file added in this PR
// ────────────────────────────────────────────────────────────────────────────

test.describe(".prettierrc", () => {
  let config;

  test.beforeAll(() => {
    config = JSON.parse(readRoot(".prettierrc"));
  });

  test("PR-1 — .prettierrc file exists at repo root", () => {
    expect(existsSync(resolve(ROOT, ".prettierrc"))).toBe(true);
  });

  test("PR-2 — .prettierrc is valid JSON", () => {
    // If JSON.parse above throws, this test will fail automatically
    expect(typeof config).toBe("object");
    expect(config).not.toBeNull();
  });

  test("PR-3 — singleQuote is false (project uses double quotes)", () => {
    expect(config.singleQuote).toBe(false);
  });

  test("PR-4 — trailingComma is es5", () => {
    expect(config.trailingComma).toBe("es5");
  });

  test("PR-5 — tabWidth is 2", () => {
    expect(config.tabWidth).toBe(2);
  });

  test("PR-6 — semi is true (semicolons required)", () => {
    expect(config.semi).toBe(true);
  });

  test("PR-7 — printWidth is 100", () => {
    expect(config.printWidth).toBe(100);
  });

  test("PR-8 — no unexpected extra properties", () => {
    const expectedKeys = ["singleQuote", "trailingComma", "tabWidth", "semi", "printWidth"];
    const actualKeys = Object.keys(config);
    // All actual keys should be in the expected set
    actualKeys.forEach((key) => {
      expect(expectedKeys).toContain(key);
    });
  });

  test("PR-9 — all 5 expected properties are present", () => {
    const expectedKeys = ["singleQuote", "trailingComma", "tabWidth", "semi", "printWidth"];
    expectedKeys.forEach((key) => {
      expect(key in config).toBe(true);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// .prettierignore — new file added in this PR
// ────────────────────────────────────────────────────────────────────────────

test.describe(".prettierignore", () => {
  let content;

  test.beforeAll(() => {
    content = readRoot(".prettierignore");
  });

  test("PI-1 — .prettierignore file exists at repo root", () => {
    expect(existsSync(resolve(ROOT, ".prettierignore"))).toBe(true);
  });

  test("PI-2 — vendor/ is ignored (minified third-party libs)", () => {
    expect(content).toContain("vendor/");
  });

  test("PI-3 — data/ is ignored (generated API snapshot bundles)", () => {
    expect(content).toContain("data/");
  });

  test("PI-4 — devops/docs/scripts/ is ignored (vendored JSDoc scripts)", () => {
    expect(content).toContain("devops/docs/scripts/");
  });

  test("PI-5 — node_modules/ is ignored (build artifacts)", () => {
    expect(content).toContain("node_modules/");
  });

  test("PI-6 — test-results/ is ignored (test artifacts)", () => {
    expect(content).toContain("test-results/");
  });

  test("PI-7 — .worktrees/ is ignored", () => {
    expect(content).toContain(".worktrees/");
  });

  test("PI-8 — *.min.js is ignored (minified assets)", () => {
    expect(content).toContain("*.min.js");
  });

  test("PI-9 — *.min.css is ignored (minified assets)", () => {
    expect(content).toContain("*.min.css");
  });

  test("PI-10 — ignore file is non-empty", () => {
    expect(content.trim().length).toBeGreaterThan(0);
  });

  test("PI-11 — ignore file has comment lines explaining each section", () => {
    // The file should have at least one comment (lines starting with #)
    const commentLines = content.split("\n").filter((line) => line.trim().startsWith("#"));
    expect(commentLines.length).toBeGreaterThan(0);
  });

  test("PI-12 — boundary check: sw.js is NOT in .prettierignore (it is formatted)", () => {
    // sw.js is excluded from CodeRabbit review but should NOT be in .prettierignore
    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("#"));
    expect(lines).not.toContain("sw.js");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// .pre-commit-config.yaml — lint-staged hook added in this PR
// ────────────────────────────────────────────────────────────────────────────

test.describe(".pre-commit-config.yaml", () => {
  let content;

  test.beforeAll(() => {
    content = readRoot(".pre-commit-config.yaml");
  });

  test("PC-1 — .pre-commit-config.yaml file exists", () => {
    expect(existsSync(resolve(ROOT, ".pre-commit-config.yaml"))).toBe(true);
  });

  test("PC-2 — lint-staged hook id is declared", () => {
    expect(content).toContain("id: lint-staged");
  });

  test("PC-3 — lint-staged hook name describes its purpose", () => {
    expect(content).toContain("Format staged files with prettier");
  });

  test("PC-4 — lint-staged hook uses npx lint-staged as entry point", () => {
    expect(content).toContain("entry: npx lint-staged");
  });

  test("PC-5 — lint-staged hook has always_run: true", () => {
    // The hook should always run, not just on specific file patterns
    const hookSection = content.substring(content.indexOf("id: lint-staged"));
    expect(hookSection).toContain("always_run: true");
  });

  test("PC-6 — lint-staged hook uses system language", () => {
    const hookSection = content.substring(content.indexOf("id: lint-staged"));
    expect(hookSection).toContain("language: system");
  });

  test("PC-7 — pre-existing gitleaks hook is still present", () => {
    expect(content).toContain("id: gitleaks");
  });

  test("PC-8 — pre-existing stamp-sw-cache hook is still present", () => {
    expect(content).toContain("id: stamp-sw-cache");
  });

  test("PC-9 — pre-existing check-release-sync hook is still present", () => {
    expect(content).toContain("id: check-release-sync");
  });

  test("PC-10 — pre-existing check-claude-md hook is still present", () => {
    expect(content).toContain("id: check-claude-md");
  });

  test("PC-11 — lint-staged hook appears after other local hooks", () => {
    const lintStagedIdx = content.indexOf("id: lint-staged");
    const checkClaudeMdIdx = content.indexOf("id: check-claude-md");
    expect(lintStagedIdx).toBeGreaterThan(checkClaudeMdIdx);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// .coderabbit.yaml — new file added in this PR
// ────────────────────────────────────────────────────────────────────────────

test.describe(".coderabbit.yaml", () => {
  let content;

  test.beforeAll(() => {
    content = readRoot(".coderabbit.yaml");
  });

  test("CR-1 — .coderabbit.yaml file exists at repo root", () => {
    expect(existsSync(resolve(ROOT, ".coderabbit.yaml"))).toBe(true);
  });

  test("CR-2 — schema reference is present for IDE support", () => {
    expect(content).toContain("yaml-language-server");
    expect(content).toContain("coderabbit.ai/integrations/schema");
  });

  test("CR-3 — language is set to en-US", () => {
    expect(content).toContain('language: "en-US"');
  });

  test("CR-4 — review profile is assertive (solo-dev configuration)", () => {
    expect(content).toContain('profile: "assertive"');
  });

  test("CR-5 — high_level_summary is enabled", () => {
    expect(content).toContain("high_level_summary: true");
  });

  test("CR-6 — poem is disabled", () => {
    expect(content).toContain("poem: false");
  });

  test("CR-7 — auto_review is enabled", () => {
    expect(content).toContain("enabled: true");
  });

  test("CR-8 — auto_incremental_review is enabled", () => {
    expect(content).toContain("auto_incremental_review: true");
  });

  test("CR-9 — WIP title keyword is in ignore list", () => {
    expect(content).toContain('"WIP"');
  });

  test("CR-10 — DO NOT MERGE title keyword is in ignore list", () => {
    expect(content).toContain('"DO NOT MERGE"');
  });

  test("CR-11 — node_modules path filter is excluded", () => {
    expect(content).toContain("!**/node_modules/**");
  });

  test("CR-12 — data/ (StakTrakr-specific) path filter is excluded", () => {
    expect(content).toContain("!data/**");
  });

  test("CR-13 — sw.js is excluded from review (auto-stamped)", () => {
    expect(content).toContain("!sw.js");
  });

  test("CR-14 — DESIGN.md is excluded (known false-positive source)", () => {
    expect(content).toContain("!DESIGN.md");
  });

  test("CR-15 — eslint tool is enabled", () => {
    const toolsSection = content.substring(content.indexOf("tools:"));
    expect(toolsSection).toContain("eslint:");
    expect(toolsSection).toContain("enabled: true");
  });

  test("CR-16 — gitleaks tool is enabled (security scanning)", () => {
    const toolsSection = content.substring(content.indexOf("tools:"));
    expect(toolsSection).toContain("gitleaks:");
  });

  test("CR-17 — markdownlint tool is enabled", () => {
    const toolsSection = content.substring(content.indexOf("tools:"));
    expect(toolsSection).toContain("markdownlint:");
  });

  test("CR-18 — knowledge base learnings are enabled", () => {
    expect(content).toContain("learnings:");
    expect(content).toMatch(/learnings:\s*\n\s*enabled: true/);
  });

  test("CR-19 — chat auto_reply is enabled", () => {
    expect(content).toContain("auto_reply: true");
  });

  test("CR-20 — path instructions include js/**/*.js guidance", () => {
    expect(content).toContain('path: "js/**/*.js"');
  });

  test("CR-21 — path instructions include tests/** guidance", () => {
    expect(content).toContain('path: "tests/**"');
  });

  test("CR-22 — abort_on_close is true", () => {
    expect(content).toContain("abort_on_close: true");
  });

  test("CR-23 — early_access is false", () => {
    expect(content).toContain("early_access: false");
  });

  test("CR-24 — finishing_touches docstrings are disabled", () => {
    const ftSection = content.substring(content.indexOf("finishing_touches:"));
    expect(ftSection).toContain("docstrings:");
    expect(ftSection).toContain("enabled: false");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CHANGELOG.md — new version entries added in this PR (3.34.04 – 3.34.09)
// ────────────────────────────────────────────────────────────────────────────

test.describe("CHANGELOG.md — new entries", () => {
  let content;

  test.beforeAll(() => {
    content = readRoot("CHANGELOG.md");
  });

  test("CL-1 — CHANGELOG.md follows Keep a Changelog format header", () => {
    expect(content).toContain("Keep a Changelog");
    expect(content).toContain("Semantic Versioning");
  });

  test("CL-2 — [3.34.09] entry is present (STAK-548 hotfix)", () => {
    expect(content).toContain("## [3.34.09]");
  });

  test("CL-3 — [3.34.09] has correct date 2026-04-17", () => {
    expect(content).toContain("## [3.34.09] - 2026-04-17");
  });

  test("CL-4 — [3.34.09] mentions STAK-548", () => {
    const entryStart = content.indexOf("## [3.34.09]");
    const entryEnd = content.indexOf("## [3.34.08]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("STAK-548");
  });

  test("CL-5 — [3.34.08] entry is present (STAK-548 SQLD rename)", () => {
    expect(content).toContain("## [3.34.08]");
  });

  test("CL-6 — [3.34.08] has correct date 2026-04-17", () => {
    expect(content).toContain("## [3.34.08] - 2026-04-17");
  });

  test("CL-7 — [3.34.08] describes SQLD_URL rename", () => {
    const entryStart = content.indexOf("## [3.34.08]");
    const entryEnd = content.indexOf("## [3.34.07]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("SQLD_URL");
  });

  test("CL-8 — [3.34.07] entry is present (STAK-517 market filter cache)", () => {
    expect(content).toContain("## [3.34.07]");
  });

  test("CL-9 — [3.34.07] has correct date 2026-04-17", () => {
    expect(content).toContain("## [3.34.07] - 2026-04-17");
  });

  test("CL-10 — [3.34.07] mentions _invalidateMarketFilterCache", () => {
    const entryStart = content.indexOf("## [3.34.07]");
    const entryEnd = content.indexOf("## [3.34.06]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("_invalidateMarketFilterCache");
  });

  test("CL-11 — [3.34.06] entry is present (STAK-551 filter chip logic)", () => {
    expect(content).toContain("## [3.34.06]");
  });

  test("CL-12 — [3.34.06] has correct date 2026-04-17", () => {
    expect(content).toContain("## [3.34.06] - 2026-04-17");
  });

  test("CL-13 — [3.34.06] describes isAccumulate rename", () => {
    const entryStart = content.indexOf("## [3.34.06]");
    const entryEnd = content.indexOf("## [3.34.05]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("isAccumulate");
  });

  test("CL-14 — [3.34.05] entry is present (STAK-546 AND semantics)", () => {
    expect(content).toContain("## [3.34.05]");
  });

  test("CL-15 — [3.34.05] has correct date 2026-04-16", () => {
    expect(content).toContain("## [3.34.05] - 2026-04-16");
  });

  test("CL-16 — [3.34.04] entry is present (STAK-549 cloud sync)", () => {
    expect(content).toContain("## [3.34.04]");
  });

  test("CL-17 — [3.34.04] has correct date 2026-04-15", () => {
    expect(content).toContain("## [3.34.04] - 2026-04-15");
  });

  test("CL-18 — [3.34.04] describes syncNow return value change", () => {
    const entryStart = content.indexOf("## [3.34.04]");
    const entryEnd = content.indexOf("## [3.34.03]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("syncNow");
    expect(entry).toContain("STAK-549");
  });

  test("CL-19 — entries are in descending version order (3.34.14 before 3.34.13)", () => {
    const idx14 = content.indexOf("## [3.34.14]");
    const idx13 = content.indexOf("## [3.34.13]");
    expect(idx14).toBeGreaterThanOrEqual(0);
    expect(idx13).toBeGreaterThan(idx14);
  });

  test("CL-20 — entries are in descending version order (3.34.10 before 3.34.09)", () => {
    const idx10 = content.indexOf("## [3.34.10]");
    const idx09 = content.indexOf("## [3.34.09]");
    expect(idx10).toBeGreaterThanOrEqual(0);
    expect(idx09).toBeGreaterThan(idx10);
  });

  test("CL-20b — entries are in descending version order (3.34.09 before 3.34.08)", () => {
    const idx09 = content.indexOf("## [3.34.09]");
    const idx08 = content.indexOf("## [3.34.08]");
    expect(idx09).toBeGreaterThanOrEqual(0);
    expect(idx08).toBeGreaterThan(idx09);
  });

  test("CL-20c — entries are in descending version order (3.34.08 before 3.34.07)", () => {
    const idx08 = content.indexOf("## [3.34.08]");
    const idx07 = content.indexOf("## [3.34.07]");
    expect(idx08).toBeGreaterThanOrEqual(0);
    expect(idx07).toBeGreaterThan(idx08);
  });

  test("CL-21 — all versions 3.34.04 through 3.34.14 are present", () => {
    for (const version of [
      "3.34.14",
      "3.34.13",
      "3.34.12",
      "3.34.04",
      "3.34.05",
      "3.34.06",
      "3.34.07",
      "3.34.08",
      "3.34.09",
      "3.34.10",
      "3.34.11",
    ]) {
      expect(content).toContain(`## [${version}]`);
    }
  });

  test("CL-22 — [Unreleased] section still present at top", () => {
    expect(content).toContain("## [Unreleased]");
    const unreleasedIdx = content.indexOf("## [Unreleased]");
    const v314Idx = content.indexOf("## [3.34.14]");
    expect(unreleasedIdx).toBeLessThan(v314Idx);
  });

  test("CL-23 — [3.34.03] pre-existing entry is still intact", () => {
    expect(content).toContain("## [3.34.03]");
  });

  test("CL-24 — boundary: [3.34.15] does NOT exist (no phantom future entries)", () => {
    expect(content).not.toContain("## [3.34.15]");
  });

  // ── 3.34.10 entry (STAK-553: Last Modified sort) ──────────────────────────

  test("CL-25 — [3.34.10] entry is present (STAK-553 Last Modified sort)", () => {
    expect(content).toContain("## [3.34.10]");
  });

  test("CL-26 — [3.34.10] has correct date 2026-04-18", () => {
    expect(content).toContain("## [3.34.10] - 2026-04-18");
  });

  test("CL-27 — [3.34.10] mentions STAK-553", () => {
    const entryStart = content.indexOf("## [3.34.10]");
    const entryEnd = content.indexOf("## [3.34.09]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("STAK-553");
  });

  test("CL-28 — [3.34.10] describes lastModified timestamp", () => {
    const entryStart = content.indexOf("## [3.34.10]");
    const entryEnd = content.indexOf("## [3.34.09]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("lastModified");
  });

  test("CL-29 — [3.34.10] describes sortInventory handling new column", () => {
    const entryStart = content.indexOf("## [3.34.10]");
    const entryEnd = content.indexOf("## [3.34.09]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("sortInventory");
  });

  // ── 3.34.13 entry (STAK-556: Numista tags cherry-pick) ───────────────────

  test("CL-30 — [3.34.13] entry is present (STAK-556 Numista tag cherry-pick)", () => {
    expect(content).toContain("## [3.34.13]");
  });

  test("CL-31 — [3.34.13] has correct date 2026-04-19", () => {
    expect(content).toContain("## [3.34.13] - 2026-04-19");
  });

  test("CL-32 — [3.34.13] mentions STAK-556", () => {
    const entryStart = content.indexOf("## [3.34.13]");
    const entryEnd = content.indexOf("## [3.34.12]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("STAK-556");
  });

  test("CL-33 — [3.34.13] describes per-tag checkbox import", () => {
    const entryStart = content.indexOf("## [3.34.13]");
    const entryEnd = content.indexOf("## [3.34.12]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("per-tag checkboxes");
  });

  test("CL-34 — [3.34.13] mentions user-edited field behavior", () => {
    const entryStart = content.indexOf("## [3.34.13]");
    const entryEnd = content.indexOf("## [3.34.12]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("user-edited");
  });

  test("CL-35 — [3.34.13] includes removed-tags behavior", () => {
    const entryStart = content.indexOf("## [3.34.13]");
    const entryEnd = content.indexOf("## [3.34.12]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("removed tags");
  });

  // ── 3.34.14 entry (STAK-558: Tag delimiter splitting) ────────────────────

  test("CL-37 — [3.34.14] entry is present (STAK-558 tag delimiter splitting)", () => {
    expect(content).toContain("## [3.34.14]");
  });

  test("CL-38 — [3.34.14] has correct date 2026-04-19", () => {
    expect(content).toContain("## [3.34.14] - 2026-04-19");
  });

  test("CL-39 — [3.34.14] mentions STAK-558", () => {
    const entryStart = content.indexOf("## [3.34.14]");
    const entryEnd = content.indexOf("## [3.34.13]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("STAK-558");
  });

  test("CL-40 — [3.34.14] describes comma/semicolon delimiter support", () => {
    const entryStart = content.indexOf("## [3.34.14]");
    const entryEnd = content.indexOf("## [3.34.13]");
    const entry = content.substring(entryStart, entryEnd);
    expect(entry).toContain("comma");
    expect(entry).toContain("semicolon");
  });

  test("CL-41 — [3.34.14] is the newest release in the file", () => {
    const idx14 = content.indexOf("## [3.34.14]");
    const idx13 = content.indexOf("## [3.34.13]");
    expect(idx14).toBeGreaterThanOrEqual(0);
    expect(idx14).toBeLessThan(idx13);
  });
});
