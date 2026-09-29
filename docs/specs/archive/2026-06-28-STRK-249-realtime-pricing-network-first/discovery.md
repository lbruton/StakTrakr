---
sketch: "STRK-249-realtime-pricing-network-first"
phase: discovery
created: 2026-06-27
---

# STRK-249 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

> **Method note.** Findings synthesized from a four-angle read-only research sweep (structural · semantic · prior-decisions · external). Every line reference below was re-verified against the live repo; the issue/requirements line-refs had drifted in several places — see **Drift corrections** at the end of Existing Code. `sw-router.js` lives at the **repo root**, not `js/`.

## Existing Code

_Files and modules already in the project that this work will touch or build on. Paths verified against the live tree._

### Service worker — the realtime caching choke point

| Path | Role | Notes |
|------|------|-------|
| `sw.js:217` | Host classification for `api.staktrakr.com` / `api2.staktrakr.com` | `classifyEndpoint()` then `classifiedFetch(request, family)` at `:220`; falls back to `staleWhileRevalidate` only when `family` is `null`. **Single SW choke point** for realtime API traffic. A second branch handles local `/data/spot-history` at `:226`. |
| `sw.js:385` | `classifiedFetch` — cache-first-with-TTL dispatcher + `lastStrategy` instrumentation | `matchWithAgeCheck` first (`:386`); on a fresh cache hit sets `lastStrategy="cache-hit"` and returns cached **without touching the network** (`:388-390`) — **this is the stale-serve root cause**. Miss → network (`lastStrategy="network"`, `:393`); fetch error → serve stale (`lastStrategy="network-fallback"`, `:397`). |
| `sw.js:355` | `matchWithAgeCheck` — freshness/age gate; TTL floor resolution | Age clock: `x-generated-at` → `x-cached-at` → null(stale). `ttl = x-stale-after ?? family.floor` (`:359-360`). Returns null (forces network) on missing/NaN age or `ageSeconds >= ttl` (`:374`). |
| `sw.js:294-374` | `fetchAndCacheClassified` — envelope/TTL machinery | Parses `generated_at`/`stale_after` from the envelope body into `x-stale-after` / `x-generated-at` headers (`:316-331`). The mechanism the network-first change reworks. |
| `sw.js:274-290` | Generic `networkFirst` / `staleWhileRevalidate` strategy helpers | **Network-first helpers already exist** in the SW but are not wired to the classified realtime path. Relevant to the deferred (approach) mechanism choice. |
| `sw.js:382`, `sw.js:405-409` | `lastStrategy` test instrumentation | Declared `:382`; values `cache-hit` / `network` / `network-fallback`; exposed to tests via the `__sw_test_state__` postMessage handler (`:405-409`). **The test-observable contract** (no `network-first` token exists today). |
| `sw-router.js:9-91` (**repo root**) | `FAMILY_TABLE` — family classification table | **Resolves the deferred (discovery) open question.** 10 families, iterated in order, first match wins, all `hasEnvelope:true` except `annual-spot-history`. Floors (sec): `manifest`=1800 · **`spot-latest`=1200** · `spot-history-daily`=3600 · **`goldback-latest`=90000 (=25h)** · **`retail-latest`=1800** · `retail-intraday`=1200 · `retail-history-short`(7d)=3600 · `retail-history-long`(30d\|90d)=86400 · `providers`=86400 · `annual-spot-history`=86400 (`hasEnvelope:false`). `classifyEndpoint` (`:103`) strips one leading `/data` segment (`:122`) so `/data/v2/…` and `/v2/…` match identically. |

### Frontend — goldback badge repaint gap (US-1 / AC-4–5)

