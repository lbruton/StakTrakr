/**
 * Shared retail price extraction helpers.
 *
 * Vendor-agnostic parsing, stock detection, HTML cleanup, JSON-LD extraction,
 * and structured scrape-result helpers live here so Vendor modules can import
 * them without importing the full poller orchestrator.
 */

import { isFractionalExemptProvider } from "./price-extract-provider-config.js";

// Per-oz price ranges by metal type.
// Multiplied by weight_oz to get the expected price range for each coin.
// Filters out accessories, spot ticker values, and unrelated products.
const METAL_PRICE_RANGE_PER_OZ = {
  silver: { min: 40, max: 200 }, // 1oz: $40-200, 10oz bar: $400-2000
  gold: { min: 1500, max: 15000 }, // 1oz: $1500-15000
  platinum: { min: 500, max: 6000 },
  palladium: { min: 300, max: 6000 },
  goldback: { min: 5, max: 25 }, // G1 ($10 spot equivalent); G50 would be $500 but tracked separately
};

// Provider IDs that use "As Low As" as their primary price indicator.
// UPDATE 2026-02-21: Monument Metals DOES have a pricing table (1-24 row with eCheck/Wire column).
// "As Low As" is bulk discount (500+) — use table-first extraction like all other vendors.
// Empty set = all vendors now use table-first strategy.
const USES_AS_LOW_AS = new Set([]);

const OUT_OF_STOCK_PATTERNS = [
  /out of stock/i,
  /sold out/i,
  /currently unavailable/i,
  /notify me when available/i,
  /email when in stock/i,
  /temporarily out of stock/i,
  /back ?order/i,
  /pre-?order/i,
  // Hero Bullion (WooCommerce) shows a `<p class="stock out-of-stock">Unavailable</p>`
  // badge that Firecrawl renders as a bare "Unavailable" line. Anchored to a line
  // start to avoid matching prose like "Currently unavailable for shipping" elsewhere.
  /^\s*unavailable\s*$/im,
];

