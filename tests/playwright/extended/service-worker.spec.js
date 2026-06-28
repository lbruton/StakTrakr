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
  const PROD_GOLDBACK_LATEST = "https://api.staktrakr.com/data/v2/goldback/latest.json";
  const PROD_RETAIL_LATEST = "https://api.staktrakr.com/data/v2/retail/apmex/latest.json";

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

  test("SC-4 — spot-latest /data/v2: online fresh entry → network-first revalidation", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // STRK-249: spot-latest is a realtime family. On an online load classifiedFetch
    // now revalidates against the network first even though the seeded entry is fresh
    // (publication age ≈ 0 s, TTL 1200 s). AC-1 contract: online, a realtime family is
    // NEVER served cache-first. not.toBe("cache-hit") proves the SW attempted the network
    // — "network" when the live fetch succeeds, "network-fallback" when the host is
    // unreachable — so the assertion is hermetic regardless of live-API reachability.
    await seedClassifiedEntry(page, PROD_SPOT_LATEST, Math.floor(Date.now() / 1000), 1200);
    await fetchClassified(page, PROD_SPOT_LATEST);
    expect(await readSwStrategy(page)).not.toBe("cache-hit");
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

  // SC-6 / SC-7 — STRK-249: goldback-latest is a realtime family. A fresh seeded
  // entry must NOT short-circuit to cache-hit on an online load; classifiedFetch
  // revalidates against the network first ("network"). Offline, the network leg
  // throws and the cached copy is served via the fallback path ("network-fallback").
  // Implemented and GREEN: C.2 landed classifiedFetch networkFirst branching for
  // realtime families in this PR.

  test("SC-6 — goldback-latest /data/v2: online fresh entry → network", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // Publication age ≈ 0 s, floor 90000 s → entry is fresh. AC-1 contract: online, a
    // realtime family is NEVER served cache-first. not.toBe("cache-hit") proves the SW
    // attempted the network — "network" when the live fetch succeeds, "network-fallback"
    // when the host is unreachable — so the assertion is hermetic regardless of reach.
    await seedClassifiedEntry(page, PROD_GOLDBACK_LATEST, Math.floor(Date.now() / 1000), 90000);
    await fetchClassified(page, PROD_GOLDBACK_LATEST);
    expect(await readSwStrategy(page)).not.toBe("cache-hit");
  });

  test("SC-7 — goldback-latest /data/v2: offline fresh entry → network-fallback (cached copy served)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // Seed a fresh entry, then go offline. Network-first leg throws (offline) →
    // classifiedFetch falls back to the cached copy with lastStrategy "network-fallback".
    await seedClassifiedEntry(page, PROD_GOLDBACK_LATEST, Math.floor(Date.now() / 1000), 90000);
    await page.context().setOffline(true);
    try {
      await fetchClassified(page, PROD_GOLDBACK_LATEST);
      expect(await readSwStrategy(page)).toBe("network-fallback");
      // The cached copy is still served despite the offline network leg.
      const served = await page.evaluate(
        (u) =>
          fetch(u)
            .then((r) => r.json())
            .then((b) => Boolean(b))
            .catch(() => false),
        PROD_GOLDBACK_LATEST
      );
      expect(served).toBe(true);
    } finally {
      await page.context().setOffline(false);
    }
  });

  // SC-8 / SC-9 — STRK-249: retail-latest is a realtime family. Same network-first
  // contract as goldback-latest: online fresh entry → "network"; offline → the
  // cached copy is served with lastStrategy "network-fallback".

  test("SC-8 — retail-latest /data/v2: online fresh entry → network", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // Publication age ≈ 0 s, floor 1800 s → entry is fresh. AC-1 contract: online, a
    // realtime family is NEVER served cache-first. not.toBe("cache-hit") proves the SW
    // attempted the network — "network" when the live fetch succeeds, "network-fallback"
    // when the host is unreachable — so the assertion is hermetic regardless of reach.
    await seedClassifiedEntry(page, PROD_RETAIL_LATEST, Math.floor(Date.now() / 1000), 1800);
    await fetchClassified(page, PROD_RETAIL_LATEST);
    expect(await readSwStrategy(page)).not.toBe("cache-hit");
  });

  test("SC-9 — retail-latest /data/v2: offline fresh entry → network-fallback (cached copy served)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await waitForSwControl(page);

    // Seed a fresh entry, then go offline. Network-first leg throws (offline) →
    // classifiedFetch falls back to the cached copy with lastStrategy "network-fallback".
    await seedClassifiedEntry(page, PROD_RETAIL_LATEST, Math.floor(Date.now() / 1000), 1800);
    await page.context().setOffline(true);
    try {
      await fetchClassified(page, PROD_RETAIL_LATEST);
      expect(await readSwStrategy(page)).toBe("network-fallback");
      // The cached copy is still served despite the offline network leg.
      const served = await page.evaluate(
        (u) =>
          fetch(u)
            .then((r) => r.json())
            .then((b) => Boolean(b))
            .catch(() => false),
        PROD_RETAIL_LATEST
      );
      expect(served).toBe(true);
    } finally {
      await page.context().setOffline(false);
    }
  });
});
