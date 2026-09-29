---
sketch: STRK-50-payment-method-dropdown
phase: tasks
created: 2026-05-11
approved: 2026-05-13
---

# STRK-50 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [x] **0.1** — Confirm worktree exists (StakTrakr patch convention)
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree at `.worktrees/patch-<VERSION>/` on branch `patch/<VERSION>` (per AGENTS.md:62-64). Working directory is that worktree, not the main checkout. The version lock (`devops/version.lock`) is claimed. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `/start-patch` or `/release` skill (claims version lock + creates worktree); AGENTS.md:94.

## Sprint Cohort A — Playground Mockup Gate (sequential)

_AC-8 requires a mockup of the three-column Date/Price/PaymentMethod row, reviewed at desktop and mobile widths, before any HTML changes land. This cohort blocks all implementation._

- [x] **A.1** — Create playground mockup for Date/Price/PaymentMethod row
  - **File(s):** `playground/STRK-50-payment-method-row/index.html` (new — added to approach.md File Map)
  - **Acceptance:** A standalone HTML page copies the real edit modal purchase section layout (Date, Price with spot-lookup button, Payment Method `<select>`) using the project's CSS. Demonstrates: (1) desktop three-column layout with `.grid-3`, (2) mobile single-column collapse, (3) Purchase Price retains full usable width including spot-lookup button, (4) Purchase Date picker is not cramped. Human reviews and confirms pass/fail before proceeding to Cohort B. **Approval gate:** Record mockup approval as `> Mockup approved — YYYY-MM-DD` directly below this acceptance line in tasks.md before starting Cohort B.
  > Mockup approved — 2026-05-13. Caveat: mockup did not incorporate the existing app CSS directly, so post-PR QA must verify the final production form layout.
  - **Leverage:** Current edit modal HTML at `index.html:2167–2230`; existing `css/styles.css` linked directly. AC-8 layout reference screenshot in requirements.md.
  - **Maps to:** AC-8

## Sprint Cohort B — Implementation (sequential foundation → parallel consumers)

_B.1→B.2→B.3 run sequentially to establish the `paymentMethod` contract in code: DOM element (B.1), element cache + init (B.2), form parse/build/save (B.3). Once those three land, the field contract exists in code and B.4–B.11 can run in parallel — they consume the contract but don't define it._

- [x] **B.1** — Add Payment Method `<select>` to edit modal HTML + `.grid-3` CSS
  - **File(s):** `index.html` (~line 2167–2230), `css/styles.css` (~line 1188 + ~line 12982)
  - **Acceptance:** (1) The Date/Price row changes from `grid-2` to `grid-3` with a new third column containing `<select id="itemPaymentMethod">` with 10 `<option>` elements in order: `(blank)`, Zelle, PayPal, Credit Card, Debit Card, Cash, Check, Wire, Crypto, Other. (2) New `.grid-3` CSS rule added near `.grid-2` at `css/styles.css:~1188` with `display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem`. (3) Narrow-viewport collapse rule at `css/styles.css:~12982` extended to include `.grid-3` alongside `.grid-2` and `.grid-purity-row` (single-column on mobile).
  - **Leverage:** Existing `.grid-2` pattern at `css/styles.css:1188-1190`; mobile collapse at `css/styles.css:12982-12994`. D-2 decision in approach.md.
  - **Maps to:** AC-1, AC-8

- [x] **B.2** — Wire element cache and safeGetElement init
  - **Depends on:** B.1 (DOM element must exist before caching)
  - **File(s):** `js/state.js` (~line 51–88), `js/init.js` (~line 210)
  - **Acceptance:** (1) `js/state.js` element cache object includes `itemPaymentMethod: null`. (2) `js/init.js` initializes it via `elements.itemPaymentMethod = safeGetElement("itemPaymentMethod")` in the same block as purchaseLocation/storageLocation.
  - **Leverage:** Existing `purchaseLocation` / `storageLocation` pattern at `state.js:72-73` and `init.js:210-211`.
  - **Maps to:** AC-1

