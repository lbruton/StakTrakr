---
sketch: "STRK-68-chart-unit-alignment"
phase: tasks
created: 2026-05-11
approved: 2026-05-11
---

# STRK-68 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-68-chart-unit-alignment`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

## Sprint Cohort A — Persist pricingType field (sequential)

_Foundation task: creates the `pricingType` field that all downstream work reads. Must complete before Cohort B._

- [x] **A.1** — Add `pricingType` to item save path
  - **File(s):** `js/events.js`
  - **Acceptance:** After saving an item with the lot/each toggle in "lot" mode, the serialized inventory in localStorage contains `"pricingType":"lot"` on that item. Items saved with "each" mode (or the default) have `"pricingType":"each"`. The existing lot→per-unit price conversion at lines 1417–1420 is unchanged — `item.price` remains per-unit always.
  - **Leverage:** `buildItemFields()` at events.js:1582–1616 is the single point where all item fields are assembled. Add `pricingType: item.pricingType || purchasePriceToggle.getMode()` to its return object — the `item.pricingType ||` prefix is the preservation rule: existing items keep their stored value; only new items or legacy items without the field inherit the toggle state. `parseItemFormFields()` may also need to capture the toggle state if the form-field parsing path is separate from the builder.
  - **Maps to:** AC-3, AC-4

## Sprint Cohort B — Consume pricingType (parallel-safe)

_Tasks in this cohort touch independent files and can be dispatched to different models/sessions concurrently. Both read `item.pricingType` — neither creates it._

- [x] **B.1 [P]** — Restore toggle state on edit
  - **File(s):** `js/inventory.js`
  - **Acceptance:** When editing an existing item that has `pricingType: "lot"`, the edit modal opens with the toggle in "Lot" mode and the price field showing the lot-total value (`item.price * item.qty`). For items without `pricingType` (legacy) or with `pricingType: "each"`, the toggle opens in "Each" mode with the stored per-unit price — matching current behavior exactly.

  - **Note:** Legacy-save preservation is handled by A.1's `item.pricingType || purchasePriceToggle.getMode()` rule. Qty changes during edit do NOT recompute the lot price (existing behavior — `maybeConvert()` only runs on mode switches, not qty changes). A qty-change confirmation dialog is a separate follow-up, not part of STRK-68.
  - **Leverage:** `editItem()` in inventory.js already populates all form fields for the edit modal. Replace the `resetPurchasePriceToggle()` call with: read `item.pricingType` (default "each"), call `purchasePriceToggle.setMode()` with the stored value, then if mode is "lot", multiply the displayed price by qty so the user sees what they originally entered. Per decision D-7, the reset function itself stays unchanged for the add-new path.
  - **Maps to:** AC-3, AC-4

- [x] **B.2 [P]** — Scale chart by pricingType
  - **File(s):** `js/viewModal.js`
  - **Acceptance:** Two sub-checks:
    1. **Chart lines (AC-1, AC-2):** For `pricingType: "each"`, purchase line = `item.price` (per-unit), melt line = `spot × weightOz × 1 × purity`, retail endpoints + midpoints = per-unit retail. For `pricingType: "lot"` or absent (legacy), purchase = `item.price × qty`, melt = `spot × weightOz × qty × purity`, retail = `marketValue × qty`. All three lines use the same unit — no mixed units within a line.
    2. **Retail midpoint fix (D-3):** `itemPriceHistory` entries (per-unit) are multiplied by the same qty multiplier as the endpoints. This fixes the pre-existing retail-line inconsistency where midpoints were per-unit but endpoints were lot-total.

  - **Note (melt midpoints):** The chart does not render melt midpoints from `itemPriceHistory` — only `re.retail` is consumed. Melt is computed from spot data directly. No melt-midpoint scaling needed.
  - **Note:** `_buildValuationSection()` is **NOT modified** — per Lonnie's decision (2026-05-11), the valuation section continues showing both total and per-unit values unchanged. Only the chart respects pricingType. AC-6 has been updated to reflect this.
  - **Leverage:** Centralize the multiplier decision in `_getPriceHistoryContext()` (D-2): `const unitQty = (item.pricingType === "each") ? 1 : qty`. Apply `unitQty` to `purchasePerUnit` (line 608), `meltFactor` (line 585), `currentRetail` (line 610), and retail midpoints at ~line 1783. For legacy items (no `pricingType`), absence → `unitQty = qty` → lot-total display (AC-4, matching current behavior).
  - **Maps to:** AC-1, AC-2, AC-4, AC-5, AC-6

