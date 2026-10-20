# STRK-447 — Styling set from JavaScript: audit

Audit of colour and visual styling that `js/` writes directly, outside the four theme blocks
(`light`, `dark`, `slate`, `sepia`) in `css/styles.css`. Measured on `dev` at `40f84f85`
(v3.36.58, 2026-10-19). The audit changes no runtime code; each fix is a follow-up issue.

## Summary

- **Two real bugs.** Four tokens used in JS are never defined, so they always render their
  literal fallback (STRK-450). The retail vendor palette is tuned for dark themes and is
  used as text in every theme, so vendor names fail contrast in light and sepia (STRK-451).
- **One structural repeat of STRK-446.** The view-modal header picks its text colour in JS
  (`_isLightColor`), out of reach of the theme blocks (STRK-452).
- **The issue's "known first candidate" is already fixed.** `getColor()` in
  `js/inventory-table.js` now returns only the hue. Saturation and lightness come from the
  per-theme `--hashed-color-s` / `--hashed-color-l` tokens (STRK-446).
- The rest is either token-backed already or legitimately in JS. Inline typography and
  spacing strings are hygiene, not theming (STRK-454).

## Counts

| Pattern                                                                               | dev @ 0ca1c33b (issue) | dev @ 40f84f85 (now) |
| ------------------------------------------------------------------------------------- | ---------------------- | -------------------- |
| `.style.X =` assignments                                                              | 627                    | 628                  |
| of which `.style.display`                                                             | 383                    | 386                  |
| Colour-type `.style` writes (`color`, `background*`, `borderColor`, `fill`, `stroke`) | 46                     | 46                   |
| `.style.cssText`                                                                      | 44                     | 44                   |
| `style="…"` inside JS template strings                                                | 124                    | 122                  |
| Colour literals in code (comments excluded)                                           | 71 (incl. comments)    | 50                   |
| `var(--x)` in `js/` naming an undefined token                                         | —                      | 4 tokens, 9 sites    |
| `var(--x)` in `css/styles.css` naming an undefined token                              | —                      | 24 tokens, 64 refs   |

The 50 colour literals are the hits from the ESLint prototype below: 42 hex or colour-function
literals and 8 named-colour `var()` fallbacks (`green`, `orange`, `red`). The hex count matches
the grep once comments and HTML entities (`&#128196;`) are excluded. Named colours are not
caught by a hex or function pattern, so the guard matches them separately. An earlier draft
missed them and also counted the two `spotLookup.js` style writes twice, once per matching
selector.

## Classification

Three classes: **token** reads a CSS custom property and follows the theme; **migrate** is a
literal colour or visual style that belongs in CSS or a token; **legit JS** is one of the
allowed reasons listed further down.

### Colour writes to `.style` (46)

| Site                                                | Value source                                                    | Class         | Issue                    |
| --------------------------------------------------- | --------------------------------------------------------------- | ------------- | ------------------------ |
| `detailsModal.js` 576, 590, 717                     | `_dmCompColors` → `var(--palette/accent)`                       | token         | —                        |
| `detailsModal.js` 978                               | `_dmLocationColor` → same palette map / `--text-muted`          | token         | —                        |
| `filters.js` 784                                    | `getContrastColor` only when `contrast-color()` is unsupported  | legit JS      | —                        |
| `image-cache-modal.js` 111, 114, 224, 246           | `var(--success-color, green)` and similar: **undefined tokens** | migrate (bug) | STRK-450                 |
| `spotLookup.js` 99                                  | `var(--accent, #fbbf24)`: **undefined token**                   | migrate (bug) | STRK-450                 |
| `spotLookup.js` 101, 594                            | reset / `var(--danger, …)`                                      | token         | STRK-450 (drop fallback) |
| `diff-modal.js` 1749, 1753                          | `color-mix` on `getThemeColor("danger")`, flash then reset      | token         | —                        |
| `inventory-table.js` 1295                           | `var(--success)` / `var(--danger)`                              | token         | —                        |
| `ratios-panel.js` 412, 414                          | `resolveCssColor` probe for Chart.js                            | legit JS      | —                        |
| `market-data.js` 617, 1330, 1739                    | `RETAIL_VENDOR_COLORS` literals                                 | migrate (bug) | STRK-451                 |
| `market-data.js` 1306, 1355, 1362, 1366, 1369, 1809 | `var(--text-muted/warning/success/danger)`                      | token         | —                        |
| `retail-view-modal.js` 160, 165                     | vendor colour (literal) via `resolveColor`                      | migrate (bug) | STRK-451                 |
| `settings.js` 4469                                  | vendor colour (literal)                                         | migrate       | STRK-451                 |
| `settings.js` 3710, 3720, 3724, 3727                | `barColor()` → `var(--danger/warning/primary)` and similar      | token         | —                        |
| `utils.js` 1402, 1403                               | contrast probe element (resolves a CSS colour)                  | legit JS      | —                        |
| `viewModal.js` 330, 332, 333                        | `_darkenColor` gradient; text by `_isLightColor` → hex literals | migrate       | STRK-452                 |
| `viewModal.js` 360                                  | metal `color-mix` with literal surface fallbacks                | migrate       | STRK-452                 |
| `viewModal.js` 608, 1610                            | `var(--primary)`                                                | token         | —                        |
| `vault.js` 2277, 2289, 2291, 2305, 2311, 2314       | strength map → `var(--danger/warning/info/success)`             | token         | —                        |