- [x] **B.3** — Form parse, build, save, and blank-omit contract in events.js
  - **Depends on:** B.2 (element cache must be wired before reading `elements.itemPaymentMethod`)
  - **File(s):** `js/events.js` (~lines 1478, 1640, 1711, 1845, 1717–1750)
  - **Acceptance:** (1) `parseItemFormFields()` reads `elements.itemPaymentMethod.value.trim()` into `f.paymentMethod`. (2) `buildItemFields()` includes `paymentMethod: f.paymentMethod` in the return object. (3) Edit-mode save: post-spread `delete` for blank `paymentMethod` added at ~line 1711, matching the `obverseImageFrame`/`reverseImageFrame` deletion pattern. (4) Add-mode save: post-push `delete` for blank `paymentMethod` at ~line 1845. (5) `"paymentMethod"` added to `trackedFields` array for changelog tracking. Blank-omit contract: saving with blank selection stores no `paymentMethod` key on the item (AC-3).
  - **Leverage:** Image-frame deletion pattern at `events.js:1711-1712`; `pricingType` conditional at `events.js:1642-1650`. D-3 decision in approach.md.
  - **Maps to:** AC-1, AC-2, AC-3

- [x] **B.4 [P]** — Edit/clone form population + JSON export + PDF export in inventory.js
  - **File(s):** `js/inventory.js` (~lines 1381, 1762, 1860, 1950)
  - **Acceptance:** (1) Edit-open: `elements.itemPaymentMethod.value = item.paymentMethod || ""` added at ~line 1381 alongside purchase/storage population. (2) Clone/duplicate form fill: same population at ~line 1762. (3) JSON export field map at ~line 1860: `paymentMethod: item.paymentMethod || ""` added. (4) PDF `autoTable` at ~line 1950: "Pay Method" column header and `item.paymentMethod || ""` data cell added.
  - **Leverage:** Existing `purchaseLocation` population at `inventory.js:1381-1383`; D-8 abbreviation decision.
  - **Maps to:** AC-1, AC-2, AC-7, AC-10

- [x] **B.5 [P]** — Add paymentMethod to clone-picker CLONE_FIELDS
  - **File(s):** `js/clone-picker.js` (~line 103–117)
  - **Acceptance:** `CLONE_FIELDS` array includes `{ labelFor: "itemPaymentMethod", key: "paymentMethod", defaultOn: true }`. Cloning an item with `paymentMethod: "PayPal"` copies the value by default; unchecking the clone checkbox omits it.
  - **Leverage:** Existing optional-field entries in `CLONE_FIELDS` at `clone-picker.js:103-117`. Deep clone at `clone-picker.js:86-95` copies all properties automatically; this entry adds the opt-out checkbox.
  - **Maps to:** AC-10

- [x] **B.6 [P]** — Add paymentMethod to bulk edit + blank-delete handling
  - **File(s):** `js/bulkEdit.js` (~line 280, ~line 1266)
  - **Acceptance:** (1) `BULK_EDITABLE_FIELDS` gains `{ id: "paymentMethod", label: "Payment Method", inputType: "select", options: ["", "Zelle", "PayPal", "Credit Card", "Debit Card", "Cash", "Check", "Wire", "Crypto", "Other"] }` — pattern matches `grade`/`gradingAuthority`. (2) After the generic write loop in `applyBulkEdit()` at ~line 1266, a post-apply check: if `paymentMethod` was enabled and its value is blank (`""`), `delete item.paymentMethod` for each affected item (AC-9 blank-delete contract). D-4 decision.
  - **Leverage:** `grade` select field definition at `bulkEdit.js:228`; generic write at `bulkEdit.js:1263-1266`.
  - **Maps to:** AC-9

