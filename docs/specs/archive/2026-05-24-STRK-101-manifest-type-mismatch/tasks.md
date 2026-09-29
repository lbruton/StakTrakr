---
sketch: STRK-101-manifest-type-mismatch
phase: tasks
created: 2026-05-23
approved: 2026-05-23
---

# STRK-101 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it — this is setup work, not a stop-the-world gate._

- [x] **0.1** — Ensure sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows the project-required worktree and branch. Working directory is that worktree, not the main checkout. StakTrakr convention: invoke `/start-patch` to claim version lock and create worktree at `.worktrees/patch-<version>/`.
  - **If the worktree does not exist yet:** Invoke `/start-patch` to create it.
  - **Leverage:** `/start-patch` skill.

## Sprint Cohort A — Foundation (sequential)

_Scaffolding that later cohorts depend on. The normalization helper is the only shared primitive._

 - [x] **A.1** — Add `_normalizeItemChangeType()` private helper to `cloud-sync.js`
   - **File(s):** `js/cloud-sync.js`
   - **Acceptance:** A private function `_normalizeItemChangeType(type)` exists in `cloud-sync.js` that: (1) returns `"add"` for `"item-add"`, `"edit"` for `"item-edit"`, `"delete"` for `"item-delete"`; (2) returns `"setting"` unchanged for `"setting"`; (3) returns the input unchanged for any unrecognized type; (4) guards against `null`/`undefined` input (returns `""` or the input without throwing). Uses `String.prototype.startsWith("item-")` or `/^item-/` regex — not a naive `.replace`. No consumers wired yet — this is the stub.
   - **Leverage:** Approach D-1. Discovery Constraint 1 (producer types frozen, consumer-side fix).
   - **Maps to:** AC-1 (foundation for all type normalization)

## Sprint Cohort B — Tests · RED (parallel-safe)

_TDD red phase. Write tests that encode the acceptance criteria BEFORE implementation. Tests MUST fail at this point — a passing test means it's not actually testing the new behavior. The three test files are independent and touch no shared files._

- [x] **B.1 [P]** — Write failing tests for manifest type normalization and type-priority merge
  - **File(s):** `tests/playwright/cloud-sync-manifest-type.spec.js` (new)
  - **Acceptance:** Tests cover all four manifest consumer sites through exported flows (`pushSyncVault` / `pullSyncVault`) with Dropbox mocks — NOT by calling private functions directly. Specific test cases:
    - Build explicit page-level Dropbox route/fetch mocks for `https://api.dropboxapi.com/2/*` and `https://content.dropboxapi.com/2/files/download` / `upload`, returning stub manifest and vault payloads so the test suite never reaches denied Dropbox hosts.
    - `_buildDiffFromManifest()` correctly classifies `"item-add"` → added, `"item-edit"` → modified, `"item-delete"` → deleted (AC-1, AC-2, AC-3)
    - `buildAndUploadManifest()` summary reports accurate counts for adds, edits, deletes (AC-4)
    - Manifest conflict detection recognizes `"item-edit"` entries (AC-1)
    - Type-priority merge: edit+delete → delete, add+edit → add, add+delete → delete, delete+add → add (Discovery Constraint 5)
    - Vault-first fallback still works when manifest is unavailable (AC-7 — existing behavior preserved)
    - All new tests fail (red) because the consumer sites still check unprefixed types and type-priority merge doesn't exist yet.
  - **Leverage:** Existing Dropbox connection setup in `tests/playwright/attachments/cloud-sync.spec.js` only seeds localStorage; add the route mocks above for upload/download behavior. Private functions are NOT exported — tests must drive through `pushSyncVault`/`pullSyncVault` or evaluate behavior via `page.evaluate` on exported symbols.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-7

- [x] **B.2 [P]** — Write failing tests for ZIP JSON field completeness
  - **File(s):** `tests/playwright/attachments/backup-zip.spec.js` (extend existing)
  - **Acceptance:** New test(s) call the real `createBackupZip()` (via `window.createBackupZip` — confirmed exported at `inventory-backup.js:889`) with a seed item containing all 13 missing DIFF_FIELDS entries, then parse `inventory_data.json` from the output ZIP and assert every DIFF_FIELDS entry is present with the correct value. Specific fields verified: `purchasePrice`, `retailPrice`, `collectable`, `ignorePatternImages`, `currency`, `obverseImageFrame`, `reverseImageFrame`, `lastModified`, `capsule`, `capsuleNotes`, `numistaData`, `fieldMeta`, `attachments`. All new tests fail (red) because the allowlist currently omits these 13 fields.
  - **Leverage:** Existing `backup-zip.spec.js` test structure (lines 60–88) for seed/mock pattern. `DIFF_FIELDS` array at `js/diff-engine.js:32–89` is the canonical source.
  - **Maps to:** AC-5

