---
title: "STRK-368 — Collections beta (PR evidence)"
project: StakTrakr
type: evidence
status: shipped
source: "PR #1500"
created: 2026-09-19
---

# STRK-368 — Collections beta

**There are no sketch phase documents here, and none are missing.** STRK-368 was built
as a long-lived feature branch (`feature/strk-368-collections-beta`), not through the
`/sketch` phase flow, so `requirements.md` / `discovery.md` / `approach.md` / `tasks.md`
were never written. This folder exists only to keep the PR evidence, which lived in the
worktree as untracked files and would otherwise have been destroyed when the merged
worktree was removed.

## What shipped

Collections — a checklist/album layer over the inventory (epic STRK-254). ASE Type 1 and
Type 2 date runs, Custom Collections, Item↔Slot links, album and ledger views, a link
picker, a custom builder, and a Settings toggle. Merged to `dev` as **v3.36.25** via
[PR #1500](https://github.com/lbruton/StakTrakr/pull/1500) on 2026-09-19 (merge commit
`7f17853d`).

Related issues: STRK-368, STRK-369, STRK-370, STRK-371, STRK-372, STRK-373, STRK-376,
STRK-377, STRK-378.

## Evidence

Captured by Codex during the review pass. Theme and responsive coverage for the album
and hub views:

| File                            | Shows                     |
| ------------------------------- | ------------------------- |
| `evidence/album-light.png`      | Album view, `light` theme |
| `evidence/album-dark.png`       | Album view, `dark` theme  |
| `evidence/album-slate.png`      | Album view, `slate` theme |
| `evidence/album-sepia.png`      | Album view, `sepia` theme |
| `evidence/album-mobile-390.png` | Album view at 390px       |
| `evidence/hub-mobile-390.png`   | Hub view at 390px         |

The four themes are the complete set — there is no `contrast` theme
(see `.context/design-philosophy.md`).

## Review follow-up worth remembering

The Codex review found three P1s and a P2 that all shared one shape: **an operation
committing before the state it depended on had settled.** Fixed in `1cb37901`.

- `cloud-sync.js` — a dead IndexedDB connection made `exportAll*` return `[]`, identical
  to "the user deleted every photo", so a push could delete the remote image vault.
  `collectAndHashImageVault()` now reports `{ enumerationFailed: true }` for an unreadable
  cache; `null` still means genuinely empty.
- `cloud-sync.js` — the vault-first silent pull restored artwork _before_
  `_mergeCollectionState`, so a new Collection's cover was judged orphaned and then
  stranded behind a recorded image hash. The merge moved to the top of the branch.
- `vault.js` — `restoreImageVaultData` throws only after committing records, so a photo
  failure rolled back state the blobs could not be rolled back with. The restore now
  commits and the shortfall is a warning.
- `inventory.js` — the Collections prune ran after an un-awaited `saveInventory()`, which
  is also a no-op in recovery mode. The delete now awaits the write.

Codacy note: the PR could not clear `complexityThreshold` (2127 vs 1500) because
`tests/**` contributed 766 of that delta — spec-file "complexity" is test enumeration,
not production risk. Production delta was 1361. Merged by bypassing status checks;
excluding `tests/**` from Codacy cloud analysis remains an open option.
