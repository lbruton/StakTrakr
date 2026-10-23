#!/usr/bin/env node
/**
 * Runs the unit suite. With COVERAGE=1 it also writes coverage/unit-lcov.info,
 * limited to the app scripts the harness evaluates (js/ and sw-router.js).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const args = ["--test"];

if (process.env.COVERAGE === "1") {
  mkdirSync(path.join(REPO_ROOT, "coverage"), { recursive: true });
  args.push(
    "--experimental-test-coverage",
    "--test-coverage-include=js/**",
    "--test-coverage-include=sw-router.js",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    "--test-reporter-destination=coverage/unit-lcov.info"
  );
}
args.push("tests/unit/*.test.js");

const run = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: "inherit" });
process.exit(run.status ?? 1);