- [x] **B.3 [P]** — Write failing tests for CSV frame columns
  - **File(s):** `tests/playwright/csv-frame-columns.spec.js` (new)
  - **Acceptance:** Tests verify both CSV exports include `Obverse Frame` and `Reverse Frame` columns with correct values:
    - ZIP CSV: seed item with `obverseImageFrame: "rectangle"`, `reverseImageFrame: "circle"`, export via `createBackupZip()`, parse `inventory_export.csv`, assert columns present with correct values.
    - Standalone CSV: seed item, export via `window.exportInventoryCSV` (confirmed exported at `inventory-import.js:1713–1714`), parse output, assert columns present with correct values.
    - Test wording must NOT imply CSV round-trip losslessness — frame data is NOT preserved through CSV import (approach D-5).
    - For standalone CSV, call `window.exportInventoryCSV()` / `buildCsvContent()` directly and strip the leading `# exportOrigin:` comment line before parsing with Papa.
    - Parse both CSV outputs and verify `Obverse Frame` and `Reverse Frame` appear immediately after `Reverse Image URL` with values populated from the seeded item.
    - All new tests fail (red) because neither CSV export currently includes frame columns.
  - **Leverage:** Existing image-frame test patterns in `tests/playwright/image-frame-override.spec.js`; `window.exportInventoryCSV` returns a CSV string directly, so standalone CSV tests do not need download interception.
  - **Maps to:** AC-6

## Sprint Cohort C — Implementation · GREEN (sequential then parallel)

_TDD green phase. Write the minimum code that makes all Cohort B tests pass._

- [x] **C.1** — Wire `_normalizeItemChangeType()` to all consumer sites + add type-priority merge
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** All Cohort B.1 tests pass (green). Specifically:
    - **Write-side normalization** (line ~1056): `changesByKey[key].type` stores the normalized (unprefixed) type so new manifests written to Dropbox carry clean types.
    - **Type-priority merge** (lines ~1052–1058): When multiple changeLog entries exist for the same `itemKey`, replace first-wins assignment with a chronological pairwise merge helper such as `_mergeItemChangeTypes(existingType, incomingType)`, operating on raw prefixed types before normalization. Ensures: edit+delete → delete, add+edit → add, add+delete → delete (safe no-op), delete+add → add (re-addition), edit+add → add. Handle `delete+edit` defensively or document it as unreachable because a deleted item cannot later receive an edit in the same change log. Do not use a static `Math.max`/priority-map comparison, because `delete+add` and `add+delete` intentionally resolve differently.
    - **Consumer 1 — summary counting** (lines ~1069–1082): `entryType` derived via `_normalizeItemChangeType(entry.type)` before comparison. Summary counts now correct.
    - **Consumer 2 — diff classification** (lines ~2933/2935/2949): `change.type` normalized via `_normalizeItemChangeType()` before comparison. Returns populated arrays for item changes.
    - **Consumer 4 — conflict detection** (line ~3601): `mc.type` normalized before `=== "edit"` check.
    - Consumer 3 (`_mNoChanges` guard at lines ~3287–3290) is fixed implicitly — it evaluates the arrays from Consumer 2.
    - `_deferredVaultRestore` (line ~3026) is NOT modified — it uses DiffModal's independent type vocabulary.
    - Backward compatibility: read-side normalization handles both prefixed `"item-*"` types (from older manifests in Dropbox) and unprefixed types (from new manifests).
  - **Depends on:** A.1, B.1
  - **Leverage:** Approach D-1 (hybrid normalization), D-2 (type-priority merge `delete > add > edit`). Discovery Cascade Map (4 consumer sites).
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-7