| Path | Role | Notes |
|------|------|-------|
| `js/goldback.js:422-487` | `fetchGoldbackApiPrices` — app-level goldback fetch (failover-aware) | Endpoint loop over `V2_API_ENDPOINTS` (`:432-447`), `cache:"no-store"` fetch (`:437`). Success path (`:481-484`) runs `saveGoldbackPrices`/`fetchGoldbackApiHistory`/`recordGoldbackPrices`/`syncGoldbackSettingsUI` — **but never `renderRatioChips()`**. This is the badge-missing root cause. |
| `js/goldback.js:410` | Spot-derived goldback path (`updateGoldbackFromSpot`) | **Does** call `renderRatioChips()` — the asymmetry: spot paths repaint, the API path does not. |
| `js/init.js:633-641` | Boot-time goldback API fetch trigger | When `goldbackPricingSource==='api'`, fires `void fetchGoldbackApiPrices({expectedSource:"api"})` (`:638`) fire-and-forget. Other callers: `settings-listeners.js:443`, `spotLookup.js:413`. All flow through the `:422` path that omits the repaint. |
| `js/spot-ratio-chips.js:242` | **`renderRatioChips` definition** (issue cited `init.js:762` — wrong) | Loops `renderRatioChip` over silver/gold/platinum/palladium (`:244-247`). `renderRatioChip` (singular, `:211`) paints the gold "GB" badge via `resolveChipContent`→`resolveGoldbackRate`. `window.renderRatioChips` at `:368`; self-invoked once at `:353`. Two read sites call `resolveGoldbackRate`: `resolveChipContent:124` and `renderRatioChip:183`. |
| `js/spot-ratio-math.js:83-96` | `resolveGoldbackRate` — resolves the chip value | `off`→null; fresh cache→`{value, est:false}` (`:88`); stale + `spot`/`manual`→spot estimate `{est:true}` (`:91`); **stale + `api`→null** (`:95`) ⇒ no badge (the Non-Goal #1 estimate fallback would change this). |
| `js/spot-ratio-math.js:52-58` | `readFreshCachedGoldback` — fresh-cache read | Reads `goldbackPrices["1"]`; null if absent or `isGoldbackStale` (`:56`); else `getGoldbackDenominationPrice(1)` when >0. Staleness via `isGoldbackStale` (`:44`, seconds-based: `floor(now/1000)-entry.ts > entry.staleAfter`). **AC-6 explicitly mirrors this helper for the premium seed.** |
| renderRatioChips call sites | Existing repaint fan-out | `api.js:1257,2314,2339,2608,2891` · `goldback.js:410` · `settings-listeners.js:91,458` · `spot.js:497,553,1192,1268` · self-call `:353`. **`fetchGoldbackApiPrices:481-486` is the lone omission.** |

### Frontend — market premium delay & api2 failover gap (US-2 / US-4 / AC-6–9)

| Path | Role | Notes |
|------|------|-------|
| `js/market-data.js:103` | `let _goldbackG1Rate = null` — the premium reference | Gated `> 0` at **three** render sites: vendor matrix `_buildVendorPriceCell:1354` · ticker `_buildTickerItem:386` · modal `_buildModalVendorRow:879`. **All goldback premium cells stay blank until the single `:1702` fetch populates this** — hence the ~1–2 s lag. |
| `js/market-data.js:1700-1715` | **Raw fetch #1** — goldback G1 seed (api1-only) | `if (!_goldbackG1Rate)` guard (`:1700`) → `fetch(V2_API + "/goldback/latest.json", {signal: AbortSignal.timeout(10000)})` (`:1702`); sets `_goldbackG1Rate = gbJson.data.g1_usd` (`:1708`). **No failover** (AC-8 target). |
| `js/market-data.js:1188-1193` | **Raw fetch #2** — retail-detail batch (api1-only) | `fetch(V2_API + "/retail/"+slug+"/latest.json", {signal: AbortSignal.timeout(8000)})` inside `missingSlugs.map`. **No failover** (AC-9 target). |
| `js/market-data.js:11-33` | `_marketV2Fetch` — failover-aware helper (STRK-188) | Resolves `V2_API_ENDPOINTS` (both hosts) else `[V2_API]` (`:12-17`); delegates to `_staktrakrFetch` (`:18-20`) with inline plain-fetch failover fallback (`:23-32`). **The helper the two raw fetches should route through.** Already used at `:186` (manifest), `:602`/`:610`/`:614` (retail detail/history/intraday). |
| `js/market-data.js:5` | `V2_API` const — single hardcoded api1 base | `"https://api.staktrakr.com/data/v2"`. Used only by the two raw-fetch outliers. |
| `js/api.js:42-70` | `_staktrakrFetch` — canonical ordered api1→api2 failover | Iterates urls in order, 5 s per-endpoint `AbortController` timeout (`:47`), optional STRK-189 freshness verdict gate (`:55-58`), throws only if all fail (`:69`). First actual `V2_API_ENDPOINTS` consumption is `api.js:107` (issue's `:42-59` is the definition). |
| `js/constants.js:562-565` | `V2_API_ENDPOINTS` — ordered failover array | `["https://api.staktrakr.com/data/v2", "https://api2.staktrakr.com/data/v2"]`; `window` at `:2051`. |

### Test seams

| Path | Role | Notes |
|------|------|-------|
| `tests/unit/sw-router.test.js` | Pure classifier — **strategy-agnostic** | Asserts `FAMILY_TABLE.length === 10`, exact family order, per-family `{family, floor, hasEnvelope}` for both hosts + `/data/v2` prefix; `goldback-latest` floor pinned **90000** (`:102,238`). Untouched by a strategy flip **unless** floors/table change. |
| `tests/playwright/extended/service-worker.spec.js` | Strategy via `lastStrategy` — **conflict risk** | 5 cases: SC-1–3 cover `annual-spot-history` (`:68/:86/:121`); SC-4–5 cover `spot-latest /data/v2` (`:176/:189`). **No `goldback-latest` / `retail-latest` family exercised for strategy.** **SC-4 (`:186`) expects `cache-hit` for a fresh `spot-latest` entry — the realtime case that directly contradicts a network-first flip**; rescope SC-4 and add `goldback-latest`/`retail-latest` coverage. SC-1's `annual-spot-history` `cache-hit` (`:83`) is **protected by AC-3/C-1** — leave it. This is the spec the requirements' "direct SW-strategy assertion" (locked-scope Tests item 6) extends. |
| `tests/unit/spot-ratio-chips.test.js` | Chip math — fresh/stale × mode matrix | Encodes `resolveGoldbackRate` fresh/stale × mode and `isGoldbackStale` boundary; pure-math, no DOM/repaint. A premium-seed change touching `resolveGoldbackRate` must keep satisfying it. |
| `tests/playwright/core/smoke.spec.js:185-193,268-288`; `retail-market.spec.js:607-620` | Existing gold-card / premium surfaces | The "gold-card GB chip present after async goldback fetch" Playwright case (locked-scope Tests 6a) lands near these. |

### Drift corrections (issue/requirements line-refs that moved)

- `renderRatioChips` is at **`spot-ratio-chips.js:242`**, *not* `init.js:762` (no such reference exists in `init.js`).
- `classifiedFetch` at `sw.js:385` (issue `~:386`); `matchWithAgeCheck` at `sw.js:355` (issue `~:351`).
- `sw-router.js` is at the **repo root**, not `js/`.
- `V2_API_ENDPOINTS` first *consumption* is `api.js:107`; `api.js:42-59` is the `_staktrakrFetch` definition.
- Goldback G1 raw fetch confirmed `market-data.js:1700-1715` (issue `~:1700-1718`); gating at `:1354` (issue `~:1354`, exact).

## Prior Decisions

_From mem0, sessionflow, and git. Queries recorded below each cluster._

- **2026-06-12 — commit `bc94ae01` (STRK-190, v3.35.20): the decision STRK-249 partially reverses.** All API families were *intentionally* flipped to **cache-first-with-TTL** because `classifyEndpoint` returned null for production `/data/v2/…` URLs (falling through to SWR); the classifier was fixed to strip one leading `/data` segment. **STRK-249 reverses the _strategy choice_ for the realtime families while keeping STRK-190's classifier fix.** Corroborated by mem0 `0647a185` (retro-learning, 2026-06-14): "User intentionally flipped behavior so all API families … use a cache-first-with-TTL strategy."
- **2026-05-16 — mem0 `edf6a57f` (STRK-79): the original intent STRK-249 restores.** Initial SW design was *network-first for spot/latest, cache-first for historical, SWR for manifest/slug-detail.* STRK-249 effectively restores the STRK-79 network-first intent for the realtime families that STRK-190 overrode.
- **STRK-188 (commit `3aa4e6a9`, v3.35.17) — `_marketV2Fetch` api1→api2 failover helper** (`market-data.js:11`). Already wired at `:186/602/610/614`; the two raw fetches (`:1189`, `:1702`) are the outliers AC-8/AC-9 fold in.
- **STRK-189 (commit `6875d065`, v3.35.19) — per-family freshness verdict gate** (`api-health.js:49-112,286`): "Primary degraded — backup is currently serving data." The `_staktrakrFetch` `validate` gate (`api.js:55-58`) is part of this lineage; relevant to AC-8's "a SW stale-fallback for api1 must not be treated as a successful api1 result."
- **2026-06-27 — mem0 `ab45e58a` & `e80e7eb5` (STRK-249 handoffs):** this issue's own session already (a) identified the primary-only `market-data.js` gaps at the retail-detail and goldback-G1 paths, and (b) **verified api1 and api2 both serve current v2 spot/goldback/manifest** — the failover target is live.
- **2026-06-06 — mem0 `ef499df5` (session-digest): goldback-badge pattern of record** — the gold-card chip should reuse `getGoldbackDenominationPrice(1)` "with the envelope's `stale_after` guard, falling back to spot-estimate." Informs the badge-repaint + premium-seed-from-cache work; the spot-estimate fallback is this sketch's deferred Non-Goal #1.
- **No prior decision exists for:** the badge-repaint-on-fresh-data mechanism, the premium-rate seed-from-cache wiring, or **STRK-248** (companion intraday-history pipeline — unbuilt; STRK-249 only *defers* to it). **STRK-223** (clear-watermark) and **STRK-213** (AbortController timeout) returned **nothing** relevant to SW caching strategy — different code paths.

_Queries — mem0:_ `"StakTrakr STRK-249 service worker cache-first realtime spot goldback retail freshness floor goldback badge renderRatioChips"`; `"service worker cache strategy network-first realtime pricing offline fallback envelope freshness TTL"`. _sessionflow:_ `"service worker cache-first realtime pricing goldback badge STRK-188 _marketV2Fetch api1 api2 failover freshness floor"`. _git:_ `--grep STRK-188/189/248/249`, `-S'_marketV2Fetch'`, `--grep 'cache-first|network-first|service worker'`.

## External References

_Background only — StakTrakr's SW is hand-rolled (no Workbox). Used to anchor terminology for the deferred (approach) mechanism choice._

- [Workbox — Caching strategies overview](https://developer.chrome.com/docs/workbox/caching-strategies-overview/) — **Network First (network falling back to cache):** "go to the network first … place the response in the cache. If you're offline at a later point, you fall back to the latest version of that response in the cache." This is the AC-1 shape — fresh-when-online, cache used **only** after the network attempt. Same page defines **Cache First** (current StakTrakr behavior to retire): the request hits the cache and is served from there before any network attempt — a within-TTL stale entry (goldback floors at 25 h) is returned with no network call.
- [web.dev — The Offline Cookbook](https://web.dev/articles/offline-cookbook) — **Network falling back to cache:** "give online users the most up-to-date content, but offline users get an older cached version" — network attempt first, cache **only if it fails** (exact AC-1 ordering). **Stale-while-revalidate** (why AC-1 excludes it): "If there's a cached version available, use it, but fetch an update for next time." The cached copy serves immediately; the refresh benefits only the *next* load — for a realtime endpoint this guarantees a stale first paint (the reported symptom).

## Constraints

_Things the implementation must respect._

- **C-1 (AC-3):** only the **realtime families** (`spot-latest`, `goldback-latest`, `retail-latest`) change strategy. The other 7 `FAMILY_TABLE` entries (history/manifest/providers/annual) and all static assets keep cache-first. `annual-spot-history` is the only `hasEnvelope:false` family — do not lump it in.
- **C-2 (offline fallback, AC-2 / US-5):** realtime endpoints stay cached purely as an offline fallback; cache is served **only** after a network attempt fails. `lastStrategy="network-fallback"` already models this; `cache-hit` must no longer be the online path for these families.
- **C-3 (test-observable contract):** behavior is asserted through `lastStrategy` via `__sw_test_state__` (`sw.js:405`). **No `network-first` strategy token exists in `sw.js` today** — the existing values are `cache-hit`/`network`/`network-fallback`. The approach must define what the online realtime path reports (likely `network` with `network-fallback` offline).
- **C-4 (test conflict):** the scoped realtime conflict is `service-worker.spec.js` **SC-4**, which hard-asserts `cache-hit` for a fresh `spot-latest` entry (`:186`). SC-1's `annual-spot-history` `cache-hit` (`:83`) is **protected by AC-3/C-1** and must NOT change — only a *global* flip would wrongly break it. The SW classifier unit suite (`sw-router.test.js`) is safe **unless** floors/the table change. Expect to rework/rescope **SC-4** and add `goldback-latest`/`retail-latest` coverage, not just add cases.
- **C-5 (Playwright + SW interception):** mem0 `fde1b4cd`/`70e349b2` (STRK-79 retro) — **`page.route` cannot intercept SW-originated fetches**; use `browserContext.setOffline(true)` for the stale-cache / offline-fallback scenarios. Required for AC-2 coverage.
- **C-6 (SW opaque-response gotcha):** mem0 `b060a32d` — check `response.type === "opaque"` (status 0) **before** `!response.ok` in any new SW fetch branch.
- **C-7 (two staleness windows — pick correctly):** chip/premium freshness uses `isGoldbackStale` (`spot-ratio-math.js:44`, seconds-based, envelope `staleAfter`), but `getGoldbackPriceInfo` (`goldback.js:566`) uses a separate hard-coded `STALE_MS = 25 h` on `entry.updatedAt`. **AC-6 mandates mirroring `readFreshCachedGoldback`** (the seconds-based path) for the premium seed — do not accidentally key the seed on the 25 h reader.
- **C-8 (failover ≠ SW short-circuit, AC-8/AC-9):** routing the two raw fetches through `_marketV2Fetch` is necessary but not sufficient — a SW **stale-cache fallback for api1** must not be treated as a successful api1 result that ends the failover loop before api2 is tried. This couples the failover fix to the network-first SW change.
- **C-9 (premium gating fan-out):** `_goldbackG1Rate` gates **three** render sites (`:386` ticker · `:879` modal · `:1354` vendor matrix) plus its setter (`:1708`); a seed change must satisfy all three, and the network correction (AC-7) must re-render.

## Open Questions

_Discovery resolved the one question requirements tagged `(discovery)`. The remaining item is a design choice deliberately handed to the approach phase, not a blocker._

- [x] **RESOLVED (was the deferred `(discovery)` question):** the realtime price families and their matcher paths are `FAMILY_TABLE` entries `spot-latest` / `goldback-latest` / `retail-latest` in **`sw-router.js:9-91` (repo root)**; the SW matcher entry point is `sw.js:217` → `classifiedFetch` (`sw.js:385`) → `matchWithAgeCheck` (`sw.js:355`).
- [ ] **HANDED TO APPROACH (the deferred `(approach)` question — does not block this phase):** which revalidation mechanism satisfies AC-1's fresh-while-online contract — (a) route the three realtime families to the existing `networkFirst` helper (`sw.js:274-290`), or (b) keep `classifiedFetch` but force an effectively-zero online floor / fetch-first for those families. Evidence for the choice: both mechanisms already exist; option (b) reuses the envelope-age machinery; either way `lastStrategy` must report a non-`cache-hit` value online (C-3) and SC-4 must be rescoped (C-4). _Discovery does not pick one — that's the approach phase's call._

## Discovery Summary

The work lands in **four well-mapped spots**: (1) the SW realtime choke point at `sw.js:217`→`classifiedFetch:385`, where a fresh `cache-hit` is returned with no network call — flip the three `FAMILY_TABLE` realtime families (`sw-router.js`, repo root) to a network-first/short-floor strategy while keeping STRK-190's classifier fix and AC-3's other-family cache-first behavior; (2) the one-line repaint asymmetry — `fetchGoldbackApiPrices` (`goldback.js:481-486`) is the lone goldback path that never calls `renderRatioChips` (`spot-ratio-chips.js:242`); (3) the premium lag — seed `_goldbackG1Rate` from cache via the `isGoldbackStale`/`readFreshCachedGoldback` path AC-6 names, then correct from the network; and (4) two raw api1-only fetches (`market-data.js:1189`, `:1702`) routed through the existing `_marketV2Fetch` helper. The genuinely tricky parts are the **test rework** (SC-4 hard-asserts `cache-hit` for `spot-latest`; no `network-first` token exists yet; SW fetches need `setOffline` not `page.route`) and the **failover/SW-short-circuit coupling** (C-8) — a stale api1 SW fallback must not masquerade as a successful api1 result. Everything else is low-risk reuse of plumbing that already exists (`_marketV2Fetch`/STRK-188, the envelope `stale_after` machinery/STRK-189, the chip-freshness helpers). STRK-249 is a deliberate, scoped reversal of STRK-190 restoring STRK-79's network-first intent — not a fix for an oversight.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved (the one design choice is explicitly deferred to approach, not blocking). Then advance: `/sketch-approach STRK-249`.

## Review Archive — discovery (2026-06-27)

### Resolution Summary

- **Accepted (2):** A1 — the realtime SW-strategy conflict is **SC-4** (`spot-latest` fresh → `cache-hit`, `service-worker.spec.js:186`), **not** SC-1 (`annual-spot-history`, which stays cache-first and is *protected* by AC-3/C-1); corrected in the test-seam row, **C-4**, the Open-Question handoff, and the Discovery Summary, and "no realtime family exercised" refined to "no `goldback-latest`/`retail-latest` exercised" (since `spot-latest` *is* covered by SC-4/SC-5). A2 — `_goldbackG1Rate` gates **three** render sites (`:386`/`:879`/`:1354`) plus its setter (`:1708`), not "four render sites"; corrected in the `market-data.js:103` row and **C-9**.
- **Rejected (0):** none.
- **Resolved with your input (0):** none — both corrections were factual/mechanical.
- **Verification:** both claims confirmed against the live repo — `grep _goldbackG1Rate js/market-data.js` (3 display branches `:386/:879/:1354` + setter `:1708`); `service-worker.spec.js:68` (SC-1 = `annual-spot-history`) vs `:176/:186` (SC-4 = `spot-latest` → `cache-hit`).

The original review is preserved verbatim below.

### CODEX Review (2026-06-27)

#### Verified

- Read `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, and `.context/sketch-conventions.md`.
- Resolved the sketch folder to `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/sketches/STRK-249-realtime-pricing-network-first`; `discovery.md` is untracked in DocVault, so verification used direct readback.
- Checked `sw-router.js:9-140`, `sw.js:216-409`, `js/goldback.js:422-487`, `js/spot-ratio-chips.js:122-368`, `js/spot-ratio-math.js:38-96`, `js/init.js:633-641`, `js/market-data.js:1-33,374-388,856-880,1187-1204,1351-1356,1699-1718`, `js/api.js:42-70,106-110`, and `js/constants.js:561-565,2051`.
- Checked `tests/playwright/extended/service-worker.spec.js:68-209`, `tests/unit/sw-router.test.js:30-271`, and `tests/unit/spot-ratio-chips.test.js:177-260`.
- Verified the cited caching-strategy definitions against Chrome/Workbox and web.dev docs: network-first tries network before cache fallback; stale-while-revalidate can serve cache first while refreshing in the background.
- Checked git history for STRK-190 (`bc94ae01` / `2625836a`), STRK-188 (`3aa4e6a9`), STRK-189 (`6875d065` / `039d83c6`), and STRK-79 (`4ef167bf`).

#### Top concerns

- The discovery misidentifies the SW Playwright conflict: SC-1 is `annual-spot-history` and should remain cache-first; SC-4 is the realtime `spot-latest` assertion that contradicts AC-1.
- `_goldbackG1Rate` is described as gating four render sites, but the live file has three display branches plus one setter. This should be corrected before the approach turns it into a file map or test inventory.

#### Unverified assumptions

- I did not inspect Plane STRK-249 live; this review used the requirements artifact and live repo evidence.
- I did not hit the production API endpoints during this review; the discovery's current-api-health claim remains inherited from the source issue / prior handoff text.
