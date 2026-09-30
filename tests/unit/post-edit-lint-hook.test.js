// Contract tests for .claude/hooks/post-edit-lint.py — DEVS-90.
//
// One script serves both harnesses:
//   - Claude Code sends tool_name "Edit"/"Write" with tool_input.file_path.
//   - Codex sends tool_name "apply_patch" with the patch text in tool_input.command
//     (no file_path); paths in the patch are relative to the payload's cwd.
// Both harnesses drop plain stdout from PostToolUse hooks, so findings must be
// emitted as hookSpecificOutput.additionalContext JSON. A clean edit is silent.
//
// Each test writes scratch files into a temp dir inside the repo (files outside
// the repo root are deliberately skipped by the hook) and pipes a synthetic
// payload to the script.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const hook = join(repoRoot, ".claude/hooks/post-edit-lint.py");

const BAD_MD = "#  Heading with two spaces\n";
const CLEAN_MD = "# Clean heading\n\nSome text.\n";

let dir;

function runHook(payload) {
  const res = spawnSync("python3", [hook], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    cwd: repoRoot,
    timeout: 60000,
  });
  assert.equal(res.status, 0, `hook exited ${res.status}: ${res.stderr}`);
  return res.stdout.trim();
}

function contextOf(stdout) {
  assert.notEqual(stdout, "", "expected JSON output, got nothing");
  const out = JSON.parse(stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  return out.hookSpecificOutput.additionalContext;
}

function scratch(name, body) {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

describe("post-edit-lint hook", () => {
  before(() => {
    dir = mkdtempSync(join(repoRoot, ".tmp-hooktest-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("Claude Edit on a Markdown file with a violation surfaces markdownlint findings", () => {
    const file = scratch("bad.md", BAD_MD);
    const ctx = contextOf(runHook({ tool_name: "Edit", tool_input: { file_path: file } }));
    assert.match(ctx, /MD019|MD\d{3}/);
  });

  test("Claude Write on a clean Markdown file is silent", () => {
    const file = scratch("clean.md", CLEAN_MD);
    assert.equal(runHook({ tool_name: "Write", tool_input: { file_path: file } }), "");
  });

  test("invalid JSON file is reported", () => {
    const file = scratch("broken.json", "{ not json");
    const ctx = contextOf(runHook({ tool_name: "Write", tool_input: { file_path: file } }));
    assert.match(ctx, /JSON SYNTAX ERROR in broken\.json/);
  });

  test("JavaScript syntax error is reported", () => {
    const file = scratch("broken.js", "const = ;\n");
    const ctx = contextOf(runHook({ tool_name: "Edit", tool_input: { file_path: file } }));
    assert.match(ctx, /SYNTAX ERROR in broken\.js/);
  });

  test("Codex apply_patch: files named in the patch are linted relative to cwd", () => {
    scratch("patched.md", BAD_MD);
    scratch("patched-clean.md", CLEAN_MD);
    const rel = relative(repoRoot, dir);
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${rel}/patched.md`,
      "@@",
      "-old",
      "+#  Heading with two spaces",
      `*** Add File: ${rel}/patched-clean.md`,
      "+# Clean heading",
      "*** End Patch",
    ].join("\n");
    const ctx = contextOf(
      runHook({ tool_name: "apply_patch", cwd: repoRoot, tool_input: { command: patch } })
    );
    assert.match(ctx, /patched\.md/);
    assert.doesNotMatch(ctx, /patched-clean\.md/);
  });

  test("Codex apply_patch: Move to lints the destination, Delete File is ignored", () => {
    scratch("moved.json", "{ bad");
    const rel = relative(repoRoot, dir);
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${rel}/old-name.json`,
      `*** Move to: ${rel}/moved.json`,
      `*** Delete File: ${rel}/gone.json`,
      "*** End Patch",
    ].join("\n");
    const ctx = contextOf(
      runHook({ tool_name: "apply_patch", cwd: repoRoot, tool_input: { command: patch } })
    );
    assert.match(ctx, /moved\.json/);
    assert.doesNotMatch(ctx, /gone\.json|old-name\.json/);
  });

  test("files outside the repo root are skipped", () => {
    const outside = mkdtempSync(join(tmpdir(), "hooktest-outside-"));
    try {
      const file = join(outside, "bad.md");
      writeFileSync(file, BAD_MD);
      assert.equal(runHook({ tool_name: "Edit", tool_input: { file_path: file } }), "");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("unrelated tools and malformed payloads are silent", () => {
    assert.equal(runHook({ tool_name: "Bash", tool_input: { command: "ls" } }), "");
    const res = spawnSync("python3", [hook], { input: "not json", encoding: "utf-8" });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "");
  });
});
