#!/usr/bin/env node
/**
 * Turns a test:changed plan into Tests workflow outputs, or into a job summary.
 *
 * Usage: node devops/testing/ci-plan-outputs.mjs <plan.json> [--summary]
 * Outputs (key=value lines for $GITHUB_OUTPUT): unit, core (space-separated paths, empty
 * when nothing is selected) and shards (a JSON array for the core matrix).
 */

import { existsSync, readFileSync } from "node:fs";

const FULL_CORE = "tests/playwright/core";
const MAX_SHARDS = 4;
// Selected locations per shard before another shard starts.
const LOCATIONS_PER_SHARD = 40;
// Paths reach shell commands, so only plain path characters pass.
const SAFE_PATH = /^[\w./:*-]+$/;
const SUMMARY_LIMIT = 50;

/**
 * Checks that every path is a plain repository path.
 * @param {string[]} paths - Paths from the plan.
 * @returns {string[]}
 */
function safe(paths) {
  for (const p of paths) {
    if (!SAFE_PATH.test(p))
      throw new Error(`refusing a test path with unexpected characters: ${JSON.stringify(p)}`);
  }
  return paths;
}

const [planPath, mode] = process.argv.slice(2);
const plan = existsSync(planPath)
  ? JSON.parse(readFileSync(planPath, "utf-8"))
  : {
      full: true,
      core: [],
      unit: ["tests/unit/*.test.js"],
      reasons: [{ file: "-", why: "no plan" }],
    };
const unit = safe(plan.unit);
// A full plan still names selected specs outside core/, such as an extended spec.
const core = plan.full ? [FULL_CORE, ...safe(plan.core)] : safe(plan.core);

if (mode === "--summary") {
  const lines = ["## Test selection", ""];
  if (plan.full) {
    lines.push("Core: the full suite, because:");
    for (const { file, why } of plan.reasons) lines.push(`- \`${file}\`: ${why}`);
  } else if (core.length) {
    lines.push(`Core: ${core.length} test location(s)`);
    for (const location of core.slice(0, SUMMARY_LIMIT)) lines.push(`- \`${location}\``);
    if (core.length > SUMMARY_LIMIT) lines.push(`- … and ${core.length - SUMMARY_LIMIT} more`);
  } else {
    lines.push("Core: no test selected.");
  }
  lines.push(
    "",
    unit.length ? `Unit: ${unit.map((f) => `\`${f}\``).join(", ")}` : "Unit: no test selected.",
    ""
  );
  console.log(lines.join("\n"));
} else {
  const count = plan.full
    ? MAX_SHARDS
    : Math.min(MAX_SHARDS, Math.max(1, Math.ceil(core.length / LOCATIONS_PER_SHARD)));
  const shards = Array.from({ length: count }, (_, i) => i + 1);
  console.log(`unit=${unit.join(" ")}`);
  console.log(`core=${core.length ? core.join(" ") : ""}`);
  console.log(`shards=${JSON.stringify(shards)}`);
}