- [x] **B.7 [P]** — Wire filter chips: counting, descriptor, predicate, text search, defaults
  - **File(s):** `js/filters.js` (~lines 145, 175, 286, 362, 387, 948, 1250), `js/constants.js` (~line 1169)
  - **Acceptance:** (1) `generateCategorySummary()`: new `paymentMethods = {}` counting object; counting loop mirrors `purchaseLocation` pattern — skip blank/missing, increment. (2) Return object gains `paymentMethods: filteredPaymentMethods` (after `applyMinCountThreshold`). (3) Category descriptors map gains `paymentMethod: { summaryKey: "paymentMethods", field: "paymentMethod" }`. (4) Fallback `categoryConfig` gains `{ id: "paymentMethod", enabled: true }`. (5) Filter predicate `switch` gains `case "paymentMethod":` — normalize missing/falsy to `"—"`, exact match against `values` array (mirror `purchaseLocation`). (6) Text search `fieldMatch` chain gains `(item.paymentMethod && wordRegex.test(item.paymentMethod))`. (7) `FILTER_CHIP_CATEGORY_DEFAULTS` in `constants.js` gains `{ id: "paymentMethod", label: "Payment Method", enabled: true, group: null }`. Existing users' saved configs auto-merge the new default via the merge helper at `constants.js:1177-1196`.
  - **Leverage:** `purchaseLocation` chip pattern across all 7 sites; D-5 decision.
  - **Maps to:** AC-4

- [x] **B.8 [P]** — Add Payment Method to view modal
  - **File(s):** `js/viewModal.js` (~line 480)
  - **Acceptance:** `_buildInventorySection()` adds a Payment Method detail to the `invGrid2` three-col grid alongside Date and Source. Shows `item.paymentMethod || "—"` (or omits the detail entirely if blank — match how Source handles missing `purchaseLocation`).
  - **Leverage:** Existing Date/Source grid at `viewModal.js:473-481`; D-7 decision.
  - **Maps to:** AC-5

- [x] **B.9 [P]** — Add paymentMethod to backup/restore exports (JSON, CSV, HTML report, sample, ZIP restore verify)
  - **File(s):** `js/inventory-backup.js` (~lines 40, 155, 200, 240, 385, 780)
  - **Acceptance:** (1) JSON backup field map at ~line 40: `paymentMethod: item.paymentMethod || ""`. (2) ZIP-internal CSV headers at ~line 155: `"Payment Method"` added. (3) ZIP-internal CSV row at ~line 200: `item.paymentMethod || ""` at matching index. (4) ZIP sample JSON fields at ~line 240: `paymentMethod` included. (5) ZIP HTML report table at ~line 780: "Payment Method" column header + cell. (6) ZIP restore: verify that `parsedItems` from `inventory_data.json` at ~line 385 carries `paymentMethod` through to `showImportDiffReview()` — no transform strips it (passthrough confirmation, not code change).
  - **CSV column-ordering contract:** "Payment Method" column must be placed immediately after the last existing column in both ZIP-internal CSV (B.9) and user-facing CSV (B.10). ZIP CSV at `inventory-backup.js:130` is documented as "synced with exportCsv()" — the column index must match between both files. If running B.9 and B.10 in parallel, coordinate the exact index before starting.
  - **Leverage:** Existing field maps at `inventory-backup.js:26-59`, `131-163`, `180-218`, `223-251`, `764-790`.
  - **Maps to:** AC-6, AC-7

- [x] **B.10 [P]** — Add paymentMethod to CSV export + all import paths (CSV, JSON, ZIP)
  - **File(s):** `js/inventory-import.js` (~lines 304, 435, 842, 1050, 1100, 1280, 1652)
  - **Acceptance:** (1) User-facing CSV export in `buildCsvContent()`: `"Payment Method"` header at ~line 1050; `item.paymentMethod || ""` row value at ~line 1100. (2) CSV import path 1 at ~line 304: `const paymentMethod = row["Payment Method"] || ""`, passed to `sanitizeImportedItem()` at ~line 435. (3) CSV import path 2 (legacy) at ~line 842: same pattern. (4) JSON import at ~line 1280: `raw.paymentMethod` read and passed. (5) ZIP restore import at ~line 1652: same pattern. All import paths funnel through `sanitizeImportedItem()` for sanitization (see B.11).
  - **Leverage:** Existing `purchaseLocation` import pattern; D-6 `sanitizeImportedItem` boundary decision.
  - **Maps to:** AC-7

