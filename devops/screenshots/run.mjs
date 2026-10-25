#!/usr/bin/env node
/**
 * Captures the screenshot sets in shots.json with Playwright.
 *
 * Usage:
 *   node devops/screenshots/run.mjs [--set=site|release] [--version=vX.Y.Z] [--shots=a,b] [--record]
 *
 * --set=site (default) writes the committed set to screenshots/.
 * --set=release writes docs/announcements/images/<version>-<shot>.png (gitignored).
 * --record refreshes the recorded API responses from the live API first.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;

/**
 * Parses `--name=value` and `--flag` arguments.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {Record<string, string|boolean>}
 */
function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const split = arg.indexOf("=");
    const name = split === -1 ? arg.slice(2) : arg.slice(2, split);
    if (!/^[a-z]+$/.test(name)) throw new Error(`Unknown argument: ${arg}`);
    args[name] = split === -1 ? true : arg.slice(split + 1);
  }
  return args;
}

/**
 * Checks the arguments and turns them into the environment the capture spec reads.
 * @param {Record<string, string|boolean>} args - Parsed arguments.
 * @returns {Record<string, string>}
 */
function captureEnv(args) {
  const set = args.set || "site";
  if (set !== "site" && set !== "release") throw new Error("--set must be site or release");
  if (set === "release" && !VERSION_PATTERN.test(String(args.version || ""))) {
    throw new Error("--set=release needs --version=vX.Y.Z");
  }
  return {
    SHOTS_SET: set,
    SHOTS_VERSION: set === "release" ? args.version : "",
    SHOTS_ONLY: typeof args.shots === "string" ? args.shots : "",
    SHOTS_RECORD: args.record ? "1" : "",
  };
}

let env;
try {
  env = captureEnv(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const result = spawnSync(
  "npx",
  ["playwright", "test", "--config", path.join("devops", "screenshots", "playwright.config.js")],
  { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, ...env } }
);
process.exit(result.status ?? 1);
