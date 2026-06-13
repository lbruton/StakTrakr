import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-153 regression: spot-price cards must not lock on the "Seed" label when the
// seed bundle includes a TODAY-dated (noon) tail entry. saveSpotHistory re-sorts by
// timestamp, so a noon seed entry sorts back to the tail even after a real same-day
// API sync recorded earlier in the day. getLastUpdateTime must compare by LOCAL
// CALENDAR DAY and prefer the live provider/API label once a same-day sync exists.

test.use({ locale: "en-US", timezoneId: "America/Chicago" });

// Fixed "now" so the seed noon entry and the morning sync land on the same local day.
const FIXED_NOW_ISO = "2026-06-04T18:00:00.000Z"; // 13:00 local (America/Chicago, CDT)
const TODAY_LOCAL = "2026-06-04";

async function gotoApp(page) {
  await page.addInitScript(
    ({ fixedNowIso }) => {
      const RealDate = Date;
      const fixedNow = new RealDate(fixedNowIso).getTime();
      class MockDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fixedNow]));
        }
        static now() {
          return fixedNow;
        }
      }
      MockDate.UTC = RealDate.UTC;
      MockDate.parse = RealDate.parse;
      window.Date = MockDate;
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
        },
        { once: true }
      );
    },
    { fixedNowIso: FIXED_NOW_ISO }
  );

  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#newItemBtn", { state: "visible" });
  await page.waitForFunction(
    () =>
      typeof window.updateSpotTimestamp === "function" &&
      typeof window.saveDataSync === "function" &&
      "spotHistory" in window
  );
}

// Drives the real code path: set the in-memory spotHistory tail to a today-noon seed
// entry, optionally record a same-day morning API sync, re-render the timestamp DOM,
// and return the rendered label.
async function renderSilverLabel(page, { withMorningSync }) {
  return page.evaluate(
    ({ today, morningSync }) => {
      window.spotHistory = [
        { metal: "Silver", spot: 30, source: "seed", timestamp: `${today} 12:00:00` },
      ];
      // "lastApiSync" === LAST_API_SYNC_KEY
      if (morningSync) {
        window.saveDataSync("lastApiSync", {
          provider: "Metals.dev",
          timestamp: `${today}T06:57:00`,
        });
      } else {
        localStorage.removeItem("lastApiSync");
      }
      localStorage.removeItem("lastCacheRefresh");
      window.updateSpotTimestamp("Silver");
      return document.getElementById("spotTimestampSilver").innerHTML;
    },
    { today: TODAY_LOCAL, morningSync: withMorningSync }
  );
}

test.describe("STRK-153 seed label lock", () => {
  test("today-noon seed tail + same-day morning API sync shows the live provider label, not Seed", async ({
    page,
  }) => {
    await gotoApp(page);
    const label = await renderSilverLabel(page, { withMorningSync: true });
    expect(label).not.toContain("Seed");
    expect(label).toContain("Metals.dev");
    expect(label).toContain("Last API Sync");
  });

  test("today-noon seed tail with no sync still shows the Seed label", async ({ page }) => {
    await gotoApp(page);
    const label = await renderSilverLabel(page, { withMorningSync: false });
    expect(label).toContain("Seed");
    expect(label).toContain(TODAY_LOCAL);
  });
});