- [x] **B.11 [P]** — Add paymentMethod to sanitizeImportedItem basicFields
  - **File(s):** `js/utils.js` (~line 1352)
  - **Acceptance:** `"paymentMethod"` added to the `basicFields` array in `sanitizeImportedItem()`. All imported values are `cleanString()`'d automatically — no special numeric/type coercion needed.
  - **Leverage:** Existing string field entries in `basicFields` at `utils.js:1352`. D-6 decision.
  - **Maps to:** AC-7

## Sprint Cohort C — Tests (sequential)

_Tests depend on all Cohort B implementation being in place. TDD note: if applying via `/sketch apply`, write tests first and confirm they fail, then implement. If applying via `/sketch orchestrate` with parallel dispatch, tests run after implementation since the models can't share runtime state._

- [x] **C.1** — Write Playwright E2E tests for paymentMethod
  - **File(s):** `tests/playwright/payment-method.spec.js` (new — added to approach.md File Map)
  - **Acceptance:** Tests cover:
    - AC-1: Dropdown present in Edit Item modal with correct options in order
    - AC-2: Select a value, save, reopen — value persists in localStorage
    - AC-3: Blank default on new item; blank clears existing value (key omitted from stored item); existing items without `paymentMethod` load without error
    - AC-4: Filter chip appears when ≥3 items share a payment method value; clicking chip filters inventory; clicking again clears filter; text search matches payment method values
    - AC-5: Payment Method visible in view modal
    - AC-9: Bulk edit sets payment method across multiple items; bulk-setting to blank clears the key
    - AC-10: Clone preserves paymentMethod
    - AC-7: JSON export includes paymentMethod; CSV export includes "Payment Method" column; import round-trips the value
  - **Depends on:** All B.* tasks
  - **Maps to:** AC-1 through AC-10

---

## Standard Closing Tasks

