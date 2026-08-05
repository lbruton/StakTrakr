/**
 * MintBuilder Vendor module (STRK-307 / STRK-311 / STRK-321).
 *
 * STRK-321: MintBuilder granted StakTrakr direct API access — the first
 * vendor with a first-party price feed. scrape() is now FEED-FIRST: it
 * resolves the row against the memoized feed index
 * (price-extract-mintbuilder-feed.js, one GET per process) and only falls
 * back to the page scrape on a miss or when the feed is unavailable
 * (MB_API_KEY unset, HTTP failure, bad payload). Unsetting MB_API_KEY
 * therefore rolls the vendor back to pure scraping with no code change.
 *
 * The page-scrape fallback is the pre-STRK-321 behavior and stays healthy:
 * MintBuilder serves clean schema.org Product/Offer JSON-LD (price +
 * availability) on every real product page, with no bot-challenge (Cloudflare
 * sits in front purely as a CDN — cf-cache-status: HIT, no JS challenge, no
 * cf_clearance cookie needed). Same "trust JSON-LD, no markdown quirks" shape
 * as Goldback: no cutoff patterns, no OOS text-pattern workaround, no custom
 * price strategy. `availability` (InStock/OutOfStock) is authoritative and
 * populated even when `price` is present on an out-of-stock page — the
 * Phase 0 (Playwright-direct) scraper now combines JSON-LD availability with
 * text-based stock detection (same formula as scrapeViaCFClearance) so this
 * case reports OOS correctly instead of trusting text detection alone.
 */

import { mergeProviderConfig } from "./price-extract-provider-config.js";
import { lookupMintbuilderProduct } from "./price-extract-mintbuilder-feed.js";

// Plain SSR HTML — JSON-LD is present in the initial response, no JS render
// needed. domcontentloaded is sufficient; waiting for networkidle only adds
// latency (same reasoning as sdbullion).
export const MINTBUILDER_CONFIG = mergeProviderConfig({
  waitUntil: "domcontentloaded",
});

export const vendor = {
  id: "mintbuilder",
  displayName: "MintBuilder",
  config: MINTBUILDER_CONFIG,
  // No vendor-specific markdown shaping — MintBuilder needs no cutoff/header trimming.
  cutoffPatterns: [],
  headerSkipPattern: null,
  preorderTolerant: false,
  untrustedOfferPrice: false,
  usesAsLowAs: false,
  // No extractPrice override → shared default strategy (JSON-LD offer.price authoritative).
  /**
   * Resolve a MintBuilder target feed-first, page-scrape as fallback (STRK-321).
   *
   * A feed hit records `source: "mintbuilder-api"` with `inStock: true` (the
   * feed carries no stock field; presence in the all-active-products payload
   * is the availability signal) and always reports the row's product-page URL
   * — never the feed endpoint. A miss or an unavailable feed falls back to
   * `context.scrapeGeneric`, which decides both price and OOS from the page.
   *
   * @param {object} context - Scrape context supplied by the vendor registry
   *   (coinSlug, coin, provider, urls, scrapeGeneric, optional mbFeedLookup
   *   test seam), carrying a config already merged as provider defaults →
   *   this module's config → caller-explicit overrides (STRK-314). The
   *   fallback passes this context through untouched — config is never
   *   re-derived or merged here.
   * @returns {Promise<object>} { price, inStock, source, ok, error, url }.
   */
  async scrape(context) {
    const log = context.log || console.log;
    const warn = context.warn || console.warn;
    const lookup = context.mbFeedLookup || lookupMintbuilderProduct;
    const targetUrl = context.url || context.urls?.[0] || context.provider?.url || null;

    const resolved = await lookup({
      url: targetUrl,
      hints: context.provider?.hints ?? null,
      log,
      warn,
    });

    if (resolved.status === "hit") {
      // STRK-325 hybrid stock rule: the feed's tier data proves availability
      // only when some tier shows inventory headroom (max qty_max > 1 —
      // validated against 119 product pages). A degenerate cap of 1 cannot
      // distinguish sold-out from last-unit, so those items fall through to
      // the page scrape, whose JSON-LD availability is authoritative.
      if (!resolved.product.stockConfident) {
        log(
          `[mintbuilder] feed shows no tier inventory headroom for ${context.coinSlug} — ` +
            "page-scrape fallback for authoritative availability"
        );
        return context.scrapeGeneric(context);
      }
      return {
        price: resolved.product.price,
        inStock: true,
        source: "mintbuilder-api",
        ok: true,
        error: null,
        url: targetUrl,
      };
    }

    if (resolved.status === "miss") {
      warn(
        `[mintbuilder] feed miss (${resolved.reason}) for ${context.coinSlug} @ ${targetUrl} — ` +
          'page-scrape fallback (pin {"mbProductId": "…"} in the row hints to fix a URL drift)'
      );
    } else {
      log(
        `[mintbuilder] feed unavailable (${resolved.reason}) for ${context.coinSlug} — page-scrape fallback`
      );
    }

    return context.scrapeGeneric(context);
  },
};

export default vendor;
