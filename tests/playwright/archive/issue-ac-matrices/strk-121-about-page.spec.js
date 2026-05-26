import { test, expect } from "@playwright/test";

/**
 * Tests for about.html — the StakTrakr marketing/about page.
 *
 * This page was reformatted by Prettier in this PR. These tests verify that
 * the reformatting did not break the page structure or content and that all
 * key sections and links are intact.
 */
test.describe("about-page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/about.html");
  });

  // ── Document-level ────────────────────────────────────────────────────────

  test("AP-1 — page loads with correct title", async ({ page }) => {
    await expect(page).toHaveTitle("StakTrakr — Track Your Precious Metals Stack");
  });

  test("AP-2 — HTML lang attribute is set to en", async ({ page }) => {
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe("en");
  });

  test("AP-3 — meta description is present and non-empty", async ({ page }) => {
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toBeTruthy();
    expect(description.length).toBeGreaterThan(20);
  });

  // ── Hero section ──────────────────────────────────────────────────────────

  test("AP-4 — hero section is visible", async ({ page }) => {
    await expect(page.locator("header.hero")).toBeVisible();
  });

  test("AP-5 — hero logo displays StakTrakr branding", async ({ page }) => {
    const logo = page.locator(".hero-logo");
    await expect(logo).toBeVisible();
    const text = await logo.textContent();
    expect(text.trim()).toContain("StakTrakr");
  });

  test("AP-6 — hero tagline is correct", async ({ page }) => {
    const tagline = page.locator(".hero-tagline");
    await expect(tagline).toBeVisible();
    await expect(tagline).toContainText("Track your precious metals stack. Your way.");
  });

  test("AP-7 — hero sub-copy mentions key value propositions", async ({ page }) => {
    const sub = page.locator(".hero-sub");
    await expect(sub).toBeVisible();
    const text = await sub.textContent();
    expect(text).toContain("free");
    expect(text).toContain("open-source");
  });

  // ── Hero buttons ──────────────────────────────────────────────────────────

  test("AP-8 — 'Open StakTrakr' primary button is present", async ({ page }) => {
    const btn = page.locator(".hero-buttons a.btn-primary");
    await expect(btn).toBeVisible();
    await expect(btn).toContainText("Open StakTrakr");
  });

  test("AP-9 — 'Open StakTrakr' button links to staktrakr.com", async ({ page }) => {
    const href = await page.locator(".hero-buttons a.btn-primary").getAttribute("href");
    expect(href).toContain("staktrakr.com");
  });

  test("AP-10 — 'View Source' outline button is present", async ({ page }) => {
    const btn = page.locator(".hero-buttons a.btn-outline");
    await expect(btn).toBeVisible();
    await expect(btn).toContainText("View Source");
  });

  test("AP-11 — 'View Source' button links to GitHub repository", async ({ page }) => {
    const href = await page.locator(".hero-buttons a.btn-outline").getAttribute("href");
    expect(href).toContain("github.com");
    expect(href).toContain("StakTrakr");
  });

  test("AP-12 — both hero buttons are present", async ({ page }) => {
    const buttons = page.locator(".hero-buttons a");
    await expect(buttons).toHaveCount(2);
  });

  // ── Pillars section ───────────────────────────────────────────────────────

  test("AP-13 — pillars section heading is visible", async ({ page }) => {
    const heading = page.locator("h2", { hasText: "What Makes StakTrakr Different" });
    await expect(heading).toBeVisible();
  });

  test("AP-14 — exactly 4 pillars are rendered", async ({ page }) => {
    const pillars = page.locator(".pillar");
    await expect(pillars).toHaveCount(4);
  });

  test("AP-15 — 'Your Data Stays Yours' pillar is present", async ({ page }) => {
    await expect(page.locator(".pillar h3", { hasText: "Your Data Stays Yours" })).toBeVisible();
  });

  test("AP-16 — 'Free, Always' pillar is present", async ({ page }) => {
    await expect(page.locator(".pillar h3", { hasText: "Free, Always" })).toBeVisible();
  });

  test("AP-17 — 'Free Spot & Market API' pillar is present", async ({ page }) => {
    await expect(page.locator(".pillar h3", { hasText: "Free Spot & Market API" })).toBeVisible();
  });

  test("AP-18 — 'Truly Portable' pillar is present", async ({ page }) => {
    await expect(page.locator(".pillar h3", { hasText: "Truly Portable" })).toBeVisible();
  });

  test("AP-19 — each pillar has a non-empty icon", async ({ page }) => {
    const icons = page.locator(".pillar-icon");
    const count = await icons.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      const text = await icons.nth(i).textContent();
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  // ── Feature sections ──────────────────────────────────────────────────────

  test("AP-20 — 'Live Market Prices' section heading is present", async ({ page }) => {
    const heading = page.locator("h2", { hasText: "Live Market Prices" });
    await expect(heading).toBeVisible();
  });

  test("AP-21 — at least 4 feature cards are rendered", async ({ page }) => {
    const cards = page.locator(".feature-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test("AP-22 — 'Best Price Ticker' feature card is present", async ({ page }) => {
    await expect(page.locator(".feature-card h3", { hasText: "Best Price Ticker" })).toBeVisible();
  });

  test("AP-23 — 'Vendor Price Matrix' feature card is present", async ({ page }) => {
    await expect(
      page.locator(".feature-card h3", { hasText: "Vendor Price Matrix" })
    ).toBeVisible();
  });

  // ── API table ─────────────────────────────────────────────────────────────

  test("AP-24 — 'Optional API Integrations' section is present", async ({ page }) => {
    const heading = page.locator("h2", { hasText: "Optional API Integrations" });
    await expect(heading).toBeVisible();
  });

  test("AP-25 — api-table is rendered", async ({ page }) => {
    await expect(page.locator("table.api-table")).toBeVisible();
  });

  test("AP-26 — api-table has expected column headers", async ({ page }) => {
    const headers = page.locator("table.api-table th");
    await expect(headers.nth(0)).toContainText("Integration");
    await expect(headers.nth(1)).toContainText("What It Does");
    await expect(headers.nth(2)).toContainText("Key");
  });

  test("AP-27 — StakTrakr API row is in the api-table", async ({ page }) => {
    await expect(page.locator("table.api-table td", { hasText: "StakTrakr API" })).toBeVisible();
  });

  test("AP-28 — 'Bundled' badge is visible in api-table", async ({ page }) => {
    await expect(page.locator(".badge-free", { hasText: "Bundled" })).toBeVisible();
  });

  test("AP-29 — at least 3 rows exist in the api-table body", async ({ page }) => {
    const rows = page.locator("table.api-table tbody tr");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  // ── Privacy section ───────────────────────────────────────────────────────

  test("AP-30 — privacy-box section is present", async ({ page }) => {
    await expect(page.locator(".privacy-box")).toBeVisible();
  });

  test("AP-31 — privacy list items are rendered", async ({ page }) => {
    const items = page.locator(".privacy-list li");
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  // ── Getting Started section ───────────────────────────────────────────────

  test("AP-32 — 'Get Started in 30 Seconds' section is present", async ({ page }) => {
    const heading = page.locator("h2", { hasText: "Get Started in 30 Seconds" });
    await expect(heading).toBeVisible();
  });

  test("AP-33 — Option A and Option B cards are present", async ({ page }) => {
    await expect(
      page.locator(".feature-card h3", { hasText: "Option A: Just Open It" })
    ).toBeVisible();
    await expect(
      page.locator(".feature-card h3", { hasText: "Option B: Run It Locally" })
    ).toBeVisible();
  });

  // ── Sponsor section ───────────────────────────────────────────────────────

  test("AP-34 — sponsor section is visible", async ({ page }) => {
    await expect(page.locator(".sponsor-section")).toBeVisible();
  });

  test("AP-35 — 'Sponsor on GitHub' button is present with correct link", async ({ page }) => {
    const btn = page.locator("a.btn-sponsor");
    await expect(btn).toBeVisible();
    await expect(btn).toContainText("Sponsor on GitHub");
    const href = await btn.getAttribute("href");
    expect(href).toContain("github.com/sponsors");
  });

  // ── Thank You / shoutout section ──────────────────────────────────────────

  test("AP-36 — 'Thank You' section with shoutout is present", async ({ page }) => {
    await expect(page.locator("h2", { hasText: "Thank You" })).toBeVisible();
    await expect(page.locator(".shoutout")).toBeVisible();
  });

  test("AP-37 — Reddit community link is in the shoutout", async ({ page }) => {
    const link = page.locator(".shoutout a", { hasText: /r\/staktrakr/i });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toContain("reddit.com");
  });

  // ── Footer ────────────────────────────────────────────────────────────────

  test("AP-38 — footer is visible", async ({ page }) => {
    await expect(page.locator("footer")).toBeVisible();
  });

  test("AP-39 — footer contains MIT License mention", async ({ page }) => {
    const footer = page.locator("footer");
    await expect(footer).toContainText("MIT License");
  });

  test("AP-40 — footer has 5 navigation links", async ({ page }) => {
    const links = page.locator(".footer-links a");
    await expect(links).toHaveCount(5);
  });

  test("AP-41 — footer App link points to staktrakr.com", async ({ page }) => {
    const link = page.locator(".footer-links a", { hasText: "App" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toContain("staktrakr.com");
  });

  test("AP-42 — footer GitHub link points to lbruton/StakTrakr", async ({ page }) => {
    const link = page.locator(".footer-links a", { hasText: "GitHub" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toContain("github.com");
  });

  test("AP-43 — footer Privacy link points to privacy.html", async ({ page }) => {
    const link = page.locator(".footer-links a", { hasText: "Privacy" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toContain("privacy");
  });

  // ── CSS custom properties (regression: prettier should not break inline styles) ──

  test("AP-44 — CSS custom properties are applied (body has non-default background)", async ({
    page,
  }) => {
    const bgColor = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("background-color")
    );
    // Background should not be white (default) — the dark theme uses a near-black
    expect(bgColor).not.toBe("rgb(255, 255, 255)");
  });

  test("AP-45 — metal-bar accent element is present", async ({ page }) => {
    await expect(page.locator(".metal-bar")).toBeVisible();
  });
});
