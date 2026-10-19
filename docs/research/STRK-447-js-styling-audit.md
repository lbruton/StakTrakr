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

- **Hex and every CSS colour function**: `rgb`/`rgba`, `hsl`/`hsla`, `hwb`, `lab`, `lch`,
  `oklab`, `oklch` and `color()`, case-insensitive. Chromium accepts each one through
  `CSS.supports("color", …)`. The lookbehinds skip HTML entities such as `&#128196;` and
  hyphenated names, so `contrast-color(red)` (a feature test in `js/filters.js`) and
  `color-mix(` don't match.
- **The 148 CSS named colours only**, not any keyword. All 148 were validated with
  `CSS.supports("color", name)` in Chromium. Named colours are matched as a `var()` fallback
  anywhere (`var(--success-color, green)`). They are also matched anywhere inside a string
  literal or template written to a colour `.style` property: `"orange"`,
  `"linear-gradient(red, blue)"`, `` `red` `` and `` `linear-gradient(${a}, navy)` ``.
  Word and hyphen lookarounds keep token names like `var(--gold)` and
  `var(--type-gold-bg)` from matching. Keywords such as `none`, `auto`, `inherit` and
  `transparent` are never flagged. A colour name in any other string isn't flagged either:
  metal keys such as `METALS.GOLD.color = "gold"` in `js/constants.js` are token names, not
  CSS colours.
- **One report per node.** The style-assignment selectors skip values that the hex/function
  or `var()`-fallback selectors already report.

A labelled fixture checked the rule. It hits each of these exactly once: `"Orange"` on
`.style.color`, `var(--x, Green)`, `LAB(…)`, `color(srgb …)`, `hwb(…)`, `oklab(…)`,
`#ABCDEF`, `"linear-gradient(red, blue)"`, `` `red` ``, `` `linear-gradient(${a}, Navy)` ``,
`"var(--x, red)"` and `"linear-gradient(#fff, red)"`. It passes
`.style.background = "none"`, `var(--layout-mode, auto)`, `"var(--gold)"`,
`"var(--type-gold-bg)"`, `getContrastColor(x)`, `&#128196;`, `color-mix(…)`,
`contrast-color(red)`, and `"red"` assigned to a plain variable.

```js
const COLOR_PROPS = "color|backgroundColor|background|borderColor|fill|stroke";
// The 148 CSS named colours (CSS Color 4). Validated with CSS.supports("color", name) in Chromium.
const NAMED_COLORS =
  "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";
// Hex and every CSS colour function, case-insensitive. HTML entities (&#128196;) and
// hyphenated names (contrast-color(, color-mix() are excluded by the lookbehinds.
const LITERAL =
  "/(?<![&\\w])#[0-9a-f]{3,8}\\b|(?<![\\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(/i";
// A named colour used as a var() fallback, e.g. var(--success-color, green).
const NAMED_FALLBACK = `/var\\(--[\\w-]+,\\s*(${NAMED_COLORS})\\s*\\)/i`;
// A named colour anywhere in a value written to a colour style property, e.g. "orange" or
// "linear-gradient(red, blue)". The hyphen/word lookarounds skip token names like var(--gold).
const NAMED_IN_VALUE = `/(?<![\\w-])(${NAMED_COLORS})(?![\\w-])/i`;
// Assignment to el.style.<colour prop>.
const COLOR_ASSIGN = `AssignmentExpression[left.object.property.name='style'][left.property.name=/^(${COLOR_PROPS})$/]`;
// Skip values another selector already reports, so each node is reported once.
const NOT_REPORTED = `:not([value=${LITERAL}]):not([value=${NAMED_FALLBACK}])`;
const NOT_REPORTED_RAW = `:not([value.raw=${LITERAL}]):not([value.raw=${NAMED_FALLBACK}])`;
module.exports = [
  {
    files: ["js/**/*.js"],
    ignores: ["js/theme.js"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: `${COLOR_ASSIGN} > Literal.right[value=${NAMED_IN_VALUE}]${NOT_REPORTED}`,
          message: "Named colour written to .style — use a CSS token or a class (STRK-447).",
        },
        {
          selector: `${COLOR_ASSIGN} > TemplateLiteral.right > TemplateElement[value.raw=${NAMED_IN_VALUE}]${NOT_REPORTED_RAW}`,
          message: "Named colour written to .style — use a CSS token or a class (STRK-447).",
        },
        {
          selector: `Literal[value=${LITERAL}]`,
          message:
            "Colour literal in js/ — read a token via getThemeColor()/resolveColor() or move it to CSS (STRK-447).",
        },
        {
          selector: `Literal[value=${NAMED_FALLBACK}]`,
          message:
            "Named-colour var() fallback in js/ — use a defined token without a literal fallback (STRK-447).",
        },
        {
          selector: `TemplateElement[value.raw=${LITERAL}]`,
          message: "Colour literal in a template — use a CSS token (STRK-447).",
        },
        {
          selector: `TemplateElement[value.raw=${NAMED_FALLBACK}]`,
          message: "Named-colour var() fallback in a template — use a defined token (STRK-447).",
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

## Follow-up issues

| Issue    | Surface                                                                                | Priority |
| -------- | -------------------------------------------------------------------------------------- | -------- |
| STRK-450 | Undefined colour tokens in `image-cache-modal.js`, `spotLookup.js`, `styles.css:12004` | medium   |
| STRK-451 | Retail vendor palette → per-theme `--vendor-<id>` tokens (contrast bug)                | medium   |
| STRK-452 | Metal-tinted surfaces: view-modal header, `_metalRgb`, surface fallbacks               | low      |
| STRK-453 | Chart.js literals: card-view grid/tooltip, ratios-panel and spot fallbacks             | low      |
| STRK-454 | Inline visual styles (`cssText`, template `style=`) → CSS classes                      | low      |
| STRK-455 | ESLint colour-literal guard + undefined-token test (incl. CSS sweep)                   | low      |