### Colour literals in code (50, from the ESLint prototype)

| File                                 | Hits | What                                                                     | Class         | Issue                     |
| ------------------------------------ | ---- | ------------------------------------------------------------------------ | ------------- | ------------------------- |
| `retail.js`                          | 12   | `RETAIL_VENDOR_COLORS` + `#6c757d` fallback                              | migrate       | STRK-451                  |
| `viewModal.js`                       | 4    | header text hex pair; surface fallbacks                                  | migrate       | STRK-452                  |
| `image-cache-modal.js`               | 8    | named fallbacks `green`/`orange`/`red` on undefined `--*-color` tokens   | migrate (bug) | STRK-450                  |
| `image-cache-modal.js`               | 2    | `#888` fallback on the defined `--text-secondary` (lines 294, 297)       | token         | STRK-450 (drop fallbacks) |
| `spotLookup.js`                      | 2    | `#fbbf24` on undefined `--accent` (bug); `#dc3545` on defined `--danger` | migrate       | STRK-450                  |
| `utils.js`                           | 3    | `getContrastColor` black/white result                                    | legit JS      | —                         |
| `ratios-panel.js`                    | 3    | dead fallbacks after reading defined tokens                              | migrate       | STRK-453                  |
| `inventory-table.js`                 | 3    | `hsl(hue, var(--hashed-color-s), …)` and `var(--success, #…)` fallbacks  | token         | STRK-455 (drop fallbacks) |
| `card-view.js`                       | 2    | Chart.js grid + tooltip `rgba(...)`                                      | migrate       | STRK-453                  |
| `detailsModal.js`                    | 2    | canvas gradient `rgba(r,g,b,…)` built from a token's RGB                 | token         | —                         |
| `diff-modal-settings.js`             | 2    | `_metalRgb` table → `rgba(...)` gradient                                 | migrate       | STRK-452                  |
| `catalog-api.js`, `cloud-storage.js` | 3    | `var(--danger, #e74c3c)` fallback                                        | token         | STRK-455 (drop fallbacks) |
| `init.js`                            | 2    | "Updating to new version…" screen, written before CSS loads              | legit JS      | —                         |
| `inventory-backup.js`                | 1    | `<style>` of a standalone printable HTML document                        | legit JS      | —                         |
| `spot.js`                            | 1    | `getMetalColor` fallback `#6366f1`                                       | migrate       | STRK-453                  |

`js/theme.js` is excluded: it is the token-to-canvas bridge (`getThemeColorRGB`,
`resolveColor`) and formats `rgb()` strings by design.

### `.style.cssText` (44) and template `style=` (122)

Every colour inside these already reads a token (`--text-muted`, `--text-secondary`,
`--primary`, `--info`, `--warning`, `--danger`, `--bg-secondary`), apart from the `#e74c3c`
fallbacks above. What remains is typography, spacing and opacity written from JS, much of it
duplicated: the compact table header in three places, the market empty-state in three, and
`font-size:0.85em;color:var(--text-secondary)` six times in `js/settings.js`. These are
classed **migrate (hygiene)** and collected in STRK-454. The largest files are
`diff-modal.js` (45 template + 1 `cssText`) and `settings.js` (18 + 19).

### `.style.display` (386) and geometry

