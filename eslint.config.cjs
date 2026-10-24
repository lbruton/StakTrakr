// Single ESLint rule source: `npm run lint`, lint-staged, the Tests check and
// Codacy ESLint9 (with "Use configuration file" on) all read this file.
const js = require("@eslint/js");
const globals = require("globals");
const security = require("eslint-plugin-security");

// Codacy skips the paths in .codacy.yml; keep this list in step with it.
const CODACY_EXCLUDES = [
  ".agents/**",
  ".archive/**",
  "docs/specs/**",
  ".codex/**",
  ".codacy/**",
  ".claude/**",
  ".gemini/**",
  ".github/**",
  ".spec-workflow/**",
  ".jules/**",
  "deprecated/**",
  "vendor/**",
  "playground/**",
  "devops/firecrawl-docker/**",
];

const DIALOG_BAN = [
  "error",
  { name: "alert", message: "Use showAppAlert/appAlert instead of native alert()." },
  { name: "confirm", message: "Use showAppConfirm/appConfirm instead of native confirm()." },
  { name: "prompt", message: "Use showAppPrompt/appPrompt instead of native prompt()." },
];

const UNUSED_VARS_OPTIONS = {
  args: "after-used",
  argsIgnorePattern: "^_",
  caughtErrors: "none",
  ignoreRestSiblings: true,
};

// Colour literal guard for js/: theme colours come from CSS tokens, read through
// getThemeColor()/resolveColor() in js/theme.js. Cases: tests/unit/js-theme-tokens.test.js.
// Colour-bearing style properties (camelCase): color, any *Color, background, border*,
// outline*, the shadows, fill and stroke. Kept in step with KEBAB_PROPS.
const COLOR_PROPS =
  "color|[a-z][A-Za-z]*Color|background|border[A-Za-z]*|outline[A-Za-z]*|boxShadow|textShadow|fill|stroke";
// The 148 CSS named colours (CSS Color 4).
const NAMED_COLORS =
  "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";
const KEBAB_PROPS =
  "color|[a-z-]+-color|background|border(-[a-z]+)*|outline(-[a-z]+)*|box-shadow|text-shadow|fill|stroke";
// Nothing inside url(…) is a colour. A quoted URL runs to its closing quote and may hold ")";
// an unquoted URL ends at the first ")".
const NOT_IN_URL = `(?<!url\\(\\s*(?:"[^"]*|'[^']*|[^)]*))`;
// Hex of the CSS lengths (3, 4, 6, 8) and every CSS colour function. The lookbehinds skip
// HTML entities (&#128196;) and hyphenated names (contrast-color(, color-mix().
const LITERAL = `/${NOT_IN_URL}(?:(?<![&\\w])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])|(?<![\\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\()/i`;
const NAMED_FALLBACK = `/var\\(--[\\w-]+,\\s*(${NAMED_COLORS})\\s*\\)/i`;
// A named colour in one CSS declaration of any string; it stops at ; " ' and `.
const NAMED_IN_DECL = `/(?<![\\w-])(${KEBAB_PROPS})\\s*:[^;"'\`]*?${NOT_IN_URL}(?<![\\w-])(${NAMED_COLORS})(?![\\w-])/i`;
// The hyphen and word lookarounds keep token names such as var(--gold) from matching.
const NAMED_IN_VALUE = `/${NOT_IN_URL}(?<![\\w-])(${NAMED_COLORS})(?![\\w-])/i`;
const COLOR_ASSIGN = `AssignmentExpression[left.object.property.name='style'][left.property.name=/^(${COLOR_PROPS})$/]`;
const COLOR_SET = `CallExpression[callee.object.property.name='style'][callee.property.name='setProperty'][arguments.0.value=/^(${KEBAB_PROPS})$/i]`;
// Selectors run from most to least specific; each skips what an earlier one reports.
const NOT_EARLIER = `:not([value=${LITERAL}]):not([value=${NAMED_FALLBACK}])`;
const NOT_EARLIER_RAW = `:not([value.raw=${LITERAL}]):not([value.raw=${NAMED_FALLBACK}])`;
const NOT_DECL = `:not([value=${NAMED_IN_DECL}])`;
const NOT_DECL_RAW = `:not([value.raw=${NAMED_IN_DECL}])`;
const USE_TOKEN = "use a CSS token, read through getThemeColor()/resolveColor() in canvas code";