- [x] **C.2 [P]** — Extend ZIP JSON allowlist + add ZIP CSV frame columns
  - **File(s):** `js/inventory-backup.js`
  - **Acceptance:** All Cohort B.2 and B.3 (ZIP CSV portion) tests pass (green). Specifically:
    - **ZIP JSON** (lines ~26–61): `inventory_data` map extended with all 13 missing DIFF_FIELDS entries using unconditional defaults matching existing style: arrays → `|| []`, objects → `|| null`, scalars → `|| ""` / `|| 0` / `|| false`. Fields added: `purchasePrice` (`|| 0`), `retailPrice` (`|| 0`), `collectable` (`|| false`), `ignorePatternImages` (`|| false`), `currency` (`|| ""`), `obverseImageFrame` (`|| ""`), `reverseImageFrame` (`|| ""`), `lastModified` (`|| ""`), `capsule` (`|| ""`), `capsuleNotes` (`|| ""`), `numistaData` (`|| null`), `fieldMeta` (`|| null`), `attachments` (`|| []`). Comment referencing `js/diff-engine.js:DIFF_FIELDS` as canonical source. Clarifying comment on `retailPrice` vs CSV "Retail Price" column (`marketValue`). Existing identity fields (`uuid`, `serial`) and conditional `paymentMethod` spread unchanged.
    - **ZIP CSV** (headers ~line 159, rows ~line 209): `Obverse Frame` and `Reverse Frame` columns inserted after `Reverse Image URL`. Values: `item.obverseImageFrame || ""`, `item.reverseImageFrame || ""`.
  - **Depends on:** B.2, B.3
  - **Leverage:** Approach D-3 (static allowlist, unconditional defaults), D-4 (frame columns both CSVs). Discovery ZIP JSON Field Gap Analysis (13 fields).
  - **Maps to:** AC-5, AC-6

- [x] **C.3 [P]** — Add standalone CSV frame columns
  - **File(s):** `js/inventory-import.js`
  - **Acceptance:** All Cohort B.3 (standalone CSV portion) tests pass (green). Specifically:
    - **Standalone CSV** (headers ~line 1092, rows ~line 1149): `Obverse Frame` and `Reverse Frame` columns inserted after `Reverse Image URL`. Values: `i.obverseImageFrame || ""`, `i.reverseImageFrame || ""`.
  - **Depends on:** B.3
  - **Leverage:** Approach D-4 (frame columns both CSVs). Discovery CSV Frame Column Gap table.
  - **Maps to:** AC-6

