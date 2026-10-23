/**
 * Downloads artifacts that the latest successful `dev` push run of the Tests workflow
 * published, such as the test map and the block file.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Id of the latest successful `dev` push run of the Tests workflow, or "" if none.
 * @param {string} cwd - Repository root for `gh`.
 * @returns {string}
 */
export function latestDevRunId(cwd) {
  return execFileSync(
    "gh",
    [
      "run",
      "list",
      "--workflow",
      "tests.yml",
      "--branch",
      "dev",
      "--event",
      "push",
      "--status",
      "success",
      "--limit",
      "1",
      "--json",
      "databaseId",
      "--jq",
      ".[0].databaseId",
    ],
    { cwd, encoding: "utf-8" }
  ).trim();
}

/**
 * Downloads one artifact of the latest `dev` run into `dir`, replacing older copies.
 * `gh run download` refuses to overwrite a file, so it extracts into a temp folder first.
 * @param {string} name - Artifact name.
 * @param {string} dir - Destination directory.
 * @param {string} cwd - Repository root for `gh`.
 * @returns {boolean} False when no successful `dev` run exists.
 */
export function downloadDevArtifact(name, dir, cwd) {
  const id = latestDevRunId(cwd);
  if (!id) return false;
  mkdirSync(dir, { recursive: true });
  const staging = mkdtempSync(path.join(dir, `.${name}-`));
  try {
    execFileSync("gh", ["run", "download", id, "-n", name, "-D", staging], {
      cwd,
      stdio: "inherit",
    });
    for (const file of readdirSync(staging)) {
      renameSync(path.join(staging, file), path.join(dir, file));
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return true;
}
