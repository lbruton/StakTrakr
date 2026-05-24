import { test, expect } from "./helpers/mocks/extended-test.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test.describe("STRK-29: Monospace font and font-size-base", () => {
  test("TYP-1 — --font-mono CSS variable defined with Geist Mono", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const fontMono = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim()
    );
    expect(fontMono).toContain("Geist Mono");
  });

  test("TYP-2 — no inline monospace font assignments in JS", async () => {
    const targets = ["image-cache-modal.js", "market-data.js", "settings.js"];
    const violations = [];

    for (const file of targets) {
      const filePath = path.join(ROOT, "js", file);
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, idx) => {
        const lower = line.toLowerCase();
        if (
          (lower.includes("style.csstext") || lower.includes("style.fontfamily")) &&
          lower.includes("monospace")
        ) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations, `Inline monospace found:\n${violations.join("\n")}`).toHaveLength(0);
  });

  test("TYP-3 — Geist Mono font file exists", async () => {
    const fontPath = path.join(ROOT, "fonts", "geist-mono-variable.woff2");
    expect(fs.existsSync(fontPath)).toBe(true);
  });

  test("TYP-4 — sw.js registers Geist Mono font in cache", async () => {
    const swPath = path.join(ROOT, "sw.js");
    const content = fs.readFileSync(swPath, "utf-8");
    expect(content).toContain("geist-mono-variable.woff2");
  });

  test("TYP-5 — all CSS monospace uses var(--font-mono)", async () => {
    const cssPath = path.join(ROOT, "css", "styles.css");
    const content = fs.readFileSync(cssPath, "utf-8");
    const lines = content.split("\n");
    const violations = [];
    let inFontFace = false;

    lines.forEach((line, idx) => {
      const trimmed = line.trim();

      if (trimmed.startsWith("@font-face")) {
        inFontFace = true;
        return;
      }
      if (inFontFace) {
        if (trimmed === "}") inFontFace = false;
        return;
      }

      // Skip the line that DEFINES --font-mono
      if (trimmed.includes("--font-mono") && trimmed.includes(":")) return;

      // Check font-family lines that reference monospace
      if (trimmed.includes("font-family") && trimmed.toLowerCase().includes("monospace")) {
        if (!trimmed.includes("var(--font-mono")) {
          violations.push(`Line ${idx + 1}: ${trimmed}`);
        }
      }
    });

    expect(violations, `Bare monospace found:\n${violations.join("\n")}`).toHaveLength(0);
  });
});