const COLOUR_LITERAL_GUARD = [
  "warn",
  { selector: `Literal[value=${LITERAL}]`, message: `Colour literal in js/: ${USE_TOKEN}.` },
  {
    selector: `TemplateElement[value.raw=${LITERAL}]`,
    message: `Colour literal in a template: ${USE_TOKEN}.`,
  },
  {
    selector: `Literal[value=${NAMED_FALLBACK}]:not([value=${LITERAL}])`,
    message: "Named-colour var() fallback: use a defined token without a literal fallback.",
  },
  {
    selector: `TemplateElement[value.raw=${NAMED_FALLBACK}]:not([value.raw=${LITERAL}])`,
    message: "Named-colour var() fallback: use a defined token without a literal fallback.",
  },
  {
    selector: `Literal[value=${NAMED_IN_DECL}]${NOT_EARLIER}`,
    message: "Named colour in a generated inline style: use a CSS token or a class.",
  },
  {
    selector: `TemplateElement[value.raw=${NAMED_IN_DECL}]${NOT_EARLIER_RAW}`,
    message: "Named colour in a generated inline style: use a CSS token or a class.",
  },
  {
    // Descendant selectors cover conditionals and concatenations (failed ? "red" : "green").
    selector: `${COLOR_ASSIGN} Literal[value=${NAMED_IN_VALUE}]${NOT_EARLIER}${NOT_DECL}`,
    message: "Named colour written to .style: use a CSS token or a class.",
  },
  {
    selector: `${COLOR_ASSIGN} TemplateElement[value.raw=${NAMED_IN_VALUE}]${NOT_EARLIER_RAW}${NOT_DECL_RAW}`,
    message: "Named colour written to .style: use a CSS token or a class.",
  },
  {
    selector: `${COLOR_SET} Literal[value=${NAMED_IN_VALUE}]${NOT_EARLIER}${NOT_DECL}`,
    message: "Named colour passed to style.setProperty: use a CSS token or a class.",
  },
  {
    selector: `${COLOR_SET} TemplateElement[value.raw=${NAMED_IN_VALUE}]${NOT_EARLIER_RAW}${NOT_DECL_RAW}`,
    message: "Named colour passed to style.setProperty: use a CSS token or a class.",
  },
];

module.exports = [
  {
    ignores: [
      ...CODACY_EXCLUDES,
      "**/node_modules/**",
      ".worktrees/**",
      "test-results/**",
      "playwright-report/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      // Flags every obj[key] lookup; Semgrep covers prototype pollution.
      "security/detect-object-injection": "off",
      "no-unused-vars": ["error", UNUSED_VARS_OPTIONS],
      // An empty catch is the deliberate best-effort pattern (storage, DOM cleanup).
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Browser scripts loaded by <script> tags share one global scope, so
    // cross-file references look undefined and top-level names look unused.
    files: ["js/**/*.js", "sw.js", "sw-router.js", "data/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": ["error", { ...UNUSED_VARS_OPTIONS, vars: "local" }],
      "no-restricted-globals": DIALOG_BAN,
    },
  },
  {
    // js/theme.js is the token-to-canvas bridge and formats rgb() strings by design.
    files: ["js/**/*.js"],
    ignores: ["js/theme.js"],
    rules: {
      "no-restricted-syntax": COLOUR_LITERAL_GUARD,
    },
  },
  {
    files: ["devops/**/*.{js,mjs}", "functions/**/*.js", "tests/**/*.js", "*.{js,mjs}"],
    ignores: ["sw.js", "sw-router.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // Playwright page.evaluate() callbacks run in the browser.
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // Repo tooling reads paths it builds itself, never user input.
    files: ["devops/**/*.{js,mjs}", "tests/**/*.js"],
    rules: {
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  {
    // Unit tests evaluate the browser scripts and page.evaluate() callbacks
    // reference app globals, so those names are undeclared here.
    files: ["tests/unit/**/*.js", "tests/playwright/**/*.js"],
    rules: {
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
];
