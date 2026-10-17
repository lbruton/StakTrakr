---
spec: "STRK-427-unified-image-framing"
phase: tasks
created: 2026-10-10
approved: 2026-10-10
---

# STRK-427 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from `approach.md`. Decisions are cited as D-N and matrix rows as I-/H-/E-/C-N (all in `approach.md`). Acceptance criteria are cited as AC-N.N (`requirements.md`)._

> **Approval gate:** `/spec run` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four spec files.
>
> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/update-spot-bundle`, `/vault-update`, `codacy-analysis analyze --diff`, `/pr-resolve`, `/spec archive`). When generating or executing tasks.md, **invoke skills by name verbatim**. Paraphrasing the steps inline is not equivalent, because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant, mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.
>
> **Two phases, two patch PRs.** `requirements.md` splits the work into **P1** (shared editor, resolver, item data model, sync/import/export, five Collections surfaces) and **P2** (table, card and view-modal renderers). Each phase is its own `patch/<version>` PR to `dev`, with its own Cohort 0 and its own closing block. P2 starts only after the P1 PR has merged.
>
> **Execution notes (all tasks).**
>
> - Every command that targets the worktree carries its own anchoring (`cd <abs worktree> && …` or `git -C`), per `.claude/rules/worktree-cwd.md`. Compare test counts against the known inventory before trusting a green run.
> - Read `.context/coding-standards.md` before writing JavaScript, and `.context/design-philosophy.md` and `.context/style.html` before UI work. Read `.context/implementation-gotchas.md` for the script load order, `state.js` `let` visibility, four themes and `--surface` rules.
> - New top-level names must not collide in the shared script scope (`tests/unit/script-global-scope-collisions.test.js`; avoid `_frameSuffix`, `renderFrameToggles`, `cycleFrame`, `setPendingImageFrames`, `imageShapeTouched`, `suggestedShape` until each is deleted).
> - JSDoc on every new production function (75% docstring gate). Keep shared Playwright setup in existing helpers so Codacy duplication does not flag it. Adding a **new** helper file is outside the File Map: stop and ask first.
> - ESLint is ecmaVersion 2020: no logical-assignment operators.

---

## Phase 1 (P1)

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it. This is setup work, not a stop-the-world gate._

- [x] **0.1** — Ensure the P1 patch worktree exists
  - **File(s):** _no file changes — verification only_ (`/release patch` writes the version lock and the bump in its own flow)
  - **Acceptance:** `git worktree list` shows `.worktrees/patch-<version>/` on branch `patch/<version>`, based on `origin/dev`, with a version-lock claim naming STRK-427 (P1). The working directory is that worktree, not the main checkout. The spec folder `docs/specs/STRK-427-unified-image-framing/` is present in it: merge or cherry-pick the spec branch `chore/strk-427-spec` if it has not reached `dev` yet.
  - **If the worktree does not exist yet:** run `/start-patch` (issue pick → STRK-427), which hands off to **`/release patch`** for the lock and the `patch/<version>` worktree. Do not use the generic `spec/STRK-427-…` branch name (`.context/spec-conventions.md`). Run `npm ci` inside the new worktree; never symlink `node_modules`.
  - **Leverage:** `/start-patch`, `/release patch`, `.context/git-topology.md` §Worktrees.

- [x] **0.2** — File the approach's follow-up issues and fix the Plane brief drift
  - **File(s):** _no file changes — Plane only_
  - **Acceptance:** One STRK issue for each item in `approach.md` → Out of Scope (frame fields in `computeInventoryHash`; framing for the thumb popover, `bulk-row-images.js` and `diff-modal.js`; renaming `.collections-segmented*`; the stale JS count in `.github/copilot-instructions.md:9`). STRK-425, bulk-edit shape and older-build detection already exist as Non-Goals or issues and are linked, not re-filed. Each is related to STRK-427. A comment on STRK-427 says the brief's "three phases" and "hidden item orientation controls in P1" are superseded by `requirements.md` (two phases, per-side controls in P1).
  - **Leverage:** `/issue`, `mcp__plane__workitem`, `mcp__plane__workitem_relation`, `.context/issue-tracking.md` (list states each session; never cache UUIDs).
  - **Maps to:** — (process)

## Sprint Cohort A — Foundation (parallel-safe)

_Independent files, so these can be dispatched concurrently. Scaffolding, data structures and the mockup gate. No behavioral logic yet._

- [x] **A.1 [P]** — Build the STRK-427 mockup and get it approved (**implementation gate**) — _approved 2026-10-10 by lbruton: 200px desktop box, buttons under the preview on desktop and mobile (M-B), 40px thumb clamp; recorded in the playground header_
  - **File(s):** `playground/STRK-427-image-frame-editor.html` (new)
  - **Acceptance:** Built with `/ui-mockup`. It shows every named state in the UI Contract (E-empty, E-one, E-mixed, E-round, E-slab, E-follow, E-pinned, B-builder, M-390) for the item modal and the builder side by side, in light, dark, slate and sepia, at desktop width (1280px) and 390px, plus a P2 section (P2-table, P2-card A/B/C, P2-view, including the legacy-rect case). It sets the **exact** desktop preview size inside the 700px dialog (D-16, AC-6.1) or explicitly shows that the dialog must widen. Widening is a scope escalation (Tradeoff 4) that needs the user's sign-off before C.4. Orientation controls follow Option C, one group per side, named "Obverse orientation" / "Reverse orientation". The user has **explicitly approved** the mockup in chat; record the date and any decisions as a comment at the top of the file. **No task in Cohort C may start before this approval.**
  - **Leverage:** `/ui-mockup`; `playground/STRK-424-orientation-toggle.html` (Option C, ~228-262); `playground/STRK-421-collection-modal-variants.html` (builder hero baseline); `.context/design-philosophy.md`; `.context/style.html` (tokens: `--bg-card`, `--bg-secondary`, `--bg-tertiary`, `--border`, `--border-hover`; never `--surface`). Memory: compare against the Add Item modal in dark at 390px; theme every control.
  - **Maps to:** AC-6.1, AC-6.2, AC-6.3, AC-5.1, AC-1.5, AC-9.1 (P2 section)

- [x] **A.2 [P]** — Scaffold `image-frame-editor.js` and register it in load order
  - **File(s):** `js/image-frame-editor.js` (new), `index.html`, `sw.js`
  - **Acceptance:** The file defines the D-7 controller surface (`mount(root, options)` returning `seed`/`reset`, `signalsChanged`, `swapSides`, `resetSide`, `setSideHasImage`, `getState`, `getResult`, `dispose`, `onChange`). Each method is JSDoc'd and throws `Error("not implemented")`, and the surface is exposed on `window` under one non-colliding name. It is registered in `index.html` immediately after `js/image-frame.js` (`:8965`) and in `sw.js` `CORE_ASSETS` immediately after `./js/image-frame.js` (`:88`). Both positions come before `inventory.js` (8973), `events.js` (8989) and `collections-picker.js` (9026). `npm run test:unit` (including `script-global-scope-collisions.test.js`) and `npm run lint` pass. The app boots with no console error.
  - **Leverage:** `js/image-frame.js` (module style); the `sw.js` cache stamp hook stamps `CACHE_NAME` automatically.
  - **Maps to:** AC-1.1

- [x] **A.3 [P]** — Move the frame ratio tokens to `:root` (pure refactor)
  - **File(s):** `css/styles.css`
  - **Acceptance:** `:root` declares `--frame-bar-portrait`, `--frame-bar-landscape`, `--frame-note-portrait`, `--frame-note-landscape` with today's values and `--frame-slab: 0.68` (D-15). The `--collections-frame-*` declarations at `:17997-18003` are removed, and every medallion, album and builder rule that read them reads the shared tokens. **No rendered value changes** in this task: the builder Slab stays 3:4 until C.5, and `npm run test:core` → `collections.spec.js` (STRK-421/424 ratio and width cases) is unchanged and green.
  - **Leverage:** `discovery.md` §D.
  - **Maps to:** AC-2.2 (foundation)

- [x] **A.4 [P]** — Unit harness loads the real `image-frame.js` into `collections-core`
  - **File(s):** `tests/unit/collections-core.test.js`
  - **Acceptance:** `loadCore` (`:28-45`) also evaluates the real `js/image-frame.js` into the surface, the way it loads `utils.js`. A variant loader without it stays available for the fail-closed test in B.2. **No existing assertion is edited** (Tradeoff 7), and all existing cases still pass.
  - **Leverage:** the existing `utils.js` load in `loadCore`.
  - **Maps to:** AC-4.1 (foundation)

- [x] **A.5 [P]** — Typedef the new item fields
  - **File(s):** `js/types.js`
  - **Acceptance:** The `InventoryItem` typedef (`:38-39`) documents optional `imageShape` (`'round'|'bar'|'note'|'slab'`), `obverseImageOrientation` and `reverseImageOrientation` (`'portrait'|'landscape'`) as "absent = derived". Lint passes.
  - **Maps to:** AC-7.1

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Each test encodes an acceptance criterion and **must fail** before Cohort C. Playwright cases assert the interaction flow and DOM structure (visible controls, checked state, rendered frame geometry, stored keys after reopen), never storage alone (`.context/testing.md`). Item-modal cases open the modal via `#newItemBtn` after `window.appListenersReady`, or with `window.editItem(idx)`, and switch themes with `window.setTheme(name)`._

- [x] **B.1** — Unit RED: resolver, reader, writer, normalizers
  - **File(s):** `tests/unit/image-frame.test.js` (new)
  - **Acceptance:** Failing cases for:
    - `deriveImageShape`: the AC-4.2 order (grading first → Slab; Bar/Set → Bar; Note/Aurum/Goldback/Silverback → Note; Coin + non-round Numista → Bar; else Round; non-Coin + non-round Numista → by Type, D-18).
    - Orientation defaults: Bar portrait, Note landscape.
    - Enum normalizers: `''`, `auto`, unknown and wrong-case values read as absent (I-9, I-10).
    - **Reader** precedence: new field, else legacy obverse mapping, else derived (AC-8.1/8.2). `circle` → Round; `rectangle` → the derived shape, or Bar when that is Round (D-3). Reverse legacy is ignored (AC-8.4).
    - **Writer** (D-2/D-4): stores only deviations, strips orientation for non-rotating shapes, projects the legacy `circle`/`rectangle` pair on an explicit shape, returns the keys to delete on a sparse result. Includes the signal-only case: a stored `note` on a Coin whose Type becomes Goldback yields no `imageShape` and a delete of both legacy keys.
    - The stale-orientation read (I-7): ignored under Round, not deleted, and re-applied under Bar.
    - Enum values survive `sanitizeObjectFields` (alphanumeric).

    All fail with "not a function" or wrong values.
  - **Depends on:** A.2
  - **Leverage:** `js/image-frame.js:31-65` (current resolver); `tests/unit/helpers/source-extract.js`; the `utils.js` loading pattern in `tests/unit/collections-core.test.js`.
  - **Maps to:** AC-4.1, AC-4.2, AC-7.1, AC-7.3, AC-8.1, AC-8.2, AC-8.4, AC-8.5