> **Parallelization note:** C.2 and C.3 are marked `[P]` — they touch different files (`inventory-backup.js` vs `inventory-import.js`) with no shared symbols or data structures. C.1 must complete first because it's the only task touching `cloud-sync.js` and its tests (B.1) are independent of the backup/CSV tests.

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test`. All existing tests pass; all new tests from Cohort B pass (green after Cohort C implementation).
  - If anything fails: fix the implementation, not the test. Tests are the spec.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **StakTrakr note:** After scan, run `git diff .codacy/codacy.yaml` and revert any tool additions before commit (CLI side effect per CLAUDE.md).

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - **Repo boundary:** `tasks.md` lives in the DocVault repo, not the StakTrakr patch worktree. Do not stage this file into the StakTrakr app PR. Commit the stamp via `/vault-update` or as part of `/sketch archive` after the app PR flow completes.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-7), write exactly one line:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` or `- [x] AC-N — verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump + spot bundle**
  - **File:** project version files (6 files per `/release` skill)
  - **MUST invoke `/release patch`** as a skill.
  - **MUST invoke `/update-spot-bundle`** before the version bump PR (per CLAUDE.md pre-flight). Run in the same closing-task cohort. Stage and commit bundle files before `gh pr create`.

- [x] **CLOSE-5. Vault update**
  - **MUST invoke `/vault-update`** as a skill — the skill audits whether foundation docs need updating. Cloud sync architecture docs may need a note about the type normalization fix.
  - Do not mark the Plane issue Done here. Plane closure waits until the PR has merged and the sketch has been archived.

- [x] **CLOSE-6. Open PR**
  - Title: `v<claimed-version> — STRK-101: manifest-first sync silently drops item field edits`
  - Target: `dev`; branch: `patch/<claimed-version>`.
  - Body must include: link to source issue, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-101-manifest-type-mismatch/`), test plan checklist.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill.
  - Coverage: scan **both** inline diff threads AND review-body findings (Codacy, Copilot, CodeRabbit).

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-101`** as a skill.

- [ ] **CLOSE-9. Mark Plane issue Done** (after PR merges and sketch archive completes)
  - Mark the source issue Done in Plane: `mcp__plane__update_issue` to state "Done".
  - Acceptance: Plane closure happens only after the PR is merged and `/sketch archive STRK-101` has completed.

---

> **Multi-model dispatch hint:** Cohort B tasks marked `[P]` can be sent to different models in parallel — they touch three independent test files. Suggested split: B.1 (manifest type tests — complex, benefits from a strong model) to Claude/Opus, B.2 (backup-zip extension — needs to understand existing test harness) to Codex, B.3 (CSV frame tests — straightforward) to Gemini/Kimi. Cohort C's C.2 and C.3 are also `[P]` across two files. The TDD boundary between Cohort B (red) and Cohort C (green) is the natural model-routing seam.

## Review Archive — tasks (2026-05-23)

_Reconciled by /sketch reconcile on 2026-05-23. Original reviewer marks preserved below for audit._

### Codex

#### Inline Marks

> CODEX: The exported-flow constraint is right, but the "existing Dropbox mock patterns" reference is load-bearing and currently thin. `tests/playwright/attachments/cloud-sync.spec.js:6-18` only seeds Dropbox connection localStorage and does not mock Dropbox upload/download routes; `window.pushSyncVault` / `window.pullSyncVault` are exported at `js/cloud-sync.js:4286-4287`, while the private helpers are not. Add an explicit task acceptance for building the Dropbox route/fetch mocks needed to exercise those exported flows, or B.1 can pass by drifting back toward private-function seams.
> CODEX: This file is in the DocVault repo, not the StakTrakr patch worktree, so the stamp is a cross-repo artifact. The StakTrakr app flow opens a draft PR from `patch/<VERSION>` after the version bump (`AGENTS.md:127-130`), while this `tasks.md` edit must be committed by `/vault-update` or `/sketch archive`. Add that routing to the acceptance so the implementer does not try to stage DocVault paths into the app PR.
> CODEX: This step closes STRK-101 before the PR is even opened in CLOSE-6. Project ordering says version bump → spot bundle → `gh pr create` → post-merge archive → mark Plane Done, and explicitly says never mark Plane issues Done before PR merge (`CLAUDE.md:159-169`). Split this into vault update here and a terminal Plane-Done step after CLOSE-8 `/sketch archive`.
> CODEX: The title format does not match the StakTrakr versioned patch convention. `AGENTS.md:98-100` requires the PR title to be `vX.YY.ZZ — ...` against `dev`, after `/release patch` has claimed the real version; use `v<claimed-version> — STRK-101: manifest-first sync silently drops item field edits` rather than a conventional-commit title.

**Verified**

- Resolved the active sketch at `DocVault/Projects/StakTrakr/sketches/STRK-101-manifest-type-mismatch/tasks.md` and confirmed no prior unreconciled `CODEX` review was present.
- Checked the approach file map against task paths: `js/cloud-sync.js`, `js/inventory-backup.js`, `js/inventory-import.js`, `tests/playwright/cloud-sync-manifest-type.spec.js`, `tests/playwright/csv-frame-columns.spec.js`, and `tests/playwright/attachments/backup-zip.spec.js` are all represented in `approach.md:37-46`.
- Verified the manifest type mismatch anchors: raw grouped type assignment and unprefixed summary comparisons at `js/cloud-sync.js:1052-1082`, read-side classification at `js/cloud-sync.js:2931-2951`, `_mNoChanges` consuming the classified arrays at `js/cloud-sync.js:3287-3290`, and conflict detection comparing `mc.type === "edit"` at `js/cloud-sync.js:3598-3601`.
- Verified exported sync entry points exist at `js/cloud-sync.js:4286-4287`, while `buildAndUploadManifest()` and `_buildDiffFromManifest()` remain private (`js/cloud-sync.js:1019`, `js/cloud-sync.js:2925`).
- Verified the ZIP JSON allowlist gap and CSV insertion anchors in `js/inventory-backup.js:26-60`, `js/inventory-backup.js:132-165`, `js/inventory-backup.js:182-210`, `js/diff-engine.js:32-89`, and standalone CSV anchors at `js/inventory-import.js:1064-1102` and `js/inventory-import.js:1121-1149`.
- Verified current release and closeout rules from `AGENTS.md:75-100`, `AGENTS.md:127-132`, `CLAUDE.md:159-169`, and `devops/hooks/check-release-sync.sh:1-37`.

**Top concerns**

1. B.1 asks for exported-flow cloud-sync tests, but the named existing spec only seeds Dropbox connection state; it does not provide Dropbox route/download/upload mocks. The task should require those mocks explicitly so the red tests remain behavior-level without private exports.
2. CLOSE-3 writes to DocVault `tasks.md` from a StakTrakr implementation flow but does not name the repo boundary or how that stamp is committed. Route it through `/vault-update` or archive closeout.
3. CLOSE-5 marks the Plane issue Done before PR creation/merge, which conflicts with the project closing-order rule. Plane closure should move after `/sketch archive` post-merge.

**Unverified assumptions**

- The implementing agent can build stable Dropbox mocks around `pushSyncVault` / `pullSyncVault` without exposing `buildAndUploadManifest()` or `_buildDiffFromManifest()` as test-only globals.
- The new manifest test file belongs at `tests/playwright/cloud-sync-manifest-type.spec.js` rather than beside the existing cloud-sync attachment spec; both paths are workable, but helper import paths and fixture reuse differ.
- `/vault-update` is the intended place to commit the CLOSE-3 verification stamp, rather than leaving it for `/sketch archive` only.
- The `/release patch` skill will substitute the claimed version into the PR title and body before `gh pr create`; the current CLOSE-6 title text does not do that by itself.

### Gemini

#### Inline Marks

> GEMINI: Agreed. Furthermore, since `api.dropboxapi.com` and `content.dropboxapi.com` are explicitly on the `DENIED_HOSTS` list in `tests/playwright/helpers/mocks/audit.js:25-26`, any unmocked fetch calls to Dropbox will fail the test suite immediately. The test setup must use page-level route interception (`page.route()`) for `https://content.dropboxapi.com/2/files/download` and `upload` to bypass the audit policy and return stub manifest/vault payloads.
> GEMINI: Verification of the CSV exports should parse the Papa.unparse output (or mock the download in Playwright) to confirm the new headers are present in the correct columns (directly following 'Reverse Image URL') and the values are properly populated from the seeded items. For standalone CSV, we must also ensure the `# exportOrigin:` comment prepended to the CSV data doesn't throw off parsing.
> GEMINI: Note that a simple static priority comparison (e.g. `Math.max` or `>` using a fixed map) is insufficient because while `edit + delete -> delete` and `add + edit -> add`, a `delete + add` (re-addition) must resolve to `add` (the later state), whereas `add + delete` resolves to `delete` (or no-op). The implementation must use a chronological pairwise merge state machine or transition function `_mergeItemChangeTypes(existingType, incomingType)` to correctly handle these transitions rather than a static hierarchy comparison.
> GEMINI: To avoid schema clutter, make sure that `numistaData` and `fieldMeta` are initialized to `null` (since they are nested objects) rather than empty objects `{}`, as this matches the existing pattern in `inventory-backup.js` (e.g. `disposition: item.disposition || null`). For `attachments`, using `item.attachments || []` is correct to ensure that the field is serialized as an array rather than `null` for items without attachments.
> GEMINI: Confirming this. Because `tasks.md` resides in `DocVault`, any changes made to it during implementation must not be staged in the `StakTrakr` Git repository. The verification stamp in `tasks.md` should be committed to `DocVault` via the `/vault-update` skill (or as part of `/sketch archive` at the end of the session).
> GEMINI: Yes, marking the Plane issue "Done" in `CLOSE-5` before opening the PR violates the Release Workflow. The Plane issue status change must be deferred until after the PR is merged and the sketch is archived in `CLOSE-8` (as part of the final closeout cohort). We should modify this task to only handle the DocVault foundation doc update, moving the Plane issue transition to a new `CLOSE-9` task.
> GEMINI: Agreed. The PR title must strictly match the StakTrakr release format: `vX.YY.ZZ — STRK-101: manifest-first sync silently drops item field edits`. This is a hard pre-commit hook gate for version syncing.