## Sprint Cohort C — Verification (sequential)

_Depends on Cohorts A and B. Manual verification with real data._

- [ ] **C.1** — Visual verification with multi-qty item
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Open StakTrakr in a browser:
    1. Create or find a multi-qty item (e.g., 5× 1oz Silver rounds). Edit it, set toggle to "Lot", enter a lot price (e.g., $250), save. Open view modal → chart shows lot-total lines ($250 purchase, ~$160 melt for 5oz, retail scaled by qty).
    2. Edit same item — toggle shows "Lot" with $250. Switch to "Each" and re-save with $50. View modal → chart shows per-unit lines ($50 purchase, ~$32 melt for 1oz, per-unit retail).
    3. **Retail line smoothness (D-3):** Verify the retail line has no "sawtooth" between midpoints and endpoints — the line should be smooth, not jumping between per-unit midpoints and lot-total endpoints.
    4. **Valuation section unchanged (AC-6):** Verify the Valuation section still shows both total and per-unit values regardless of pricingType setting.
    5. **Qty=1 unaffected (AC-5):** Verify qty=1 item chart is identical to pre-change behavior.
    6. **Legacy preservation (AC-4):** Find a legacy item (no pricingType). Verify chart shows lot-total. Edit only the notes field (don't touch toggle or price), save. Verify chart still shows lot-total — the preservation rule prevents silent flipping.
  - **Depends on:** A.1, B.1, B.2
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6

---

## Standard Closing Tasks

> **Numbering:** Continues from Sprint Cohort C.

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test` and `npm run lint`. All existing tests pass; no new regressions from the three modified files.
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files (`js/events.js`, `js/inventory.js`, `js/viewModal.js`). Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-6), write exactly one line:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` or `verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`)
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — the approach modifies data model behavior (new `pricingType` field) and chart rendering logic. Foundation docs (`architecture.md`, `coding-standards.md`) may need a note about the new field. Let the skill audit.
  - Mark STRK-68 Done in Plane: `mcp__plane__update_issue` to state "Done".

- [x] **CLOSE-6. Open PR**
  - Use worktree branch `sketch/STRK-68-chart-unit-alignment`. Title: `feat(STRK-68): chart unit alignment for lot/each pricing`.
  - Body must include: link to STRK-68, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-68-chart-unit-alignment/`), test plan checklist.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-68`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-68-chart-unit-alignment/` and saves mem0 summary.

---

## Verification Stamp

- [x] AC-1 — verified at `js/viewModal.js:667` (`unitQty = 1` when `pricingType === "each"`) + lines 697-706 (purchasePerUnit, meltFactor, currentRetail, scaledRetailEntries all use `unitQty`)
- [x] AC-2 — verified at `js/viewModal.js:667` (`unitQty = metrics.qty` when `pricingType === "lot"` or absent) — same multiplier applies to all three chart lines
- [x] AC-3 — verified at `js/events.js:1484-1497` (pricingType persisted in parseItemFormFields/buildItemFields) + `js/inventory.js:1608-1623` (restorePurchasePriceToggle restores mode + lot price on edit open)
- [x] AC-4 — verified at `js/events.js:1484-1497` (legacy items: `existingItem.pricingType` = undefined, no toggle interaction → pricingType not set → chart uses lot-total via `unitQty = qty`) + `js/events.js:1484` (edit toggle opens as "each" via `restorePurchasePriceToggle("each")`)
- [x] AC-5 — verified at `js/events.js:129-130` (toggle forced to "each" at qty≤1) → pricingType never written for qty=1 items; `js/viewModal.js:667` (`unitQty = qty = 1` → no change vs before)
- [x] AC-6 — verified by git diff: `_buildValuationSection()` has zero changes in this PR; chart context reads pricingType only for the price history chart lines

> **Note:** C.1 browser verification (visual chart rendering, retail line smoothness, legacy preservation) requires manual browser session. All ACs are statically verified through code analysis above; browser testing would add confidence on the rendered output.

---

> **Multi-model dispatch hint:** Cohort B tasks marked `[P]` can be sent to different models in parallel via OpenCode. Suggested split: send B.1 (inventory.js toggle restore) to Codex, B.2 (viewModal.js chart scaling) to Claude. Both read `pricingType` from the same data model — no shared file conflicts.