- [x] **B.2** — Unit RED: Collections reverse key and the resolver seam
  - **File(s):** `tests/unit/collections-core.test.js` (additive cases only)
  - **Acceptance:** Failing cases for:
    - `defaultImageShapeForType` delegates to `window.deriveImageShape` (Goldback → Note), and **fails closed to Round** under the loader without `image-frame.js`.
    - `normalizeDefinition` keeps `reverseImageOrientation`, but drops it when the shape does not rotate or when it equals `imageOrientation` (D-10 canonical form, C-5).
    - `reverseImageOrientationFor` falls back to the obverse value, including the legacy-landscape pin for pre-STRK-424 Bar/Note (AC-5.5).
    - Create and update mirror the obverse rules and bump `metaModified` (AC-5.3).
    - A stripped copy against a full copy tied on `metaModified` merges to the same result in either order, `merge(A,B)` deep-equals `merge(B,A)` (C-1, C-2).
    - A new Bar or Note saved at its default reopens at that default, distinct from legacy absence (AC-5.5).
  - **Depends on:** A.4
  - **Leverage:** existing shape/orientation and `metaModified` cases (`:771-1008`, `:1451-1462`).
  - **Maps to:** AC-4.1, AC-5.2, AC-5.3, AC-5.5

- [x] **B.3** — Unit RED: hash gate, sync registration and the cross-version matrix
  - **File(s):** `tests/unit/cloud-sync-image-frame-hash.test.js` (new)
  - **Acceptance:** Cases using `tests/unit/helpers/source-extract.js`, the way the STRK-241 hash test does:
    - **Old-build (O) functions pinned in the test file.** During Cohort B, before any Cohort C task touches the sources, pin O's `resolveImageFrame`, `computeInventoryHash`, the `DIFF_FIELDS` modify-apply path (`js/diff-engine.js:839-894`), the JSON/CSV import readers and `normalizeDefinition` as source literals inside this test file (captured from the current worktree, which is still O). No new helper or fixture file.
    - **One assertion per cross-version matrix row** (`approach.md` → Cross-version matrix), with expected losses asserted as losses rather than skipped:
      - I-1–I-10: N writer output run through O's resolver/edit spread, and N's reader over O-edited records (for example, I-3: O's Type edit keeps the new fields and does not move the frame; I-4: O's legacy edit is ignored by N; I-6: `rectangle` maps through the new Type).
      - H-1: absent and `''` hash the same **and** produce no diff on the new build.
      - H-2: a different shape or orientation changes the hash **and** produces a field-level diff via `DIFF_FIELDS`.
      - H-3: O's pinned hash over an N inventory with the fields differs from N's, while O's field diff is empty (accepted loss, asserted).
      - H-4: an inventory with none of the new fields hashes byte-identically under O's pinned function and N's.
      - H-5: O's `modify` apply drops new-field changes; an `add` keeps the whole record.
      - E-2: an N export run through O's JSON/CSV readers drops the new keys and the frames as the matrix states; a ZIP `add` keeps them.
      - C-1 (O side): O's `normalizeDefinition` drops `reverseImageOrientation`, and the reverse then falls back to the obverse value.
    - The gated segment is tagged distinctly from the STRK-241/242 block.
    - The legacy `*ImageFrame` fields stay out of the hash (D-12).
    - The three fields are in `DIFF_FIELDS` (Images group) and in the `changeLog.js` field array (AC-8.6).

    New-behavior cases fail until C.7. Rows that pin O-only behavior or an unchanged hash (H-4, H-3/H-5/E-2/C-1 O-side losses) are compatibility pins and may already pass (see B.9).
  - **Depends on:** —
  - **Leverage:** the existing STRK-241 hash test in `tests/unit/` (find it with `grep -l computeInventoryHash tests/unit`); `js/cloud-sync.js:123-165`; `js/diff-engine.js:30-94, 839-894`; `js/changeLog.js:142-197`; `js/inventory-import.js` readers; `js/collections-core.js` `normalizeDefinition`.
  - **Maps to:** AC-5.3, AC-8.2, AC-8.3 (I, H, E-2 and C-1 rows), AC-8.6

- [x] **B.4** — Playwright RED: item-modal editor interaction
  - **File(s):** `tests/playwright/core/image-frame-editor.spec.js` (new)
  - **Acceptance:** Failing cases at desktop width:
    - **E-empty**: on a new item with no images, the "Image shape" radiogroup and both frames are visible (AC-1.5), and the `COIN_IMAGES` flag off still hides `#imageUploadGroup` (D-16).
    - Choosing a shape reshapes both frames immediately: the rendered ratio matches the token, with no save (AC-2.1).
    - **E-round/E-slab**: no orientation group is shown (AC-2.3). Bar/Note show "Obverse orientation" and "Reverse orientation" (AC-5.1), and each starts at its default (AC-4.8).
    - All four shapes are selectable for Coin, Bar and Goldback (AC-4.7).
    - **E-follow**: on a derived shape, Coin → Goldback shows Note (AC-4.6) and Note → Bar re-derives (AC-4.3).
    - **E-pinned**: with Slab chosen on a Coin, a Type change leaves it (AC-4.4).
    - D-5 hybrid: with Round chosen on an ungraded Coin, applying a grading authority **stays Round**. On an untouched shape, the same grade re-derives Slab, and so does a programmatic `pcgs-api`-style set followed by the notify path (AC-4.5).
    - **E-mixed** + swap: portrait obverse with landscape reverse → Swap exchanges the images **and** the orientations, and the shape is unchanged (AC-3.1). The existing busy/`inert` guard is still applied during the swap (AC-1.3).
    - Swap visibility follows real image presence, not frame visibility: Swap is hidden in E-empty and E-one (both frames visible) and shown only when both sides hold an image, across seed, upload/URL/camera, Remove and swap completion.
    - Remove resets that side's orientation and keeps the shape (AC-3.3).
    - Save → reopen shows exactly the chosen shape and orientations for all four shapes, including Slab and Note on an ungraded Coin (AC-7.2). The **stored record** has only the deviating keys plus the legacy projection (AC-7.1/7.3).
    - D-4: a stored `note` Coin changed to Goldback and saved leaves no `imageShape` and no legacy frame keys.
    - Untouched edit of a legacy mixed `circle`/`rectangle` item leaves both legacy fields byte-identical (I-8, AC-8.5). A legacy `rectangle` Coin opens as Bar (D-3, AC-8.1).
  - **Depends on:** A.2
  - **Leverage:** `tests/playwright/helpers/seed.js`; `tests/playwright/helpers/test-obverse.png` / `test-reverse.png`; the swap cases in `tests/playwright/core/collections.spec.js:349-540` (`_pendingItemImageSwap` pattern); the archived `strk-121-image-frame-override.spec.js:76-223` for item-modal flows; mockup states from A.1.
  - **Maps to:** AC-1.3, AC-1.5, AC-2.1, AC-2.3, AC-3.1, AC-3.3, AC-4.3–AC-4.8, AC-5.1, AC-5.4, AC-7.1–AC-7.3, AC-8.1, AC-8.4, AC-8.5