**Verified**

- Confirmed active sketch directory at `DocVault/Projects/StakTrakr/sketches/STRK-101-manifest-type-mismatch/` and verified `tasks.md` was drafted.
- Checked `js/cloud-sync.js` for manifest type checking locations: `buildAndUploadManifest` (lines 1043-1082) where `entry.type` is processed and summary is counted; `_buildDiffFromManifest` (lines 2925-2959) where `change.type` is classified into `added`, `modified`, and `deleted`; conflict detection (lines 3596-3611) where `mc.type === "edit"` is evaluated; and verified `_deferredVaultRestore` (line 3026) is indeed separate and correct.
- Checked `tests/playwright/helpers/mocks/audit.js` and verified `api.dropboxapi.com` and `content.dropboxapi.com` are in `DENIED_HOSTS`, meaning any live network calls to Dropbox will fail immediately without explicit local `page.route` mocking.
- Checked CSV header structures in `js/inventory-backup.js` (lines 132-165, 182-220) and `js/inventory-import.js` (lines 1064-1102, 1121-1159) to confirm obverse/reverse URL positions and the standalone CSV prepended comment.
- Checked `tests/playwright/attachments/backup-zip.spec.js` (lines 60-88) to confirm the existing test manually stringifies mock items rather than calling the real `createBackupZip()`.

**Top concerns**