// Soft 404 patterns — React SPAs return HTTP 200 but render "not found" content.
// When detected, the scraper should record inStock=false and price=null (STRK-475).
const SOFT_404_PATTERNS = [
  /page\s*(not|can['\u2019]?t be|cannot be)\s*found/i,
  /product\s*(not|no longer)\s*(found|available)/i,
  /404\s*[-–—]\s*(page|not found)/i,
  /this\s+page\s+(doesn['\u2019]?t|does not)\s+exist/i,
  /we\s+couldn['\u2019]?t\s+find/i,
  /the\s+page\s+you\s+(requested|are looking for)/i,
  /no\s+longer\s+available/i,
  /has\s+been\s+(removed|discontinued)/i,
];

// Providers whose "Pre-Order" / "Presale" items still show live purchasable prices.
// For these, skip the pre-?order OOS pattern — treat presale as in-stock.
const PREORDER_TOLERANT_PROVIDERS = new Set(["jmbullion", "monumentmetals"]);

const MARKDOWN_CUTOFF_PATTERNS = {
  sdbullion: [
    /^\*\*Add on Items\*\*/im,
    /^Add on Items\s*$/im,
    /^\*\*Customers Also Purchased\*\*/im,
    /^Customers Also Purchased\s*$/im,
    /<[^>]*>\s*Add on Items/i,
    /<[^>]*>\s*Customers Also Purchased/i,
  ],
  jmbullion: [/^Similar Products You May Like/im, /<[^>]*>\s*Similar Products You May Like/i],
  monumentmetals: [
    /[\d,]+\s+Reviews?\]\(https:\/\/www\.shopperapproved/i,
    /[\d,]+\s+Reviews?\b/i,
    /\bSuggested Products\b/i,
  ],
  summitmetals: [
    /^\s*Description Shipping & Returns\s*$/im,
    /^#{0,6}\s*What Our Clients/im,
    /^#{0,6}\s*Faq'?s\s*$/im,
  ],
};

const MARKDOWN_HEADER_SKIP_PATTERNS = {
  jmbullion:
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}\s+at\s+\d{1,2}:\d{2}\s+[A-Z]{2,4}/,
  monumentmetals: /(?:Home\s*>|Bullion\s*>|Coins?\s*>)/,
};

export function preprocessMarkdown(markdown, providerId) {
  if (!markdown) return "";
  let result = markdown;

  const headerPattern = MARKDOWN_HEADER_SKIP_PATTERNS[providerId];
  if (headerPattern) {
    const headerMatch = result.search(headerPattern);
    if (headerMatch !== -1) {
      const afterMatch = result.indexOf("\n", headerMatch);
      if (afterMatch !== -1) result = result.slice(afterMatch + 1);
    }
  }

  const patterns = MARKDOWN_CUTOFF_PATTERNS[providerId];
  if (patterns) {
    let cutIndex = result.length;
    for (const pattern of patterns) {
      const match = result.search(pattern);
      if (match !== -1 && match < cutIndex) cutIndex = match;
    }
    result = result.slice(0, cutIndex);
  }

  return result;
}

export function detectStockStatus(markdown, expectedWeightOz = 1, providerId = "") {
  if (!markdown) {
    return { inStock: true, reason: "no_markdown", detectedText: null };
  }

  for (const pattern of SOFT_404_PATTERNS) {
    const match = markdown.match(pattern);
    if (match) {
      return {
        inStock: false,
        reason: "soft_404",
        detectedText: match[0],
      };
    }
  }

  const toleratesPreorder = PREORDER_TOLERANT_PROVIDERS.has(providerId);
  for (const pattern of OUT_OF_STOCK_PATTERNS) {
    if (toleratesPreorder && /pre-?order/i.source === pattern.source) continue;
    const match = markdown.match(pattern);
    if (match) {
      return {
        inStock: false,
        reason: "out_of_stock",
        detectedText: match[0],
      };
    }
  }

  if (expectedWeightOz >= 1 && !isFractionalExemptProvider(providerId)) {
    const headingMatch = markdown.match(/^#{1,2}\s+(.+)$/m);
    const titleArea = headingMatch ? headingMatch[1] : markdown.slice(0, 500);

    const fractionalPatterns = [
      /\b1\/2\s*oz\b/i,
      /\b1\/4\s*oz\b/i,
      /\b1\/10\s*oz\b/i,
      /\bhalf\s*ounce\b/i,
      /\bquarter\s*ounce\b/i,
    ];

    for (const pattern of fractionalPatterns) {
      const match = titleArea.match(pattern);
      if (match) {
        return {
          inStock: false,
          reason: "fractional_weight",
          detectedText: match[0],
        };
      }
    }
  }

  return { inStock: true, reason: "in_stock", detectedText: null };
}

// Sentinel returned by extractJsonLdPrice when JSON-LD has a valid Product
// with price=0 — signals "real product page, no price (OOS)".
export const JSONLD_ZERO_PRICE = Symbol("jsonld-zero-price");

const UNTRUSTED_OFFER_PRICE_VENDORS = new Set(["sdbullion", "bullionexchanges"]);

export function extractJsonLdPrice(jsonLdScripts, metal, weightOz = 1, providerId = "") {
  if (!jsonLdScripts || jsonLdScripts.length === 0) return null;
  const perOz = METAL_PRICE_RANGE_PER_OZ[metal];
  if (!perOz) return null;
  const min = perOz.min * weightOz;
  const max = perOz.max * weightOz;

  function inRange(p) {
    return !isNaN(p) && p >= min && p <= max;
  }

  const WIRE_METHOD_RE = /bank|wire|check|ach/i;
  function isBankTransfer(method) {
    if (!method) return false;
    if (typeof method === "string")
      return method.includes("ByBankTransferInAdvance") || WIRE_METHOD_RE.test(method);
    if (method["@id"])
      return (
        method["@id"].includes("ByBankTransferInAdvance") || WIRE_METHOD_RE.test(method["@id"])
      );
    if (method.name) return WIRE_METHOD_RE.test(method.name);
    return false;
  }

  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const typeVal = item["@type"];
        const types = Array.isArray(typeVal) ? typeVal : [typeVal];
        if (!types.includes("Product")) continue;
        const offers = item.offers;
        if (!offers) continue;
        const offerList = Array.isArray(offers) ? offers : [offers];
        for (const offer of offerList) {
          const rawSpecs = offer.priceSpecification;
          const specs = rawSpecs == null ? [] : Array.isArray(rawSpecs) ? rawSpecs : [rawSpecs];
          if (specs.length > 0) {
            let wirePrice = null;
            for (const spec of specs) {
              const methods = Array.isArray(spec.appliesToPaymentMethod)
                ? spec.appliesToPaymentMethod
                : [spec.appliesToPaymentMethod];
              if (!methods.some(isBankTransfer)) continue;
              const qty = spec.eligibleQuantity;
              const qtyMin = qty ? String(qty.minValue ?? qty.value ?? "") : "";
              if (qtyMin && qtyMin !== "1") continue;
              const p = parseFloat(String(spec.price ?? "").replace(/,/g, ""));
              if (inRange(p)) {
                wirePrice = p;
                break;
              }
            }
            if (wirePrice !== null) return wirePrice;
          }

          const price = parseFloat(String(offer.price ?? "").replace(/,/g, ""));
          if (!isNaN(price) && price === 0) return JSONLD_ZERO_PRICE;
          if (UNTRUSTED_OFFER_PRICE_VENDORS.has(providerId)) continue;
          if (inRange(price)) return price;
        }
      }
    } catch {
      /* invalid JSON — skip */
    }
  }
  return null;
}

export const JSONLD_OOS_VALUES = new Set(["outofstock", "soldout", "discontinued"]);

export function extractJsonLdAvailability(jsonLdScripts) {
  if (!jsonLdScripts || jsonLdScripts.length === 0) return null;

  function checkProduct(item) {
    const typeVal = item["@type"];
    const types = Array.isArray(typeVal) ? typeVal : [typeVal];
    if (!types.includes("Product")) return null;
    const offers = item.offers;
    if (!offers) return null;
    const offerList = Array.isArray(offers) ? offers : [offers];
    let nonOos = null;
    for (const offer of offerList) {
      const av = offer.availability;
      if (!av) continue;
      const m = String(av)
        .split(/[\/#]/)
        .pop()
        .match(/([A-Za-z]+)/);
      if (m) {
        const token = m[1].toLowerCase();
        if (JSONLD_OOS_VALUES.has(token)) return token;
        if (!nonOos) nonOos = token;
      }
    }
    return nonOos;
  }

  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item) continue;
        let nodes;
        if (item["@graph"] != null) {
          nodes = Array.isArray(item["@graph"]) ? item["@graph"] : [item["@graph"]];
        } else {
          nodes = [item];
        }
        for (const node of nodes) {
          const av = checkProduct(node);
          if (av) return av;
        }
      }
    } catch {
      /* invalid JSON — skip */
    }
  }
  return null;
}

