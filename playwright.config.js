import { defineConfig, devices } from "@playwright/test";

// Derive the dev-server port deterministically from the worktree path. Playwright
// re-imports this config in EVERY process (the web-server host + each worker), so
// the port must NOT be random — Math.random() would hand each process a different
// value and the workers would hit a port nothing is serving. Hashing process.cwd()
// gives every process in one run the same port, while two different worktrees /
// concurrent sessions get different ports and never collide on a shared server
// (the cross-session contention that produces scattered "random" failures).
// PW_PORT overrides for CI or focused debugging.
const portFromCwd = () => {
  let h = 0;
  for (const ch of process.cwd()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return 30000 + ((h >>> 0) % 30000); // 30000–59999
};
const PORT = Number(process.env.PW_PORT) || portFromCwd();

export default defineConfig({
  testDir: "./tests/playwright",
  fullyParallel: false,
  workers: process.env.PW_WORKERS ? parseInt(process.env.PW_WORKERS, 10) || 1 : 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Safe to reuse this worktree's own server across local runs (faster iteration);
    // the per-worktree port means an "existing" server can only ever be our own, never
    // another session's, so the cross-session reuse footgun stays closed. CI starts fresh.
    reuseExistingServer: !process.env.CI,
    stderr: "ignore",
  },
});
