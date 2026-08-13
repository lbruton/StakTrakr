#!/usr/bin/env node
/**
 * Fixture tests for htmlToPlainText() — STRK-99 hotfix v3.34.83.
 *
 * Verifies that <nav>, <header>, <footer> blocks are dropped (not just
 * their tag markers) when flattening HTML to plain text for the
 * cf-clearance/Byparr extraction path.
 *
 * Before the fix, bullionexchanges Byparr HTML returned the React shell
 * with a server-rendered spot ticker inside <header>; after dropping
 * JSON-LD via STRK-99, firstInRangePriceProse() matched the FIRST in-range
 * $-value (silver spot ~$75.92 / gold spot ~$4,520) for every coin.
 *
 * Run:  node devops/pollers/shared/price-extract-html-chrome-strip.test.mjs
 */

// ---------------------------------------------------------------------------
// Inline the helper under test. Keep in sync with price-extract.js.
// ---------------------------------------------------------------------------

const CHROME_OR_RAWTEXT_TAGS = new Set(["script", "style", "nav", "header", "footer"]);

const isHtmlWhitespace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const collapseWhitespace = (s) => s.replace(/\s+/g, " ");

function findHtmlTagEnd(html, from) {
  let i = from;
  let inQuote = null;
  while (i < html.length) {
    const c = html[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
    } else if (c === '"' || c === "'") inQuote = c;
    else if (c === ">") return i;
    i++;
  }
  return -1;
}

function findRawTextCloseTag(html, lowerHtml, tagName, from) {
  const closeTag = "</" + tagName;
  let i = from;
  while (i < html.length) {
    const idx = lowerHtml.indexOf(closeTag, i);
    if (idx === -1) return -1;
    const after = idx + closeTag.length;
    if (after >= html.length || /[\s>/]/.test(html[after])) return findHtmlTagEnd(html, after);
    i = after;
  }
  return -1;
}

function htmlToPlainText(html) {
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
      if (!((code >= 97 && code <= 122) || (code >= 48 && code <= 57))) break;
      nameEnd++;
    }
    const tagName = lowerHtml.slice(nameStart, nameEnd);
    // Same partial-name guard as price-extract.js — see Gemini PR #1148 review.
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

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;
function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}
function firstDollarMatch(text) {
  const m = text.match(/\$\s*\d{1,6}(?:,\d{3})*\.\d{2}/);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// Existing-behavior regression: script / style content already dropped.
// ---------------------------------------------------------------------------

assert(
  "1. <script> content dropped",
  htmlToPlainText("before<script>var x = '$1.23';</script>after"),
  "before after"
);

assert(
  "2. <style> content dropped",
  htmlToPlainText("before<style>.a{content:'$2.34';}</style>after"),
  "before after"
);

// ---------------------------------------------------------------------------
// STRK-99 new behavior: nav / header / footer content dropped.
// ---------------------------------------------------------------------------

assert(
  "3. <header> content dropped (spot ticker scenario)",
  htmlToPlainText("<header>Gold $4,520.00 Silver $75.92</header><main>1 oz Maple $77.82</main>"),
  "1 oz Maple $77.82"
);

assert(
  "4. <nav> content dropped (mega-menu links)",
  htmlToPlainText("<nav>Gold Silver Platinum 1/2 oz 1/4 oz</nav><main>1 oz Maple $77.82</main>"),
  "1 oz Maple $77.82"
);

assert(
  "5. <footer> content dropped (legal/ads area)",
  htmlToPlainText("<main>1 oz Maple $77.82</main><footer>Spot Gold $4,520.00</footer>"),
  "1 oz Maple $77.82"
);

assert(
  "6. all three chrome tags stripped together",
  htmlToPlainText(
    "<header>$4,520.00</header><nav>menu</nav><main>$77.82</main><footer>$1.99 Over Spot</footer>"
  ),
  "$77.82"
);

// ---------------------------------------------------------------------------
// Critical assertion: firstDollarMatch on the BE-style structure
// returns the PRODUCT price, not the spot ticker.
// ---------------------------------------------------------------------------

const beStyleHtml = `<!DOCTYPE html>
<html>
<head><title>1 oz Silver Canadian Maple Leaf | Bullion Exchanges</title></head>
<body>
<header>
  <ul class="spot-ticker">
    <li>Gold $4,520.00</li>
    <li>Silver $75.92</li>
    <li>Platinum $1,933.40</li>
    <li>Palladium $1,376.00</li>
  </ul>
</header>
<nav>Silver Gold Platinum Goldbacks Sale</nav>
<main>
  <h1>1 oz Silver Canadian Maple Leaf BU (Random Year)</h1>
  <div class="grid">
    <div>1-24</div><div>$77.82</div><div>$78.61</div><div>$80.93</div>
  </div>
  <div class="grid">
    <div>25-99</div><div>$77.62</div><div>$78.40</div><div>$80.72</div>
  </div>
  <div class="grid">
    <div>500+</div><div>$77.22</div><div>$78.00</div><div>$80.31</div>
  </div>
</main>
<footer>
  Visit Our Blog | Live Market Graphs Gold $4,520.00 Silver $75.92
</footer>
</body>
</html>`;

assert(
  "7. BE-style structure: first $-match is 1-unit Check/Wire ($77.82), not spot",
  firstDollarMatch(htmlToPlainText(beStyleHtml)),
  "$77.82"
);

// ---------------------------------------------------------------------------
// Defensive: tags inside attributes should not be confused with real tags.
// ---------------------------------------------------------------------------

assert(
  "8. data-tag='header' attribute does NOT trigger strip",
  htmlToPlainText('<div data-tag="header">$77.82</div>'),
  "$77.82"
);

// ---------------------------------------------------------------------------
// Gemini PR #1148 review: partial-name guard for custom elements.
// Without this guard, `<nav-bar>...</nav-bar>` would be treated as a `nav`
// open tag because the name-char loop stops at `-`. findRawTextCloseTag
// would not find `</nav>`, and cursor would jump to html.length, silently
// dropping the rest of the document.
// ---------------------------------------------------------------------------

assert(
  "8a. <nav-bar> custom element preserved (not stripped as <nav>)",
  htmlToPlainText("<nav-bar>$77.82</nav-bar><main>$80.00</main>"),
  "$77.82 $80.00"
);

assert(
  "8b. <header-banner> custom element preserved (not stripped as <header>)",
  htmlToPlainText("<header-banner>$77.82</header-banner><div>$80.00</div>"),
  "$77.82 $80.00"
);

assert(
  "8c. <footer1> custom element preserved (not stripped as <footer>)",
  htmlToPlainText("<footer1>$77.82</footer1><div>$80.00</div>"),
  "$77.82 $80.00"
);

assert(
  "8d. real <nav> still stripped when followed by a real custom element",
  htmlToPlainText("<nav>$4,520.00</nav><nav-bar>$77.82</nav-bar>"),
  "$77.82"
);

assert(
  "9. unclosed <header> drops rest of document (graceful)",
  htmlToPlainText("<header>spot $4,520.00 silver $75.92"),
  ""
);

// ---------------------------------------------------------------------------
// Existing-behavior regression: ordinary div/span/section preserved.
// ---------------------------------------------------------------------------

assert(
  "10. <section> content preserved (only listed chrome tags are dropped)",
  htmlToPlainText("<section>price $77.82</section>"),
  "price $77.82"
);

assert("11. <article> content preserved", htmlToPlainText("<article>$77.82</article>"), "$77.82");

assert(
  "12. <aside> content preserved",
  htmlToPlainText("<aside>related $80.00</aside><main>$77.82</main>"),
  "related $80.00 $77.82"
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