- [x] **B.5** — Playwright RED: item-modal layout, themes and builder parity
  - **File(s):** `tests/playwright/core/image-frame-editor.spec.js` (same file as B.4, so sequential)
  - **Acceptance:** Failing cases:
    - At 1280px each preview frame is larger than 140px, at the size the A.1 mockup sets (AC-6.1).
    - At 768px and 390px each preview keeps the 140px cap and the existing ids, the Upload/URL/Camera/Remove buttons stack **under** the preview (approved departure from AC-6.2's "unchanged", mockup option M-B, 2026-10-10), and the new radio options are ≥44px tall (D-8). Size values are compared with those captured from `dev` before C.4 for the elements that did not move (labels, size info, URL input).
    - In light, dark, slate and sepia at 1280 and 390, the editor background, borders and remove badge use per-theme tokens, with canvas-sampled contrast against the modal background (AC-6.3, AC-10.2, no `--surface`).
    - Settings → Images `.image-upload-preview img` keeps its 140px cap (AC-1.4).
    - The builder mounts the **same** editor: the `.ife` root and the same radiogroup names and frame `data-shape`/`data-orientation` contract in both modals (AC-1.1, B-builder).
  - **Depends on:** B.4
  - **Leverage:** memory "--surface is light-only" (canvas contrast pattern); `tests/playwright/core/collections.spec.js:925-1010` (STRK-421 width and STRK-426 badge-contrast cases); `tests/playwright/core/mobile-and-layout.spec.js`.
  - **Maps to:** AC-1.1, AC-1.4, AC-6.1, AC-6.2, AC-6.3, AC-10.2

- [x] **B.6** — Playwright RED: Collections surfaces, builder swap, locator re-baseline
  - **File(s):** `tests/playwright/core/collections.spec.js`
  - **Acceptance:**
    - **Re-baseline (Tradeoff 10):** the five `getByRole("radiogroup", { name: "Orientation" })` locators (`:1507, :1549, :1574, :1603, :1679`) become `{ name: "Obverse orientation" }`, with **no assertion edited**. This is a disclosed contract change, not an edit to make a test pass.
    - Additive failing cases:
      - A mixed pair (portrait obverse, landscape reverse) saved in the builder reopens with both orientations, and renders per side in the builder preview, the Album title pair, Album Slot tiles and Ledger rows (reverse-side Collection), and Hub card and Ledger-row medallions. Each frame's **width and ratio** are pinned (AC-5.2, D-11, D-15).
      - Legacy uniform Bar/Note pairs and a pre-STRK-424 Collection keep today's rendered widths and ratios (AC-10.1, AC-5.5). Measured on `dev` once the modal's `scale(0.95)` entrance animation has settled (a rect read mid-animation is 5% small): the builder frames render at their `--collections-cover-size` tokens, 80/108/80/160/128px for Bar portrait, Bar landscape, Note portrait, Note landscape and Round; the Album title medallion is 92px, the Slot tile 112px, the Hub card 84px and Ledger rows 40px for every shape, with the ratio doing the shaping.
      - Builder Slab box is 0.68 at its current 100px width (AC-10.1, AC-2.2).
      - Builder swap exchanges images and orientations (AC-3.2).
      - **Stored pair → Remove one side → Swap → Save → reopen**: the remaining image is on the swapped side and the removed side is empty (D-9).
      - A forced failed blob read swaps nothing.
      - Grading-free Collections still follow Type on a derived shape.
  - **Depends on:** B.5
  - **Leverage:** existing STRK-421/424 cases (`:925-1010`, `:1497-1681`); `tests/playwright/helpers/collections-fixtures.js`; `seedAndGoto`, `openCollectionsTab`, `builderModal` helpers in the spec.
  - **Maps to:** AC-2.2, AC-3.2, AC-5.1, AC-5.2, AC-5.5, AC-10.1

- [x] **B.7** — Playwright RED: Collection definition data paths
  - **File(s):** `tests/playwright/core/collections-data-paths.spec.js` (additive cases only)
  - **Acceptance:** Failing cases:
    - A mixed-pair definition's `reverseImageOrientation` round-trips through ZIP backup/restore and the standalone Collections export/import.
    - A uniform pair carries no reverse key after save (C-5).
    - `Collections` stays the last CSV column (`:406` unchanged).
  - **Depends on:** B.6
  - **Leverage:** existing definition round-trip cases in the spec; `discovery.md` §G persistence list.
  - **Maps to:** AC-5.2, AC-5.3

- [x] **B.8** — Playwright RED: item import/export round trips
  - **File(s):** `tests/playwright/core/import-export.spec.js` (additive cases only)
  - **Acceptance:** One checklist case per path (D-13). An item carrying all five fields (explicit shape, mixed orientations, legacy projection) round-trips through ZIP backup, JSON export → JSON import, standard CSV export → import, and ZIP CSV. Use **real exported files**, not hand-built CSVs, because of PapaParse's carriage return on the last header (E-1, AC-8.7).
    - A sparse item exports with no new keys and no `''` legacy frames (ZIP JSON omits absent keys, Tradeoff 8).
    - New columns `Image Shape`, `Obverse Image Orientation`, `Reverse Image Orientation` appear before `Collections` in both header lists. `Obverse Frame`/`Reverse Frame` stay immediately after `Reverse Image URL` (`expectFrameColumns` unchanged).
    - Invalid enum values in an imported CSV read as absent (I-10).
    - Values survive `loadInventory` sanitizing.
  - **Depends on:** B.7
  - **Leverage:** `expectFrameColumns` (`:91-100`), ZIP JSON key checks (`:360-374`), the STRK-185 legacy-payload cases in the spec.
  - **Maps to:** AC-8.3 (E rows), AC-8.7, AC-8.8

- [x] **B.9** — Confirm RED
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Run `npm run test:unit` and `npx playwright test tests/playwright/core/image-frame-editor.spec.js tests/playwright/core/collections.spec.js tests/playwright/core/collections-data-paths.spec.js tests/playwright/core/import-export.spec.js`, then record the expected failures **per assertion** in the PR notes, in two classes:
    - **New-behavior cases** must fail now. Any that passes is not testing new behavior: fix it before Cohort C.
    - **Compatibility pins** must pass now and stay green: H-4 byte-identity, the O-side loss rows in B.3 (H-3, H-5, E-2, C-1), sanitizer survival, legacy Collections widths and ratios, `Collections` as the last CSV column, `expectFrameColumns`, and the 140px Settings cap.
    - Every other pre-existing case is still green. **Exception:** the five re-baselined STRK-424 locator cases (Tradeoff 10, `collections.spec.js:1507, :1549, :1574, :1603, :1679`) are expected RED until C.5, because the current builder (`js/collections-picker.js:1211-1221`) has no "Obverse orientation" name.
  - **Depends on:** B.1–B.8
  - **Maps to:** AC-10.3

### B.9 record — RED confirmation (2026-10-10, tree `patch/3.36.46` before any C task)

**Unit (`npm run test:unit`):** 1138 tests, 75 fail, 1063 pass. The 1047 pre-existing tests all pass (baseline on `dev`: 1047/1047). The 91 new tests split as:

- **New behavior, RED (75):** `image-frame.test.js` 46 (every `deriveImageShape`, `defaultImageOrientation`, normalizer, `readImageFraming` and `writeImageFraming` case: "is not a function"); `collections-core.test.js` 16 (resolver seam delegation and fail-closed, reverse key keep/drop/canonical form, `reverseImageOrientationFor`, create/update/`metaModified`, save/reopen, tie merge precondition); `cloud-sync-image-frame-hash.test.js` 13 (I-1…I-9/I-10, H-2, H-3, C-1 O side, changeLog registration).
- **Compatibility pins, green and must stay green (16):** `image-frame.test.js` 2 (sanitizer survival); `collections-core.test.js` 6 (real resolver Goldback → Note, and the other cases that assert today's behavior); `cloud-sync-image-frame-hash.test.js` 8 (H-1, H-4, D-12, segment tag, H-5, E-2 ×2, legacy frames still diffed).

**Playwright core:**

- `image-frame-editor.spec.js` (new, 26): 23 RED at the editor assertions; 3 compatibility pins pass (`COIN_IMAGES` off hides the group, the item swap guards are unchanged, Settings → Images keeps its 140px cap).
- `collections.spec.js` (117 existing + 7 new): 10 fail. Four are the **re-baselined STRK-424 locator cases** (`:1497, :1539, :1562, :1667`, five locators; expected RED until C.5 because "Obverse orientation" does not exist yet); six are new RED (mixed pair on every surface, builder Slab ratio 0.75 → 0.68, builder Swap, Remove-then-Swap-then-Save, failed stored-image read). Compatibility pins that pass: legacy uniform pairs and a pre-STRK-424 Bar keep their rendered builder widths and ratios; a Collection with no grading follows Type on a derived shape. All 113 other pre-existing cases pass.
- `collections-data-paths.spec.js` (3 new): 2 RED (mixed pair through the standalone export/import and through ZIP backup); 1 compatibility pin passes (a uniform pair carries no reverse key).
- `import-export.spec.js` (5 new): 5 RED (JSON export and import, standard CSV export and import, ZIP JSON/CSV/restore parse, sparse item, invalid enums). All pre-existing cases pass.

Totals: 75 unit + 23 + 10 + 2 + 5 = 115 RED assertions-by-test; every pre-existing test is green except the five re-baselined locators.

**Test inventory delta for the P1 PR:** `+92 unit tests, +32 +10 +3 +5 = +50 Playwright tests, +3 files (image-frame.test.js, cloud-sync-image-frame-hash.test.js, image-frame-editor.spec.js)` (26 editor cases at C.10 plus 2 clone-clearing, 2 duplicate-framing and 1 legacy-click cases, and 7 Collections cases plus 2 builder-swap race cases, added for the Codex findings on PR #1572); no test removed or edited (five locator strings re-baselined, Tradeoff 10).

## Sprint Cohort C — Implementation · GREEN (sequential)

_TDD green phase. Write the minimum code that makes Cohort B pass. **C.3 onward requires the A.1 mockup approval.**_

_**Scoped gates.** Each task's gate covers only the assertions it implements; the task names the cases that stay RED and the task that turns them green. The full-suite gate (every Cohort B case green) runs once, at the end of C.8. A case listed as "stays RED until C.N" does not block checking off an earlier task._

- [x] **C.1** — Pure rules in `image-frame.js`
  - **File(s):** `js/image-frame.js`
  - **Acceptance:** Adds `deriveImageShape`, the orientation default, the enum normalizers, the reader (D-3) and the writer (D-2/D-4, returning set and delete keys). `resolveImageFrame` is **unchanged** (D-18, P1). B.1 is green.
  - **Depends on:** B.9
  - **Maps to:** AC-4.1, AC-4.2, AC-7.1, AC-7.3, AC-8.1, AC-8.2, AC-8.4

- [x] **C.2** — `collections-core` seam and reverse key
  - **File(s):** `js/collections-core.js`
  - **Acceptance:** `defaultImageShapeForType` calls `window.deriveImageShape({ type })` through the fail-closed seam (the `getUnitOztWeight` precedent). `normalizeDefinition` whitelists and canonicalises `reverseImageOrientation`. Adds `reverseImageOrientationFor`, and create and update mirror the obverse rules. The module stays DOM-free. B.2 is green.
  - **Depends on:** C.1
  - **Maps to:** AC-4.1, AC-5.2, AC-5.3, AC-5.5

- [x] **C.3** — The shared editor and its CSS
  - **File(s):** `js/image-frame-editor.js`, `css/styles.css`
  - **Acceptance:** Implements the D-7 controller:
    - Slot hooks (`data-ife-*`), throwing on a missing required slot.
    - Shape radiogroup "Image shape", and per-side "Obverse orientation" / "Reverse orientation" radiogroups using `.collections-segmented*` markup (D-8), with its own DOM helper and glyphs.
    - The D-5 hybrid following with the `shapeChosen` flag, seeded from explicit record signals (D-6).
    - `swapSides`, `resetSide`, `getResult` via the C.1 writer.
    - Sets `data-shape`/`data-orientation` on frames only.

    CSS under `.ife`: frame ratios from the `--frame-*` tokens (Round = 1, no literal ratios), the D-8 sizing block (wrapping, compact spacing, `min-height: 44px` options at `max-width: 768px`), `prefers-reduced-motion` disabling transitions, and theme tokens per the UI Contract (no `--surface`). **Gate:** lint passes, B.1 and B.2 stay green, and no pre-existing unit case regresses. B.3's new-behavior cases stay RED until C.7. B.4–B.6 stay RED until the mounts (C.4–C.6).
  - **Depends on:** C.1, **A.1 approved**
  - **Leverage:** `js/collections-picker.js` `segmented()` (pattern only; leave it in place); `builderIcon` glyphs; STRK-424 Option C.
  - **Maps to:** AC-1.2, AC-2.1, AC-2.3, AC-4.3–AC-4.8, AC-5.1, AC-1.4

- [x] **C.4** — Mount the editor in the Add/Edit Item modal
  - **File(s):** `index.html`, `js/events.js`, `js/inventory.js`, `js/pcgs-api.js`, `js/catalog-numista-modal.js`, `css/styles.css`
  - **Acceptance:**
    - `index.html`: slot hooks added to the image section (`:1865-2038`), the two `.frame-toggle` buttons removed, and every pinned id kept.
    - `events.js`: removes the pending-frame state and helpers (`:404-406`, `:479-523`) and the `cycleFrame` wiring (`:3095-3103`). Mounts the editor, resets it from `clearUploadState`, calls `resetSide` from Remove and `swapSides` from the existing guarded swap handler (guards untouched), and calls `signalsChanged` from the Type listener, `handleTypeChange`, and new `change` listeners on `#itemGradingAuthority` and `#numistaShape`. Replaces the frame read and write (`:1688`, `:1835-1840`, `:1930-1931`) with the editor result and the C.1 writer: on edit the writer always runs and applies only a differing result (D-4).
    - `inventory.js` `editItem` seeds the editor from the record (replaces `setPendingImageFrames`, `:2095-2097`).
    - Replace the swap-visibility predicate: `updateSwapButtonVisibility` (`events.js:468-477`) currently treats both preview elements being visible as proof that both images exist, which is false once empty frames stay visible (D-16). Drive it from actual per-side image presence, and feed `setSideHasImage` on seed, upload/URL/camera, Remove and swap completion. The async race guards stay unchanged; visibility is a separate condition.
    - `pcgs-api.js:618-621` and `catalog-numista-modal.js:1097` (plus after `populateNumistaDataFields`) notify the editor.
    - Desktop preview sizing in `@media (min-width: 769px)`, scoped under `#inventoryForm .ife`, with the base `.image-upload-preview img` rule (`:3822-3828`) not edited. The preview bounding box is the approved 200px square. At `max-width: 768px` the box stays at the 140px cap and the buttons stack under it (mockup M-B, same arrangement as desktop).
    - `events.js` net line count falls.
    - **Gate:** B.4 is green, and B.5 is green except the builder-mount parity case (stays RED until C.5).
  - **Depends on:** C.3
  - **Leverage:** `discovery.md` §B; the STRK-67 D-11 delete discipline; memory "safeGetElement returns a partial dummy".
  - **Maps to:** AC-1.1–AC-1.5, AC-2.1, AC-3.1, AC-3.3, AC-4.3–AC-4.8, AC-5.4, AC-6.1, AC-6.2, AC-7.1–AC-7.3, AC-8.5

- [x] **C.5** — Mount the editor in the Edit Collection builder
  - **File(s):** `js/collections-picker.js`, `css/styles.css`
  - **Acceptance:**
    - `collections-picker.js` mounts the editor in collection mode. It removes the old shape/orientation controls, `imageShapeTouched`, `suggestedShape` and the inline map (`:1193-1288`), and the shape glyph entries from `BUILDER_ICONS` if no other reference remains (grep first). `builderSeed` and save carry `reverseImageOrientation` (`:1612-1681`).
    - `imageChooser` gains snapshot/apply per D-9: removal precedence, empty-destination marks removed, atomic swap with no partial orientation swap on failure, a toast, and the busy/`inert` state.
    - CSS: removes the builder per-shape ratio rules (`:19628-19650`) and moves `--collections-cover-size` selection onto each frame's own `[data-shape][data-orientation]` with unchanged values (D-15). Builder Slab is on `--frame-slab`. The `.collections-image-pick` class stays on the frames.
    - **Gate:** the B.5 builder-mount parity case is green; the builder-only B.6 cases are green (builder reopen and builder preview per side, legacy widths and ratios, Slab 0.68, builder swap, the D-9 remove-then-swap case, the failed blob read, grading-free Type following); the five re-baselined STRK-424 locator cases and all STRK-421/424/426 cases are green. The B.6 Album/Hub per-side surface cases stay RED until C.6 (the Album title loop at `js/collections-album.js:105-117` still passes one orientation to both sides).
  - **Depends on:** C.2, C.4
  - **Maps to:** AC-3.2, AC-4.1, AC-5.1, AC-5.2, AC-10.1, AC-2.2

- [x] **C.6** — The other Collections surfaces read per side
  - **File(s):** `js/collections-ui.js`, `js/collections-album.js`, `js/collections-hub.js`
  - **Acceptance:**
    - The entry projection (`collections-ui.js:699-738`) carries `reverseImageOrientation`, and Series Template entries keep projecting landscape for Bar/Note.
    - The Album title pair picks orientation per side in its `titleSides` loop (`:95-121`).
    - `buildSlotCoin` (`:569-599`) and `buildEntryCoin` (`collections-hub.js:394-413`) pick by `definition.side`. A title fallback image uses the coin's nominal side (D-11).
    - **Gate:** the remaining B.6 Album/Hub surface cases and B.7 are green, so all of B.6 is now green.
  - **Depends on:** C.5
  - **Maps to:** AC-5.2, AC-9.4 (unchanged Slot rule)

- [x] **C.7** — Diff, change log and hash registration
  - **File(s):** `js/diff-engine.js`, `js/changeLog.js`, `js/cloud-sync.js`
  - **Acceptance:**
    - `DIFF_FIELDS` Images group (`:75-76`) and the `changeLog.js` field array (`:181-182`) gain the three fields.
    - `computeInventoryHash` appends a truthiness-gated, distinctly tagged segment after the STRK-241/242 block (`:158-165`), and the legacy frames stay out of it.
    - B.3 is green, including H-4 byte-identity.
  - **Depends on:** C.1
  - **Leverage:** `.context/cloud-sync-convergence.md` (STRK-154 invariant).
  - **Maps to:** AC-8.3, AC-8.6

- [x] **C.8** — Import/export enumeration sites (disclosure: one existing fixture, the "older CSV" derivation in `collections-data-paths.spec.js`, now also drops the three new columns, since a pre-STRK-371 export has none; its assertions are unchanged)
  - **File(s):** `js/inventory.js`, `js/inventory-backup.js`, `js/csv-export.js`, `js/inventory-import.js`
  - **Acceptance:**
    - `exportJson` (`inventory.js:2554-2596`) projects all five fields sparsely.
    - ZIP JSON writer (`inventory-backup.js:121-135`) writes the three new fields and omits all five when absent.
    - `BACKUP_CSV_HEADERS` and cells (`:8-47`, `:251-288`) and `csv-export.js` headers and cells (`:100-146`, `:163-200`) append the three columns before `Collections` (D-14), with the index comments updated.
    - `inventory-import.js` reads the legacy frames and the new fields with enum validation in JSON import (`:1564-1602`), `_readCsvIdentityFields` (`:747-755`) and the test-only parse branch (`:1848-2006`), with camelCase aliases.
    - **Gate:** B.8 is green.
    - **Full-suite checkpoint:** every Cohort B case (B.1–B.8) is green, as are all pre-existing unit and core cases, with counts matching the inventory plus the B delta. Nothing stays RED past this point.
  - **Depends on:** C.4 (shares `js/inventory.js`)
  - **Leverage:** `discovery.md` §E; the STRK-235/242 enumeration rule; the STRK-371 column note.
  - **Maps to:** AC-8.7, AC-8.8

- [x] **C.9** — P1 inventory, docs and component catalog
  - **File(s):** `tests/playwright/coverage-map.csv`, `.context/GLOSSARY.md`, `.context/deep-dives/data-model.md`, `.context/cloud-sync-convergence.md`, `.context/style.html`
  - **Acceptance:**
    - `coverage-map.csv` gets a new row for `core/image-frame-editor.spec.js`, updated `test_count` and rationale for `collections.spec.js`, `collections-data-paths.spec.js` and `import-export.spec.js` (noting the Tradeoff 10 re-baseline), and the archived `strk-121-image-frame-override` rows marked superseded for the three-state toggle (Tradeoff 6).
    - GLOSSARY: Image Shape, per-side Image Orientation and sparse/derived terms.
    - data-model: the three item fields and the definition `reverseImageOrientation`.
    - convergence: the hash segment row and the H-3 limitation.
    - `style.html`: the editor component with its tokens, replacing the 140px "Image Uploads" pattern text (`:1616-1730`).
    - `npm run lint:md:all` passes.
  - **Depends on:** C.8
  - **Maps to:** AC-10.3

- [x] **C.10** — P1 visual verification against the mockup — _evidence: `playground/images/STRK-427-evidence/` (E-empty, E-one, E-follow, E-pinned, E-round, E-mixed, E-slab for the item modal, B-builder for the builder; each in light, dark, slate and sepia at 1280 and 390; the 390 shots show the icon-only orientation options and buttons under the preview of option M-B). No deviation from the approved mockup other than the builder's captions top-aligning per side, which the builder already did._
  - **File(s):** _no file changes — screenshots attached to the PR_
  - **Acceptance:** In the browser preview (launch.json in the **main** checkout with `--directory` pointing at this worktree; memory "Preview server for a worktree"), each UI Contract state (E-empty, E-one, E-mixed, E-round, E-slab, E-follow, E-pinned, B-builder, M-390) is captured in all four themes at 1280 and 390 and compared side by side with the approved A.1 mockup. Any deviation is fixed or explicitly accepted by the user. The screenshots go in the PR.
  - **Depends on:** C.9
  - **Maps to:** AC-6.3, plus visual evidence for every UI-Contract AC in the CLOSE-P1-3 stamp

## Standard Closing Tasks — P1

- [x] **CLOSE-P1-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test` (core Playwright PR gate), plus `npm run test:unit` and `npm run lint`, with counts compared to the pre-change inventory plus the B delta. `npm run test:legacy` is expected to fail only on the superseded `strk-121` toggle cases (Tradeoff 6); record that.
  - If anything else fails: fix the implementation, not the test.
  - _Result (final tree, after the CLOSE-P1-2 refactor): at C.10, unit 1138/1138 and core Playwright 878/878 (837 on `dev` + 41 new: 26 + 7 + 3 + 5). The review fixes on PR #1572 then added 2 clone cases, 2 builder-swap race cases, 2 duplicate-framing cases, 1 legacy-click case, 1 legacy-follows-Type case and 1 throwing-stored-preview case to core, and 1 whitespace-only Numista shape case to unit, so the final gates are core 887/887 and unit 1139/1139, re-run green after the fixes; `npm run lint` and `npm run lint:md:all` clean. `npm run test:legacy` (604 archived tests): `origin/dev` already fails 235 of them (archive rot, not a CI gate); this branch fails 234. The one failure only this branch has is `strk-121-image-frame-override` "edit modal cycles, swaps, removes, previews URL images, and clears explicit overrides back to absent auto", the superseded three-state toggle (Tradeoff 6). Two tests that fail on `dev` pass here. No other regression._

- [x] **CLOSE-P1-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-analysis analyze --diff`. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Check duplication (shared test setup goes in existing helpers) and docstring coverage on new production code (`.context/review-and-ci.md`).
  - _Result: `--diff` exhausts the heap (exit 134) in the bundled Stylelint on `css/styles.css`, a 20k-line file; the unmodified `origin/dev` copy OOMs the same way, so it is a local-tool limit, not this branch. Scanned instead file by file (every changed `js/`, `sw.js` and `tests/` file): 0 Critical/High, 0 security, 0 ESLint, 0 Opengrep/Trivy findings, 0 findings in the 7 changed test files and in `js/image-frame.js`, `js/image-frame-editor.js`, `js/inventory-backup.js`, `js/pcgs-api.js`, `js/types.js`, `js/collections-hub.js`, `js/catalog-numista-modal.js`, `sw.js`. Only Lizard Medium (complexity/size) findings remained, all in functions and files already over threshold on `origin/dev`. Compared against `origin/dev` with Lizard: fixed the ones this branch could cleanly avoid (`builderSeed` CCN 55 → 50 via the new `builderSeedFraming`; the JSON-import spread moved last so Lizard does not re-attribute 155 CCN / 325 NLOC to a new `reader.onload`). Documented, not fixed: `monogramOf` 54 → 55 and `buildAlbumHead` 29 → 30 (one ternary each for the reverse-side orientation), `events.js` and `cloud-sync.js` no new function over threshold and no CCN change, `diff-engine.js`/`csv-export.js` unchanged. The 4-line added-CSS fragment could not be linted on its own (diff fragments do not parse); the cloud Codacy check covers `styles.css`. Duplication: the 7 test files share the existing helpers (`frameOf`, `settleBuilder`, `createMixedBars`, `chooserImageHash`, `chooserImageColor`); no cloned blocks introduced. Docstrings: every new production function in `image-frame.js`, `image-frame-editor.js`, `collections-core.js`, `collections-picker.js` carries JSDoc._

- [x] **CLOSE-P1-3. Generate verification stamp**
  - **File:** Append to the bottom of `tasks.md` (this file) under heading `## Verification Stamp — P1`.
  - For EACH acceptance criterion in `requirements.md` (AC-1.1 … AC-10.3), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>`, OR
    - `- [x] AC-N — verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>`.
    - **P2-tagged ACs** (AC-9.1–AC-9.3, and the P2 pin of AC-9.4) are listed as `- [-] AC-9.N — deferred: P2, stamped in CLOSE-P2-3`. A `[-]` line is not a gap.
  - The stamp block MUST list every AC from requirements.md. Status-only notes are not equivalent.
  - **UI verification requirement:** `approach.md` has a `## UI Contract`, so every AC mapped to a named UI state or interaction there (see UI Contract Traceability below) needs `verified by <test name> + visually verified against mockup state "<state>"` or `+ screenshot compared: <path>`. Otherwise it is `- [ ] AC-N — gap: test passes but UI not visually verified against mockup`.
  - Refuse to proceed to CLOSE-P1-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-P1-4. Version bump**
  - **File:** project version files (enumerated by the skill)
  - Run **`/update-spot-bundle`** first (Tailscale active; the worktree's own script copy with `/usr/bin/python3`), then **MUST invoke `/release patch`** as a skill. Paraphrasing the bump inline is not equivalent. The What's New entry is editorial, in `js/about.js`.
  - _Result: spot bundle refreshed from the worktree's own copy (+10 days, coverage to 2026-10-10); version lock re-claimed for 3.36.46 (the earlier claim had expired; `origin/dev` still at 3.36.45, merge-base == `origin/dev`); six release files bumped, What's New trimmed to 5, sw.js stamped by the hook; commit `v3.36.46 — STRK-427: shared image-frame editor (P1)`._

- [x] **CLOSE-P1-5. Vault update + close issue**
  - _Result (documentation audit, no Plane change): StakTrakr has no in-repo `DocVault/` (`vault-path project` exits 2); the private companion holds only archived specs that mention the old frame toggle (STRK-67, STRK-78), which are historical and left as written; the shared KnowledgeBase has no image-framing page. The `.context/` updates from C.9 stand, and a final grep for the removed identifiers (`frame-toggle`, `cycleFrame`, `suggestedShape`, `imageShapeTouched`, `pendingObverseFrame`) found only one stale code comment, fixed in the release commit. Zero vault changes: clean N/A by audit._
  - **MUST invoke `/vault-update`** as a skill. Project docs are in `.context/` (updated in C.9); the skill audits for anything missed, and zero changes is a clean N/A by audit. StakTrakr has no in-repo `DocVault/`.
  - Documentation audit only. Do **not** touch STRK-427's Plane state or post a "P1 shipped" comment here: the PR is not open yet. The P1-shipped comment is posted in 0P2.1 after the merge is verified, and the issue closes in CLOSE-P2-8 (`.context/implementation-gotchas.md` §Closing task ordering).

- [x] **CLOSE-P1-6. Open PR** — [lbruton/StakTrakr#1572](https://github.com/lbruton/StakTrakr/pull/1572)
  - Branch `patch/<version>` → `dev`. Title: `v<version> — STRK-427: shared image-frame editor (P1)`.
  - Body: link to STRK-427, link to `docs/specs/STRK-427-unified-image-framing/`, test plan checklist, test inventory delta (`+N -M tests, +X -Y files`), the Tradeoff 10 locator re-baseline called out, and the C.10 screenshots.
  - Labels: `codacy-review` and `coderabbit-review` (patch PR).

- [x] **CLOSE-P1-7. Resolve PR review threads** — _PR #1572: 13 review threads (Codex ×8, Copilot ×4, CodeRabbit ×1), all fixed or answered with evidence and resolved; CodeRabbit APPROVED on `e831169`; checks green; merge state CLEAN, 0 unresolved threads. The review rounds found real defects the C-cohort tests had not pinned (clone-mode clearing, duplicate seeding, builder swap races, legacy-rectangle Type following, edit-save gate), each now has a regression test. Waiting on the merge click._
  - **MUST invoke `/pr-resolve`** as a skill. It must scan both inline diff threads and review-body findings. Critical/High fixed or marked false-positive with reasoning, Medium fixed or waived, Low/Info advisory.
  - After `/pr-resolve`, check for threads re-posted by scanners on new commits. Drive the PR to CLEAN with 0 threads, then report and wait: **the merge click is the user's**.

- [ ] **CLOSE-P1-8. Archive spec**
  - `N/A — the spec stays open for P2; /spec archive STRK-427 runs in CLOSE-P2-8.`

---

## Phase 2 (P2)

## Sprint Cohort 0 — Setup, P2 (sequential)

- [x] **0P2.1** — Ensure the P2 patch worktree exists — _P1 merge verified (PR #1572, `40374d93`, v3.36.46); P1-shipped comment posted on STRK-427 (state stays In Progress); P1 worktree and branch removed after the merge check; `patch/3.36.47` created from `origin/dev` with its own `npm ci`, version-lock claim for 3.36.47 (STRK-427 P2) written._
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** The P1 PR merge has been verified (`gh pr view --json state,mergeCommit`), and its worktree has been cleaned up only after that. After the verified merge, a comment on STRK-427 records that P1 shipped (version, PR link); the issue stays open. A fresh `patch/<version>` worktree from `origin/dev` holds a STRK-427 (P2) version-lock claim and has its own `npm ci`.
  - **If the worktree does not exist yet:** run `/start-patch` → `/release patch`.
  - **Depends on:** CLOSE-P1-7 merged
  - **Leverage:** `/start-patch`, `/release patch`.

## Sprint Cohort D — Foundation, P2

- [x] **D.1** — Confirm the P2 mockup section is approved — _the mockup header (`playground/STRK-427-image-frame-editor.html` lines 5-17) carries the approval record: approved 2026-10-10 by lbruton in chat, with decision 6 "P2: table thumb 28px tall with width clamped to 40px (approved); images use object-fit: contain", which is the letterboxing of Tradeoff 5. The user's 2026-10-11 review of v3.36.46 confirmed the bigger images and shape options are wanted and asked to finish P2 first._
  - **File(s):** _no file changes — verification only_ (`playground/STRK-427-image-frame-editor.html`)
  - **Acceptance:** The A.1 playground's P2 section (P2-table, P2-card A/B/C, P2-view, legacy-rect) carries the user's approval note. If it does not, get approval (or a revision via `/ui-mockup`) before Cohort F. The approval covers the table-thumb width clamp and the letterboxing of landscape photos in a portrait Bar (Tradeoff 5).
  - **Maps to:** AC-9.1, AC-9.3

## Sprint Cohort E — Tests · RED, P2 (sequential)

- [x] **E.1** — Unit RED: the `resolveImageFrame` wrapper — _12 cases added in `tests/unit/image-frame.test.js`: 10 red (stored Bar/Note/Slab/Round beats Type, stored shape beats legacy frame, one frame per item so the side argument no longer differs, D-18 non-Coin Numista and `gb`/`sb`, graded-but-chosen-Round, and the new `resolveImageFrameSpec` renderer helper: legacy rectangle = portrait Bar, per-side orientation, no orientation for Round/Slab, null record) and 2 compatibility pins that already pass (legacy circle/rectangle still resolve, a missing record is round)._
  - **File(s):** `tests/unit/image-frame.test.js` (additive)
  - **Acceptance:** Failing cases:
    - `resolveImageFrame` delegates to the shared reader, so every non-round shape returns `rect`.
    - D-18's two accepted differences: a non-Coin with a non-round Numista shape follows Type; `weightUnit` `gb`/`sb` alone no longer forces rect.
    - Grading-first changes the name but not the round/rect binary.
  - **Maps to:** AC-9.1, AC-9.3

- [x] **E.2** — Playwright RED: renderer frames — _11 cases in `tests/playwright/core/image-frame-renderers.spec.js`: 9 red on the intended assertion (missing `data-shape`/`data-orientation`, the 28px/16–40px thumb width, placeholder ratio, card A/B/C frame at the token ratio inside the 44 / 80 / 80×56 boxes, per-side view-modal orientation, Numista re-apply, four-theme legacy rectangle) and 2 regression pins that already pass (legacy `bar-shape`/`table-thumb-rect`/`view-shape-rect` classes remain; a Custom Collection Slot keeps the collection's Bar frame for a linked round Coin's photo, AC-9.4)._
  - **File(s):** `tests/playwright/core/image-frame-renderers.spec.js` (new)
  - **Acceptance:** Failing cases:
    - The table thumb, card A/B/C image and view-modal slots carry `data-shape`/`data-orientation` and render the token ratio inside their bounding box with `object-fit: contain` (AC-9.1).
    - The table thumb stays 28px tall with the clamped width, and the placeholder SVG follows the frame (AC-9.2).
    - A legacy `rectangle` item renders as Bar portrait in all four themes (AC-9.3).
    - The view modal re-applies the frame after Numista enrichment.
    - A Custom Collection Slot showing a linked Item photo still uses the **collection's** shape (AC-9.4 regression pin).
    - The `bar-shape`, `table-thumb-rect` and `view-shape-rect` classes are still present (protected `mobile-and-layout.spec.js:198-222` stays green unedited).
  - **Depends on:** E.1
  - **Leverage:** `tests/playwright/core/mobile-and-layout.spec.js:166-222`; archived `strk-121-rect-image-card-table.spec.js`; A.1 P2 mockup states.
  - **Maps to:** AC-9.1–AC-9.4

- [x] **E.3** — Confirm RED (P2) — _unit 1151 tests: 1141 pass, 10 fail, all in the new E.1 block; the 1139 pre-existing tests are green. Core lists 898 tests (887 + 11); the 9 red are all in the new spec, no pre-existing core file was changed and the protected `mobile-and-layout.spec.js` is untouched._
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Only the E.1/E.2 cases fail. Every pre-existing unit and core case is green, and the counts are recorded.
  - **Depends on:** E.2
  - **Maps to:** AC-10.3

## Sprint Cohort F — Implementation · GREEN, P2 (sequential)

- [x] **F.1** — Make `resolveImageFrame` a thin wrapper — _`resolveImageFrame` now delegates to the new `resolveImageFrameSpec` (shape, per-side orientation, round/rect frame) over `readImageFraming`; helpers `imageFrameAttrHtml`, `imageFrameRatio` (reads the `:root` --frame-* tokens, fallback constants) and `imageFrameThumbWidth` (28px tall, clamp 16..40) carry the renderer plumbing; 3 extra unit cases for them; unit 1154/1154._
  - **File(s):** `js/image-frame.js`
  - **Acceptance:** `resolveImageFrame` returns `round` for a Round shape and `rect` otherwise, using the shared reader. E.1 is green.
  - **Depends on:** E.3
  - **Maps to:** AC-9.1, AC-9.3

- [x] **F.2** — Renderers adopt the shared frames — _`js/card-view.js` (`_cardImageHTML`), `js/inventory-table.js` (`_buildThumbHtml`, placeholder SVG drawn at the thumb's frame size with shape and orientation in its cache key, `_loadThumbImage`) and `js/viewModal.js` (`_applyViewSlotFrame`, re-applied after Numista enrichment) set `data-shape`/`data-orientation` beside the kept legacy classes; one CSS block at the end of `css/styles.css` fits the largest token-ratio rectangle in each wrapper box with `object-fit: contain` (cards 44 / 80 / 80×56, table 28px tall clamp 16..40, view 180 / 200×260). `image-frame-renderers.spec.js` 11/11 and the protected `mobile-and-layout.spec.js` 7/7 unedited._
  - **File(s):** `js/card-view.js`, `js/inventory-table.js`, `js/viewModal.js`, `css/styles.css`
  - **Acceptance:**
    - `card-view.js:563-593`, `inventory-table.js:350-385, 408-468, 1448-1482` and `viewModal.js:2996-3017, 1963-1977` set `data-shape`/`data-orientation` on their existing wrappers (`.coin-img`, `.table-thumb`, `.view-image-slot`) next to the kept legacy classes.
    - The CSS fits the largest token-ratio rectangle inside each wrapper box, with `object-fit: contain` and the table width clamp.
    - The placeholder SVG cache key includes shape and orientation.
    - The view modal keeps its re-apply after Numista enrichment.
    - E.2 is green, and `mobile-and-layout.spec.js` is green unedited.
  - **Depends on:** F.1
  - **Maps to:** AC-9.1–AC-9.3

- [x] **F.3** — P2 inventory — _`tests/playwright/coverage-map.csv` row for `core/image-frame-renderers.spec.js` (11 cases, rationale and the tableImageSides trap)._
  - **File(s):** `tests/playwright/coverage-map.csv`
  - **Acceptance:** A new row for `core/image-frame-renderers.spec.js` with its count and rationale.
  - **Depends on:** F.2
  - **Maps to:** AC-10.3

- [x] **F.4** — P2 visual verification — _evidence: `playground/images/STRK-427-evidence/P2-*.png`, 48 files: `P2-table-<theme>-<1280|390>`, `P2-card-<A|B|C>-<theme>-<width>`, `P2-view-legacy-…` and `P2-view-mixed-…`, each in light, dark, slate and sepia. The fixture set holds a round Coin, a Bar, a chosen Note, a graded Slab, a legacy rectangle Coin, a Bar with landscape obverse, a D-18 anomaly (Coin with a `gb` unit and a Rectangular Numista shape) and a Bar without an image. Compared with the approved P2 mockup section: Bar and Note thumbs are narrower or wider within the 28px row (16..40px clamp), photos letterbox inside their frames, the placeholder follows the frame, card A/B/C images fit their existing boxes, and the view modal shows per-side orientation. Deviation to disclose: the card and table frames are transparent (protected `bar-shape` / `table-thumb-rect` rules keep a transparent background), so a letterboxed photo shows no frame outline except in the view modal._
  - **File(s):** _no file changes — screenshots attached to the PR_
  - **Acceptance:** P2-table, P2-card (A/B/C) and P2-view are captured, including a legacy-rect item and an anomalous D-18 item, in all four themes at 1280 and 390, and compared with the approved P2 mockup section. The screenshots go in the PR.
  - **Depends on:** F.3
  - **Maps to:** AC-9.3, plus visual evidence for the CLOSE-P2-3 stamp

## Standard Closing Tasks — P2

- [x] **CLOSE-P2-1. Run full test suite** — zero regressions — _unit 1154/1154 (1139 before P2 + 15 new); core Playwright 898/898 (887 + 11 in `image-frame-renderers.spec.js`), the protected `mobile-and-layout.spec.js` unedited and green; `npm run lint` and `npm run lint:md:all` clean. Archived matrix `strk-121-rect-image-card-table.spec.js` (not a CI gate): 3 placeholder cases already fail on `origin/dev`; 3 more fail on this branch, the card A/B/C container-size cases (44x44 / 80x80 / 80x56 box assertions), which D-17 supersedes on purpose (the wrapper box is now the bounding box of a token-ratio frame, so a portrait Bar is 26x44 in card A). Disclosed, not edited._
  - **File:** _no file changes — verification only_
  - `npm test`, `npm run test:unit` and `npm run lint`, with counts checked. Fix the implementation, not the test.

- [x] **CLOSE-P2-2. Codacy CLI scan** — security + quality — _scanned file by file (the `--diff` form exhausts the heap in Stylelint on `css/styles.css`, as in P1): `js/image-frame.js`, `js/inventory-table.js`, `tests/unit/image-frame.test.js` and `tests/playwright/core/image-frame-renderers.spec.js` have 0 findings. `js/card-view.js` and `js/viewModal.js` report only Lizard Medium findings on functions this PR did not touch (`generateSparklineSVG`, `_buildInventorySection`, `_buildValuationSection`, `_buildDispositionSection`, `loadViewNumistaData`); a Lizard comparison against `origin/dev` shows no CCN or NLOC change, only two unrelated functions' line length moved. 0 Critical/High, 0 security. Duplication: the new tests share the `frameOf`, `thumbOf`, `cardCoinOf` and `boot` helpers; JSDoc on every new production function._
  - **File:** _no file changes — scan only_
  - `codacy-analysis analyze --diff`. Same triage rules as P1.

- [x] **CLOSE-P2-3. Generate verification stamp** — _`## Verification Stamp — P2` at the bottom: 45 lines, one per AC, 0 open `[ ]`; AC-9.1 to AC-9.4 use the test + screenshot form._
  - **File:** Append to the bottom of `tasks.md` under heading `## Verification Stamp — P2`.
  - One line for **every** AC in `requirements.md`. P1 ACs may cite their P1 stamp line (`- [x] AC-N — verified in P1 stamp, re-run green in CLOSE-P2-1`). AC-9.1–AC-9.4 need the full UI verification form (test + mockup state or screenshot).
  - Refuse to proceed to CLOSE-P2-4 if any `[ ]` remains.

- [x] **CLOSE-P2-4. Version bump** — _spot bundle refreshed from this worktree's own script (sqld reachable over Tailscale; no new complete UTC day since P1, so the year JSON and bundle were already current); version lock re-claimed for 3.36.47 (the first claim had expired); six release files bumped, What's New trimmed to 5, sw.js stamped by the hook; commit `v3.36.47 — STRK-427: renderers adopt shared image frames (P2)`._
  - Run **`/update-spot-bundle`**, then **MUST invoke `/release patch`** as a skill.

- [x] **CLOSE-P2-5. Vault update + close issue** — _documentation audit only, no Plane change: `.context/style.html` (renderer frames block), `.context/deep-dives/data-model.md` (renderer reader note) and `.context/GLOSSARY.md` were updated in `522f1120`; StakTrakr has no in-repo `DocVault/` (`vault-path project` exits 2); the private companion holds only the archived STRK-67 spec, which is historical and left as written; the shared KnowledgeBase has no renderer-frame page. STRK-427 stays In Progress (closes after STRK-434)._
  - **MUST invoke `/vault-update`** as a skill. `.context/style.html` and `.context/deep-dives/data-model.md` should reflect the renderer frames; the skill audits for this.
  - Documentation audit only. Do **not** change STRK-427's Plane state here: the Done transition moves to CLOSE-P2-8, after the verified merge and the archive (`.context/implementation-gotchas.md` §Closing task ordering).

- [x] **CLOSE-P2-6. Open PR** — [lbruton/StakTrakr#1573](https://github.com/lbruton/StakTrakr/pull/1573)
  - Branch `patch/<version>` → `dev`. Title: `v<version> — STRK-427: renderers adopt shared image frames (P2)`.
  - Body: links to the issue and the spec folder, test plan, inventory delta, F.4 screenshots. Labels `codacy-review` and `coderabbit-review`.

- [x] **CLOSE-P2-7. Resolve PR review threads** — _PR #1573: 1 review thread (Copilot: the release copy overstated letterboxing for Round frames), fixed as copy-only changes in the What's New entry, CHANGELOG, glossary and style guide and resolved; checks green (Codacy 0 issues, CodeQL, Analyze, Cloudflare Pages), CodeRabbit skipped by design, Codex out of review credit; merge state CLEAN, 0 unresolved threads. Waiting on the merge click; STRK-427 stays open for STRK-434._
  - **MUST invoke `/pr-resolve`** as a skill, covering inline and review-body findings and scanner re-posts. Drive to CLEAN, then report and wait for the user's merge.

- [x] **CLOSE-P2-8. Archive spec** — _STRK-434 merged (v3.36.48, PR #1574, `8b7634f0`) and Lonnie signed off its screenshots in chat (2026-10-11), so the spec folder moved to `docs/specs/archive/2026-10-11-STRK-427-unified-image-framing/` in a chore PR; STRK-427 moves to Done in Plane after that PR merges. One known dangling pointer: a comment in `tests/unit/cloud-sync-image-frame-hash.test.js` still names the old `docs/specs/STRK-427-unified-image-framing/approach.md` path (comment only; a test-file edit would need the full issue and lock discipline, so it is left for the next change to that file)._
  - **Re-scoped 2026-10-11 (Lonnie):** STRK-427 does not close with P2. The item-modal vs Edit-collection visual parity work is filed as **STRK-434** and must land on `dev` before any `dev` → `main` ship. After the P2 merge is verified, this task only verifies the merge and records it; the archive and the Done transition below run when STRK-434 has merged and Lonnie has signed off its screenshots. Do not archive the spec folder before then (STRK-434 reuses it).
  - Verify the P2 merge first (`gh pr view --json state,mergeCommit`).
  - **MUST invoke `/spec archive STRK-427`** as a skill.
  - Then mark STRK-427 Done in Plane: `mcp__plane__workitem` (`action: "update"`) to state "Done" (list states this session; never cache UUIDs), with the follow-ups from 0.2 cross-linked.

---

## UI Contract Traceability

_Every named state in `approach.md` → UI Contract, mapped to its implementing task, the test assertion that verifies it, and the visual check. Cited mockups: `playground/STRK-427-image-frame-editor.html` (A.1, B.4, B.5, C.3, C.10, D.1, E.2, F.4), `playground/STRK-424-orientation-toggle.html` (A.1, C.3), `playground/STRK-421-collection-modal-variants.html` (A.1, B.6)._

| State | Implementing task(s) | Verifying assertion(s) | Visual verification |
|-------|---------------------|------------------------|---------------------|
| E-empty | C.3, C.4 | B.4: shape radiogroup and both frames visible with no image; flag-off hides the group | C.10 vs mockup E-empty, 4 themes × 1280/390 |
| E-one | C.4 | B.4: one side filled, the other an empty frame with the same `data-shape`; swap button hidden | C.10 vs mockup E-one |
| E-mixed | C.3, C.4 | B.4: portrait obverse + landscape reverse render ratios 0.6 / 1.6; swap exchanges both | C.10 vs mockup E-mixed |
| E-round | C.3 | B.4: Round → circular frame, no orientation radiogroups | C.10 vs mockup E-round |
| E-slab | C.3 | B.4: Slab (chosen or graded) → 0.68 frame, no orientation radiogroups | C.10 vs mockup E-slab |
| E-follow | C.3, C.4 | B.4: Coin → Goldback reshapes to Note immediately; untouched shape re-derives on grade | C.10 vs mockup E-follow |
| E-pinned | C.3, C.4 | B.4: a chosen Slab survives a Type change; a chosen Round survives a grade | C.10 vs mockup E-pinned |
| B-builder | C.5, C.6 | B.5: same `.ife` contract in both modals; B.6: hero layout widths, per-side widths/ratios, swap with pending removal | C.10 vs mockup B-builder and the STRK-421 baseline |
| M-390 | C.3, C.4, C.5 | B.5: existing elements unchanged at 768/390; options ≥44px | C.10 at 390 vs mockup M-390 |
| T-4 | C.3, C.4, C.5 | B.5: canvas-sampled contrast in light/dark/slate/sepia; no `--surface` | C.10, every state × 4 themes |
| P2-table | F.2 | E.2: `data-shape`/`data-orientation`, 28px height, clamped width, placeholder follows | F.4 vs mockup P2-table |
| P2-card (A/B/C) | F.2 | E.2: token ratio inside the wrapper, `object-fit: contain`, legacy classes kept | F.4 vs mockup P2-card |
| P2-view | F.2 | E.2: frame applied and re-applied after Numista enrichment; legacy rect → Bar | F.4 vs mockup P2-view |

---

> **Multi-model dispatch hint:** Cohort A tasks marked `[P]` can be sent to different models in parallel (A.1 needs the user present for approval; A.2–A.5 are mechanical). Reconverge before Cohort B. The B (red) / C (green) boundary is a natural model-routing seam. Every dispatched prompt MUST name the absolute worktree path (`.context/spec-conventions.md` §dispatch), and the closing tasks go out as one batched prompt.

---

## Review Archive — tasks (2026-10-10)

### Resolution Summary

- Reviewer: CODEX. Findings: 5 (5 inline marks + 1 review section whose top concerns restate them). All code claims verified against the live worktree before disposition (`js/events.js:468-477`, `js/collections-album.js:105-117`, `.context/implementation-gotchas.md` §Closing task ordering, `approach.md:101`).
- Accepted: 4 — Cohort C scoped gates with named stays-RED-until cases and a full-suite checkpoint at the end of C.8; swap visibility driven by real per-side image presence (C.4 + B.4 assertions); B.9 splits new-behavior RED from compatibility pins and excuses the five re-baselined STRK-424 locators until C.5; Plane Done moved after the P2 merge and archive (CLOSE-P2-8), with the P1-shipped comment moved to 0P2.1.
- Rejected: 0.
- Resolved with your input: 1 — old-build coverage: B.3 pins O's functions as source literals in the test file (captured during Cohort B) and asserts one case per I-1–I-10, H-1–H-5, E-2 and C-1 (O side) row, expected losses included, plus new-build H-1 no-diff and H-2 field-level diff.

### Inline marks (verbatim, with their anchor)

In B.3:

> CODEX: [P2] Accepted compatibility loss still needs an executable outcome check: the approach calls every matrix row a test target, but this task explicitly excludes H-3/H-5 and no task covers the older-build transitions I-1–I-6 or E-2. B.3 also checks field registration without asserting H-1 no-diff / H-2 field-level diff. Add a pinned old-build fixture or extracted old functions and map each matrix row to an assertion (including expected loss), plus new-build diff/apply checks. The current hash omits these fields (`js/cloud-sync.js:123-165`), and diff generation versus apply/add are separate paths (`js/diff-engine.js:839-894`); hash inequality and source-array membership alone cannot verify the promised save/edit/read behavior.

In B.9:

> CODEX: [P2] Separate new-behavior RED checks from compatibility pins that should already pass. H-4 unchanged hashes, sanitizer survival, legacy Collections widths, and the last CSV column deliberately assert existing behavior; B.7 even points to an unchanged last-column assertion. Requiring every new case to fail would force valid regression tests to be weakened or distorted. Also exempt the five deliberately re-baselined STRK-424 cases from “Every pre-existing case is still green” until C.5, because their new accessible names are absent in the current builder (`tests/playwright/core/collections.spec.js:1507` and `js/collections-picker.js:1211-1221`). Record expected failures by assertion rather than requiring all new cases to fail.

At the top of Sprint Cohort C:

> CODEX: [P1] The per-task GREEN gates cannot be met in this execution order. C.3 requires all unit tests to pass while B.3 remains RED until C.7; C.4 requires all of B.5 green even though B.5 checks the builder mount implemented in C.5; C.5 requires all of B.6 green even though its Album/Hub per-side assertions need C.6. The current Album title loop passes one orientation to both sides (`js/collections-album.js:105-117`), so the builder change cannot satisfy that test. Scope each task gate to its implemented assertions and retain the full-suite gate after all dependent tasks, or regroup the tasks; otherwise the required check-off-before-next-task rule deadlocks execution.

In C.4:

> CODEX: [P1] Explicitly replace the swap-visibility predicate and wire image-presence updates into the controller here. `updateSwapButtonVisibility` (`js/events.js:468-477`) currently treats both preview elements being visible as proof that both images exist. A.1/B.4/D-16 now keep both empty frames visible, so preserving that predicate exposes Swap for zero or one image. Use actual per-side image presence across seed, upload/URL/camera, remove and swap completion, and add B.4 assertions for Swap hidden in E-empty/E-one and visible only with two images. Keep the async race guards unchanged; visibility is a separate condition.

In CLOSE-P2-5:

> CODEX: [P1] This closes STRK-427 before CLOSE-P2-6 even opens the PR. Move the Done transition after the verified P2 merge and CLOSE-P2-8 archive, keeping only the documentation audit here. `.context/implementation-gotchas.md:205-215` explicitly requires PR → post-merge archive → Plane Done. Likewise, CLOSE-P1-5 must not report “P1-shipped” before its PR is opened/merged; defer that comment to the verified P1 merge checkpoint in 0P2.1.

### CODEX Review (2026-10-10)

#### Verified

- Reviewed all four phase artifacts in the active `chore/strk-427-spec` worktree against the project spec conventions, testing policy, glossary and closing-order rule. The prior approach findings are archived and reconciled.
- Checked the File Map, P1/P2 boundary, mockup gate, sequential implementation dependencies, UI-state traceability and per-phase coverage inventory tasks. The tasks retain the agreed sparse writer, hybrid signal following, per-frame builder widths and removal-aware atomic swap.
- Verified the current swap visibility predicate (`js/events.js:468-477`), Album title orientation consumption (`js/collections-album.js:105-117`), entry projection (`js/collections-ui.js:699-738`), existing orientation locator (`tests/playwright/core/collections.spec.js:1507`), ZIP frame assertions (`tests/playwright/core/import-export.spec.js:360-374`), hash gate (`js/cloud-sync.js:123-165`) and diff apply path (`js/diff-engine.js:839-894`).

#### Top concerns

1. C.3–C.5 demand passing tests whose implementations occur in later tasks, blocking sequential execution.
2. Always-visible empty frames invalidate the existing swap visibility predicate; the host integration must track actual images.
3. The RED gate conflates new behavior with already-passing compatibility checks, while cross-version matrix transitions lack executable coverage.
4. Plane closure and the P1 shipped comment precede their verified merges; move them to the post-merge checkpoints.

#### Unverified assumptions

- No implementation, browser tests or cross-version experiment ran for this document-only review. The proposed STRK-427 mockup and its approval remain future gates; desktop size and four-theme geometry are not validated here.
- Remote Plane state/relations and PR status were not queried. Findings use the reconciled local spec and current worktree source, not older memory summaries, as authority.
- Only `tasks.md` was edited. No approval stamp, reconciliation, implementation or phase advancement was performed.

---

## Verification Stamp — P1

_Shorthand: **EDITOR** = `tests/playwright/core/image-frame-editor.spec.js`; **COLL** = `tests/playwright/core/collections.spec.js`; **DATA** = `tests/playwright/core/collections-data-paths.spec.js`; **IMPEXP** = `tests/playwright/core/import-export.spec.js`; **UNIT-IF** = `tests/unit/image-frame.test.js`; **CORE-U** = `tests/unit/collections-core.test.js`; **HASH** = `tests/unit/cloud-sync-image-frame-hash.test.js`. Screenshots: `playground/images/STRK-427-evidence/<state>-<light|dark|slate|sepia>-<1280|390>.png`, compared side by side with the approved A.1 mockup `playground/STRK-427-image-frame-editor.html` (approved in chat: 200px desktop box, buttons under the preview on desktop and mobile = M-B, 40px table-thumb clamp for P2). "Visually verified" below means those eight states were captured in all four themes at both widths and matched the mockup, with no deviation other than the builder's captions top-aligning per side, which the builder already did._

### AC-1 Shared editor

- [x] AC-1.1 — verified by EDITOR "B-builder: the Edit Collection builder mounts the same editor contract", and at `index.html:8958` + `sw.js:89` (registered in both, after `image-frame.js`, before its consumers) + visually verified against mockup state "B-builder" (`B-builder-*-1280.png`, `B-builder-*-390.png`)
- [x] AC-1.2 — verified at `js/image-frame-editor.js:152` (`mount` owns presentation, shape and per-side orientation; Upload/URL/Camera/size/Remove stay in the host callbacks wired in `js/events.js`, `createItemHost` at `js/image-frame-editor.js:468`) + EDITOR "the swap guards are unchanged: the group is busy and inert while a swap is pending"
- [x] AC-1.3 — verified by EDITOR "the swap guards are unchanged: the group is busy and inert while a swap is pending" and "Swap shows only when both sides hold an image, across seed, upload, Remove and swap"; the pre-existing item-modal specs in the core suite stay green
- [x] AC-1.4 — verified by EDITOR "AC-1.4: Settings → Images keeps its 140px preview cap"
- [x] AC-1.5 — verified by EDITOR "E-empty: shape control and both empty frames show before any image exists, flag off hides the group" + visually verified against mockup state "E-empty" (`E-empty-*-1280.png`, `E-empty-*-390.png`)

### AC-2 Live preview

- [x] AC-2.1 — verified by EDITOR "choosing a shape reshapes both frames immediately, with no save" + visually verified against mockup states "E-round" and "E-slab" (`E-round-*`, `E-slab-*`)
- [x] AC-2.2 — verified at `css/styles.css:18174-18180` (the shared `:root` ratio tokens, one `--frame-slab: 0.68`) and by COLL "STRK-427 the builder Slab box keeps its width and moves to the shared 0.68 ratio" + visually verified against mockup state "E-slab" (`E-slab-*`)
- [x] AC-2.3 — verified by EDITOR "Round and Slab show no orientation controls; Bar and Note show one group per side at their default" + visually verified against mockup states "E-round" and "E-slab" (`E-round-*`, `E-slab-*`)

### AC-3 Swap and Remove

- [x] AC-3.1 — verified by EDITOR "E-mixed: Swap exchanges the images and their orientations and leaves the shape alone" + visually verified against mockup state "E-mixed" (`E-mixed-*`)
- [x] AC-3.2 — verified by COLL "STRK-427 Swap in the builder exchanges the images and their orientations" and "STRK-427 a stored pair, Remove one side, Swap, Save and reopen keeps the image on the swapped side only" + visually verified against mockup state "B-builder" (`B-builder-*`)
- [x] AC-3.3 — verified by EDITOR "Remove resets that side's orientation to its default and keeps the shape (AC-3.3)" + visually verified against mockup state "E-one" (`E-one-*`)

### AC-4 Shape derivation

- [x] AC-4.1 — verified by UNIT-IF "deriveImageShape — the one resolver (AC-4.1, AC-4.2)" and CORE-U "defaultImageShapeForType delegates to the one resolver (AC-4.1)"; `suggestedShape` and `imageShapeTouched` no longer appear in `js/` (grep empty)
- [x] AC-4.2 — verified by UNIT-IF "deriveImageShape — the one resolver (AC-4.1, AC-4.2)" (table of Type × grade × Numista shape) at `js/image-frame.js:132`
- [x] AC-4.3 — verified by EDITOR "E-follow: an untouched shape follows Type, Coin to Goldback shows Note" + visually verified against mockup state "E-follow" (`E-follow-*`)
- [x] AC-4.4 — verified by EDITOR "E-pinned: a chosen shape survives a Type change" + visually verified against mockup state "E-pinned" (`E-pinned-*`)
- [x] AC-4.5 — verified by EDITOR "a grade re-derives an untouched shape and never moves a chosen one (AC-4.5)" and "a programmatic grading or Numista-shape set followed by the notify call re-derives an untouched shape" + visually verified against mockup states "E-follow" and "E-pinned"
- [x] AC-4.6 — verified by EDITOR "E-follow: an untouched shape follows Type, Coin to Goldback shows Note" + visually verified against mockup state "E-follow" (`E-follow-*`)
- [x] AC-4.7 — verified by EDITOR "all four shapes are selectable for Coin, Bar and Goldback"
- [x] AC-4.8 — verified by UNIT-IF "Bar defaults to portrait and Note to landscape" and EDITOR "Round and Slab show no orientation controls; Bar and Note show one group per side at their default" + visually verified against mockup state "E-mixed" (`E-mixed-*`)

### AC-5 Per-side orientation

- [x] AC-5.1 — verified by EDITOR "Round and Slab show no orientation controls; Bar and Note show one group per side at their default" + visually verified against mockup state "E-mixed" (`E-mixed-*`), whose toggle follows `playground/STRK-424-orientation-toggle.html` Option C
- [x] AC-5.2 — verified by CORE-U "reverseImageOrientation on the definition (AC-5.2, D-10)" and "reverseImageOrientationFor (D-10)", and COLL "STRK-427 a mixed pair saved in the builder reopens with both orientations and renders per side everywhere" (Album title pair, Slot tiles, Ledger rows, Hub cards and rows) at `js/collections-core.js:290`, + visually verified against mockup state "B-builder" (`B-builder-*`)
- [x] AC-5.3 — verified by CORE-U "create and update mirror the obverse rules (AC-5.3)" and "merge convergence with the reverse key (C-1, C-2)", HASH "C-1: O's normalizeDefinition drops reverseImageOrientation and the reverse falls back to the obverse", DATA "STRK-427 a uniform pair carries no reverse key, so older and newer builds never diverge (C-5)"
- [x] AC-5.4 — verified by UNIT-IF "an orientation that differs from the default is stored; the default is not" and EDITOR "save and reopen shows exactly the chosen ${label} (AC-7.2) and stores only deviations" (Bar and Note)
- [x] AC-5.5 — verified by CORE-U "save and reopen stability (AC-5.5)" ("a new Bar or Note saved at its default reopens at that default" and "a legacy Bar saved before STRK-424 with no orientation still reopens landscape") and COLL "STRK-427 legacy uniform pairs and a pre-STRK-424 Bar keep their builder frame widths and ratios"

### AC-6 Size and themes

- [x] AC-6.1 — verified by EDITOR "AC-6.1: desktop previews are larger than the old 140px cap and fit the 700px dialog" + screenshot compared: `playground/images/STRK-427-evidence/E-empty-light-1280.png` against mockup state "E-empty" (200px preview box)
- [x] AC-6.2 — verified by EDITOR "AC-6.2: at ${width}px previews keep the 140px cap, buttons stack under them and options are 44px" + screenshot compared: `playground/images/STRK-427-evidence/E-mixed-light-390.png` against mockup state "M-390"
- [x] AC-6.3 — verified by EDITOR "AC-6.3: the editor is legible in light, dark, slate and sepia at desktop and 390px" + screenshot compared: all 64 `playground/images/STRK-427-evidence/*.png` (8 states × 4 themes × 2 widths). Caveat, disclosed: the shipped `.collections-segmented` selected-state contrast (about 2.4–3.7:1) is the existing control, reused unchanged, and is not asserted by this test

### AC-7 Item storage

- [x] AC-7.1 — verified by UNIT-IF "the derived shape at default orientation writes nothing and removes all five keys" and IMPEXP "STRK-427 a sparse item exports no new keys and never writes empty legacy frames"
- [x] AC-7.2 — verified by EDITOR "save and reopen shows exactly the chosen ${label} (AC-7.2) and stores only deviations" (Round, Bar, Note, Slab) and "D-4: a stored note on a Coin that becomes Goldback saves as sparse, with no legacy frames" + visually verified against mockup states "E-round", "E-slab", "E-mixed" (`E-*`)
- [x] AC-7.3 — verified by UNIT-IF "a non-derived shape stores imageShape and projects the legacy pair (AC-7.3)" and "Round chosen on a rectangular Type projects circle"

### AC-8 Compatibility and migration

- [x] AC-8.1 — verified by UNIT-IF "a legacy circle reads as Round, whatever the Type", "a legacy rectangle reads as the shape the item derives" and "a legacy rectangle on a plain round Coin reads as Bar, not Round (D-3)"; EDITOR "D-3: a legacy rectangle on a plain Coin opens as a Bar"
- [x] AC-8.2 — verified by UNIT-IF "a stored imageShape wins over the derived shape and over a legacy frame" and HASH "I-4: O cycles the frame toggle on a migrated item; N ignores the legacy value (accepted loss)"; limitation documented at `.context/cloud-sync-convergence.md` § Image framing fields (STRK-427)
- [x] AC-8.3 — verified by HASH `describe` blocks "STRK-427 matrix — items (I-1 … I-10)", "STRK-427 matrix — sync, hash and diff (H-1 … H-5)" and "STRK-427 matrix — import/export and Custom Collections" (O = pinned v3.36.45 source literals, N = live; expected losses asserted, including H-3 and I-4)
- [x] AC-8.4 — verified by UNIT-IF "only the obverse legacy frame counts; the reverse value is ignored (AC-8.4)" and HASH "I-8: legacy mixed sides read as the obverse mapping"
- [x] AC-8.5 — verified by EDITOR "I-8: an untouched edit of a legacy mixed circle/rectangle item leaves both legacy fields byte-identical" (the edit-save gate; nothing is rewritten at load or on an untouched edit)
- [x] AC-8.6 — verified by HASH "STRK-427 registration at the enumeration sites (AC-8.6)", "H-1: absent and empty new fields hash the same and produce no diff on N" and "H-4: an inventory with none of the new fields hashes byte-identically on O and N"; registered at `js/diff-engine.js:78`, `js/changeLog.js:183`, `js/cloud-sync.js:171`
- [x] AC-8.7 — verified by IMPEXP "STRK-427 item framing round-trips through JSON export and JSON import", "… through the standard CSV export and import" and "… through the ZIP backup JSON, ZIP CSV and restore parse"
- [x] AC-8.8 — verified by IMPEXP "STRK-427 item framing round-trips through the standard CSV export and import" (real exported file: `Obverse Frame`/`Reverse Frame` stay after `Reverse Image URL`, the three new columns sit immediately before `Collections`) at `js/csv-export.js:131-146` and `js/inventory-backup.js:38-47`

### AC-9 Table, card and view modal (P2)

- [-] AC-9.1 — deferred: P2, stamped in CLOSE-P2-3
- [-] AC-9.2 — deferred: P2, stamped in CLOSE-P2-3
- [-] AC-9.3 — deferred: P2, stamped in CLOSE-P2-3
- [-] AC-9.4 — deferred: P2 pin, stamped in CLOSE-P2-3 (P1 leaves the Slot frame unchanged)

### AC-10 Compatibility and coverage

- [x] AC-10.1 — verified by COLL "STRK-427 legacy uniform pairs and a pre-STRK-424 Bar keep their builder frame widths and ratios" and "STRK-427 the builder Slab box keeps its width and moves to the shared 0.68 ratio" + visually verified against mockup state "B-builder" and the STRK-421 baseline (`B-builder-*`)
- [x] AC-10.2 — verified at `css/styles.css` (`git diff origin/dev...HEAD -- css/styles.css` adds 0 `var(--surface)`; the editor's own surfaces use `--bg-card`, and the STRK-426 badge rules are untouched) and EDITOR "AC-6.3: the editor is legible in light, dark, slate and sepia at desktop and 390px"
- [x] AC-10.3 — verified at `tests/playwright/coverage-map.csv:164-167` (EDITOR new, 32 cases; COLL +10, DATA +3, IMPEXP +5); inventory delta `+92 unit tests, +50 Playwright tests (32+10+3+5), +3 files` goes in the PR body (CLOSE-P1-6)

---

## Verification Stamp — P2

_Shorthand: **REND** = `tests/playwright/core/image-frame-renderers.spec.js`; **UNIT-IF** = `tests/unit/image-frame.test.js`. Screenshots: `playground/images/STRK-427-evidence/P2-<state>-<theme>-<1280|390>.png`, compared with the approved P2 section of `playground/STRK-427-image-frame-editor.html` (table thumb 28px tall with the width clamped to 40px, images `object-fit: contain`). P1 ACs cite their P1 stamp line; the full core (898/898), unit (1154/1154) and lint gates were re-run green in CLOSE-P2-1 on the P2 tree._

### AC-1 to AC-8 and AC-10 (P1)

- [x] AC-1.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-1.2 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-1.3 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-1.4 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-1.5 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-2.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-2.2 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-2.3 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-3.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-3.2 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-3.3 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-4.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-4.2 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-4.3 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-4.4 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-4.5 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-4.6 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-4.7 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-4.8 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-5.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-5.2 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-5.3 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-5.4 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-5.5 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-6.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-6.2 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-6.3 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-7.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-7.2 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-7.3 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-8.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-8.2 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-8.3 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-8.4 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-8.5 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-8.6 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-8.7 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-8.8 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-10.1 — verified in P1 stamp, re-run green in CLOSE-P2-1
- [x] AC-10.2 — verified in P1 stamp, re-run green in CLOSE-P2-1 (this PR adds 0 `var(--surface)` to `css/styles.css`; its new block uses only tokens)
- [x] AC-10.3 — verified at `tests/playwright/coverage-map.csv` (new row for `core/image-frame-renderers.spec.js`, 11 cases); inventory delta `+15 unit tests, +11 Playwright tests, +1 file` goes in the PR body (CLOSE-P2-6)

### AC-9 Table, card and view modal (P2)

- [x] AC-9.1 — verified by REND "table thumbs carry shape and orientation, stay 28px tall and clamp their width (AC-9.1)", "the reverse thumb follows the same shape with its own orientation (AC-9.1)", "card A / B / C: the wrapper frame fits its box at the token ratio (AC-9.1)", "the view modal frames each side from the shared reader (AC-9.1)" and "the view modal re-applies the frame after Numista enrichment (AC-9.1)", UNIT-IF "resolveImageFrame is a thin wrapper over the shared reader" (and the `resolveImageFrameSpec` / `imageFrameAttrHtml` / `imageFrameThumbWidth` helpers) + screenshot compared: `P2-table-light-1280.png`, `P2-table-dark-390.png`, `P2-card-A-dark-1280.png`, `P2-card-B-light-1280.png`, `P2-card-C-sepia-390.png`, `P2-view-mixed-dark-1280.png` against the approved P2 mockup section
- [x] AC-9.2 — verified by REND "the placeholder SVG follows the frame (AC-9.2)" (natural ratio of the 16..40px clamped thumb box, distinct SVG per shape) and the 28px-height assertions in "table thumbs carry shape and orientation…" + screenshot compared: `P2-table-light-1280.png` and `P2-table-sepia-1280.png`, the "Bar without an image" row against the approved P2-table state
- [x] AC-9.3 — verified by REND "a legacy rectangle item is a portrait Bar in every theme (AC-9.3)" (card A frame and view modal slot in light, dark, slate and sepia) and UNIT-IF "a legacy rectangle on a plain Coin is a portrait Bar frame (AC-9.3)" + screenshot compared: `P2-view-legacy-<light|dark|slate|sepia>-1280.png` and `-390.png`, `P2-card-A-<theme>-1280.png` (legacy rectangle Coin and the D-18 anomaly row) against the approved P2-view and P2-card states
- [x] AC-9.4 — verified by REND "a Custom Collection Slot keeps the collection's shape for a linked Item photo (AC-9.4)" (regression pin: a Bar collection keeps `collections-coin--shape-bar` / `--portrait` for a linked round Coin's photo; P2 changes no Collections code) and the existing Slot-photo cases in `tests/playwright/core/collections.spec.js`, green in CLOSE-P2-1
