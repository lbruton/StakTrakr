import { test, expect } from "../../helpers/mocks/extended-test.js";

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

  test("TT-4 — modal headers consume theme tokens, not hardcoded literals", async ({ page }) => {
    // STRK-25 — refactored from literal-string match to token-consumption assertion.
    // The original "color !== rgb(248, 250, 252)" check missed cascade-poisoning bugs
    // where modal-content panels hardcoded Slate-blue rgba (rgba(30,41,59,0.95)) for
    // both dark and slate themes via :is(dark, slate). It also broke when slate's
    // --text-primary legitimately resolved to #f8fafc (Tailwind preservation).
    //
    // The correct assertion: modal headers must source their color from --text-primary
    // OR --text-inverse for the active theme. Anything else is a hardcoded literal that
    // bypasses the token system.
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const violations = [];

    for (const theme of THEMES) {
      await setTheme(page, theme);
      const probe = await page.evaluate(() => {
        const ids = [
          "apiHistoryModal",
          "cloudSyncModal",
          "changeLogModal",
          "detailsModal",
          "storageReportModal",
          "itemModal",
        ];
        const root = document.documentElement;
        const cs = getComputedStyle(root);
        const expected = {
          textPrimary: cs.getPropertyValue("--text-primary").trim(),
          textInverse: cs.getPropertyValue("--text-inverse").trim(),
        };
        // Resolve the token reference values to actual computed colors via a
        // throwaway probe element — getPropertyValue returns the raw declaration
        // (e.g. "oklch(...)"), but getComputedStyle on an element using that
        // token returns the browser-resolved RGB form needed for comparison.
        const probeEl = document.createElement("div");
        probeEl.style.position = "absolute";
        probeEl.style.visibility = "hidden";
        document.body.appendChild(probeEl);
        probeEl.style.color = "var(--text-primary)";
        const resolvedTextPrimary = getComputedStyle(probeEl).color;
        probeEl.style.color = "var(--text-inverse)";
        const resolvedTextInverse = getComputedStyle(probeEl).color;
        probeEl.remove();

        const results = [];
        for (const id of ids) {
          const modal = document.getElementById(id);
          if (!modal) continue;
          const prevDisplay = modal.style.display;
          modal.style.display = "flex";
          const header = modal.querySelector(".modal-header");
          if (header) {
            const hcs = getComputedStyle(header);
            results.push({
              id,
              color: hcs.color,
              matchesTextPrimary: hcs.color === resolvedTextPrimary,
              matchesTextInverse: hcs.color === resolvedTextInverse,
            });
          }
          modal.style.display = prevDisplay;
        }
        return { expected, results };
      });

      for (const h of probe.results) {
        if (!h.matchesTextPrimary && !h.matchesTextInverse) {
          violations.push(
            `[${theme}] #${h.id} .modal-header color "${h.color}" does not match --text-primary or --text-inverse`
          );
        }
      }
    }

    expect(
      violations,
      `Modal headers using hardcoded color literals:\n${violations.join("\n")}`
    ).toHaveLength(0);
  });

  test("TT-5 — modal content panels consume theme tokens, not hardcoded Slate rgba", async ({
    page,
  }) => {
    // STRK-25 — added to catch the cascade-poisoning bug where
    // :is([data-theme="dark"], [data-theme="slate"]) .modal-content hardcoded
    // rgba(30, 41, 59, 0.95) (Tailwind Slate 800), defeating the new metallic
    // dark palette. Asserts that in dark theme, modal-content backgroundColor
    // is NOT the legacy Slate-blue literals.
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const violations = [];
    const slateBlueLegacy = [
      "rgba(30, 41, 59, 0.95)", // Slate 800
      "rgb(30, 41, 59)",
      "rgba(15, 23, 42, 0.95)", // Slate 900
      "rgb(15, 23, 42)",
    ];

    // Only assert on dark theme — slate intentionally preserves these Tailwind
    // values, so it is allowed to use the legacy rgba.
    await setTheme(page, "dark");
    const headerBgs = await page.evaluate(() => {
      const ids = [
        "apiHistoryModal",
        "cloudSyncModal",
        "changeLogModal",
        "detailsModal",
        "storageReportModal",
        "itemModal",
        "settingsModal",
      ];
      const results = [];
      for (const id of ids) {
        const modal = document.getElementById(id);
        if (!modal) continue;
        const prevDisplay = modal.style.display;
        modal.style.display = "flex";
        const content = modal.querySelector(".modal-content");
        if (content) {
          results.push({ id, bg: getComputedStyle(content).backgroundColor });
        }
        modal.style.display = prevDisplay;
      }
      return results;
    });

    for (const h of headerBgs) {
      if (slateBlueLegacy.includes(h.bg)) {
        violations.push(
          `[dark] #${h.id} .modal-content backgroundColor "${h.bg}" is a Slate-blue literal, not a metallic dark token`
        );
      }
    }

    expect(
      violations,
      `Cascade-poisoning Slate rgba in dark theme modal-content:\n${violations.join("\n")}`
    ).toHaveLength(0);
  });
});