1. **Chronological Type-Priority Merge**: A static priority hierarchy (e.g. `delete > add > edit`) fails for `delete + add` (re-addition within same sync window) where the later state `add` must win. A state machine or chronological pairwise merge helper `_mergeItemChangeTypes(existingType, incomingType)` is required.
2. **Denied Dropbox Hosts**: Playwright audit policies block Dropbox API domains. Task B.1 must explicitly configure route interception for `content.dropboxapi.com` and `api.dropboxapi.com` endpoints to avoid test execution failures.
3. **Divergent CSV Parsing in Tests**: CSV tests in B.3 must strip/handle the `# exportOrigin:` comment in standalone exports, and verify that columns are positioned exactly after `Reverse Image URL`.

**Unverified assumptions**

- That `localStorage` items are correctly decrypted and parsed into the expected formats during Dropbox download mocks in the new test suite.
- That adding the `Obverse Frame` and `Reverse Frame` columns does not break third-party CSV parsers used by users importing older CSVs.

### Deepseek

#### Inline Marks

> DEEPSEEK: Verified `window.exportInventoryCSV` is aliased to `buildCsvContent` at `inventory-import.js:1714`, which returns a string (not a Blob download). No `page.route` interception needed for standalone CSV tests — calling `page.evaluate(() => window.exportInventoryCSV())` returns the string directly. However, `buildCsvContent` prepends `# exportOrigin: <url>\n` at `inventory-import.js:1165` before Papa.unparse output. Papa.parse with `{ header: true }` will fail on this non-CSV header line unless explicitly stripped. B.3 tests should strip or set `{ skipEmptyLines: true, transform: (val) => val === '# exportOrigin:' ? null : val }` or simply split on newline and skip the comment line before parsing.

**Verified**

- Confirmed sketch directory: `DocVault/Projects/StakTrakr/sketches/STRK-101-manifest-type-mismatch/`. All four phase documents (requirements, discovery, approach, tasks) present. No prior `DEEPSEEK Review` in tasks.md.
- **Task A.1** — helper stub: verified `cloud-sync.js:1056` stores raw `entry.type` and `cloud-sync.js:1069-1082` compares unprefixed strings. Helper creation is a standalone function — line reference tracks correctly with C.1 wiring.
- **Task B.1** — manifest type tests: verified `cloud-sync.js:4286-4287` exports `pushSyncVault` and `pullSyncVault` as reachable flow entry points. `buildAndUploadManifest()` at line 1019 and `_buildDiffFromManifest()` at line 2925 are private (not exported). Existing `cloud-sync.spec.js:6-18` only seeds Dropbox connection localStorage — no Dropbox route/download/upload mocks exist.
- **Task B.2** — ZIP JSON tests: verified `window.createBackupZip` at `inventory-backup.js:889`. Existing `backup-zip.spec.js:60-88` manually serializes items (does NOT call `createBackupZip()`). DIFF_FIELDS at `diff-engine.js:32-89` has 44 entries. ZIP JSON allowlist at `inventory-backup.js:26-60` covers 31 entries (plus `serial`/`uuid`). 13 missing confirmed.
- **Task B.3** — CSV frame tests: verified `window.exportInventoryCSV` at `inventory-import.js:1714` aliased to `buildCsvContent` which returns string (no download). ZIP CSV `Reverse Image URL` at `inventory-backup.js:159` (header) and `inventory-backup.js:209` (row). Standalone CSV `Reverse Image URL` at `inventory-import.js:1092` (header) and `inventory-import.js:1149` (row). `# exportOrigin:` comment at `inventory-import.js:1165`. Frame field write paths at `events.js:1617-1618`.
- **Task C.1** — type normalization wiring: verified consumer sites at `cloud-sync.js:1056` (write-side `changesByKey[key].type`), `cloud-sync.js:1070-1082` (summary counting), `cloud-sync.js:2933/2935/2949` (diff classification), `cloud-sync.js:3287-3290` (`_mNoChanges` guard), `cloud-sync.js:3601` (conflict detection), `cloud-sync.js:3026` (`_deferredVaultRestore` — correctly excluded per 3-reviewer consensus).
- **Task C.2** — ZIP JSON/CSV: verified `inventory-backup.js:26-60` allowlist (closing `})` at line 61). ZIP CSV headers at `inventory-backup.js:132-165` (32 columns, `Reverse Image URL` at line 159). Row builder at `inventory-backup.js:182-214` (`item.reverseImageUrl` at line 209). Existing defaults pattern confirmed: `|| ""` for scalars, `|| null` for objects (`disposition:` at line 59), `|| []` for arrays, conditional spread for `paymentMethod` at line 37.
- **Task C.3** — standalone CSV: verified `inventory-import.js:1064-1102` (37 headers, `Reverse Image URL` at line 1092). Row builder at `inventory-import.js:1121-1159` (`i.reverseImageUrl` at line 1149). C.2 and C.3 touch different files with no shared symbols — `[P]` marking is correct.
- **Dropbox deny-list**: confirmed `api.dropboxapi.com` and `content.dropboxapi.com` in `tests/playwright/helpers/mocks/audit.js:25-26`. Any unmocked Dropbox fetch will fail the test suite immediately — CODEX and GEMINI flags on this are warranted.
- **Standard Closing Tasks template**: verified at `DocVault/specflow/user-templates/tasks-template.md:232-332`. Template defines 8 numbered closing tasks (N+1 through N+8) with specific structure. STRK-101 tasks.md substitutes completely different CLOSE-1 through CLOSE-8.
- **CLOSE-3 cross-repo boundary**: confirmed tasks.md lives in DocVault repo. CODEX and GEMINI flags about not staging DocVault paths into the StakTrakr app PR are correct.
- **CLOSE-5 Plane issue closure timing**: verified `AGENTS.md` gate "Never mark Plane issues Done before PR merge." CODEX and GEMINI flags about splitting CLOSE-5 are correct.
- **CLOSE-6 PR title format**: verified `AGENTS.md:98-100` requires `vX.YY.ZZ — ...` format. CODEX and GEMINI flags about conventional-commit vs versioned-patch title are correct.
- **Cohort parallelization**: B.1/B.2/B.3 are independent (three different test files, no shared symbols). C.2/C.3 are independent (`inventory-backup.js` vs `inventory-import.js`). `[P]` markers are correctly placed.

