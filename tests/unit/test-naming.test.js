import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const root = fileURLToPath(new URL("../../", import.meta.url));
const issueId = /\b(?:STRK|STAK)-\d+/i;

function checkTitles(node, file, failures) {
  if (!node || typeof node !== "object") return;
  if (node.type === "CallExpression") {
    let callee = node.callee;
    while (callee?.type === "MemberExpression") callee = callee.object;
    const title = node.arguments[0];
    const value =
      title?.type === "Literal"
        ? title.value
        : title?.type === "TemplateLiteral"
          ? title.quasis.map((part) => part.value.cooked).join("")
          : null;
    if (
      ["test", "it", "describe"].includes(callee?.name) &&
      typeof value === "string" &&
      issueId.test(value)
    ) {
      failures.push(`${file}:${title.loc.start.line}: ${value}`);
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => checkTitles(child, file, failures));
    else if (value && typeof value === "object") checkTitles(value, file, failures);
  }
}

test("test filenames, titles and evidence names describe behavior without issue IDs", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--", "tests"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const failures = [];
  for (const file of files) {
    if (issueId.test(path.basename(file))) failures.push(file);
    if (!/\.(?:test|spec)\.[cm]?js$/.test(file)) continue;
    const source = readFileSync(path.join(root, file), "utf8");
    checkTitles(
      parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true }),
      file,
      failures
    );
  }
  assert.deepEqual(failures, [], `Use behavior names:\n${failures.join("\n")}`);
});
