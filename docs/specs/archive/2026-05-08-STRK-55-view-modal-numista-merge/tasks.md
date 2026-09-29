---
sketch: "STRK-55-view-modal-numista-merge"
phase: tasks
created: 2026-05-08
approved: 2026-05-08
---

# STRK-55 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Effort estimate** (per v4-Pro V-6): Sprint A (source changes) is 30–90 minutes, the original sketch target. Full path including B.1 (10–11 Playwright tests with IndexedDB seeding) and CLOSE-1..8 is **4–8 hours**. Top slippage sources: B.1 test 8 (IndexedDB TTL observation without re-render — no existing fixture), B.1 test 10 (Settings UI cross-page verification), B.1 test 11 (cache-empty + item-populated seeding), and the helper's `MEANINGFUL_FALSY_KEYS` exemption logic.

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`, `/pr-resolve`). Invoke them by name verbatim — paraphrasing the steps inline is not equivalent.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows `.worktrees/strk-55-view-modal-numista-merge/` on branch `strk-55-view-modal-numista-merge`. Working directory is that worktree. (Worktree was created during sketch authoring; reuse it.)
  - **Leverage:** existing `.worktrees/strk-55-view-modal-numista-merge/`.

> CODEX: This conflicts with the repo-level version-locked workflow in `AGENTS.md`: StakTrakr runtime code PRs are supposed to claim `devops/version.lock` and work from `.worktrees/patch-<VERSION>/` on `patch/<VERSION>`. If the sketch worktree is intentionally exempt, say so; otherwise this setup task will send implementers down a branch/PR path that later conflicts with CLOSE-4/CLOSE-6 release expectations.
> → **RESOLVED:** doc-drift between `AGENTS.md` (older, strict patch-`<VERSION>` convention) and `CLAUDE.md` (current, allows both `<issue>-<slug>` AND `patch-<VERSION>` per the `Worktrees` section). Recent merged PRs (e.g. STRK-37 `chore`) use issue-named worktrees. CLOSE-4's `/release patch` skill claims the version lock and stamps version files; if the project release flow requires renaming the worktree to `patch-<VERSION>` at that point, `/release` is the canonical place to do it. This sketch's setup is consistent with `/start-patch` convention. Filing follow-up to update `AGENTS.md` for parity.

## Sprint Cohort A — Source changes (parallel-safe)

_All three tasks touch independent files. Verified parallel-safe: no shared file, no symbol-level interdependencies. A.3 reads `cfg.obverse` / `cfg.reverse` but tolerates `undefined` via `!== false` default-render guard, so it does not depend on A.1 landing first._

> CODEX: Parallelization is mostly safe for no-conflict editing, but it is not fully independent behaviorally. A.3 can ship before A.1 without hiding the new rows because `undefined !== false`, but users cannot turn the rows off until A.1/A.2 land and the settings UI exposes the keys. That tolerance is load-bearing and should be called out as a temporary integration assumption, with Cohort B verifying both default render and toggle-off behavior after reconvergence.
> → **RESOLVED:** **Integration Assumption (load-bearing):** A.3 reads `cfg.obverse` / `cfg.reverse` and treats `undefined` as a render signal (default-on via `!== false` check). This works because `getNumistaViewFieldConfig` will return undefined for these keys until A.1 lands. Therefore A.3 can ship without A.1, but **users cannot toggle the new rows off until A.1 + A.2 both land**. Cohort B test cases must verify (a) default-render works regardless of A.1 landing order, AND (b) toggle-off works correctly once A.1 + A.2 are in place. Reconvergence checkpoint: ALL of A.1, A.2, A.3 must be merged into the worktree before B.1 starts.

- [x] **A.1 [P]** — Add `obverse` / `reverse` defaults to view-field config
  - **File(s):** `js/constants.js`
  - **Acceptance:** `NUMISTA_VIEW_FIELD_DEFAULTS` (`constants.js:1326-1344`) includes `obverse: true` and `reverse: true`. Existing localStorage entries continue to merge correctly via `{ ...DEFAULTS, ...saved }` (no migration needed).
  - **Leverage:** existing key list; spread-merge already handles forward-compat.
  - **Maps to:** AC-2, AC-5.

- [x] **A.2 [P]** — Add Settings UI toggles for obverse/reverse rows
  - **File(s):** `js/catalog-manager.js`
  - **Acceptance:** Two new `data-nf="obverse"` and `data-nf="reverse"` toggle rows appear in the Numista field-visibility list (matching the markup pattern at `catalog-manager.js:382-470`). Toggling each row in Settings → Item Detail Modal hides/shows the corresponding row in the View modal. `saveNumistaViewFieldConfig` persistence continues to work.
  - **Leverage:** copy the exact existing row pattern; do not invent new structure.
  - **Maps to:** AC-2, AC-5.

- [x] **A.3 [P]** — Refactor `loadViewNumistaData()` for item-priority merge + visible obverse/reverse + tags-dedupe
  - **File(s):** `js/viewModal.js`
  - **Acceptance:**
    - Module-level constant `MEANINGFUL_FALSY_KEYS = new Set(["commemorative", "rarityIndex"])` (D-10).
    - New private helper `hasMeaningfulItemData(itemData)` returns true if `itemData` has at least one defensively-non-empty key (D-9).
    - New private helper `mergeNumistaSources(itemData, cacheMeta)` that:
      1. **Defensively strips non-meaningful empty values** from a copy of `itemData` using `MEANINGFUL_FALSY_KEYS`. Drop a key when: value is `""`, `null`, or `undefined` AND key is not in the meaningful-falsy set. Preserve `false`/`0` for `commemorative` and `rarityIndex`.
      2. Spreads `cacheMeta` as base, overrides with stripped item values.
      3. **Preserves both shape siblings** — `merged.kmRef` (string) and `merged.kmReferences` (array); `merged.mintage` (string) and `merged.mintageByYear` (array). Helper does NOT collapse one into the other.
    - **Soften cache-empty short-circuit at `viewModal.js:1074`:** change `if (!meta) return;` to `if (!meta && !hasMeaningfulItemData(item.numistaData)) return;` — allows item-only render when cache is empty (D-9 / v4-Pro V-7a).
    - All `meta.*` reads in the existing render block (`viewModal.js:1080-1221`) replaced with `merged.*`. When `meta` is null but item data exists, helper still works: `mergeNumistaSources(item.numistaData, null)` returns the stripped item data (treat `null` cacheMeta as `{}` inside helper).
    - **Explicit flat-first precedence at call sites** — Mintage row: `if (merged.mintage) renderFlat; else if (merged.mintageByYear?.length) renderArray;`. References / KM Reference row: `if (merged.kmRef) renderFlat; else if (merged.kmReferences?.length) renderArrayJoined;`.
    - Two new visible full-width rows render `merged.obverseDesc` and `merged.reverseDesc`, gated by `cfg.obverse !== false` and `cfg.reverse !== false`. Pattern mirrors edge-description block at `viewModal.js:1137-1143`.
    - Image-tooltip assignment (`viewModal.js:1146-1157`) remains and reads from `merged.obverseDesc` / `merged.reverseDesc` — additive, not replaced.
    - `view-shape-rect` class assignment (`viewModal.js:1080-1087`) reads `merged.shape`.
    - **Cache TTL refresh path remains intact.** The TTL refresh callback updates IndexedDB only — it does NOT re-render the open modal (per approach D-6). User sees item-over-cache foreground; cache freshness benefits next View open.
    - **Tags-row dedupe:** remove the `meta.tags` row inside the Catalog Data section (`viewModal.js:1160-1166`). The dedicated TAGS section below already renders tags as removable chips; the Catalog Data tag row is redundant. Non-AC visible-behavior change — call out explicitly in CHANGELOG and PR body so reviewers don't treat it as opportunistic. Verify the dedicated TAGS section still renders correctly and nothing else in this block depends on the removed grid.
    - Inline comment at `mergeNumistaSources` documents (a) the defensive-stripping rationale (alternate write paths via `inventory-import.js` and `clone-picker.js`), (b) the future-coupling requirement: any change to `parseNumistaDataFields` that preserves intentional blanks needs lockstep changes here, and (c) the `MEANINGFUL_FALSY_KEYS` exemption list with one-line rationale per key.
    - **DO NOT** edit `js/about.js` What's New, `version.json`, `package.json`, or `CHANGELOG.md` during A.3. Per v4-Pro V-5b, those files are owned by `/release patch` (CLOSE-4). Pre-emptively writing What's New entries causes duplicate / conflicting CHANGELOG entries. CHANGELOG copy lives in CLOSE-4 invocation only.
  - **Leverage:** mirror the proven Layer-1 / Layer-2 pattern in `inventory.js:1222-1254` (`populateNumistaDataFields`); reuse the same `kmReferences` and `mintageByYear` reduction logic at the call sites.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8. (Tags-dedupe is a non-AC cleanup folded in per user direction — explicitly called out in PR body and CHANGELOG.)

> CODEX: The tags cleanup is small, but it is outside the accepted requirements and changes visible behavior for cache tags versus item tags. If it stays folded into A.3, the current test bullet helps; otherwise it is cleaner as its own task or its own acceptance criterion so reviewers do not treat it as opportunistic scope creep.
> → **RESOLVED:** stays folded into A.3 (user-approved). Acceptance text now explicitly tags this as "non-AC visible-behavior change" and requires PR body + CHANGELOG callout. B.1 includes a dedicated test case (test 7).

> CODEX: The helper acceptance should require normalization of raw imported/restored item data or explicitly state that raw empty strings/nulls from import are out of scope. `inventory-import.js` can preserve `raw.numistaData` directly, so a literal spread can override cache fallback with blank values that never went through `parseNumistaDataFields`.
> → **RESOLVED:** A.3 acceptance now mandates defensive empty-value stripping in `mergeNumistaSources` (step 1 of helper contract above). Imported/restored data is now in scope for safe merge.

## Sprint Cohort B — Tests (sequential, depends on A)

- [x] **B.1** — Playwright spec for AC verification
  - **File(s):** `tests/playwright/view-modal-numista-merge.spec.js`
  - **Acceptance:** New spec covering each AC:
    1. **AC-1:** Item with `item.numistaData.composition === "Silver (.9999)"` and cache `composition === "Silver"` → View modal renders "Silver (.9999)".
    2. **AC-2:** Item with non-empty `obverseDesc`/`reverseDesc`/`edgeDesc` → all three render as visible full-width rows; image-slot `title` attributes also still set for obverse/reverse.
    3. **AC-3:** Two items with same `catalogId` but different `item.numistaData.composition` → each item's View modal renders its own composition (close-and-reopen between items).
    4. **AC-4:** After Edit modal save changes diameter `39 → 40`, opening View shows "40 mm".
    5. **AC-6:** Item with `kmRef === "KM#273"` (string) → "KM Reference: KM#273" renders. Cache-only item with `kmReferences === [{catalogue: "KM", number: "274"}]` → still renders.
    6. **AC-7:** Pre-STRK-51 legacy item with no `item.numistaData` → cache-only render path unchanged.
    7. **Tags-dedupe:** ASE-style item → tags appear ONCE (in the dedicated TAGS section), not twice.
    8. **AC-8 partial item metadata:** item has only `kmRef` set (`{ kmRef: "KM#274" }`); cache has full data → View modal renders `KM Reference: KM#274` from item, all other Catalog Data fields render from cache. Background TTL refresh is observable (cache `cachedAt` timestamp is updated after expiry without re-rendering the open modal — verify by reading IndexedDB before/after).
    9. **Defensive empty stripping:** item has `{ composition: "", obverseDesc: null }` (simulating an unnormalized import); cache has valid `composition: "Silver"` → View renders `Silver` from cache (item's empty values are stripped before merge).
    10. **Toggle-off behavior:** user disables `obverse` and `reverse` toggles in Settings → corresponding rows DO NOT render. Re-enable → rows reappear. (Validates A.1 + A.2 reconvergence per the Cohort A integration assumption.)
    11. **Cache-empty + item-populated (D-9 / v4-Pro V-7a):** item has `{ composition: "Silver (.9999)", obverseDesc: "Test obverse" }` and IndexedDB cache has NO entry for the catalogId; no API result available. View modal opens → Catalog Data section renders `composition` and `obverseDesc` from item data. Function does NOT short-circuit on `!meta`.
  - **TDD note:** write tests FIRST against the un-refactored viewModal to confirm they fail in the expected way, then run after A.3 lands to confirm they pass. **Never modify a test to make it pass** — if a test fails after A.3, fix `viewModal.js`.
  - **Depends on:** A.1, A.2, A.3 (all three must be merged into the worktree before B.1 — see Cohort A Integration Assumption).
  - **Leverage:** spec patterns in `tests/playwright/view-modal-no-auto-resync.spec.js`, `tests/playwright/numista-picker-tags.spec.js`. Use `tests/fixtures/`.
  - **Maps to:** AC-1 through AC-8 + tags-dedupe cleanup + defensive-stripping invariant + toggle-off behavior.

> CODEX: Add a test case if you keep D-6: item has one saved `numistaData` field plus stale/missing cache-backed fields. The assertion should prove either that background cache refresh still happens for fallback data, or that suppressing refresh for partial item metadata is the intentionally accepted behavior.
> → **RESOLVED:** D-6 reworked (foreground item-over-cache, background cache refresh continues). Test cases 8 and 9 above explicitly cover partial-item-metadata + background refresh + defensive stripping.

---

> V4-PRO (2026-05-08): **Realistic time estimate.** The sketch's 30–90 min window is accurate for Sprint A (JS-only: A.1 5 min + A.2 5 min + A.3 45–75 min). The full task list including B.1 (Playwright spec — 10 test cases) and CLOSE-1..8 is **4–8 hours**. See approach.md V4-PRO section 6 for slippage analysis.
>
> V4-PRO: **Stamp-sw-cache hazard for multi-model dispatch.** The pre-commit hook `stamp-sw-cache` fires on ANY `js/` file change and auto-adds `sw.js` to the commit. If A.1, A.2, A.3 are committed by different agents in parallel, each commit will carry a competing `sw.js` cache stamp. Let the final rebase settle the stamp; do not hand-edit `sw.js` to resolve.
>
> V4-PRO: **Do NOT pre-write the What's New entry.** Sprint A must NOT edit `js/about.js`. Let CLOSE-4's `/release patch` prepend the entry. Sprint A should supply the user-facing summary text (see approach.md V4-PRO section 3 for a draft) in the PR body or a task comment so `/release` can consume it.
>
> V4-PRO: **Split B.1 recommendation.** Consider B.1a (tests 1–7: core merge + tags dedupe, ~90 min) and B.1b (tests 8–10: TTL refresh, defensive stripping, toggle-off — the three riskiest tests, ~90+ min). If B.1b blocks, the PR can ship with B.1a to get the core fix out while edge-case tests bake. Test 8 (IndexedDB TTL observable without re-render) has no existing fixture precedent and is the highest-risk single test case.

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test` (Playwright E2E). All existing tests pass; new spec from B.1 passes.
  - If anything fails: fix the implementation, not the test.
  - **Note:** `npm test` requires Browserbase. If unavailable, run `npm run test:offline` and document the gap on this task line.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - **MUST invoke `codacy-cli` skill** against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - StakTrakr-specific: ignore pre-existing browser-global `no-undef` findings (project uses script-tag globals). Verify findings only on changed lines (`git diff dev...HEAD`).

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` under heading `## Verification Stamp`.
  - For EACH AC in `requirements.md` (AC-1 through AC-8), write one line:
    - `- [x] AC-N — verified at <relative/file/path>:<line>`, OR
    - `- [x] AC-N — verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>`.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains.

- [x] **CLOSE-4. Version bump**
  - **File:** `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md` (`sw.js` stamped by pre-commit hook).
  - **MUST invoke `/release patch`** — StakTrakr's project-level skill edits 6 files + trims What's New to 8 entries. Do not hand-edit version files.
  - **What's New copy** (per v4-Pro V-3, paste into `/release patch` invocation): "STRK-55: View modal respects per-item edits. The item detail modal now shows YOUR saved Numista customizations instead of the shared catalog snapshot. Obverse and reverse descriptions are now visible text rows in the Catalog Data section. Duplicate tags removed."
  - **Worktree convention:** if `/release patch` requires the branch to follow `patch/<VERSION>` naming (per `AGENTS.md` line 63), let the skill rename or recreate the worktree — do not pre-empt by hand. CLAUDE.md explicitly allows both `<issue>-<slug>` and `patch-<VERSION>` naming, so the issue-named worktree is valid for the implementation phase. Per Codex C-10.

- [ ] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** — performs the audit even if no foundation docs are affected.
  - Mark STRK-55 Done in Plane via `mcp__plane__update_issue` with state `b6039898-c1c1-46ea-8396-1ae8b52f0692` (Done).

- [x] **CLOSE-6. Open PR**
  - Worktree branch `strk-55-view-modal-numista-merge` → target `dev`.
  - Title: `fix(STRK-55): View modal respects per-item Numista edits` (per v4-Pro V-3 — concise + user-meaningful; technical detail goes in body).
  - Body sections:
    1. **What changed (user-facing):** the user-friendly summary from CLOSE-4's What's New copy.
    2. **Technical detail:** item-priority merge over IndexedDB cache, helper-side defensive empty-stripping with `MEANINGFUL_FALSY_KEYS`, explicit flat-first precedence at Mintage and KM Reference rows, softened cache-empty short-circuit (D-9), tags-row dedupe (non-AC cleanup).
    3. **Resolves:** `STRK-55 — https://plane.lbruton.cc/lbruton/browse/STRK-55/`
    4. **Sketch artifacts:** `DocVault/Projects/StakTrakr/sketches/STRK-55-view-modal-numista-merge/`
    5. **Test plan checklist:** mirror B.1 cases 1-11 (AC-1 through AC-8 + tags-dedupe + cache-empty + toggle-off).
    6. **Multi-model review log:** "Reviewed by Codex (architecture lens) and DeepSeek-V4-Pro (shipping risk + technical edge cases lens). All findings resolved inline in sketch artifacts — see `> CODEX:` and `> V4-PRO:` blocks with paired `→ RESOLVED:` notes. Net yield: 9 substantive findings caught and resolved before implementation."

- [x] **CLOSE-7. Resolve PR review threads**
  - **MUST invoke `/pr-resolve`** — scans both inline diff threads AND review-body findings.
  - StakTrakr known false-positives: see CLAUDE.md "Known Reviewer False Positives" section (Gemini duplicates with `"line": null`, ALLOWED_STORAGE_KEYS guard, etc.).
  - All Critical/High findings must be fixed or marked false-positive with reasoning.

- [x] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-55`** — moves folder to `archive/{merge-date}-STRK-55-view-modal-numista-merge/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort A `[P]` tasks split well by complexity: A.1 (constants — trivial, Kimi/Haiku), A.2 (catalog-manager — UI markup, Sonnet/Codex), A.3 (viewModal — load-bearing refactor, keep on Claude/Opus). Each model reads the sketch folder, executes its task, commits to the worktree branch. Reconverge before Cohort B.

## Verification Stamp

- [x] AC-1 — verified by `view-modal-numista-merge — STRK-55 › AC-1: item numistaData composition wins over cached composition`.
- [x] AC-2 — verified by `view-modal-numista-merge — STRK-55 › AC-2: obverse, reverse, and edge render as visible rows and image tooltips`.
- [x] AC-3 — verified by `view-modal-numista-merge — STRK-55 › AC-3: two items sharing one catalogId render their own per-item values`.
- [x] AC-4 — verified by `view-modal-numista-merge — STRK-55 › AC-4: edit-modal save updates item numistaData and View shows the saved diameter`.
- [x] AC-5 — verified by `view-modal-numista-merge — STRK-55 › AC-5/AC-6: flat item fields render before cache arrays and preserve falsy values`.
- [x] AC-6 — verified by `view-modal-numista-merge — STRK-55 › AC-6/AC-7: cache-only legacy item still renders references and mintage arrays`.
- [x] AC-7 — verified by `view-modal-numista-merge — STRK-55 › AC-6/AC-7: cache-only legacy item still renders references and mintage arrays`.
- [x] AC-8 — verified by `view-modal-numista-merge — STRK-55 › AC-8: partial item metadata overrides only its own fields while stale cache refreshes in background`.

Additional verification:

- [x] Tags-dedupe — verified by `view-modal-numista-merge — STRK-55 › tags-dedupe: Catalog Data no longer duplicates the dedicated TAGS section`.
- [x] Defensive empty stripping — verified by `view-modal-numista-merge — STRK-55 › defensive empty stripping: blank imported item data falls back to cache`.
- [x] Toggle-off behavior — verified by `view-modal-numista-merge — STRK-55 › toggle-off behavior: settings UI persists obverse/reverse visibility`.
- [x] Cache-empty item path — verified by `view-modal-numista-merge — STRK-55 › cache-empty item-populated path renders without API metadata`.
- [x] Suite/lint — `npm run lint` passed with 0 errors and 2 pre-existing unused-disable warnings; `npm run test:offline` passed 514/515 on first run with one STAK-437 flake that passed on direct rerun; focused STRK-55 spec passed 11/11 after the final metadata-only guard tweak.
- [x] Codacy — local Codacy CLI produced 0 Opengrep findings; Trivy could not run because the CLI rejected multiple targets; ESLint SARIF only reported the known browser-global `no-undef` pattern, while repo `npm run lint` remained clean.