**Top concerns**

1. **Standard Closing Tasks are not copied from the template.** The `tasks-template.md` defines 8 closing tasks (implementation logging HARD GATE, Codacy CLI + CodeRabbit parallel scan, verification.md, cross-model peer review, loop-or-proceed gate, version bump, vault-update + issue close, draft PR). STRK-101 tasks.md replaces these with a completely different CLOSE-1 through CLOSE-8 sequence that omits: (a) `log-implementation` HARD GATE, (b) CodeRabbit parallel review, (c) cross-model peer review, (d) loop-or-proceed verification gate. The `requirements.md` and `discovery.md` instructions say "Copy Standard Closing Tasks verbatim from DocVault/specflow/user-templates/tasks-template.md, renumber only." These were not copied — they were rewritten. The core concern is not cosmetic — the `log-implementation` HARD GATE is mandatory per AGENTS.md and missing it blocks future agents from discovering what was built.

2. **Missing File Touch Map and Parallel Dispatch Plan sections.** The template requires a File Touch Map table (CREATE/MODIFY/DELETE/TEST) and a Parallel Dispatch Plan (batch groupings with rationale) before any tasks. The tasks.md starts directly with Sprint Cohort 0. The approach.md File Map section loosely covers file changes but is not structured as a touch map. Without a formal touch map, the orchestrator cannot automatically verify that parallel task markers are correct or detect file-level collisions.

3. **CLOSE-3 writes to a cross-repo file without specifying the commit mechanism.** The verification stamp writes to DocVault's `tasks.md` from a StakTrakr implementation session. CODEX's comment identifies the routing gap correctly: the stamp must be committed via `/vault-update` or `/sketch archive`. The task acceptance should name the commit path explicitly — otherwise an implementing agent may try to stage DocVault files into the StakTrakr app PR or skip committing the stamp entirely.

**Additional notes**

- B.3 `window.exportInventoryCSV` at `inventory-import.js:1714` is a direct alias for `buildCsvContent`, which returns a string with `# exportOrigin:` comment prepended at line 1165. Papa.parse with `{ header: true }` will fail on the comment. Tests need to strip it first — this is a concrete parsing hazard, not theoretical. (GEMINI identified this; confirming with code locations.)
- CLOSE-5 and CLOSE-6 ordering defects are well-documented by CODEX and GEMINI. Not repeating — just confirming the project rule at `AGENTS.md:159-169` ("Never mark Plane issues Done before PR merge") applies.
- C.2 line reference "~line 159" for `Reverse Image URL` header is correct at line 159. Row value "~line 209" is correct at line 209. C.3 line reference "~line 1092" is correct at line 1092. Row value "~line 1149" is correct at line 1149.
- C.2 default patterns for new fields are consistent with existing code: `|| ""` for `lastModified` (scalar, ISO date string), `|| null` for `numistaData` and `fieldMeta` (objects, matching `disposition || null` at line 59), `|| 0` for `purchasePrice`/`retailPrice`, `|| []` for `attachments`.

**Unverified assumptions**

