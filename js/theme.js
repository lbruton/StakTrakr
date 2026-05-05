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
  if (typeof scheduleSyncPush === "function") scheduleSyncPush();
};

/**
 * Initializes theme based on user preference and system settings
 */
const initTheme = () => {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const systemPrefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (savedTheme === "hello-kitty") {
    document.documentElement.setAttribute("data-theme", "hello-kitty");
  } else if (savedTheme && VALID_THEMES.includes(savedTheme)) {
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

// Expose theme controls globally for inline handlers and fallbacks
window.setTheme = setTheme;
window.toggleTheme = toggleTheme;
window.initTheme = initTheme;

// =============================================================================
