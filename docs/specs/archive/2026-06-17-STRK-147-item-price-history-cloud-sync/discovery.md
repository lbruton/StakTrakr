---
sketch: "STRK-147-item-price-history-cloud-sync"
phase: discovery
created: 2026-06-17
---

# STRK-147 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

> **Sources:** Codex discovery comment (2026-06-17, `dev` @ `775e01aa`, v3.35.24) +
> independent verification this session via three read-only Explore agents (constants/
> priceHistory/backup/vault; cloud-sync companion-vault pattern; test landscape). Every
> Codex claim was confirmed against the live code; line numbers below are from that
> verification.

## Existing Code

### Data, allowlists & retention — `js/constants.js`
| Path | Role | Notes |
|------|------|-------|
| `js/constants.js:541` | `ITEM_PRICE_HISTORY_KEY = "item-price-history"` | The localStorage key. |
| `js/constants.js:954` | In `ALLOWED_STORAGE_KEYS` | Survives `cleanupStorage`; eligible for manual vault/ZIP backup. **Keep.** |
| `js/constants.js:873-945` | `SYNC_SCOPE_KEYS` | Item-price-history is **deliberately absent** — must stay absent (no LWW path). |
| `js/constants.js:1145-1149` | `HISTORY_IDB_KEYS` = spot, `v2RetailHistory`, retail | Item-price-history is **not** here → stays in localStorage, not IndexedDB. |
| `js/constants.js:1152,1155` | `ITEM_PRICE_HISTORY_MAX_DAYS=365`, `…MAX_ENTRIES=1000` | Retention cap applied on every save. |
| `js/constants.js:831,834,837,840` | `SYNC_FILE_PATH`, `SYNC_META_PATH`, `SYNC_IMAGES_PATH`, `SYNC_ATTACHMENTS_PATH` | `.stvault` path-constant pattern to mirror for a new companion path. |

### Price-history store — `js/priceHistory.js`
| Path | Role | Notes |
|------|------|-------|
| `js/priceHistory.js:180-186` | `recordItemPrice()` entry shape | Entry = `{ ts, itemName, retail, spot, melt }`. Merge fingerprint must cover all fields, not just `ts`. |
| `js/priceHistory.js:231-257` | `mergeItemPriceHistory(imported)` | Unions by UUID, **dedupes by `entry.ts` only** — fine for ZIP restore, unsafe for cross-device (drops distinct same-`ts` snapshots). |
| `js/priceHistory.js:51-58` | `saveItemPriceHistory()` | Applies retention + `saveDataSync`; **does NOT call `scheduleSyncPush()`** → AC-4 requires adding a debounced trigger. |
| `js/priceHistory.js:21-45` | `applyItemPriceRetention()` | 365-day age cutoff + newest-1000 backstop per UUID. Reuse post-merge (AC-10). |

### Manual backup paths (preserve unchanged)
| Path | Role | Notes |
|------|------|-------|
| `js/inventory-backup.js:189-195` | ZIP export → `item_price_history.json` | Manual ZIP backup. |
| `js/inventory-backup.js:739-745` | `_restoreItemPriceHistory()` → `mergeItemPriceHistory()` | ZIP restore uses the ts-only merge. Any refactor must preserve restore behavior (non-goal: change it). |
| `js/vault.js:215-254` | `restoreVaultData()` | Skips `HISTORY_IDB_KEYS`, then restores keys in `ALLOWED_STORAGE_KEYS` → item-price-history restored via encrypted vault. |

### Cloud-sync companion-vault pattern — `js/cloud-sync.js` (the template to mirror)
| Path | Role | Notes |
|------|------|-------|
| `js/cloud-sync.js:2168-2177` | `metaPayload` build | `if (imageVaultMeta) metaPayload.imageVault = …` / `attachmentVault`. Add `itemPriceHistoryVault` the same way. |
| `js/cloud-sync.js:1895-2009` | Push image vault | collect→hash→compare→encrypt→upload to dedicated path; **preservation** when local empty but remote present (1954-1965, 2241-2243). |
| `js/cloud-sync.js:2011-2165` | Push attachment vault | Same shape; `_pullAttachmentVault` referenced at 2855/3855/4080/4402/4484. |
| `js/cloud-sync.js:1293-1316` | Manifest build (settings snapshot 1308-1316) | Companion-vault data is **kept OUT**; only metadata pointer in `metaPayload`. AC-8. |
| `js/cloud-sync.js:3803-3869` | **Silent-pull** path (image pull 3813-3846) | When manifest shows no item/settings changes → pull companion vault by hash diff, no diff modal. AC-5. |
| `js/cloud-sync.js:4437-4491` | **Vault-first** path (image 4440-4474, attach 4483-4491) | Post-DiffModal companion pull; update `_vfPullMeta.<hash>`. |
| `js/cloud-sync.js:3154-3236, 3770-3790, 4260-4286` | `DiffEngine.compareSettings()` / `_applyAndFinalize()` | The **LWW settings path to AVOID** for item-price-history. |
| `js/cloud-sync.js:377-407` | `syncGetLastPull()` / `syncSetLastPull()` | `lastPull` advancement; companion-write failure must NOT advance it. AC-7. |