export function extractMarkdownPrice(markdown, metal, weightOz = 1, providerId = "") {
  if (!markdown) return null;

  const perOz = METAL_PRICE_RANGE_PER_OZ[metal] || { min: 5, max: 200_000 };
  const range = { min: perOz.min * weightOz, max: perOz.max * weightOz };

  function inRange(p) {
    return p >= range.min && p <= range.max;
  }

  function tablePrices() {
    const prices = [];
    let m;
    const pat = /\|\s*\*{0,2}\$?([\d,]+\.\d{2})\*{0,2}\s*\|/g;
    while ((m = pat.exec(markdown)) !== null) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) prices.push(p);
    }
    return prices;
  }

  function asLowAsPrices() {
    const prices = [];
    let m;
    const pat = /[Aa]s\s+[Ll]ow\s+[Aa]s[\s\\]*\$?([\d,]+\.\d{2})/g;
    while ((m = pat.exec(markdown)) !== null) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) prices.push(p);
    }
    return prices;
  }

  function firstTableRowFirstPrice() {
    const lines = markdown.split("\n");
    for (const line of lines) {
      if (!line.startsWith("|")) continue;
      if (/^\|\s*[-:]+/.test(line)) continue;
      const prices = [];
      for (const m of line.matchAll(/\|\s*\*{0,2}\$?([\d,]+\.\d{2})\*{0,2}\s*(?:\|)/g)) {
        const p = parseFloat(m[1].replace(/,/g, ""));
        if (inRange(p)) prices.push(p);
      }
      if (prices.length > 0) return prices[0];
    }
    return null;
  }

  function jmPriceFromProseTable() {
    const checkWireIdx = markdown.search(/\(e\)Check\s*\/\s*Wire/i);
    if (checkWireIdx === -1) return null;
    const afterHeader = markdown.slice(checkWireIdx);
    const tierMatch = afterHeader.match(/\n\s*(\d+-\d+|\d+\+)\s*\n/);
    if (!tierMatch) return null;
    const afterTier = afterHeader.slice(tierMatch.index + tierMatch[0].length);
    const priceMatch = afterTier.match(/\$\s*([\d,]+\.\d{2})/);
    if (!priceMatch) return null;
    const p = parseFloat(priceMatch[1].replace(/,/g, ""));
    return inRange(p) ? p : null;
  }

  function jmPriceFromPipeTable() {
    const lines = markdown.split("\n");
    const WIRE_RE = /\(?e?\)?\s*Check\s*\/\s*Wire/i;
    let wireCol = -1;
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("|") || !WIRE_RE.test(line)) continue;
      let sepFound = false;
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (next === "") continue;
        if (/^\|\s*[-:]+/.test(next)) {
          sepFound = true;
        }
        break;
      }
      if (!sepFound) continue;
      const cells = line.split("|");
      for (let c = 0; c < cells.length; c++) {
        if (WIRE_RE.test(cells[c])) {
          wireCol = c;
          headerIdx = i;
          break;
        }
      }
      if (wireCol !== -1) break;
    }
    if (wireCol === -1) return null;
    let seenData = false;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("|")) {
        if (seenData) break;
        continue;
      }
      if (/^\|\s*[-:]+/.test(line)) continue;
      seenData = true;
      const cells = line.split("|");
      if (wireCol >= cells.length) continue;
      const m = cells[wireCol].match(/\$?\s*([\d,]+\.\d{2})/);
      if (!m) continue;
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) return p;
    }
    return null;
  }

  function tierAnchoredPrice() {
    const pattern = /\b(?:\d{1,3}\s*-\s*\d{1,5}|\d{1,3}\+)\s+\$\s*([\d,]+\.\d{2})/g;
    for (const m of markdown.matchAll(pattern)) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) return p;
    }
    return null;
  }

  function firstInRangePriceProse() {
    for (const m of markdown.matchAll(/\$\s*([\d,]+\.\d{2})/g)) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) return p;
    }
    return null;
  }

  function regularPricePrices() {
    const prices = [];
    let m;
    const pat = /(?:Regular|Sale)\s+price\s+\$?([\d,]+\.\d{2})/g;
    while ((m = pat.exec(markdown)) !== null) {
      const p = parseFloat(m[1].replace(/,/g, ""));
      if (inRange(p)) prices.push(p);
    }
    return prices;
  }

  if (providerId === "summitmetals") {
    const tblFirst = firstTableRowFirstPrice();
    if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
    const tier = tierAnchoredPrice();
    if (tier !== null) return { price: tier, matchedBy: "tierAnchored" };
    const reg = regularPricePrices();
    if (reg.length > 0) return { price: Math.min(...reg), matchedBy: "regularPrice" };
    return null;
  }

  if (providerId === "jmbullion") {
    const proseTbl = jmPriceFromProseTable();
    if (proseTbl !== null) return { price: proseTbl, matchedBy: "jmProseTable" };
    const pipeTbl = jmPriceFromPipeTable();
    if (pipeTbl !== null) return { price: pipeTbl, matchedBy: "jmPipeTable" };
    return null;
  } else if (UNTRUSTED_OFFER_PRICE_VENDORS.has(providerId)) {
    const tblFirst = firstTableRowFirstPrice();
    if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
    const tier = tierAnchoredPrice();
    if (tier !== null) return { price: tier, matchedBy: "tierAnchored" };
    return null;
  } else if (USES_AS_LOW_AS.has(providerId)) {
    const ala = asLowAsPrices();
    if (ala.length > 0) return { price: Math.min(...ala), matchedBy: "asLowAs" };
    const tbl = tablePrices();
    if (tbl.length > 0) return { price: Math.min(...tbl), matchedBy: "tablePrices" };
  } else {
    const tblFirst = firstTableRowFirstPrice();
    if (tblFirst !== null) return { price: tblFirst, matchedBy: "tableFirstRow" };
    const prose = firstInRangePriceProse();
    if (prose !== null) return { price: prose, matchedBy: "firstInRangeProse" };
    const ala = asLowAsPrices();
    if (ala.length > 0) return { price: Math.min(...ala), matchedBy: "asLowAs" };
  }

  return null;
}