Show/hide, popover `top`/`left`, widths computed from data, and `setProperty` of hue
numbers or measured sizes (6 `setProperty` calls). These are behaviour or runtime layout, not
theme, so they are out of scope. A class toggle is preferred for new show/hide code.

## Where styling may stay in JS

This list feeds STRK-420's `DESIGN.md`:

1. **Canvas / Chart.js.** A canvas can't read CSS variables. Read tokens through
   `getThemeColorRGB()` / `resolveColor()` / a computed-style probe. Never use literals.
2. **Hash → hue.** CSS can't hash. JS passes only the hue number, and CSS owns saturation,
   lightness and contrast (`--hashed-color-s/l`, STRK-446).
3. **`contrast-color()` fallback.** JS may compute black/white text only behind a
   `CSS.supports("color", "contrast-color(red)")` check (`CHIP_CONTRAST_IN_CSS`).
4. **Measured geometry and data-driven widths.** Runtime layout values.
5. **Show/hide.** Behaviour. Prefer a class toggle.
6. **Documents rendered outside the app's CSS.** The pre-CSS update screens in `js/init.js`
   and the standalone printable backup HTML in `js/inventory-backup.js`.

## Undefined-token sweep

Method: collect every custom property defined in `css/*.css` and `index.html`, plus the
`setProperty("--x", …)` targets in `js/`. Then list each `var(--x)` in `js/` **and**
`css/` whose `--x` is not in that set. Use POSIX classes (`[[:space:]]`). BSD `sed` reads
`\s` as a literal `s`, which silently mangles names such as `--success`.

```bash
D=$(mktemp)
grep -ohE -- '--[a-zA-Z0-9-]+[[:space:]]*:' css/*.css index.html | grep -oE -- '--[a-zA-Z0-9-]+' | sort -u > "$D"
grep -rhoE "setProperty\([[:space:]]*[\"'\`]--[a-zA-Z0-9-]+" js/*.js | grep -oE -- '--[a-zA-Z0-9-]+' | sort -u >> "$D"
grep -noE 'var\(--[a-zA-Z0-9-]+' js/*.js css/*.css | sed -E 's/var\(//' |
  while IFS=: read -r f l t; do grep -qxF -- "$t" "$D" || echo "$f:$l $t"; done > "$D.out"
for p in js css; do
  echo "$p: $(grep -c "^$p/" "$D.out") refs, $(grep "^$p/" "$D.out" | awk '{print $2}' | sort -u | wc -l | tr -d ' ') tokens"
done
```

On `40f84f85` this prints `js: 9 refs, 4 tokens` and `css: 64 refs, 24 tokens`. The
`file:line token` list is in `$D.out`.

- **`js/`:** `--success-color`, `--warning-color`, `--danger-color` (`image-cache-modal.js`)
  and `--accent` (`spotLookup.js`). Fixed in STRK-450.
- **`css/styles.css`:** 24 tokens and 64 references, mostly Bootstrap-era names
  (`--bs-border-color` ×12, `--border-color` ×7, `--border-color-subtle` ×5, `--bg-hover` ×5,
  `--bs-secondary-color` ×4) plus `--warning-color`, `--primary-dark`, `--danger-rgb` and
  others. Some may rely on their fallback on purpose. STRK-455 triages them and turns the
  sweep into a test.

## Proposed ESLint guard (STRK-455)

Prototyped against `dev` with `npx eslint --no-config-lookup -c <file> "js/**/*.js"`. It
reports 50 hits in 15 files and zero parse errors, one hit per node. What it matches:

- **Hex of the lengths CSS allows (3, 4, 6, 8) and every CSS colour function**: `rgb`/`rgba`,
  `hsl`/`hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch` and `color()`, case-insensitive. A
  five- or seven-digit `#12345` is not a colour and is not flagged. Chromium accepts each
  function through
  `CSS.supports("color", …)`. The lookbehinds skip HTML entities such as `&#128196;` and
  hyphenated names, so `contrast-color(red)` (a feature test in `js/filters.js`) and
  `color-mix(` don't match.
