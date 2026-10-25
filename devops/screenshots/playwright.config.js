import { defineConfig, devices } from "@playwright/test";

// Its own port, so a capture run never shares a server with a test run in the same tree.
const PORT = Number(process.env.SHOTS_PORT) || 8790;

export default defineConfig({
  testDir: ".",
  testMatch: "capture.spec.js",
  // One worker: shots share the recorded API file, and a record run must write it once.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  reporter: "list",
  outputDir: "../../test-results/screenshots",
  use: {
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    deviceScaleFactor: 2,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 } }],
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    cwd: "../..",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    stderr: "ignore",
  },
});