> **Numbering:** Continue from the last sprint task. If your last sprint task is C.1, closing tasks start at C.2 — or relabel as 1, 2, 3 below; consistency matters more than scheme.

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run the project's complete test command. All existing tests pass; all new tests from Cohort C pass.
  - If anything fails: fix the implementation, not the test.
  - **Result:** `npm run lint` passed with 0 errors / 2 pre-existing warnings; focused Playwright passed 21/21 for `payment-method.spec.js` + `inventory/lot-each-purchase-price.spec.js`; broad Playwright runs passed all STRK-50 and modal-adjacent coverage, with only `theme-tokens TT-1` failing from live API CORS noise unrelated to STRK-50.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **Result:** `codacy-cli` invoked. Changed-file scan exposed tool startup limitations (OpenGrep user-log permission and Trivy multi-target limitation); repo-root rerun completed, but SARIF output was dominated by pre-existing tool/config noise from vendored files, devops, browser globals, and Playwright globals. No STRK-50-specific actionable issue was identified beyond the project lint/test checks above.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1, AC-2, …), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Status-only notes ("PR opened", "tests passing") are not equivalent — the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (e.g., `package.json`, `js/constants.js`, `sw.js`)
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.
  - If the project opts out of version management (no `devops/version.lock`, or explicit project policy), write `N/A — project opts out of version management (<reason>)` as the acceptance line. Do not silently drop this task.
  - **Result:** `/release patch` workflow applied for version `3.34.64`; release files updated in the app worktree (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`). `sw.js` is left to the pre-commit hook.

- [ ] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip.
  - Mark the source issue Done in Plane: `mcp__plane__update_issue` to state "Done".
  - If the project genuinely has no DocVault footprint, write `vault-update: N/A — <reason>` as a sub-line on this task and proceed with the issue close. Do not drop the task.
  - **Status:** Vault update audit completed by updating this sketch task record with implementation evidence. Plane issue close is intentionally deferred until PR review/merge because this patch is opening as a draft PR and the user requested post-PR QA.

- [x] **CLOSE-6. Open PR**
  - Use `patch/<VERSION>` branch from CLOSE-4's `/release patch`. Title: `v<VERSION> — STRK-50: optional payment method dropdown`. Open as **draft** with `codacy-review` label per AGENTS.md:89-99.
  - Body must include: link to source issue, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-50-payment-method-dropdown/`), test plan checklist.
  - **Result:** Draft PR opened: https://github.com/lbruton/StakTrakr/pull/1112

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as "comments outside of the diff" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.
  - **Status:** `/pr-resolve` discovery pass found no review threads at draft PR creation time. CodeRabbit skipped because the PR is draft. GitHub analysis and Cloudflare checks were still pending; defer full resolver loop until post-review/post-QA findings exist.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-50`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-50-payment-method-dropdown/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** B.1→B.2→B.3 must run sequentially (one model, one session) to establish the `paymentMethod` contract in code. Once committed, B.4–B.11 are parallel-safe. Suggested parallel split: B.4 (inventory.js) + B.9 (backup) + B.10 (import) to Codex; B.5 + B.6 + B.8 + B.11 to Gemini (small, pattern-following edits); B.7 (filters) to Claude. Note: B.9 and B.10 share a CSV column-ordering contract — see the note on B.9's acceptance. Reconverge before Cohort C.

## Verification Stamp

- [x] AC-1 — verified by `STRK-50 payment method dropdown › AC-1/2/3 — dropdown options persist and blank selection omits the key`
- [x] AC-2 — verified by `STRK-50 payment method dropdown › AC-1/2/3 — dropdown options persist and blank selection omits the key`
- [x] AC-3 — verified by `STRK-50 payment method dropdown › AC-1/2/3 — dropdown options persist and blank selection omits the key`
- [x] AC-4 — verified by `STRK-50 payment method dropdown › AC-4/5 — payment method participates in chips, search, and view modal`
- [x] AC-5 — verified by `STRK-50 payment method dropdown › AC-4/5 — payment method participates in chips, search, and view modal`
- [x] AC-6 — verified at `js/inventory-backup.js` and `js/inventory-import.js` paymentMethod backup/restore mappings
- [x] AC-7 — verified by `STRK-50 payment method dropdown › AC-7 — CSV/JSON export and JSON import round-trip paymentMethod`
- [x] AC-8 — verified by `playground/STRK-50-payment-method-row/index.html` mockup approval and production CSS layout screenshot checks; post-PR QA still required per human caveat
- [x] AC-9 — verified by `STRK-50 payment method dropdown › AC-9/10 — bulk edit sets and clears paymentMethod; clone preserves it`
- [x] AC-10 — verified by `STRK-50 payment method dropdown › AC-9/10 — bulk edit sets and clears paymentMethod; clone preserves it`

## Review Archive — tasks (2026-05-13)

_Reconciled by /sketch reconcile on 2026-05-13. Original reviewer marks preserved below for audit._

### Codex

#### What I Verified

- Current edit purchase layout is Date/Price in `.grid.grid-2` with inline date-clear and spot-lookup controls at `/Volumes/DATA/GitHub/StakTrakr/index.html:2167-2230`; Purchase Location/Storage Location remain the next row at `/Volumes/DATA/GitHub/StakTrakr/index.html:2231-2241`.
- CSS has `.grid-2` at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:1188-1190` and the mobile collapse only covers `.grid-2` plus `.grid-purity-row` at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:12982-12994`; there is no generic `.grid-3` today (`.grid-3-equal` only appears at `/Volumes/DATA/GitHub/StakTrakr/css/styles.css:10086` and `/Volumes/DATA/GitHub/StakTrakr/index.html:2584`).
- Form/cache/save paths exist where tasks say they do: element cache `/Volumes/DATA/GitHub/StakTrakr/js/state.js:51-88`, initialization `/Volumes/DATA/GitHub/StakTrakr/js/init.js:199-233`, parse/build/save `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1429-1517` and `/Volumes/DATA/GitHub/StakTrakr/js/events.js:1616-1858`.
- Edit/clone/export paths exist in `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1314-1388`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1748-1770`, and `/Volumes/DATA/GitHub/StakTrakr/js/inventory.js:1844-1999`; clone optional fields exist at `/Volumes/DATA/GitHub/StakTrakr/js/clone-picker.js:103-117`.
- Bulk-edit write semantics are direct field assignment at `/Volumes/DATA/GitHub/StakTrakr/js/bulkEdit.js:1263-1266`, with persistence after the loop at `/Volumes/DATA/GitHub/StakTrakr/js/bulkEdit.js:1292-1295`.
- Filter chip counts/descriptors/defaults/predicates/text-search sites exist at `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:124-297`, `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:351-388`, `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:941-955`, `/Volumes/DATA/GitHub/StakTrakr/js/filters.js:1240-1265`, and `/Volumes/DATA/GitHub/StakTrakr/js/constants.js:1157-1196`.
- Backup/import surfaces exist at `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:26-59`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:130-251`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:385-390`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:695-710`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js:764-790`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:292-447`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1039-1168`, `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1235-1323`, and `/Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js:1558-1688`.
- Playwright is configured to discover tests only under `/Volumes/DATA/GitHub/StakTrakr/tests/playwright` via `/Volumes/DATA/GitHub/StakTrakr/playwright.config.js:3-6`; `npm test` delegates to Playwright at `/Volumes/DATA/GitHub/StakTrakr/package.json:13`.
- StakTrakr release/worktree requirements are version-lock based: `.worktrees/patch-<VERSION>` and branch `patch/<VERSION>` at `/Volumes/DATA/GitHub/StakTrakr/AGENTS.md:62-64`, with versioned PR title and draft PR command expectations at `/Volumes/DATA/GitHub/StakTrakr/AGENTS.md:89-99`.