- **The 148 CSS named colours only**, not any keyword. All 148 were validated with
  `CSS.supports("color", name)` in Chromium. Named colours are matched as a `var()` fallback
  anywhere (`var(--success-color, green)`). They are also matched in any string literal or
  template part anywhere on the right-hand side of an assignment to a colour-bearing `.style`
  property, including conditionals and concatenations (`failed ? "red" : "green"`). The
  properties are `color`, any `*Color`
  including multiword names (`backgroundColor`, `caretColor`, `textDecorationColor`,
  `borderInlineStartColor`, …), `background`, every `border*`,
  `outline*`, `boxShadow`, `textShadow`, `fill` and `stroke`. Examples: `"orange"`,
  `"linear-gradient(red, blue)"`, `border = "1px solid red"`, `boxShadow = "0 0 2px blue"`,
  `` `red` `` and `` `linear-gradient(${a}, navy)` ``.
  Word and hyphen lookarounds keep token names like `var(--gold)` and
  `var(--type-gold-bg)` from matching. Keywords such as `none`, `auto`, `inherit` and
  `transparent` are never flagged.
- **Named colours in generated inline styles.** Any string or template part matches when it
  holds a CSS colour declaration whose value names a colour. The properties are the same set
  in kebab case: `color`, any `*-color`, `background`, `border*`, `outline*`, `box-shadow`,
  `text-shadow`, `fill`, `stroke`. Examples: `'<span style="color:red">'`, `` `<td style="border: 1px solid navy">` ``,
  and `cssText = "background-color: white"`. The match stops at `;`, quotes or backticks, so
  it stays within one declaration. A colour name elsewhere in a string isn't flagged:
  prose such as `"Red alert"` and metal keys such as `METALS.GOLD.color = "gold"` in
  `js/constants.js` (token names, not CSS colours) pass.
- **Nothing inside `url(…)`.** This applies to hex, colour functions and named colours alike.
  Asset paths such as `url(/icons/red/status.svg)`, SVG references such as `url(#fade)`
  (whose id reads as 4-digit hex) and inline SVG data URLs such as
  `url("data:image/svg+xml,<svg fill=rgb(1 2 3)>")` are skipped. A quoted URL runs to its
  closing quote, so a `)` inside it (`transform='translate(1 2)'`) doesn't end it early. A
  colour after the closing parenthesis still matches.
- **`style.setProperty()`.** The CSSOM form `el.style.setProperty("color", "red")` is covered
  for the same colour-bearing properties in kebab case, custom `--*-color` properties
  included, with any literal or template part in its arguments checked.
- **One report per node.** Selectors run from most to least specific, and each skips values
  an earlier one already reports.

A labelled fixture checked the rule. It reports each of these exactly once, with no node
reported twice (34 hits):

- `"Orange"` written to `.style.color`
- `var(--x, Green)`, `LAB(…)`, `color(srgb …)`, `hwb(…)`, `oklab(…)`
- `#ABCDEF`, `#abcd`, `#11223344`
- `"linear-gradient(red, blue)"`, `` `red` ``, `` `linear-gradient(${a}, Navy)` ``
- `"var(--x, red)"`, `"linear-gradient(#fff, red)"`
- `style="color:red"`, a template `style="border: 1px solid Navy"`,
  `cssText = "…background-color: white"`, `style="color: var(--x, red)"`,
  `style="caret-color: purple"`
- `.style.border = "1px solid red"`, `.style.outline = "2px dotted navy"`,
  `.style.boxShadow = "0 0 2px blue"`, `` .style.borderLeft = `3px solid ${a} green` ``,
  `.style.caretColor = "orange"`, `.style.textDecorationColor = "red"`,
  `.style.borderInlineStartColor = "Teal"`
- `style="background: url(/a.svg) red"` (the colour after the URL)
- `.style.color = failed ? "red" : "green"` (both branches), `.style.borderColor = "solid " + "navy"`
- `style.setProperty("color", "red")`,
  `style.setProperty("background-color", failed ? "white" : "black")` (both branches),
  ``style.setProperty("--accent-color", `navy`)``

It passes:

- `.style.background = "none"`, `.style.outline = "none"`, `.style.borderRadius = "4px"`,
  `var(--layout-mode, auto)`
- `"var(--gold)"`, `"var(--type-gold-bg)"`, `style="color:var(--gold)"`,
  `style="background:none;color:var(--text-muted)"`
- `#12345`, `#1234567`, `getContrastColor(x)`, `&#128196;`, `color-mix(…)`,
  `contrast-color(red)`