function findHtmlTagEnd(html, fromIndex) {
  let quote = null;
  for (let i = fromIndex; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

function isHtmlWhitespace(ch) {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f";
}

function findRawTextCloseTag(html, lowerHtml, tagName, fromIndex) {
  const closeTag = tagName.toLowerCase();
  let searchFrom = fromIndex;
  while (searchFrom < html.length) {
    const lt = html.indexOf("<", searchFrom);
    if (lt === -1) return -1;
    let cursor = lt + 1;
    while (cursor < html.length && isHtmlWhitespace(html[cursor])) cursor++;
    if (html[cursor] !== "/") {
      searchFrom = lt + 1;
      continue;
    }
    cursor++;
    while (cursor < html.length && isHtmlWhitespace(html[cursor])) cursor++;
    const nameStart = cursor;
    while (cursor < html.length) {
      const code = lowerHtml.charCodeAt(cursor);
      const isNameChar = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
      if (!isNameChar) break;
      cursor++;
    }
    if (lowerHtml.slice(nameStart, cursor) !== closeTag) {
      searchFrom = lt + 1;
      continue;
    }
    while (cursor < html.length && isHtmlWhitespace(html[cursor])) cursor++;
    if (html[cursor] === ">") return cursor;
    searchFrom = lt + 1;
  }
  return -1;
}

function collapseWhitespace(text) {
  let output = "";
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isHtmlWhitespace(ch)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) {
      output += " ";
      pendingSpace = false;
    }
    output += ch;
  }
  return output;
}