### Tests
| Path | Role | Notes |
|------|------|-------|
| `tests/playwright/core/history-store-migration.spec.js:995-1029` | STRK-141 guard | Asserts spot/retail/legacy/item/flag all out of `SYNC_SCOPE_KEYS`. **Must stay green** (AC-11). |
| `tests/playwright/core/attachments-cloud.spec.js` | E2E cloud-sync template | `seedCloudState` / `routeDropbox` (mock Dropbox) / `encryptedManifest` / `pullWithPreview` + modal-apply stub. Model the new E2E spec on this. |
| `tests/unit/cloud-sync-tag-merge.test.js` | Merge-correctness precedent | Slice-and-eval the real `_mergeTagData`; tests commutativity, tie-union, idempotency, untimestamped convergence. Model the new merge unit test on this. |
| `tests/playwright/coverage-map.csv` | Coverage registry | Columns: `file,test_count,domain,risk_class,decision,replacement_target,rationale`. New spec needs a row. |
| `.context/cloud-sync-convergence.md` | Convergence contract | Logical (decompressed/parsed/sorted) compare+hash; commutative merge on ties; only bump timestamp on real change. AC-9. |

## Prior Decisions

_Queries: SessionFlow issue timeline + search `STRK-147`; mem0 `STRK-147 Cloud-sync
item-price-history UUID-aware merge StakTrakr` (per Codex), cross-checked against this
session's auto-memory index._

- **2026-06-04** — STRK-141 "Option Y" assumed adding item-price-history to `SYNC_SCOPE_KEYS`
  was a one-key array change; design analysis found it unsafe (LWW drops entries) → this
  issue split out. (mem0 STRK-141 Option Y memory; issue body.)
- **STRK-108 / STRK-155** — per-item **tag merge** is the precedent for a commutative,
  case-insensitive **union merge on ties** (`_mergeTagData`/`_unionTags`). Item-price-history
  is the same class of "per-item map merged across devices." (`.context/cloud-sync-convergence.md` surface matrix.)
- **STRK-140** — compression (CMP2:, ~4096-char threshold) was driven partly by
  item-price-history size → canonicalization must `__decompressIfNeeded` before compare/hash.
- **STRK-157** — corruption sentinel (`[object Object]`) is **exact-match**, never substring;
  boot-repair self-heals un-round-trippable writes. Relevant to any new persisted value.
- **localStorage dual registration** (auto-memory) — new sync keys normally need BOTH
  `ALLOWED_STORAGE_KEYS` + `SYNC_SCOPE_KEYS`; here we intentionally use a **companion vault
  instead** of `SYNC_SCOPE_KEYS`, so item-price-history stays out of the settings scope.

## External References

- _None._ No new libraries or RFCs — the work reuses existing internal patterns (companion
  vault, AES-256-GCM vault encryption, tag-merge convergence). Foundation refs:
  `DocVault/Projects/StakTrakr/Foundation/cloud-sync.md`, `Foundation/Deep Dives/Data Model.md`.

## Constraints

- **No LWW for item-price-history** — must not flow through `compareSettings`/`_applyAndFinalize`.
- **Manifest stays lightweight** — only `{hash, count}` metadata, never full history JSON.
- **Convergence contract** (`.context/cloud-sync-convergence.md`): logical compare/hash +
  commutative merge on ties + idempotent (bump timestamp only on real change).
- **Stays in localStorage** with the existing 365d/1000-entry retention cap.
- **STRK-141 guard test must keep passing**; spot/retail histories stay IndexedDB-local.
- **Orphan boundary** — remote history must filter to UUIDs in the accepted inventory.
- **Partial-failure** — failed history write must not advance `lastPull`.

## Open Questions

_None blocking approach._ The one design fork — **reuse the existing ts-only
`mergeItemPriceHistory()` vs. introduce a new fingerprint-based `mergeItemPriceHistories()`**
(and whether the ZIP path adopts the new merge) — is an **approach-phase decision**, not a
discovery gap. The convergence contract strongly implies a new fingerprint merge for the
cloud path while leaving ZIP restore behavior intact.

## Discovery Summary

The work lands almost entirely in `js/cloud-sync.js` (new companion-vault push/pull across
the silent-pull, manifest-first, and vault-first paths) plus a pure merge/canonicalize/hash
helper in `js/priceHistory.js` and one path/metadata constant in `js/constants.js`. The
companion-vault pattern (image/attachment) is a proven, near-complete template, and the
tag-merge convergence precedent gives a tested model for the commutative union merge — so
the hard parts are *plumbing parity* (wire the new channel into all three pull paths +
partial-failure handling) and *merge correctness* (full-fingerprint dedupe, same-`ts`
preservation, retention after merge). The trickiest seam is the orphan-boundary filter
(history filtered to accepted-inventory UUIDs) inside the post-apply path.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch-approach STRK-147`.