- `style="background: url(/icons/red/status.svg) no-repeat"`,
  `cssText = "background-image: url(/img/gold-bar.png)"`,
  `.style.background = "url(/icons/red/x.svg)"`, `.style.filter = "url(#fade)"`,
  `url("data:image/svg+xml,<svg fill=rgb(1 2 3)>")`, and an `hsl()` inside a
  `backgroundImage` data URL
- quoted data URLs with an inner `)`: `transform='translate(1 2)'` before `fill='rgb(1 2 3)'`,
  and `transform="scale(2)"` before `fill="red"`
- `.style.color = failed ? "var(--danger)" : "var(--success)"`,
  `style.setProperty("width", "red")`, `style.setProperty("color", "var(--text-primary)")`
- the prose `"Red alert: the color is wrong"`, and `"red"` assigned to a plain variable

```js
// Colour-bearing style properties (camelCase): color, any *Color (backgroundColor, caretColor,
// accentColor, textDecorationColor, …), background, every border*, outline*, the shadows,
// fill and stroke. Kept in step with the property list in NAMED_IN_DECL.
const COLOR_PROPS =
  "color|[a-z][A-Za-z]*Color|background|border[A-Za-z]*|outline[A-Za-z]*|boxShadow|textShadow|fill|stroke";
// The 148 CSS named colours (CSS Color 4). Validated with CSS.supports("color", name) in Chromium.
const NAMED_COLORS =
  "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";
// The same colour-bearing properties in kebab case, for CSS text and setProperty().
const KEBAB_PROPS =
  "color|[a-z-]+-color|background|border(-[a-z]+)*|outline(-[a-z]+)*|box-shadow|text-shadow|fill|stroke";
// Nothing inside url(…) is a colour: asset paths (url(/icons/red/x.svg)) and SVG references
// (url(#fade), whose id reads as 4-digit hex) are skipped by this lookbehind.
// A quoted URL runs to its closing quote (it may contain ")", e.g. transform='translate(1 2)');
// an unquoted URL cannot contain an unescaped ")" so it ends at the first one.
const NOT_IN_URL = `(?<!url\\(\\s*(?:"[^"]*|'[^']*|[^)]*))`;
// Hex (only the CSS lengths 3, 4, 6, 8) and every CSS colour function, case-insensitive.
// HTML entities (&#128196;) and hyphenated names (contrast-color(, color-mix() are excluded.
// The url() guard applies to both alternatives (data:image/svg+xml,…fill=rgb(…) is skipped).
const LITERAL = `/${NOT_IN_URL}(?:(?<![&\\w])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])|(?<![\\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\()/i`;
// A named colour used as a var() fallback, e.g. var(--success-color, green).
const NAMED_FALLBACK = `/var\\(--[\\w-]+,\\s*(${NAMED_COLORS})\\s*\\)/i`;
// A named colour inside a CSS declaration in any string: style="color:red", cssText
// "border:1px solid red;", template parts. Stops at ; " ' so it stays in one declaration.
const NAMED_IN_DECL = `/(?<![\\w-])(${KEBAB_PROPS})\\s*:[^;"'\`]*?${NOT_IN_URL}(?<![\\w-])(${NAMED_COLORS})(?![\\w-])/i`;
// A named colour anywhere in a value written to a colour style property, e.g. "orange" or
// "linear-gradient(red, blue)". The hyphen/word lookarounds skip token names like var(--gold).
const NAMED_IN_VALUE = `/${NOT_IN_URL}(?<![\\w-])(${NAMED_COLORS})(?![\\w-])/i`;
// Assignment to el.style.<colour prop>.
const COLOR_ASSIGN = `AssignmentExpression[left.object.property.name='style'][left.property.name=/^(${COLOR_PROPS})$/]`;
// The CSSOM form: el.style.setProperty("color", …) with a colour-bearing kebab-case property
// (custom properties such as "--accent-color" included).
const COLOR_SET = `CallExpression[callee.object.property.name='style'][callee.property.name='setProperty'][arguments.0.value=/^(${KEBAB_PROPS})$/i]`;
// Skip values another selector already reports, so each node is reported once.
const NOT_EARLIER = `:not([value=${LITERAL}]):not([value=${NAMED_FALLBACK}])`;
const NOT_EARLIER_RAW = `:not([value.raw=${LITERAL}]):not([value.raw=${NAMED_FALLBACK}])`;
const NOT_DECL = `:not([value=${NAMED_IN_DECL}])`;
const NOT_DECL_RAW = `:not([value.raw=${NAMED_IN_DECL}])`;
module.exports = [
  {
    files: ["js/**/*.js"],
    ignores: ["js/theme.js"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: `Literal[value=${LITERAL}]`,
          message:
            "Colour literal in js/ — read a token via getThemeColor()/resolveColor() or move it to CSS (STRK-447).",
        },
        {
          selector: `TemplateElement[value.raw=${LITERAL}]`,
          message: "Colour literal in a template — use a CSS token (STRK-447).",
        },
        {
          selector: `Literal[value=${NAMED_FALLBACK}]:not([value=${LITERAL}])`,
          message:
            "Named-colour var() fallback in js/ — use a defined token without a literal fallback (STRK-447).",
        },
        {
          selector: `TemplateElement[value.raw=${NAMED_FALLBACK}]:not([value.raw=${LITERAL}])`,
          message: "Named-colour var() fallback in a template — use a defined token (STRK-447).",
        },
        {
          selector: `Literal[value=${NAMED_IN_DECL}]${NOT_EARLIER}`,
          message:
            "Named colour in a generated inline style — use a CSS token or a class (STRK-447).",
        },
        {
          selector: `TemplateElement[value.raw=${NAMED_IN_DECL}]${NOT_EARLIER_RAW}`,
          message:
            "Named colour in a generated inline style — use a CSS token or a class (STRK-447).",
        },
        {
          // Descendant (space) selectors: any literal or template part anywhere under the
          // assignment, so conditionals and concatenations (failed ? "red" : "green") are covered.
          selector: `${COLOR_ASSIGN} Literal[value=${NAMED_IN_VALUE}]${NOT_EARLIER}${NOT_DECL}`,
          message: "Named colour written to .style — use a CSS token or a class (STRK-447).",
        },
        {
          selector: `${COLOR_ASSIGN} TemplateElement[value.raw=${NAMED_IN_VALUE}]${NOT_EARLIER_RAW}${NOT_DECL_RAW}`,
          message: "Named colour written to .style — use a CSS token or a class (STRK-447).",
        },
        {
          selector: `${COLOR_SET} Literal[value=${NAMED_IN_VALUE}]${NOT_EARLIER}${NOT_DECL}`,
          message:
            "Named colour passed to style.setProperty — use a CSS token or a class (STRK-447).",
        },
        {
          selector: `${COLOR_SET} TemplateElement[value.raw=${NAMED_IN_VALUE}]${NOT_EARLIER_RAW}${NOT_DECL_RAW}`,
          message:
            "Named colour passed to style.setProperty — use a CSS token or a class (STRK-447).",
        },
      ],
    },
  },
];
```

Roll-out: merge at `warn` into `eslint.config.cjs`, and mirror it in `.eslintrc.json`
(dual config, see `.context/review-and-ci.md`). Mark the "legit JS" sites with
`// eslint-disable-next-line no-restricted-syntax -- STRK-447 legit: <reason>`, then raise to
`error` once STRK-451/452/453 merge.

**Limits of the regex prototype.** The selectors above approximate CSS parsing with
lookarounds. Each review round on PR #1607 found another syntax they mis-handled (URLs,
quoting, CSSOM calls, nested expressions). Before raising the rule to `error`, STRK-455
should decide whether to keep the selectors or write a small local ESLint rule. That rule
would take string and template values from colour-bearing `.style` writes, `setProperty`
calls and `style=` / `cssText` strings, and run them through a real CSS value tokenizer such
as `postcss-value-parser`, which handles `url()`, quoting and functions. The fixture cases
listed above become that rule's test suite either way.

## Follow-up issues

| Issue    | Surface                                                                                | Priority |
| -------- | -------------------------------------------------------------------------------------- | -------- |
| STRK-450 | Undefined colour tokens in `image-cache-modal.js`, `spotLookup.js`, `styles.css:12004` | medium   |
| STRK-451 | Retail vendor palette → per-theme `--vendor-<id>` tokens (contrast bug)                | medium   |
| STRK-452 | Metal-tinted surfaces: view-modal header, `_metalRgb`, surface fallbacks               | low      |
| STRK-453 | Chart.js literals: card-view grid/tooltip, ratios-panel and spot fallbacks             | low      |
| STRK-454 | Inline visual styles (`cssText`, template `style=`) → CSS classes                      | low      |
| STRK-455 | ESLint colour-literal guard + undefined-token test (incl. CSS sweep)                   | low      |