const CHROME_OR_RAWTEXT_TAGS = new Set(["script", "style", "nav", "header", "footer"]);

export function htmlToPlainText(html) {
  if (!html) return "";
  const lowerHtml = html.toLowerCase();
  let text = "";
  let cursor = 0;

  while (cursor < html.length) {
    const lt = html.indexOf("<", cursor);
    if (lt === -1) {
      text += html.slice(cursor);
      break;
    }

    text += html.slice(cursor, lt);

    if (lowerHtml.startsWith("<!--", lt)) {
      const commentEnd = html.indexOf("-->", lt + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      text += " ";
      continue;
    }

    let nameStart = lt + 1;
    while (nameStart < html.length && isHtmlWhitespace(html[nameStart])) nameStart++;
    const isClosingTag = html[nameStart] === "/";
    if (isClosingTag) nameStart++;
    while (nameStart < html.length && isHtmlWhitespace(html[nameStart])) nameStart++;

    let nameEnd = nameStart;
    while (nameEnd < html.length) {
      const code = lowerHtml.charCodeAt(nameEnd);
      const isNameChar = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
      if (!isNameChar) break;
      nameEnd++;
    }

    const tagName = lowerHtml.slice(nameStart, nameEnd);
    const nextChar = nameEnd < html.length ? html[nameEnd] : "";
    const isCompleteTagName = nameEnd >= html.length || /[\s>/]/.test(nextChar);
    if (!isClosingTag && CHROME_OR_RAWTEXT_TAGS.has(tagName) && isCompleteTagName) {
      const closeEnd = findRawTextCloseTag(html, lowerHtml, tagName, nameEnd);
      cursor = closeEnd === -1 ? html.length : closeEnd + 1;
      text += " ";
      continue;
    }

    const tagEnd = findHtmlTagEnd(html, nameEnd);
    cursor = tagEnd === -1 ? html.length : tagEnd + 1;
    text += " ";
  }

  return collapseWhitespace(text).trim();
}

export function looksLikeChallengePage(html) {
  if (!html) return true;
  if (html.length < 5000) return true;
  const head = html.slice(0, 4096);
  if (/<title>\s*(Just a moment|Attention Required|Access denied|Please Wait)/i.test(head))
    return true;
  if (/cf-browser-verification|cf-challenge-running|__cf_chl_jschl_tk__/i.test(head)) return true;
  return false;
}

export function firecrawlMarkdownResult(markdown) {
  return {
    type: "markdown",
    markdown: markdown ?? "",
    price: null,
    inStock: true,
    source: "firecrawl",
  };
}

export function firecrawlOutOfStockResult(source = "firecrawl:jsonld-oos") {
  return {
    type: "price-result",
    markdown: "",
    price: null,
    inStock: false,
    source,
  };
}

export function isStructuredPriceResult(result) {
  return result !== null && typeof result === "object" && result.type === "price-result";
}

export function markdownFromScrapeResult(result) {
  if (result !== null && typeof result === "object") return result.markdown ?? "";
  return result ?? "";
}

export function extractJsonLdScriptsFromHtml(html) {
  if (!html) return [];
  const scripts = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const body = match[1].trim();
    if (body) scripts.push(body);
  }
  return scripts;
}
