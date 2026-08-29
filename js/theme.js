// THEME MANAGEMENT
// =============================================================================

/**
 * Sets application theme and updates localStorage
 *
 * @param {string} theme - 'dark', 'light', 'sepia', or 'slate'
 */
const VALID_THEMES = ["dark", "light", "sepia", "slate"];

const setTheme = (theme) => {
  if (VALID_THEMES.includes(theme)) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem(THEME_KEY, "light");
  }
  if (typeof renderTable === "function") {
    renderTable();
  }
  if (typeof updateAllSparklines === "function") {
    updateAllSparklines();
  }
  // canvas colors are resolved rgb, not var() — the open detail modal must
  // re-resolve them (D-7); DOM surfaces follow the cascade on their own
  window._refreshDetailsModalTheme?.();
  if (typeof scheduleSyncPush === "function") scheduleSyncPush();
};

/**
 * Initializes theme based on user preference and system settings
 */
const initTheme = () => {
  const savedTheme = localStorage.getItem(THEME_KEY);

  if (savedTheme && VALID_THEMES.includes(savedTheme)) {
    setTheme(savedTheme);
  } else {
    // Default to dark theme on first load
    setTheme("dark");
  }
};

/**
 * Cycles through available themes: dark → light → slate → sepia → dark
 */
const toggleTheme = () => {
  const current = localStorage.getItem(THEME_KEY) || "light";
  const cycle = ["dark", "light", "slate", "sepia"];
  const idx = cycle.indexOf(current);
  setTheme(cycle[(idx + 1) % cycle.length]);
};

/**
 * Sets up system theme change listener
 */
const setupSystemThemeListener = () => {
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      // Only auto-switch if no user preference is set
      if (!localStorage.getItem(THEME_KEY)) {
        setTheme(e.matches ? "dark" : "light");
      }
    });
  }
};

/**
 * Read a CSS custom property's resolved value for the active theme.
 * Caller passes the token name without the `--` prefix.
 * Returns the trimmed value or an empty string if unset.
 */
const getThemeColor = (token) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();

// Shared 1x1 canvas for resolveColor — created lazily on first call.
let _colorCanvas = null;

/**
 * Resolve any CSS color string (oklch, color-mix, hsl, lab, etc.) to an
 * `rgb(r, g, b)` string that Chart.js / @kurkle/color can parse.
 * Falls back to the input unchanged if the canvas trick is unavailable.
 */
const resolveColor = (css) => {
  if (!css) return css;
  const s = css.trim();
  if (s.startsWith("#") || s.startsWith("rgb")) return s;
  try {
    if (!_colorCanvas) {
      _colorCanvas = document.createElement("canvas");
      _colorCanvas.width = _colorCanvas.height = 1;
    }
    const ctx = _colorCanvas.getContext("2d");
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a < 255 ? `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})` : `rgb(${r}, ${g}, ${b})`;
  } catch (_e) {
    return s;
  }
};

/**
 * Read a CSS token and resolve to an rgb/rgba string safe for Chart.js.
 * Use this instead of getThemeColor when the value feeds into Chart.js
 * datasets, scales, or tooltip config — Chart.js cannot parse oklch or
 * color-mix strings.
 */
const getThemeColorRGB = (token) => resolveColor(getThemeColor(token));

/**
 * True if the active theme renders as a dark UI (dark or slate).
 * Use to gate dark-only chart palettes, sparkline colors, etc.
 */
const isDarkTheme = () => {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" || theme === "slate";
};

// Expose theme controls globally for inline handlers and fallbacks
window.setTheme = setTheme;
window.toggleTheme = toggleTheme;
window.initTheme = initTheme;
window.getThemeColor = getThemeColor;
window.getThemeColorRGB = getThemeColorRGB;
window.resolveColor = resolveColor;
window.isDarkTheme = isDarkTheme;

// =============================================================================
