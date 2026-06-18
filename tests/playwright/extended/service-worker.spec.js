// SW caching integration tests — STRK-79
// Verifies cache-miss/network, cache-hit, stale-revalidation, and network-fallback
// behavior for classified endpoints using the __sw_test_state__ postMessage interface.
//
// Design note: page.route() does NOT intercept SW-originated outbound fetches (SW has
// its own network stack independent of the page context). Tests therefore use:
//   - Same-origin (localhost) URLs for SC-1 and SC-3: SW fetches hit the Python dev server
//     directly, giving reliable 200 responses without route interception.
//   - page.evaluate Cache API seeding for SC-2: injects a stale entry directly into
//     CacheStorage from the page context, bypassing the SW's fetch path entirely.
//   - browserContext.setOffline for SC-3: emulates offline at CDP level, affecting all
//     network requests including those from the SW.
//
// Race mitigation: each assertion block follows one classified request with exactly
// one postMessage read. lastStrategy is a module-scoped variable in the SW so the
// read always reflects the most recent classified request in this SW lifetime.

import { test, expect } from "@playwright/test";

test.describe("SW classified caching", () => {
  // Override the global serviceWorkers: "block" setting for this test file only.
  test.use({ serviceWorkers: "allow" });

  // Wait for the SW to be actively controlling this page.
  // sw.js uses self.skipWaiting() + self.clients.claim() so the SW claims the page
  // without requiring a reload after installation.
  async function waitForSwControl(page) {
    await page.evaluate(async () => {
      if (navigator.serviceWorker.controller) return;
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      });
    });
  }

  // Read the lastStrategy value from the SW via __sw_test_state__ postMessage.
  // Call AFTER the classified fetch to avoid reading the pre-request null value.
  async function readSwStrategy(page) {
    return page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("SW postMessage timeout")), 4000);
          const listener = (event) => {
            if (event.data && event.data.type === "__sw_test_state__") {
              clearTimeout(timer);
              navigator.serviceWorker.removeEventListener("message", listener);
              resolve(event.data.lastStrategy);
            }
          };
          navigator.serviceWorker.addEventListener("message", listener);
          navigator.serviceWorker.controller.postMessage({ type: "__sw_test_state__" });
        })
    );
  }

  // Perform a classified fetch from the page context and swallow errors (the SW may
  // return a stale or error response; we care only about lastStrategy, not the body).
  async function fetchClassified(page, url) {
    await page.evaluate(
      (u) =>
        fetch(u)
          .then(() => null)
          .catch(() => null),
      url
    );
  }

  test("SC-1 — annual-spot-history: cache-miss → network then cache-hit", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // data/spot-history-2025.json is pre-cached by CORE_ASSETS addAll, but without any
    // freshness headers (x-cached-at / x-generated-at). matchWithAgeCheck treats this as
    // a legacy entry and returns null → SW goes to network.
    // fetchAndCacheClassified fetches from the Python dev server → 200 → writes x-cached-at.
    await fetchClassified(page, "/data/spot-history-2025.json");
    expect(await readSwStrategy(page)).toBe("network");

    // Second fetch — classified entry now has x-cached-at ≈ now; floor = 86400 s.
    // ageSeconds (≈ 0) < 86400 → fresh → cache-hit.
    await fetchClassified(page, "/data/spot-history-2025.json");
    expect(await readSwStrategy(page)).toBe("cache-hit");
  });

  test("SC-2 — annual-spot-history: stale cached entry triggers network revalidation", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // Seed a stale classified entry directly into CacheStorage from the page context.
    // x-cached-at is 25 hours ago; floor (annual-spot-history) = 86400 s.
    // ageSeconds (90000) >= 86400 → matchWithAgeCheck returns null → SW goes to network.
    const staleCachedAt = Date.now() - 90000 * 1000;
    const cacheName = await page.evaluate(async () => {
      const keys = await caches.keys();
      return keys.find((k) => k.startsWith("staktrakr-")) || null;
    });
    expect(cacheName).not.toBeNull();
    await page.evaluate(
      async ({ cn, url, ts }) => {
        const cache = await caches.open(cn);
        await cache.put(
          url,
          new Response("[]", {
            headers: { "Content-Type": "application/json", "x-cached-at": String(ts) },
          })
        );
      },
      { cn: cacheName, url: "/data/spot-history-2025.json", ts: staleCachedAt }
    );

    // matchWithAgeCheck → stale (ageSeconds ≈ 90000 ≥ 86400) → null
    // → fetchAndCacheClassified → Python server → 200 → "network"
    await fetchClassified(page, "/data/spot-history-2025.json");
    expect(await readSwStrategy(page)).toBe("network");
  });

  test("SC-3 — annual-spot-history: network-fallback when network fails", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // Go offline at the CDP level — affects all network requests including SW fetch calls.
    // The pre-cached entry (from CORE_ASSETS addAll) has no freshness headers (legacy).
    // matchWithAgeCheck → null → fetchAndCacheClassified → fetch throws (offline)
    // → catch → caches.match → pre-cached entry returned → lastStrategy = "network-fallback"
    await page.context().setOffline(true);
    try {
      await fetchClassified(page, "/data/spot-history-2025.json");
      expect(await readSwStrategy(page)).toBe("network-fallback");
    } finally {
      await page.context().setOffline(false);
    }
  });

  // SC-4 / SC-5 — STRK-190: classification of the REAL production URL shape
  // (https://api.staktrakr.com/data/v2/…, see V2_API_ENDPOINTS in js/constants.js).
  // These were drafted during STRK-189 and reverted because classifyEndpoint never
  // matched the /data/v2 prefix — every API request fell through to
  // staleWhileRevalidate and the seeded classified entries were never consulted.
  //
  // Seeding pattern (per SC-2): inject a synthetic classified entry directly into
  // CacheStorage from the page context. x-generated-at is unix SECONDS (publisher
  // mint time); x-stale-after is the envelope TTL in seconds (spot-latest: 1200).

  const PROD_SPOT_LATEST = "https://api.staktrakr.com/data/v2/spot/latest.json";

  async function seedClassifiedEntry(page, url, generatedAtSeconds, staleAfterSeconds) {
    const cacheName = await page.evaluate(async () => {
      const keys = await caches.keys();
      return keys.find((k) => k.startsWith("staktrakr-")) || null;
    });
    expect(cacheName).not.toBeNull();
    await page.evaluate(
      async ({ cn, u, gen, ttl }) => {
        const cache = await caches.open(cn);
        await cache.put(
          u,
          new Response(JSON.stringify({ data: {}, generated_at: gen, stale_after: ttl }), {
            headers: {
              "Content-Type": "application/json",
              "x-cached-at": String(Date.now()),
              "x-generated-at": String(gen),
              "x-stale-after": String(ttl),
            },
          })
        );
      },
      { cn: cacheName, u: url, gen: generatedAtSeconds, ttl: staleAfterSeconds }
    );
  }

  test("SC-4 — spot-latest /data/v2: fresh publication age → cache-hit", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // Publication age ≈ 0 s, TTL 1200 s → matchWithAgeCheck returns the entry
    // without any network request. Before STRK-190 this asserted "cache-hit" but
    // got SWR (lastStrategy stayed null) because the URL never classified.
    await seedClassifiedEntry(page, PROD_SPOT_LATEST, Math.floor(Date.now() / 1000), 1200);
    await fetchClassified(page, PROD_SPOT_LATEST);
    expect(await readSwStrategy(page)).toBe("cache-hit");
  });

  test("SC-5 — spot-latest /data/v2: stale publication age → never cache-hit", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // Publication age 3 h ≥ TTL 1200 s → matchWithAgeCheck rejects the entry →
    // SW goes to network. Offline (CDP) keeps the test hermetic: the real API is
    // never reached, fetch throws, and classifiedFetch falls back to the stale
    // entry with lastStrategy = "network-fallback" — anything but "cache-hit".
    const threeHoursAgoSeconds = Math.floor(Date.now() / 1000) - 3 * 3600;
    await seedClassifiedEntry(page, PROD_SPOT_LATEST, threeHoursAgoSeconds, 1200);
    await page.context().setOffline(true);
    try {
      await fetchClassified(page, PROD_SPOT_LATEST);
      const strategy = await readSwStrategy(page);
      expect(strategy).not.toBe("cache-hit");
      expect(strategy).toBe("network-fallback");
    } finally {
      await page.context().setOffline(false);
    }
  });
});