- The `changesByKey` merge in C.1 handles all 6 possible compound-type pairs within a sync window (add+edit, add+delete, edit+delete, edit+add, delete+edit, delete+add). The approach.md resolution summary accepted `delete > add > edit` priority, but C.1's acceptance for type-priority merge says "Ensures: edit+delete → delete, add+edit → add, add+delete → delete (safe no-op), delete+add → add" — which covers 4 pairs. The `edit+add` case (edit first, then add entry for the same key) is not addressed; it should also resolve to `add` (the item was newly created). The `delete+edit` case (delete first, then edit) is impossible — a deleted item can't have a subsequent edit — but the merge rule should either explicitly handle or document this case as unreachable.
- The `_normalizeItemChangeType` helper in A.1 guards against `null`/`undefined` input by returning `""`. The acceptance says "returns `""` or the input without throwing" — but the downstream consumers switch on exact strings (`=== "add"`, `=== "edit"`, `=== "delete"`). An empty string `""` will not match any branch, which is correct behavior (silently skip unknown types). But if the input is `null` and the helper throws instead, the calling code at line 1070 would crash the entire `buildAndUploadManifest` loop. The guard must not throw — the acceptance text is correct but easily missed.
- The Dropbox test route mocks required for B.1 tests are not specified in the task acceptance. The existing `cloud-sync.spec.js:6-18` `setupCloudConnected()` only seeds Dropbox connection state (account ID, token, sync enabled flag, vault password) — it does NOT mock `content.dropboxapi.com` download/upload routes. The task acceptance relies on "existing Dropbox mock patterns" which are insufficient. CODEX flagged this correctly — the task needs explicit mock requirements.
- `lastModified` default of `|| ""` in C.2: the field stores ISO date strings. On items created pre-`lastModified` era (before this field was added to the save path), `item.lastModified` is `undefined` and `|| ""` produces empty string `""` — correct. On modern items, it carries a real ISO date. Confirmed the default is correct.
- The `buildCsvContent()` function at `inventory-import.js:1062` checks `typeof Papa === "undefined"` and returns `null` if Papa isn't loaded. Tests must ensure Papa is available in the page context before calling `window.exportInventoryCSV` — this is a page-load dependency, not a code bug, but worth noting for test setup.

> **Note on CLOSE task deviations:** The CODEX review flagged CLOSE-3 (cross-repo verification stamp), CLOSE-5 (Plane closure timing), and CLOSE-6 (PR title format). GEMINI reinforced all three. This review confirms those findings are correct against the live codebase and adds the structural concern that the entire closing-task block was rewritten rather than copied-and-renumbered from the template. Reconciliation should either restore the template's closing tasks or document why each substitution was intentional.

### Resolution Summary

- Accepted: 6 reviewer clusters — Dropbox route mocks in B.1; standalone CSV comment handling and column-position assertions in B.3; chronological pairwise type merge in C.1; DocVault commit routing for CLOSE-3; delayed Plane closure after archive; versioned StakTrakr PR title.
- Rejected: 2 reviewer clusters — SpecFlow-only closing-task template requirements and File Touch Map / Parallel Dispatch Plan sections do not apply to the active sketch template.
- Resolved with your input: 0

## Verification Stamp

- [x] AC-1 — verified at `js/cloud-sync.js:2977` (`_normalizeItemChangeType` in `_buildDiffFromManifest`) and `js/cloud-sync.js:3646` (conflict detection); verified by "pull manifest classifies item-add, item-edit, and item-delete entries"
- [x] AC-2 — verified at `js/cloud-sync.js:2978` (normalized `"add"` → `added` array); verified by "pull manifest classifies item-add, item-edit, and item-delete entries"
- [x] AC-3 — verified at `js/cloud-sync.js:2994` (normalized `"delete"` → `deleted` array); verified by "pull manifest classifies item-add, item-edit, and item-delete entries"
- [x] AC-4 — verified at `js/cloud-sync.js:1097-1133` (write-side normalization + summary counting); verified by "push manifest writes normalized counts and chronological merged types"
- [x] AC-5 — verified at `js/inventory-backup.js:36-72` (13 DIFF_FIELDS entries added to ZIP JSON allowlist); verified by "inventory_data.json includes the complete DIFF_FIELDS export surface"
- [x] AC-6 — verified at `js/inventory-backup.js:174-175,226-227` (ZIP CSV) and `js/inventory-import.js:1093-1094,1152-1153` (standalone CSV); verified by "ZIP CSV includes frame columns immediately after Reverse Image URL" and "standalone CSV includes frame columns immediately after Reverse Image URL"
- [x] AC-7 — verified by "vault-first fallback still runs when manifest is unavailable"; `_deferredVaultRestore` at `js/cloud-sync.js:3026` is untouched (uses DiffModal's independent type vocabulary)
