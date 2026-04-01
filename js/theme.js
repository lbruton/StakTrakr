// THEME MANAGEMENT
// =============================================================================

/**
 * Sets application theme and updates localStorage
 *
 * @param {string} theme - 'dark', 'light', or 'sepia'
 */
const setTheme = (theme) => {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem(THEME_KEY, "dark");
  } else if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem(THEME_KEY, "light");
  } else if (theme === "sepia") {
    document.documentElement.setAttribute("data-theme", "sepia");
    localStorage.setItem(THEME_KEY, "sepia");
  } else {
    // Default to light if invalid theme
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem(THEME_KEY, "light");
  }
  if (typeof renderTable === "function") {
    renderTable();
  }
  if (typeof updateAllSparklines === "function") {
    updateAllSparklines();
  }
  if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
};

/**
 * Initializes theme based on user preference and system settings
 */
const initTheme = () => {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const systemPrefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (savedTheme === "hello-kitty") {
    document.documentElement.setAttribute("data-theme", "hello-kitty");
  } else if (savedTheme && ["dark", "light", "sepia"].includes(savedTheme)) {
    setTheme(savedTheme);
  } else {
    // Default to dark theme on first load
    setTheme("dark");
  }
};

/**
 * Cycles through available themes: dark → light → sepia → dark
 */
const toggleTheme = () => {
  const current = localStorage.getItem(THEME_KEY) || "light";
  if (current === "dark") {
    setTheme("light");
  } else if (current === "light") {
    setTheme("sepia");
  } else if (current === "sepia") {
    setTheme("dark");
  } else {
    // Default fallback
    setTheme("light");
  }
};

/**
 * Sets up system theme change listener
 */
const setupSystemThemeListener = () => {
  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
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
