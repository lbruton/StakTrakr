// Single ESLint rule source: `npm run lint`, lint-staged, the Tests check and
// Codacy ESLint9 (with "Use configuration file" on) all read this file.
const js = require("@eslint/js");
const globals = require("globals");
const security = require("eslint-plugin-security");
const staktrakr = require("./devops/eslint/no-colour-literal.cjs");

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
    plugins: { staktrakr },
    rules: {
      "staktrakr/no-colour-literal": "warn",
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
