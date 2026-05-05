import { test, expect } from "@playwright/test";

const THEMES = ["light", "dark", "slate", "sepia"];
const REQUIRED_TOKENS = [
  "--text-inverse",
  "--tag-bg",
  "--brand-gold",
  "--authority-pcgs",
  "--focus-ring",
  "--hover-mix",
];

const setTheme = async (page, theme) => {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
};

test.describe("STRK-25: theme token coverage", () => {
  test("TT-1 — all 4 themes load without JS runtime errors", async ({ page }) => {
    // Filters out unrelated network 404s (offline assets, missing icons, etc.) — those are
    // not theme errors. We only care about JS runtime / page errors that would be caused by
    // bad CSS color parsing, missing globals, or theme-switch script failures.
    const isThemeRelevantError = (text) => {
      if (!text) return false;
      if (/Failed to load resource/i.test(text)) return false;
      if (/net::ERR_/i.test(text)) return false;
      if (/404 \(File not found\)/i.test(text)) return false;
      return true;
    };

    const errorsByTheme = {};

    for (const theme of THEMES) {
      const errors = [];
      const consoleHandler = (msg) => {
        if (msg.type() === "error" && isThemeRelevantError(msg.text())) {
          errors.push(msg.text());
        }
      };
      const pageErrorHandler = (err) => errors.push(`pageerror: ${err.message}`);

      page.on("console", consoleHandler);
      page.on("pageerror", pageErrorHandler);

      await page.addInitScript((t) => {
        try {
          localStorage.setItem("appTheme", t);
        } catch (_e) {
          /* ignore */
        }
      }, theme);

      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await setTheme(page, theme);
      await page.waitForTimeout(150);

      page.off("console", consoleHandler);
      page.off("pageerror", pageErrorHandler);
      errorsByTheme[theme] = errors;
    }

    for (const theme of THEMES) {
      expect(
        errorsByTheme[theme],
        `Theme-relevant errors loading "${theme}":\n${(errorsByTheme[theme] || []).join("\n")}`
      ).toHaveLength(0);
    }
  });

  test("TT-2 — required CSS tokens resolve to non-empty values in every theme", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const missing = [];

    for (const theme of THEMES) {
      await setTheme(page, theme);
      const resolved = await page.evaluate((tokens) => {
        const cs = getComputedStyle(document.documentElement);
        const out = {};
        for (const t of tokens) out[t] = cs.getPropertyValue(t).trim();
        return out;
      }, REQUIRED_TOKENS);

      for (const token of REQUIRED_TOKENS) {
        if (!resolved[token]) missing.push(`[${theme}] ${token} = "${resolved[token]}"`);
      }
    }

    expect(missing, `Unresolved or empty tokens:\n${missing.join("\n")}`).toHaveLength(0);
  });

  test("TT-3 — theme picker cycles light → dark → slate → sepia → light", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open the settings modal where the theme picker lives.
    await page.evaluate(() => {
      const m = document.getElementById("settingsModal");
      if (m) m.style.display = "flex";
    });

    const order = ["light", "dark", "slate", "sepia", "light"];
    const observed = [];

    for (const theme of order) {
      await page.evaluate((t) => {
        const btn = document.querySelector(`.theme-picker .theme-option[data-theme="${t}"]`);
        if (btn) btn.click();
      }, theme);
      await page.waitForTimeout(75);
      const current = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme")
      );
      observed.push(current);
    }

    expect(observed).toEqual(order);
  });

  test("TT-4 — modal headers do not use hardcoded #f8fafc (rgb(248, 250, 252))", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const violations = [];

    for (const theme of THEMES) {
      await setTheme(page, theme);
      // Force a modal open and inspect the computed color of its .modal-header.
      const headerColors = await page.evaluate(() => {
        const ids = [
          "apiHistoryModal",
          "cloudSyncModal",
          "changeLogModal",
          "detailsModal",
          "storageReportModal",
          "itemModal",
        ];
        const results = [];
        for (const id of ids) {
          const modal = document.getElementById(id);
          if (!modal) continue;
          const prevDisplay = modal.style.display;
          modal.style.display = "flex";
          const header = modal.querySelector(".modal-header");
          if (header) {
            const cs = getComputedStyle(header);
            results.push({ id, color: cs.color, background: cs.backgroundColor });
          }
          modal.style.display = prevDisplay;
        }
        return results;
      });

      for (const h of headerColors) {
        if (h.color === "rgb(248, 250, 252)") {
          violations.push(`[${theme}] #${h.id} .modal-header color resolves to ${h.color}`);
        }
      }
    }

    expect(
      violations,
      `Hardcoded #f8fafc found in modal headers:\n${violations.join("\n")}`
    ).toHaveLength(0);
  });
});