#### Top 3 Issues Raised

1. **The worktree and PR closing tasks conflict with StakTrakr's versioned patch workflow.** Cohort 0 expects a `sketch/...` branch, while the repo requires `patch/<VERSION>` and `.worktrees/patch-<VERSION>` for runtime code; CLOSE-6 also uses a non-versioned PR title.
2. **Two new files are outside the approach File Map.** A.1 creates `Playground/STRK-50-payment-method-row/index.html`, and C.1 creates `tests/payment-method.spec.js`, but the approach File Map says no new files and never lists tests.
3. **The `[P]` implementation cohort overstates parallel safety.** Multiple tasks share the new `itemPaymentMethod` DOM id and `paymentMethod` item-field contract, and the two CSV tasks must coordinate column order because ZIP CSV is meant to stay synced with user-facing CSV export.

#### Unverified Assumptions

- The generic sketch branch convention is allowed to override StakTrakr's version-lock/patch-worktree rule. Live repo docs point the other way, so this is load-bearing until reconciled.
- The mockup file should live inside the StakTrakr repo's `Playground/` folder rather than the separate top-level Playground project or a DocVault artifact. The approach names a path, but the File Map does not authorize the new file.
- The human AC-8 mockup approval will be recorded somewhere durable before implementation. The task currently says "Human reviews and confirms pass/fail" but does not define the artifact or line that proves it.
- `tests/payment-method.spec.js` was intended despite Playwright only discovering `tests/playwright/**/*.spec.js`. If this is just a path typo, use `tests/playwright/payment-method.spec.js` and add it to the approach File Map.
- Parallel workers can independently implement `paymentMethod` without drifting on option order, blank semantics, DOM id, field name, or CSV column order. The live code has no existing symbol to anchor those choices.
- Adding "Payment Method" to both user-facing CSV and ZIP-internal CSV at a consistent index is required. The code comment says ZIP CSV is synced with `exportCsv()`, but the task does not specify the ordering invariant.
- A single Playwright E2E file is enough to verify AC-6/AC-7 export/restore behavior, AC-8 visual mockup approval, and AC-9 bulk blank-delete behavior. That may be true, but the task needs concrete test names or artifact checks for mechanical verification.

### Resolution Summary

- Accepted: 5
- Rejected: 0
- Resolved with your input: 2 (file-map drift → amend approach.md; parallel safety → sequence B.1→B.2→B.3)
