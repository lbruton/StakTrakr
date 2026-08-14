# Changelog

All notable changes to StakTrakr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.35.101] - 2026-08-13

### Fixed — STRK-338: Market coin names could silently stop caching

- **Market manifest cache now survives compression** (STRK-338): The cached list of coins
  the Market block tracks — the canonical names, weights, and metals behind every row —
  was written by one module through the app's compressing storage helpers but read back by
  another with those helpers bypassed. Values under 4,096 characters are stored verbatim,
  so the two halves agreed and nothing broke; past that size the reader could no longer
  parse what the writer had stored, silently discarded the cache, and fell back to a short
  built-in coin list until the next successful sync. The cached roster measured about
  57% of that limit and grows with every coin added, so this was on track to start
  happening on its own. Both sides now use the same helpers, and the duplicated restore
  logic that let them drift apart has been collapsed into one place (STRK-338).

---

### Fixed — STRK-329: Constitutional silver card should not be collapsible

- **Constitutional card is no longer collapsible** (STRK-329): The constitutional silver
  card — the denomination / face-value entry that replaces the standard weight row when
  Type = Constitutional — was accidentally included in the STRK-301 collapsible form
  sections sweep. Unlike the seven optional sections (Grading, Market Pricing, etc.), this
  card is a type-driven field swap: when it is visible it holds the only inputs that can
  value the item, so there is nothing to disclose. Worse, the collapsed state was
  remembered — a user who collapsed it once got a card with no visible inputs on every
  subsequent add, which read as the form being broken. The card now uses the same visual
  chrome (icon, header, chip toggle) but is a plain div, not a disclosure element, so it
  cannot be collapsed. Any stale `{constitutional: false}` in localStorage is harmlessly
  ignored.

---

## [3.35.99] - 2026-08-11

### Fixed — STRK-333 / STRK-332: The freshest endpoint is not always the complete one

- **Spot: per-metal backfill from the runner-up** (STRK-333): `_fetchFreshestSpotEnvelope`
  ranked endpoints purely by `generated_at` and returned a single winner. The publisher
  builds `spot/latest.json` from whichever current rows exist and skips absent metals
  (`devops/pollers/shared/api-export-v2.js`), bailing only when every row is missing — so a
  fresh, valid, partial envelope is reachable. A metal the winner omitted was left on its
  previous value, and a sole missing selection failed the sync outright, while a slightly
  older endpoint carried the price. Both endpoints are already fetched in parallel, so the
  runners-up are now retained and any metal missing from the winner is filled from the
  next-freshest envelope that has it, at no extra network cost and only from candidates
  that already cleared the same lenient STRK-189 gate.
- **Backfilled metals keep their own timestamp** (STRK-333): a metal sourced from a
  runner-up is recorded with that envelope's publication time rather than the fresher
  winner's, so a 25-minute-old price is never stamped as 5 minutes old. The returned
  `generatedAt` remains the winner's, which keeps the `_lastAcceptedSpotGeneratedAtMs`
  monotonic guard's meaning intact — reporting the oldest contributing envelope instead
  would let a backfill trip that guard and discard the whole sync, fresh metals included.
- **Retail: per-file fallback across endpoints** (STRK-332): `exportRetail()` catches and
  skips individual slug failures yet `main()` still writes a fresh manifest, so the
  newest-manifest endpoint can be missing slug files. `_syncRetailV2` fetched every slug
  exclusively from that one base and a gap degraded straight to the stored price. The
  runners-up from the manifest race are now retained and a slug file missing from the
  chosen endpoint is retried against the others before being given up on. This exposure
  pre-dates the freshest-wins change — the previous first-HTTP-OK selection was equally
  single-base.

---

## [3.35.98] - 2026-08-06

### Fixed — STRK-331: Spot sync can no longer hang on a stalled endpoint

- **Timeout covers the body read**: `_staktrakrFetch` cleared its 5-second timer as soon as
  response headers arrived, leaving the JSON body read unbounded. Harmless when endpoints
  were tried one at a time, but v3.35.97's parallel freshest-endpoint fetch waits for every
  endpoint to settle — so one endpoint stalling mid-body would have hung the entire spot
  sync. The timer now stays armed until the payload is fully parsed, bounding headers and
  body inside the same 5-second budget (STRK-331)

---

## [3.35.97] - 2026-08-06

### Fixed — STRK-331: Freshest endpoint wins — data paths and badge

- **Freshest data always serves**: the spot sync and the retail market sync now fetch every
  API endpoint in parallel and use the one with the newest publication timestamp, instead of
  the first acceptable responder. Verified live after v3.35.96: api1 at 23 minutes old was
  still being served — and honestly reported orange — while api2 sat 8 minutes fresh and
  unread (STRK-331)
- **Badge reports the freshest feed**: the footer badge now shows the smallest age per feed,
  matching what the data paths serve. In the observed state it reads a green
  "⚠️ Market 8m ago · Spot 8m ago" — fresh data, warning icon flagging the lagging
  endpoint, full breakdown in the health modal (STRK-331)
- **Safety rails unchanged**: every candidate still passes the STRK-189 freshness gate, so
  days-old service-worker or CDN copies are rejected, an all-stale fleet still fails the
  sync rather than resurrecting old data, and the monotonic overwrite guard is untouched
  (STRK-331)

---

## [3.35.96] - 2026-08-06

### Fixed — STRK-331: Footer API health badge reports the serving endpoint

- **Badge follows the failover**: the footer health badge now reports the age of whichever
  API endpoint is actually serving data, instead of always describing the primary. During
  the 2026-08-06 GitHub Pages incident it showed "2h ago" in orange while the backup was
  serving fresh prices — the app looked broken while working exactly as designed (STRK-331)
- **Two independent signals**: time and color describe the data on screen (green fresh,
  orange stale); a new leading status icon describes the infrastructure — ✅ when both
  endpoints are healthy, ⚠️ when either is stale or unreachable. Clicking the badge still
  opens the health modal with the full per-endpoint breakdown (STRK-331)
- **No more false alarms**: the badge previously judged the primary by its envelope's raw
  20-minute budget while the data path tolerated up to 2 hours before failing over, so it
  cried wolf across that whole window. Badge selection now mirrors the data path's own
  failover rules per feed (STRK-331)

---

## [3.35.95] - 2026-08-02

### Changed — STRK-328: Inventory is now always visible

- **Inventory tab locked**: Inventory joins Dashboard as an always-visible tab and its
  Settings › Appearance › Layout checkbox is disabled. It is not a peer of Market and
  Collections — it holds the only control that can add or edit an item, and the Dashboard is
  derived entirely from that data, so hiding it left a new user with empty totals and no way
  to fill them (STRK-328)
- **Stored hidden state healed**: anyone whose saved config already had the search bar and
  table turned off is restored on load. Locking alone would only have stopped writing those
  values, leaving a permanently visible tab opening an empty panel with the checkbox now
  disabled — no way back from inside the app (STRK-328)
- **Dashboard sections unaffected**: the healing is scoped to locked tabs that have no other
  control for their sections, so Dashboard's three modules stay independently hideable. A
  minimal Dashboard remains a legitimate end state (STRK-328)

---

## [3.35.94] - 2026-08-02

### Fixed — STRK-327: Best Price ticker froze when built on a hidden tab

- **Ticker animation**: the Best Price ticker no longer reveals frozen with a horizontal
  scrollbar after the page is reloaded on Inventory or Market, or after a Market setting
  re-renders it while Dashboard is hidden. It sizes its scroll loop from a measured width,
  which reads zero inside a `display:none` panel, so it fell back to the static layout and
  nothing re-measured on reveal; `activateTab` now repairs it (STRK-327)
- **Short tickers unaffected**: a genuinely static track — fewer than four items, where the
  centring and scrollbar are intentional (STRK-317) — is left alone. The repair keys on the
  duplicate content block that only looping tracks carry, not on the overloaded `static`
  class, so a short track is never animated against a gap (STRK-327)
- **Test coverage**: both directions are pinned and mutation-verified. Also de-flaked the
  goldback ticker-consistency test, whose locator spanned every mounted track and could
  resolve to two nodes while a superseded track awaited its sweep (STRK-327)

---

## [3.35.93] - 2026-08-02

### Changed — STRK-326: Settings › Layout reworked for the tab shell

- **Tabs**: a new group in Settings › Appearance › Layout shows or hides whole tabs. A hidden tab
  is removed from both the header nav and the mobile bottom bar, so unticking Vendor Prices no
  longer leaves a live Market link that opens an empty panel (STRK-326)
- **Dashboard sections**: the old flat "Visible sections" list is now scoped to the Dashboard tab.
  Its cross-tab reorder arrows moved entries between panels a user could never see side by side,
  which made the control look broken; Inventory, Market, and Collections hold a single module each
  and are managed by the Tabs group instead (STRK-326)
- **Dashboard is always visible**: locked on, guaranteeing a fallback target — a bookmarked
  `#/market` link to a tab you have since hidden now lands on Dashboard rather than a blank
  shell, as does hiding the tab you are currently viewing (STRK-326)
- **Show Realized G/L** is unchanged and stays in the Layout header (STRK-326)

---

## [3.35.92] - 2026-08-02

### Changed — STRK-282: v2 tab shell

- **Tabbed layout**: the page is now organised into Dashboard, Inventory, Market, and Collections
  views, driven by a text nav in the header and a fixed bottom bar on mobile. Section contents and
  behaviour are unchanged — the tabs only control which group is on screen (STRK-282)
- **Deep links**: each view has its own route (`#/dashboard`, `#/inventory`, `#/market`,
  `#/collections`), so a tab can be bookmarked or linked directly (STRK-282)
- **Merged inventory surface**: the search/filter bar and the inventory table now render as one
  continuous card instead of two separated panels (STRK-282)
- **Fixed**: the inventory recovery banner is no longer hidden when it appears while another tab is
  active — it warns that inventory could not be loaded, so it now sits above the tabs and stays
  visible wherever you are (STRK-282)
- **Collections**: placeholder view, built out under STRK-254 (STRK-282)

---

## [3.35.91] - 2026-08-01

### Changed — STRK-322: MintBuilder becomes a first-class frontend vendor

- **MintBuilder registered in the frontend vendor registries**: `RETAIL_VENDOR_NAMES`, `RETAIL_VENDOR_URLS`, and `RETAIL_VENDOR_COLORS` now carry mintbuilder ("MintBuilder", `https://mintbuilder.com`, indigo `#818cf8`), so the price detail modal's vendor legend, forward-fill, anomaly consensus, and intraday table columns all treat it exactly like the other ten vendors instead of relying on the STRK-317 short-label patch (STRK-322).
- **Published manifest drops the placeholder**: the v2 API publisher's `VENDOR_META` gains the same entry, so `manifest.json` stops emitting `{name: "mintbuilder", color: "#94a3b8", url: null}` and ships real display metadata; `VENDOR_META` is now exported and pinned by a unit test (STRK-322).
- **Registry parity is now test-enforced**: a Playwright test asserts the three frontend registries (`RETAIL_VENDOR_NAMES`/`URLS`/`COLORS`) describe the same vendor set with unique colors, and a unit test pins the shape of every `VENDOR_META` entry — so a vendor can no longer land in one of these registries but not the others. Paths outside these registries (e.g. a vendor never registered at all) are out of scope here (STRK-322).

---

## [3.35.90] - 2026-07-31

### Changed — STRK-301: Collapsible add/edit form sections, restored and remembered

- **The add/edit item form folds away what you aren't using**: Grading & Certification, Market Pricing & Details, Catalog Data, Notes, Attachments, and Tags are now collapsible sections, collapsed by default on a fresh form. The Images block gets the same treatment and starts open. This is the top request from mobile users — the form is dramatically shorter to scroll. The collapse mechanism is the browser's own disclosure element, so it works with keyboard, screen readers, and zero JavaScript (STRK-301).
- **Your layout is remembered**: open or close any section and the form comes back that way next time, per device. When you edit an item, any section that actually holds data — tags, notes, a certification — opens automatically unless you've explicitly told it to stay closed (STRK-301).
- **Nothing hides silently**: a collapsed section with content shows a count pill on its header — 3 tags, 1 note, 2 attachments — so data is always advertised even when folded away (STRK-301).
- **Clearer names**: the section formerly titled "Pricing & Details" is now **Market Pricing & Details**, and its price field reads **Today's Market Price** instead of "Retail Price" (STRK-301).
- **Catalog lookups open their section**: applying a Numista result auto-opens Catalog Data so the filled fields are visible immediately (STRK-301).

---

## [3.35.89] - 2026-07-31

### Fixed — STRK-320: Spot-card freshness colour catches up when you return to the tab

- **The ↻ icon's colour no longer freezes while the tab sits idle**: the freshness colour was only recomputed when something happened — boot, a sync, a button-state refresh — so a tab left open overnight with no sync kept showing green about prices the app knew were a day old. The icon now repaints the moment the tab becomes visible again, so the colour you see on returning always reflects the real age of the data (STRK-320).
- **No background polling**: the repaint rides the browser's own tab-visibility signal instead of a timer, so a hidden tab does zero work and there is no refresh interval to tune or drain your battery (STRK-320).

---

## [3.35.88] - 2026-07-30

### Added — STRK-291: Spot-card refresh icons show at a glance how current your prices are

- **The ↻ button on each spot card is now colour-coded by how old your prices are**: green when the data is under an hour old, amber between an hour and a day, red beyond that. Previously the icon looked identical whether you had synced a minute ago or last month, so there was no way to tell stale prices from fresh ones without reading the timestamp under each card. The colour updates the moment a sync finishes (STRK-291).
- **A valid cached price still reads as fresh**: if you use an API provider with a cache window, a price that is a few hours old but still inside that window shows green rather than amber. The app is not going to refetch it, so flagging it as stale would be misleading (STRK-291).
- **"Never synced" reads amber, not red**: a brand-new install shows a neutral warning rather than opening on an alarm colour. Red is reserved for prices that are genuinely known to be over a day old (STRK-291).
- **Two different questions, two different indicators**: this icon answers "how current is the data in my browser". The API health panel answers a separate question — "is the price feed still publishing" — and keeps its own, much tighter threshold. They are documented as deliberately distinct so a future change to one does not silently drag the other along (STRK-291).
- **Legible in all four themes**: every colour was measured against its background rather than eyeballed. Two failed the accessibility bar for icons and were darkened — amber in Light and Sepia, and green in Sepia, which turned out to be too pale to read against the sepia card. A test now measures all twelve colour/theme combinations on every run, so a future palette change cannot quietly make an indicator unreadable (STRK-291).

---

## [3.35.87] - 2026-07-30

### Fixed — STRK-314: Vendor-registry config overrides reach the scrape

- **Caller-supplied scrape overrides are no longer discarded**: the retail poller resolved a target's scrape configuration by preferring the vendor module's own config over the caller's, using a `??` fallback. Because every vendor module exposes a config object — including the legacy adapter's empty `{}` — that fallback never triggered, so any per-call override (custom wait, proxy selection) was silently dropped for every vendor routed through the registry, not just migrated ones (STRK-314).
- **One merge authority replaces four divergent ones**: each vendor module forwarded its config differently (overwrite, `||` fallback, spread-merge) and all four were dead code, since the resolution downstream ignored what they forwarded. Goldback and Summit were doubly affected — their fallback branch was unreachable, and their module config survived only because the downstream step bypassed it. Resolution now happens once, in the vendor dispatcher, layering provider defaults, then module-owned config, then caller-explicit overrides (STRK-314).
- **No change to polled prices**: with no caller override — which is every path the production poll loop takes — the resolved config is unchanged for all vendors, migrated and legacy. This is a latent API-contract fix, pinned by a parity test (STRK-314).

---

## [3.35.86] - 2026-07-30

### Fixed — STRK-317: Market ticker shows full item names and proper vendor labels

- **Full item names in the ticker**: long names ("Australian Silver Kookaburra 1 oz Coin", fractional Maple Leafs, Goldbacks) were hard-truncated to 27 characters + "…" by a JavaScript cap in the ticker item builder. The cap is removed — pills already size to their content, and the scroll animation derives its duration from the measured track width, so perceived speed is unchanged (STRK-317).
- **"mintbuilder" now displays as "MintBuilder"**: the vendor short-label map predates the MintBuilder vendor (STRK-311) and leaked the raw lowercase vendor id into the ticker, vendor matrix, and detail modal. MintBuilder is added to the map, and unmapped vendors now fall back to the manifest vendor-meta display name before the raw id, so future vendor additions degrade gracefully (STRK-317).

---

## [3.35.85] - 2026-07-30

### Fixed — STRK-318 / STRK-319: every weight unit now displays correctly, and editing no longer changes it

- **Goldbacks show their real denomination**: a ¼ Goldback was displayed as **0.3 gb** and a ½ Goldback as 0.5 gb, because the app was rounding the denomination as though it were a measurement. A denomination is a fixed value, not something to round — an ⅛ note was even being shown as "0.1 gb", a completely different note. They now read **¼ gb** and **½ gb** exactly (STRK-318).
- **Hovering a Goldback or Silverback shows the metal it holds**: the tooltip used to say only "Goldback denomination". It now gives the actual gold or silver content in troy ounces — a ¼ Goldback holds **0.00025 ozt** — plus the total for the lot when you hold more than one. **AGW** (Actual Gold Weight) is the gold counterpart to the ASW term introduced last release (STRK-318).
- **Editing an item no longer changes its unit — including a serious one for Silverbacks**: opening any item lighter than one troy ounce and saving it silently converted it to grams, discarding the unit you chose; a 1/10 oz gold coin came back as 3.1104 g. Worse, **Silverbacks had no handling at all**: opening one showed "1.00 oz", and saving turned a 1 Silverback — which holds 0.001 ozt of silver — into a full **one troy ounce** silver item, overstating its melt value roughly a thousandfold. Simply opening a row and clicking save was enough to do it. Every unit now survives an edit untouched (STRK-319).
- **Nothing weighs zero any more**: a 25 milligram Aurum note displayed as "0.03 g" — a fifth heavier than it is — and in troy ounces it read **0.00 oz**, as if it weighed nothing at all. Small weights now show enough decimal places to be accurate. Ordinary weights are completely unchanged: 1.00 oz, 31.65 g and 1.0000 kg all display exactly as before (STRK-319).
- **New milligram unit**: you can now enter a weight in **mg**, which suits Aurum notes and other foil products sold at 25 mg or 50 mg. Existing items are unaffected, and everything is still stored internally in troy ounces, so melt values, totals and sorting work exactly as they do for any other unit (STRK-319).
- **Filter chips say what the row said**: clicking the Weight cell on a gram, kilogram or pound item produced a chip reading something like "1.0175711288970755" instead of "31.65 g". The chip now matches the cell (STRK-319).
- **Sorting is unchanged, and now guarded**: Goldbacks and Silverbacks already sorted by the gold or silver they contain. A test now checks that ranking against the official denomination table, so a future note with different gold content can't quietly sort into the wrong place (STRK-318).

---

## [3.35.84] - 2026-07-30

### Changed — STRK-299 / STRK-300: junk silver now leads with face value, and the silver figure is called ASW

- **Your junk silver shows its face value where you look for it**: the Weight column for constitutional (junk) silver rows now reads **$6.00 fv** — the total face value of the lot — instead of the derived silver ounces. Face value is how junk silver is quoted, bought and talked about, and it was the one place the app did not lead with it; the card views and the item detail window already did. The silver content moves to the tooltip when you hover the cell, alongside the worn/fresh basis it depends on (STRK-300).
- **The derived silver figure is now called ASW everywhere**: **ASW** stands for Actual Silver Weight, the standard term dealers use when quoting junk silver bags. The app already used it internally but never showed it, and the three places that displayed the number each called it something different. It is now labelled ASW on every visible surface, spelled out in full on first hover so it is not just an unexplained abbreviation (STRK-299).
- **The item detail window says "Face value", not "Weight"**: for constitutional items that row used to label a dollar amount as a weight. It now says what it is, and the ASW keeps its own labelled row directly below (STRK-300).
- **One consistent suffix**: everywhere a constitutional face value appears — the change log, bulk edit preview, backup printouts, the add-item confirmation and printed rows — it now reads **fv**, so the same figure is named the same way throughout (STRK-300).
- **Sorting and filtering are unchanged**: sorting by Weight still ranks constitutional rows by their silver content, so they interleave correctly with your bullion, and clicking a Weight cell still filters the same way. One consequence worth knowing: because the ranking is by silver and not by dollars, $1.00 of war nickels (20 coins) sits above $1.20 of 90% dimes (12 coins) — the nickels genuinely hold more silver (STRK-300).
- **Nothing about your numbers changed**: melt values, the weight total in the summary strip, and CSV exports are all identical. Face value is also never converted to another currency — it stays in US dollars even with the display currency set to euros, because it is a US legal-tender denomination and not a market price (STRK-300).

---

## [3.35.83] - 2026-07-30

### Fixed — STRK-316: Goldbacks now sort and filter by the gold they actually contain

- **Sorting by Weight put Goldbacks in the wrong place**: a 5 Goldback was ranked as though it weighed 5 troy ounces, so it landed between a 10 oz bar and a 2 oz round instead of near the bottom of the list. A 5 Goldback holds 0.005 ozt of gold. Goldbacks and Silverbacks are now ranked by the metal they actually contain, so they sit below your bullion where they belong. Nothing else about the order changed — ounce, gram, kilogram, pound and constitutional rows sort exactly as they did before (STRK-316).
- **Clicking Weight on a Goldback pulled in unrelated items**: because the denomination was being read as a weight, a 2 Goldback note and a 2.00 oz round shared one filter, so clicking either showed both. Clicking a Goldback now selects Goldbacks of that denomination only, and clicking a 2.00 oz round no longer drags your Goldbacks in with it. Different denominations stay in separate filters, and two notes of the same denomination still group together (STRK-316).
- **The filter chip still reads the way you think**: the filter matches on gold content behind the scenes, but the chip above the table still says "5 gb" rather than a string of decimal places (STRK-316).
- **None of your numbers changed**: melt values, the weight total in the summary strip, and CSV exports are all identical to before. This only affects the order rows appear in and which rows a Weight click selects (STRK-316).

---

## [3.35.82] - 2026-07-30

### Fixed — STRK-315: the sync popup finally stops appearing when nothing changed

- **The real cause of the phantom sync popup**: v3.35.81 fixed this bug family in the catalog API settings, but the setting actually churning was the other one — the spot price API config. It keeps a private tally of how many price requests each device has made, stored right next to the API keys. The free built-in StakTrakr feed refreshes automatically when the app opens, so that tally ticked up on every device at every launch, even for people who have never entered an API key at all. Two devices drifted apart within a session or two and the Review Sync Changes window opened every time. Those tallies and their month stamp are now ignored when deciding whether your settings changed; the quota limits you set yourself still sync normally (STRK-315).
- **Matched settings were showing blank values**: everything in the "matched" list at the bottom of that window displayed as empty — an API key you definitely had configured read as "not set", and other settings showed only a dash. The window was looking for those values under the wrong name and always came up empty-handed, no matter what was actually stored. Matched settings now show what they really hold. This is also what sent the previous fix after the wrong setting: a configured Numista key appearing as "not set" looked like real evidence (STRK-315).
- **"API Keys" was never only about keys**: that row also covers which price feed you have selected, how long prices are cached, which metals each provider fetches, and your history preferences — but any change to any of them was displayed as an unreadable "••• configured", identical to a key change. It is now called **Spot API Config** and shows the selected provider and how many keys are set. Key material is still never displayed (STRK-315).
- **Your request counts survive a settings change**: if a genuine change to the spot API config syncs over from another device, the app now keeps the higher of the two request counts for the current month, per provider — unless that provider's key itself changed, in which case the count starts fresh rather than inheriting a used-up one (STRK-315).
- **A new guard against a whole class of breakage**: StakTrakr loads every script into one shared space, so two files declaring the same name is not a harmless duplicate — it stops one of them loading entirely and silently removes a feature. A test now checks all 80 app scripts together for that clash. It caught exactly this mistake while this fix was being written (STRK-315).

---

## [3.35.81] - 2026-07-30

### Fixed — STRK-313: cloud sync stops flagging your catalog API key as changed

- **The phantom "Catalog API Keys" diff is gone**: if you used StakTrakr on two synced devices or sites, the Review Sync Changes window kept claiming your Numista key had changed — showing "••• configured → ••• configured" — even though it was identical on both sides. The real difference was an internal counter of how many catalog lookups each device had made, which is stored alongside the key and ticks up on every lookup. Sync now ignores those counters when deciding whether your settings changed, so the popup only appears for a genuine key, token, or quota change (STRK-313).
- **Less background sync churn too**: that same counter was quietly convincing the sync engine that settings had changed after almost every session, triggering avoidable pull cycles between your devices. With the counters excluded from change detection, switching between synced sessions is calmer (STRK-313).
- **Usage counts merge sensibly**: when a real key change does sync across, the app now keeps the higher of the two devices' lookup counts for the current month instead of overwriting one with the other, so your Numista quota meter can't under-count (STRK-313).
- **A hidden comparison bug fixed along the way**: the settings comparison used by sync previews silently ignored differences buried inside nested settings objects, which could make genuinely different settings look identical. It now compares nested values correctly at every depth (STRK-313).

---

## [3.35.80] - 2026-07-27

### Removed — STRK-298: dead styling left behind by the header cleanup

- **Internal cleanup, no visible change**: the run of header retirements over the last few releases left behind the styling rule for the small coloured dot that used to sit in the corner of a header button. Every button it could attach to is now gone, and the freshness dot beside the market table deliberately uses a different rule because the old one would have pulled it out of that row. The rule itself is now removed (STRK-298).
- **Why it was still there**: it was held back one release in case an upcoming change — colouring each metal card's refresh icon by how fresh its price is — turned out to need it. It does not: those icons are laid out in a way that cannot host a corner badge, and that change colours the icon itself rather than adding a dot (STRK-298).
- **The colours themselves stay**: the green, orange and red variants are shared with the market and spot freshness indicators and are untouched, as is the logic that decides which colour to show (STRK-298).

---

## [3.35.79] - 2026-07-27

### Fixed — STRK-290: the Market table's Refresh button now actually refreshes

- **It was quietly doing nothing**: the **↻ Refresh** button above the market price table only fetched new prices if your data was already more than an hour old. Any sooner and the click did nothing at all — the button greyed out, spun for five seconds, put the same prices back and returned to normal. There was no way to tell it had not worked (STRK-290).
- **What changed**: it now pulls fresh vendor prices every time you click it, and the button stays in its "working" state until the fetch genuinely finishes instead of for a fixed five seconds. If you have been clicking it and wondering why prices never moved, that is why (STRK-290).

### Changed — STRK-290: Market button retired from the header

- **The Market button has left the header**: it pulled fresh market prices, which is exactly what the **↻ Refresh** button above the market table does now that the bug above is fixed. That control sits next to the prices it updates, so the header shortcut was a second way to do the same thing from further away (STRK-290).
- **The freshness dot came with it**: the small green/orange/red dot that showed how current your market data was now sits beside the market table's timestamp instead of on the header button. Same meaning — green under an hour old, orange up to a day, red beyond that (STRK-290).
- **Nothing was lost from Settings**: **Settings › Market › Sync Now** is untouched and still works. This also completes the header cleanup started a few releases ago — the header is now just the theme switcher and the settings gear (STRK-290).

---

## [3.35.78] - 2026-07-27

### Fixed — STRK-294: test harness could click header buttons before they were wired

- **Internal reliability fix, no visible change**: the app attaches its header button handlers a fraction of a second after the page draws. The automated test suite did not know to wait for that, so tests that clicked the Settings gear appeared to find a broken button. They were simply clicking too early (STRK-294).
- **Why it matters to you**: several tests had been papering over this with fixed delays, which can fail on a slow machine for reasons unrelated to what they check. Those now wait for the app to actually signal it is ready, so the suite guarding your data is less prone to false alarms (STRK-294).

---

## [3.35.77] - 2026-07-26

### Changed — STRK-288: Currency button retired from the header

- **The currency button has left the header**: unlike the other header buttons retired recently, this one did something real — it opened a small picker for switching your display currency. That exact picker already exists under **Settings › Currency**, and both went through the same code, so nothing about currency switching has changed except where you click to reach it (STRK-288).
- **You will actually notice this one**: every other button retired in this run was hidden by default, so most people never saw them go. This one was visible for everyone. If you switch currency often, it is now **Settings › Currency › Display currency** instead of one click in the header (STRK-288).

---

## [3.35.76] - 2026-07-26

### Changed — STRK-287: Cloud Sync button retired from the header

- **The cloud button has left the header**: StakTrakr already syncs whenever your data changes, so the header shortcut was doing a job that mostly did itself. Everything it offered lives in **Settings › Cloud** — the same place you go for backup and restore — including the **Sync Now** button for a manual sync whenever you want one (STRK-287).
- **Heads up — the at-a-glance status dot went with it**: the small coloured dot on that button showed sync state without opening anything. That signal is gone for now; Settings › Cloud still shows connection status and when you last synced (STRK-287).
- **Dead code cleared out**: an old inline "Vault Password" popup that used to live under the cloud button had become permanently unreachable — nothing in the app could open it. It has been removed. Normal sync password prompts are unaffected (STRK-287).

---

## [3.35.75] - 2026-07-26

### Changed — STRK-289: Info button retired from the header

- **One more duplicate header shortcut removed**: the Info button only opened Settings, and it opened it on the About tab — which is the tab Settings already opens on by default. So it was a shortcut to the place you were going anyway. It's gone; open Settings and you land on About, with the version, What's New, and changelog exactly where they were (STRK-289).

---

## [3.35.74] - 2026-07-26

### Changed — STRK-285/286: Backup and Restore header buttons retired

- **Two duplicate header shortcuts removed**: the Backup and Restore buttons both did exactly the same thing — open the same Settings tab — so the header carried two icons for one action. Both are gone. Backing up and restoring your data is unchanged and still lives in **Settings › Inventory**, which holds the import controls (CSV, JSON, ZIP) and the export controls (CSV, JSON, PDF, ZIP) exactly as before (STRK-285, STRK-286).

---

## [3.35.73] - 2026-07-26

### Changed — STRK-284: Spot Sync header button retired to the spot cards

- **Refresh spot prices from the cards themselves**: each spot card now shows its own refresh icon, replacing the Spot Sync button in the header. Clicking any card's icon refreshes all four metals — a single provider request returns the whole payload, so there is nothing to gain from refreshing them one at a time. The icon was already built and wired; it had simply been hidden. It stays disabled with a "Configure API first" tooltip when no price provider is set up, and the hidden range dropdown behind it remains hidden so the period chip added in v3.35.72 is still the one place you set the trend range (STRK-284).

---

## [3.35.72] - 2026-07-26

### Changed — STRK-283: Trend header button retired to the spot cards

- **Set the trend period from the spot cards themselves**: the small period label in the top-right of each spot card (`90d`, `1Y`, …) is now a button — click it to cycle through the trend periods, and all four metal cards plus their sparklines follow together, exactly as the header Trend button used to do. The header button is gone, freeing space in the header and putting the control next to the chart it changes. The chip is keyboard-operable and its accessible name announces the current period, so screen-reader users get the value and the action rather than a bare "90d". Existing saved header-button layouts that still list Trend keep working untouched (STRK-283).

---

## [3.35.71] - 2026-07-26

### Added — STRK-274: Service worker registration + release hygiene for /ratios/

- **The Metal Ratios page now works offline and installs from Chrome**: `/ratios/` registers the root service worker (a controlling worker on the start URL is what makes Chrome's install prompt fire), and the worker precaches the ratios shell, manifest, host script, and full icon set — so an offline reload renders the page with cached history and an honest "Last close" badge. Navigation caching is now per-shell (`navShellCacheKey`): the tracker and the ratios app each keep their own cached shell and can never overwrite each other. The main app manifest also gains an Android `shortcuts` entry — long-press the StakTrakr icon to jump straight to Metal Ratios (STRK-274).

---

## [3.35.70] - 2026-07-26

### Added — STRK-273: Standalone /ratios/ page + installable PWA manifest

- **Public Metal Ratios page at `/ratios/`**: A standalone, bookmarkable page hosting the shared ratios panel — all four pairs with live spot, long-run stats, and history back to 1968. Ships as a directory URL with its own scoped PWA manifest (`id`/`scope`/`start_url` all `/ratios/`) so it installs as a separate app from StakTrakr with the new balance-scale icon; the main app keeps `/`. The page inherits the tracker's saved theme via same-origin localStorage (dark default), carries zero user data (no localStorage writes), fetches live spot from the public feed with an honest "Last close" fallback when unreachable, and merges the daily current-year feed file over the release-time seed bundle so 52-week stats never go a release cycle stale. An "Open full tracker" link deliberately breaks out of the standalone scope (STRK-273).

---

## [3.35.69] - 2026-07-26

### Added — STRK-272: Ratios app icon set + maskable manifest fix

- **Distinct icon for the upcoming Metal Ratios app**: New balance-scale icon set (`images/ratios-icon*.{svg,png}` at 192/512, a maskable variant with adaptive-mask safe-area padding, and a 180×180 apple-touch icon) promoting the ratio chips' existing balance-scale glyph — gold pan vs silver pan — so the future installable `/ratios/` PWA is distinguishable from StakTrakr at home-screen size. Verified at 48px, under circle and squircle masks, and on light and dark wallpapers (STRK-272).
- **Fixed: Android was letterboxing the main app icon**: `manifest.json`'s icons carried no `purpose` field, so Android shrank the rounded icon inside its adaptive mask. The manifest now declares `purpose: "any"` on the existing icons and adds new full-bleed maskable 192/512 variants of the S-stack icon (STRK-272).

---

## [3.35.68] - 2026-07-26

### Added — STRK-271: Ratio chips open the Metal Ratios panel

- **Metal Ratios panel is now reachable in the app**: The Au:Ag, Au:Pt, and Au:Pd chips on the spot cards are now buttons — click or press Enter to open the new Metal Ratios panel in a modal, pre-selected on the clicked pair, with the in-panel selector available to switch pairs (including Pt:Pd) without closing. Chips gained a pointer cursor, caret affordance, focus ring, and a "Click for trends" tooltip hint. Esc, the close button, or a backdrop click closes the modal and returns focus to the originating chip. The gold card's goldback chip is intentionally not wired — it shows a G1 rate, not a ratio (STRK-271).

---

## [3.35.67] - 2026-07-25

### Added — STRK-270: Shared ratios panel component (Layout C)

- **Metal Ratios panel component**: New `js/ratios-panel.js` renders the shared Layout C ("Signal") panel both upcoming hosts will mount — the in-app modal (STRK-271) and the standalone `/ratios/` page (STRK-273). It carries the in-panel pair selector (Au:Ag, Au:Pt, Au:Pd, Pt:Pd), live/last-close badge, hero readout with delta vs prior close, an explicitly-labeled 52-week position bar with all-time percentile, four signed-magnitude trend tiles, a Chart.js history chart (30D/90D/1Y/5Y/MAX) with a conditional long-run-mean line, and a provenance footer. Styling is tokens-only across all four themes, chart colors re-read from computed tokens on theme change, and the interpretive mean-reversion copy stays Au:Ag-only. Not yet reachable in the UI — hosts arrive in the next patches (STRK-270).

---

## [3.35.66] - 2026-07-25

### Added — STRK-269: Ratio statistics engine (all 4 pairs)

- **Metal-ratio statistics engine**: `js/spot-ratio-math.js` now carries the pure, DOM-free foundation for the upcoming Metal Ratios panel (STRK-268): a 4-pair config (Au:Ag, Au:Pt, Au:Pd, Pt:Pd), a series builder that joins historical closes only on dates where both metals printed (so Pt/Pd's 1990 start needs no special-casing), and a full statistic set — historical mean, median, all-time percentile, session-based trailing averages (7/30/90/261/1,305 sessions), previous close, 52-week and all-time extremes with their dates. Live spot, when present, overrides the last close (STRK-269).

---

## [3.35.65] - 2026-07-24

### Changed — STRK-260: Period-aware retail history ranges

- **Retail history summaries and longer chart ranges**: The Retail View detail modal now offers 24H, 7D, 30D, 60D, and 90D controls and recalculates Median, Low, High, and Spread from the same valid observations shown in the selected chart window. Longer ranges use the existing 90-day feed with primary-to-backup API failover, while the Vendor comparison table remains tied to the current snapshot (STRK-260).

---

## [3.35.64] - 2026-07-01

### Fixed — STRK-251: Summit false OOS from related-products carousel

- **Summit Metals prices restored to the retail matrix**: Summit's product pages embed a related-products carousel between the buy box and the trimmable page tail; when any carousel product sells out, its "Sold out" badge false-flagged every Summit item OOS while prices kept extracting. The Summit vendor module now declares a positive buy-box marker ("In Stock, Ready to Ship") that suppresses the negative OOS patterns; genuinely sold-out pages drop the marker and still detect correctly (STRK-251).

---

## [3.35.63] - 2026-06-30

### Fixed — STRK-250: Goldback honest envelope timestamp

- **Goldback outage indicator now fires correctly**: During a goldback scrape outage (row older than 2 hours), `goldback/latest.json` now carries a `generated_at` reflecting the true scrape time instead of the publish time — so the service worker's age check and `_strictMarketFreshness` correctly surface stale data to the user rather than silently accepting hours-old prices (STRK-250).

---

## [3.35.62] - 2026-06-28

### Changed — STRK-248: Goldback intraday price history

- **New goldback intraday price feed**: A new `goldback/intraday.json` API endpoint publishes the last 72 hours of hourly goldback prices as a raw point series, giving a future intraday goldback chart a real data source at the hourly resolution the database already retains (STRK-248).
- **Honest goldback timestamp**: The goldback "latest" price now stamps its timestamp at the actual scrape hour instead of a daily-noon placeholder, so the value no longer looks like a once-a-day snapshot (STRK-248).
- **Goldback realtime freshness budget**: The goldback latest feed's staleness budget and its service-worker cache floor drop from ~25 hours to a 2-hour realtime budget, in lockstep with the STRK-249 realtime caching fix (STRK-248).

---

## [3.35.61] - 2026-06-28

### Changed — STRK-249: Realtime pricing served network-first

- **Service worker realtime families are now network-first**: The spot, goldback, and retail "latest" price endpoints are fetched fresh on every normal page load instead of being served from the service worker's cache (which previously held a copy for up to 25 hours); the cached copy is now used only as an offline fallback. This is the primary fix for the gold-card goldback badge being missing and the market premiums lagging on a normal load (STRK-249).
- **Goldback badge repaints when fresh data arrives**: The gold spot card's goldback ("GB") chip now repaints as soon as `fetchGoldbackApiPrices()` resolves, so the current rate appears without a hard refresh; a failed or empty fetch leaves the previously-shown chip untouched (STRK-249).
- **Market goldback premiums render in lockstep with spot premiums**: The market table seeds the goldback premium from the cached rate for an immediate first paint, then refines it once the network fetch resolves — removing the ~1–2 s lag where goldback premium cells were blank (STRK-249).
- **Goldback and retail-detail price lookups fail over to the backup API**: Both market-data fetches now attempt the primary then the secondary API origin (api1 → api2) with a strict freshness gate, so a stale service-worker copy of the primary origin no longer short-circuits failover to the backup (STRK-249).

---

## [3.35.60] - 2026-06-27

### Added — STRK-242: Constitutional by-denomination lot pricing

- **Lot pricing for junk silver entered by denomination**: The purchase-price Lot/Each toggle is now shown (and defaults to Lot) for constitutional items entered by denomination, dividing the entered lot total by the coin count (`cu.qty`) rather than the hidden `#itemQty` (pinned to 1). By-face-value entries remain a lot of one with no division, and editing an item restores the stored `pricingType` (legacy/absent → each). The lot/each hint is now registered for JSON export/import, ZIP backup, and cloud-sync (cu-scoped hash/diff/change-log) persistence; cost basis and table/view totals stay `price × qty` (STRK-242).

---

## [3.35.59] - 2026-06-25

### Fixed — STRK-247: Centralized custom-purity wrapper visibility

- **Custom purity is no longer silently persisted by a hidden field on a Goldback/Silverback conversion**: Setting a Custom purity, then changing Type to Constitutional (which hides the custom-purity field) and then directly to Goldback or Silverback before saving, used to leave the custom-purity input stuck hidden while still holding — and saving — its stale value. `handleTypeChange` now recomputes the field's visibility once for every Type (shown only when purity is "custom" and the Type is not Constitutional), so the wrapper re-appears and the persisted purity is always a value you can see and correct. This centralizes the per-branch fix STRK-245 added only to the non-special types, removing the recurring source of this class of bug (STRK-247).

---

## [3.35.58] - 2026-06-24

### Fixed — STRK-246: Bulk Type→Goldback metadata bundle

- **Bulk Type → Goldback now produces a valid, denomination-priced Goldback**: Converting a batch of items to Goldback via Bulk Edit now stages the full Goldback metadata — `Gold` metal, the `gb` weight unit, the picked denomination as the stored weight, and the standard `0.999` purity — past the field-checkbox gate, mirroring the constitutional bulk conversion (STRK-238). Previously a bulk Type → Goldback only set the Type, leaving each item at the `oz` weight unit, so it became a malformed Goldback valued as plain bullion instead of at its denomination price, and the item's value chart recorded nothing for the conversion. Resetting purity prevents a converted non-fine item (e.g. a 90% coin) from carrying its stale purity, which would under-value the Goldback melt and pollute the recorded history point. With the bundle injected, the existing STRK-244 bulk-edit guard also records an item-price-history point for the change (STRK-246).

---

## [3.35.57] - 2026-06-24

### Fixed — STRK-244 / STRK-245: Constitutional valuation history + custom-purity reset

- **Value-chart staleness on valuation-only edits**: Editing a constitutional coin's denomination/variant — or converting an item's Type to Constitutional, Goldback, or Silverback — now records an item-price-history point. The single-edit gate and the bulk-edit guard both sample `weightUnit` and the constitutional metadata (`constitutionalVariant`/`constitutionalEntryMode`), so a change that moves the derived melt without touching the legacy weight/price/purity fields no longer leaves the per-item value chart stale until the next price edit. Same systemic root as STRK-241 (STRK-244).
- **Custom-purity field cleared on Type → Constitutional**: Converting an item that had a custom purity to Constitutional now hides and clears the custom-purity input. Previously the field stayed visible and its stale value was saved onto the junk-silver item (whose purity is derived from the denomination, not entered), so the workaround was to reset purity to a preset first (STRK-245).

---

## [3.35.56] - 2026-06-24

### Fixed — STRK-241 / STRK-243: Constitutional silver pre-ship fixes

- **Cloud sync detects constitutional denomination/mode edits**: The inventory hash the cloud-sync poller compares now includes a constitutional item's `constitutionalVariant` and `constitutionalEntryMode`. Previously a remote edit that changed only a synced junk-silver item's denomination or entry mode on the same item produced an identical hash, so the poller silently recorded the pull and never opened the diff/merge path — the change was lost on the other device. Distinct denominations can share a face-per-coin value, so the stored weight could not catch it either (STRK-241).
- **Constitutional unit is Type-driven, not a manual dropdown choice**: Picking "constitutional" directly from the weight-unit dropdown while Type was still Coin/Bar left the constitutional entry card hidden, so saving read blank fields and dead-ended on a "weight required" error with no weight field shown. The option is now hidden from manual selection; adding junk silver via Type → Constitutional remains the supported path and wires up the entry card correctly (STRK-243).

---

## [3.35.55] - 2026-06-24

### Changed — STRK-240: Constitutional weight filter keys on derived silver ounces

- **Constitutional weight cells filter by silver weight, not face value**: Clicking a constitutional (junk-silver) row's Weight cell now creates a filter chip keyed on the derived silver troy ounces shown in the cell, not the stored dollar face value — so filtering a `$10`-face bag no longer also pulls in unrelated 10 oz items. The face value stays in the cell's hover tooltip. Refines STRK-239 (v3.35.54), which keyed the filter on the face value and could collide with same-numbered weights (STRK-240).

---

## [3.35.54] - 2026-06-23

### Changed — STRK-239: Restore click-to-filter on constitutional weight cells

- **Constitutional weight cells filter again**: Clicking a constitutional (junk-silver) row's Weight cell creates a filter chip again, matching every other weight unit including goldback and silverback. The cell still displays the derived silver troy ounces and keeps the face value in its hover tooltip; the filter keys on the stored face value, the same way goldback/silverback filter on their stored weight. Reverses the STRK-237 decision (v3.35.52) that disabled it (STRK-239).

---

## [3.35.53] - 2026-06-23

### Changed — STRK-233: Settings inventory summary excludes disposed items

- **Settings inventory summary reflects current stock only**: The Inventory summary card (Items / Total weight / Melt value / Last modified) in Settings no longer counts disposed (sold / traded / gifted / lost / returned) items, so the totals reflect what you currently hold instead of being inflated by stock that has left the stack. Uses the canonical `isDisposed()` predicate already applied across the card views, the inventory disposed-mode filter, and exports (STRK-233).

---

## [3.35.52] - 2026-06-23

### Changed — STRK-237 / STRK-236: Constitutional weight display + Currency settings layout

- **Inventory table shows derived silver weight for constitutional rows**: The Weight column now renders a constitutional / junk-silver item's derived pure-silver troy ounces — consistent with every other row and the portfolio weight totals — instead of `$X.XX face`. The face value (total = face-per-coin × qty) and the active worn/fresh valuation basis move to the cell's hover tooltip (STRK-237).
- **Settings → Currency layout tightened**: The Show spot ratios and Constitutional silver valuation basis toggles are arranged in a 2×1 grid with added spacing below the currency dropdowns, and their heavy descriptive paragraphs are replaced by compact info-icon (ⓘ) tooltips (STRK-236).

---

## [3.35.51] - 2026-06-23

### Added — STRK-238: Bulk-edit denomination sub-control for constitutional silver

- **Bulk-convert items to constitutional silver without zeroing their value**: Bulk-editing an item's Type to Constitutional now surfaces a denomination picker, and applying it stages the full constitutional metadata (denomination variant + `denom` entry mode, with weight derived from the variant's face-per-coin) so converted items carry real derived silver content instead of registering as 0 ozt. Previously a bulk Type→Constitutional change coerced only the unit (`cu`) and metal (Silver) but dropped the denomination data, producing zero-silver "ghost" items. Each selected item keeps its existing quantity as the coin count, and the metadata bundle is applied past the per-field checkbox gate so only the Type field need be enabled (STRK-238).

---

## [3.35.50] - 2026-06-22

### Added — STRK-235: Constitutional / junk silver tracking (90% / 40% / 35%)

- **Constitutional item type**: New first-class `Constitutional` type for U.S. junk silver. Add holdings by denomination + coin count (90% dime / quarter / half, 90% Morgan/Peace dollar, 40% Kennedy half, 40% Eisenhower dollar, 35% war nickel) or by total face value (treated as 90% subsidiary coinage). Actual silver content and melt value are derived from a verified per-variant silver table via deferred troy-oz conversion — mirroring the Goldback/Silverback pattern — so users never hand-calculate weight. Silver dollars are valued at their true ~0.7734 ozt/coin rather than the 0.7234/$ subsidiary rate, and the constitutional melt branch skips the coin-purity multiplier to avoid double-discounting an already-pure silver weight (STRK-235).
- **Worn vs fresh valuation basis**: A new global Settings → Currency control toggles the wear basis — worn (~0.715 ozt/$1 face, default) or fresh ASW (~0.7234 ozt/$1 face) — applied uniformly across all constitutional items, persisted across reloads and included in cloud-sync scope. Changing it reprices the portfolio without per-item edits (STRK-235).

---

## [3.35.49] - 2026-06-22

### Fixed — STRK-234: cloud-sync re-entrancy race nulled \_previewPullMeta on empty-diff silent pull

- **Concurrent two-session cloud sync no longer errors with "Could not decrypt vault for preview"**: `_previewPullMeta` is a module-level mutable global that `pullWithPreview`'s empty-diff "silently record pull" branch set, then dereferenced after three network `await`s (image / attachment / item-price-history companion vaults). When two browsers synced at once, a second pull flow nulled the global mid-`await`, so the first flow crashed with `TypeError: ... _previewPullMeta is null` — surfaced in the Restore Preview modal. Two layers fix it: the silent branch now snapshots the global into a local before the awaits and records onto that snapshot (mirrors the existing guard in `_deferredVaultRestore`), and a new `_previewPullInFlight` re-entrancy guard serializes overlapping `pullWithPreview` invocations across all three entry routes so two pull cycles can't interleave on the shared global (the deferred pull is re-detected by the next poll). STRK-147 widened the race window (a new companion-vault fetch) which is why the symptom surfaced now on `itemPriceHistoryHash`; the image/attachment siblings shared the same latent flaw (STRK-234).

---

## [3.35.48] - 2026-06-21

### Changed — STRK-232: keyboard activation for delegated reference chips

- **N#/PCGS#/grade reference chips are now keyboard-activatable**: The Numista (`N#`), PCGS (`PCGS#`), and grade reference chips in the inventory table render with `tabindex=0 role=button` but activate through a delegated document `click` handler (unlike the year/purity chips, which use an inline `onkeydown` from STRK-209). A keyboard user could focus them but Enter/Space did nothing. A delegated `keydown` handler now mirrors that click handler: on Enter or Space over one of these chips it calls `preventDefault()` (so Space no longer scrolls the page) and synthesizes a click, reusing the existing per-tag action for all three chip types (STRK-232).

---

## [3.35.47] - 2026-06-21

### Fixed — STRK-220: CSV merge import applies Tags/removedTags to existing items

- **CSV merge now persists `Tags`/`removedTags` for existing items**: On a CSV merge import, an item already in your inventory surfaces as a `modify` (or `unchanged`) change, which carries no item object — so the deferred tag appliers silently dropped its `Tags` and `removedTags` columns and only brand-new items were covered. The merge path now applies the CSV tag columns over every imported and matched item (keyed by the preserved import key), mirroring the override and full-restore import paths, and a tag-only row whose other fields are unchanged is honored too. The dead `add`/`modify` branch in the old appliers is removed (STRK-220).

---

## [3.35.46] - 2026-06-21

### Changed — STRK-217: viewModal value chart uses ES2020-compatible last-element lookup

- **`.at(-1)` replaced with index-based access in `_resolveViewChartLeadingRetail`**: The leading-retail resolver in the item value chart used `Array.prototype.at(-1)` (ES2022), but `.eslintrc.json` targets `ecmaVersion: 2020` for non-test code to keep StakTrakr running on older `file://` browsers. The call is now `priorRetailEntries[priorRetailEntries.length - 1]`, which is behavior-identical (same last element, same `undefined` on an empty array) and honors the declared runtime target. No user-visible change (STRK-217).

---

## [3.35.45] - 2026-06-21

### Changed — STRK-216: bulkEdit uses safeGetElement for the type-field lookup

- **`bulkFieldVal_type` lookup routed through `safeGetElement`**: `wireBulkWeightDenomPicker` now resolves the bulk-edit Type select via the project-standard `safeGetElement` helper (matching its sibling field lookups) instead of a raw `document.getElementById`. The helper's truthy-dummy return is normalized back to `null` with an `instanceof HTMLElement` guard, so all downstream null checks keep their exact prior behavior — a consistency/robustness change with no visible difference (STRK-216).

---

## [3.35.44] - 2026-06-21

### Fixed — STRK-213: Retail provider refresh compatible with older runtimes

- **providers.json refresh no longer depends on `AbortSignal.timeout`**: `_fetchAndApplyV2Providers` now uses the `AbortController` + `setTimeout` + `clearTimeout` timeout pattern (matching `_pickFreshestV2Endpoint` and `_fetchV2Json`). On a runtime lacking the `AbortSignal.timeout` static method the providers fetch previously threw synchronously and was swallowed by the catch, leaving retail provider links stale even though price sync reported success (STRK-213).

---

## [3.35.43] - 2026-06-21

### Fixed — STRK-209: Keyboard activation for inventory-table filter tags

- **Year & purity chips are keyboard-operable**: The year and purity filter chips in the inventory table now respond to Enter and Space, so keyboard and screen-reader users can apply the column filter without a mouse — previously they were focusable but inert (STRK-209).
- **Space no longer scrolls the page**: Activating a filter chip, the shared column-filter link, or the name-cell view link with Space now calls preventDefault, matching expected button behavior instead of scrolling the page (STRK-209).

---

## [3.35.42] - 2026-06-21

### Fixed — STRK-215/218: bulk-image-cache failure count and resolver robustness

- **Failure count no longer doubles**: A catalog lookup that throws for an uncached item is now counted as a single failure in the bulk image-cache completion summary, instead of being incremented twice — once in the fetch catch path and again in the trailing no-result branch (STRK-215).
- **Tag map uses the in-scope resolver**: `buildCatalogIdToUuids()` now calls the closure-local `resolveCatalogId` rather than the module's global self-reference, so tag application stays consistent if the export is shadowed or reassigned (STRK-218).

---

## [3.35.41] - 2026-06-21

### Fixed — STRK-223: Cloud-sync item-price-history clear propagation

- **Clear all propagates across devices**: Clearing all item price history on one device now propagates to other devices on the next sync via a synced clear watermark, and removes the stale remote companion vault — instead of silently leaving other devices' history in place. A fresh device with empty history still preserves a populated remote companion (STRK-223).

---

## [3.35.40] - 2026-06-21

### Fixed — STRK-224: Cloud-sync item-price-history companion failure/cancel/retry edges

- **Cancel now cancels**: Cancelling a sync review (DiffModal) that also carried item-price-history changes no longer silently merges that history or advances the sync watermark. The poll's companion pre-merge ran before the modal was shown, so a cancel could not undo it; the merge now runs only on the no-modal poll exits, and the DiffModal route relies on the existing apply-gated companion pull (Edge 1, STRK-224).
- **Transient failures retry**: A transient companion download/decrypt failure now leaves `lastPull` stale so the next poll retries, instead of being treated as a benign no-op that advanced the watermark and blocked the retry. An explicit `failed` signal disambiguates a true failure from the benign "nothing changed" no-op across all six companion-pull call sites (Edge 2, STRK-224).
- **Post-apply write safety**: A failed post-apply companion `writeItemPriceHistoryStrict()` no longer advances `lastPull.syncId` past the unmerged history. The manifest-first and vault-first apply paths now snapshot `lastPull` before the apply and restore it if the companion write throws or fails, so the next poll retries (Edge 3, STRK-224).

## [3.35.39] - 2026-06-20

### Changed — STRK-225: Cloud-sync vault-first cancel no longer advances the image/attachment hash

- **Cloud sync**: Cancelling a vault-first restore preview no longer pulls the image or attachment companion vaults or advances their stored sync hashes. Previously a cancel advanced `lastPull.imageHash` / `lastPull.attachmentHash` to the remote value even though STRK-200's guard skipped the photos, so later accepting the same remote items would not re-download their images/attachments until the remote hash next changed. Both companion pulls are now gated on apply, mirroring the item-price-history block (STRK-225).

---

## [3.35.38] - 2026-06-20

### Changed — STRK-221: Pattern-rule image processing no longer silently drops images

- **Pattern rules**: Creating or editing a custom image pattern rule now surfaces an error and aborts when the selected image can't be processed, instead of silently saving a rule with no cached image — covers both the create (`settings-listeners.js`) and edit (`settings.js`) paths (STRK-221).

---

## [3.35.37] - 2026-06-19

### Changed — STRK-226/227: backup/CSV-export cleanup

- **Dead code removed**: Deleted the unused legacy `downloadCompleteBackup()` path from `js/api.js` — it had zero callers repo-wide and was superseded by the single-ZIP backup. No user-visible change (STRK-226).
- **CSV serialization deduplicated**: The inventory CSV export and the backup ZIP CSV now share a single `buildCsvValueCells` helper for the 13 value columns instead of two near-identical copies, removing a drift risk where a fix to one exporter could silently miss the other. Exports are byte-for-byte unchanged (STRK-227).

---

## [3.35.36] - 2026-06-19

### Changed — STRK-206/207: filters.js robustness (Numista-Import chip + defensive guards)

- **Location filters**: Clicking a "Numista Import" purchase/storage-location chip no longer filters your inventory to zero items. Items imported from Numista have no real location, so they now group under the "—" placeholder — consistent with how they already display in the table — instead of producing a separate location chip that the filter could never match (STRK-206).
- **Defensive hardening**: The filtering code's tag lookups (`getItemTags` readers) and the disposed-items filter reset now tolerate missing tag data and a missing filter container without throwing. Internal hardening only; no visible change in normal use (STRK-207).

---

## [3.35.35] - 2026-06-19

### Changed — STRK-229: Correct trade cost basis when editing a trade's linked items

- **Trade cost basis**: Editing an existing trade to add or remove received items now re-balances every linked item so each carries an equal share of the given-up value (given-up value ÷ total linked count), keeping the trade's total cost basis equal to what you traded away. Previously, adding items to a trade priced the new items by the size of that edit alone — inflating the total basis — and never re-priced the originally-linked items. Each re-balanced item records its own Change Log entry you can undo (STRK-229).

---

## [3.35.34] - 2026-06-18

### Changed — STRK-204: Safer undo for corrupt price-history Change Log entries

- **Change Log undo**: Undoing a price-history deletion now fails safely when the stored snapshot is corrupt — it shows a toast and leaves your data untouched instead of throwing an unhandled error. This matches the guards already on the other undo actions and only affects Change Log entries that have been altered outside the app (STRK-204).

---

## [3.35.33] - 2026-06-18

### Changed — STRK-196: Accurate trade cost basis for multi-item trades

- **Disposition → Trade links**: When trading one item for multiple received items, the given-up cost basis is now divided by the number of items actually linked, not the raw input length. Duplicate, empty, self-referential, or unresolvable entries no longer dilute each received item's cost basis or emit redundant trade-link change-log rows. Everyday trades are unchanged; this corrects an edge case in cost-basis allocation (STRK-196).

---

## [3.35.32] - 2026-06-18

### Changed — STRK-203: Harden cross-origin warning toasts

- **Security**: The "exported from a different domain" warnings shown during vault restore and CSV import now escape the originating domain with `escapeHtml` in the rare case the core HTML sanitizer is unavailable, replacing a raw, unescaped fallback. Defense-in-depth only — the warning text is unchanged in normal use (STRK-203).

---

## [3.35.31] - 2026-06-18

### Changed — STRK-228: Faster Settings User Images grid for large inventories

- **Settings → User Images**: Rendering the per-Item User Images grid is faster for large collections. Each photo's lookup to its inventory item (for the display name and Edit button) uses an indexed lookup instead of two linear scans per photo, so the grid no longer slows down as your inventory and photo count grow. Grid contents and Edit/Delete actions are unchanged (STRK-228).

---

## [3.35.30] - 2026-06-18

### Changed — STRK-201: Faster backup export for large inventories

- **Backup export**: Creating a backup ZIP is now faster for large collections. The step that matches each saved per-Item photo to its inventory item uses an indexed lookup instead of re-scanning the entire inventory for every photo, so export time no longer grows disproportionately as your inventory and photo count increase. Backup contents are unchanged (STRK-201).

---

## [3.35.29] - 2026-06-17

### Fixed — STRK-211, STRK-212: CSV and backup export no longer crash on incomplete items

- **CSV export & backup**: Exporting CSV or creating a backup ZIP no longer throws and aborts when an inventory item is missing its metal or has a non-numeric weight. Such items fall back to the existing "Silver" metal default and a `0.0000` weight in the output instead of crashing the entire export (STRK-211, STRK-212).

---

## [3.35.28] - 2026-06-17

### Fixed — STRK-200: User-image restore orphan guard

- **Backup restore**: Restoring a backup no longer imports per-Item photos for items that are not in your inventory. Both the unencrypted ZIP path and the encrypted `.stvault` companion / cloud-sync path now skip photos whose item was removed or de-duplicated away, matching the guard attachments already had. This prevents orphaned images that silently bloated storage and appeared as un-editable entries in the Settings Per-Item User Images list (STRK-200).

---

## [3.35.27] - 2026-06-17

### Fixed — STRK-202: Custom pattern-rule images survive backup restore

- **Backup round-trip**: ZIP backups now include your custom Numista lookup rules, so restoring a backup brings the rules back alongside their pattern images instead of leaving the images orphaned with no rule to display them. Restored rules keep their original identity, so previously cached pattern images re-bind automatically (STRK-202).
- **Orphan cleanup**: A new Settings → Images "Orphaned Pattern Images" panel lists pattern images whose rule no longer exists and clears them individually or all at once, reclaiming storage (STRK-202).
- **Rule identity**: Custom rules saved without an id now receive a stable, content-derived id instead of a fresh timestamp on every load, preventing rare id collisions between rules (STRK-202).

---

## [3.35.26] - 2026-06-17

### Changed — STRK-147: Cloud-sync item-price-history with UUID-aware merge

- **Cloud Sync**: Per-Item price history now syncs across devices through a dedicated, always-on encrypted companion vault with a UUID-aware union merge. Entries recorded on different devices merge by union rather than last-write-wins, so history added on a second device is never silently dropped; the change-detection manifest stays lightweight (only a `{hash, count}` pointer, never the full history JSON); companion-only changes merge silently with no review prompt; a remote Item rejected in the diff modal imports no orphan history; and the existing retention cap (365 days / 1000 entries per item) is applied after merging. Spot/retail market histories remain out of cloud auto-sync scope (STRK-147).

---

## [3.35.24] - 2026-06-17

### Changed — STRK-214: Bulk image cache startup failures now complete cleanly

- **Bulk image cache**: Bulk image caching now catches image cache initialization failures and routes them through the normal completion callback with one failed startup result, so the image cache modal can reset controls and show a clear failure instead of leaving Sync All stuck (STRK-214).

---

## [3.35.23] - 2026-06-16

### Changed — STRK-170: Tier-1 complexity refactor (cohorts 1.1–3.9)

- **Code health**: Behavior-preserving decomposition of 38 high-complexity functions across 19 core modules (`inventory.js`, `inventory-import.js`, `inventory-backup.js`, `vault.js`, `market-data.js`, `changeLog.js`, `diff-modal.js`, `filters.js`, `search.js`, `inventory-table.js`, `api.js`, `bulk-image-cache.js`, `bulkEdit.js`, `catalog-api.js`, `csv-export.js`, `chip-grouping.js`, `image-cache-modal.js`, `retail.js`, `viewModal.js`) to under the Codacy Lizard ccn-25 / nloc-150 gate. Hundreds of JSDoc'd module-private helpers added; every `window.*` export byte-identical; characterization tests added for the correctness-critical paths (undo, history-merge, crypto restore, field edits). No user-facing change (STRK-170).

---

## [3.35.22] - 2026-06-14

### Changed — STRK-193: Remove dead code from the sync diff modal

- **Cleanup**: Removed ~200 lines of unreachable code from `js/diff-modal.js` that was surfaced (and flagged, not deleted) during the STRK-181 split. Gone: the orphaned `_renderProgressTracker` renderer; the self-referential `_renderConflictCards` → `_groupByItem` → `_updateProgress` conflict-card chain (reachable only from its own click handler, never from a live entry point); the write-only `_expandedModified` state; and the unused `sectionType` / `type` parameters on `_swapBtnClass` / `_updateOrphanBtnStyles`. No user-facing behavior change; recovers headroom under the Codacy Lizard file-size gate (diff-modal.js 2702 → 2503 lines) (STRK-193).

---

## [3.35.21] - 2026-06-14

### Changed — STRK-169: Oversized-module split campaign complete

- **Refactor**: Completed the STRK-169 campaign to break StakTrakr's largest JavaScript modules into focused, single-responsibility files. The final and hardest child, STRK-181, split the IIFE-scoped diff modal — settings-diff rendering moved into `js/diff-modal-settings.js`, the duplicated chip-strip/toggle-map renderers were deduplicated behind shared `_renderDiffChip`/`_renderMatchedChip`/`_chipKey` helpers (cyclomatic complexity 33/29 → 22/22; Codacy −9 complexity / 0 duplication), and a 14-test unit suite now pins the extracted renderers. Earlier children (bulk-row-images, csv-export, vault-crypto, utils, catalog-numista-modal) shipped under prior patch releases. No user-facing behavior change (STRK-169, STRK-181).
- **Reliability**: The price publisher is now self-cleaning — it prunes its own working files so an exhausted volume / inode table can no longer stall published price updates, the root cause of the 2026-06-11 feed outage (STRK-187).

---

## [3.35.20] - 2026-06-12

### Changed — STRK-190: Service worker now classifies production API URLs

- **Bug fix**: The service worker's endpoint classifier now recognizes the production API URL shape (`/data/v2/…`). Every family test in `sw-router.js` expected a bare `/v2/…` path, but the app fetches `https://api{,2}.staktrakr.com/data/v2/…`, so classification always returned null and every API request (spot, retail, goldback, manifest, providers) silently fell through to stale-while-revalidate — serving cached payloads unconditionally with no age check, and leaving the STRK-79 classified TTL cache and the STRK-189 `x-generated-at` header stamping as dead code. The classifier now strips one leading `/data` segment before matching, flipping all API endpoint families to cache-first-with-TTL as originally designed. Unit tests now pin the real production URL shapes on both API hosts, and the two service-worker freshness tests drafted during STRK-189 are restored (fresh publication age → cache hit; stale publication age → never served from cache). Discovered during STRK-189 (STRK-190).

---

## [3.35.19] - 2026-06-11

### Changed — STRK-189: Spot sync rejects stale payloads

- **Bug fix**: Spot price sync now validates the `/spot/latest.json` envelope's `generated_at` timestamp. Payloads older than the freshness threshold (`max(stale_after × 6, 2 h)`) are rejected per endpoint and the fetch fails over to the backup API; if every endpoint serves a stale payload the sync fails instead of displaying or recording stale prices. Previously a days-old payload from a service-worker cache fallback or a stale CDN edge was accepted, recorded into spot history with a current timestamp, and could overwrite a fresher price already on screen (the observed fresh→stale flash). Spot history rows from live syncs now carry the payload's publication timestamp instead of the wall-clock fetch time, and a monotonic guard prevents an older payload from ever overwriting a newer accepted one. The service worker also now parses ISO-8601 `generated_at` values when stamping `x-generated-at` cache headers (previously only numeric values were recognized, so the header was never set). Reported after the 2026-06-11 feed outage (STRK-189).

---

## [3.35.18] - 2026-06-11

### Changed — STRK-186: Restored backups keep catalog API keys

- **Bug fix**: Restoring an encrypted backup (or applying a cloud-sync snapshot) now rehydrates the in-memory catalog configuration after writing `catalog_api_config` to localStorage. Previously the `CatalogConfig` singleton kept the stale defaults it booted with, so the restored Numista API key / PCGS bearer token looked missing, and the next usage-counter save permanently overwrote the restored keys with empty values. All restore paths (legacy full restore, diff-preview apply, cloud-sync pull, snapshot restore) now call a shared `rehydrateCatalogState()` helper that reloads `CatalogConfig`, `CatalogAPI` settings, and reinitializes providers. Reported by a beta user after a browser-storage wipe (STRK-186).

---

## [3.35.17] - 2026-06-11

### Changed — STRK-188: Market data fails over to the backup API

- **Bug fix**: Market data (manifest, coin detail, 30-day history, intraday) now tries `api.staktrakr.com` and falls back to `api2.staktrakr.com` using the same ordered-failover helper as the spot and goldback feeds. Previously `js/market-data.js` hardcoded the primary endpoint, so a GitHub Pages outage blanked the Market tab even while the Fly.io backup API was serving fresh data — defeating the backup's purpose. Surfaced during the 2026-06-11 feed outage (STRK-188).

---

## [3.35.16] - 2026-06-11

### Changed — STRK-185: Encrypted backup now includes pattern-rule images

- **Bug fix**: The encrypted backup image vault (.stvault image companion and cloud-sync photo upload) now exports and restores pattern-rule images from the `patternImages` IndexedDB store alongside user photos. Previously a pattern rule's regex survived backup (localStorage) but its obverse/reverse images did not, so rules silently lost their images after a storage wipe + restore. Old image vaults without pattern records restore unchanged, a pattern-only image library now produces an image companion file, and the image-vault change hash stays identical for users with no pattern images (STRK-185).

---

## [3.35.15] - 2026-06-10

### Changed — STRK-184: Remove dead storage-report popup renderer

- **Security/cleanup**: Removed the unreachable storage-report popup renderer from `js/utils-storage-report.js` (`openStorageReportPopup`, `generateStorageReportHTML` and its CSS/JS/analysis helpers, `generateStorageReportTar`). Its `#storageReportModal` markup was removed from `index.html` in an earlier release and nothing invoked it, leaving ~1,400 lines of dead code containing an XSS-prone HTML generator (unescaped `innerHTML` interpolation), a hardcoded Chart.js CDN load, a broken `window.close()` button, and a wrong empty-storage fallback. The live footer storage stats (`updateStorageStats`) and the `generateStorageReport` data helper are unchanged (STRK-184).

---

## [3.35.14] - 2026-06-07

### Changed — STRK-167: Numista instance-aware de-duplication + safe merge

- **Numista import**: restored a safe merge with instance-aware de-duplication. The identity key is now `numistaId|year|grade|certNumber`, so identical ungraded copies collapse into one row with a summed quantity, distinct graded instances stay separate (cert data preserved), and re-importing the same CSV produces no duplicates. The importer routes through the shared diff-review modal again (the STRK-165 interim onboarding/replace gate is removed; `importNumistaCsv(file, true)` still replaces directly). The review modal gains a 3-way quantity control (Keep / Replace / Add-to-existing, keyboard-accessible) and an advisory "possible duplicate of a graded item" badge — the badge never blocks import and is never persisted onto an item (STRK-167).

---

## [3.35.13] - 2026-06-07

### Changed — STRK-161: Spot card ratio chips

- **Feature**: Each spot card now shows an at-a-glance precious-metals ratio chip — gold-denominated GSR (Au:Ag), Au:Pt, and Au:Pd on the non-gold cards, and the daily goldback G1 rate on the gold card. A single "Show spot ratios" toggle in Currency & Pricing controls visibility (default on); the goldback chip also respects the goldback pricing mode and a freshness guard (`now − data.ts > stale_after`, read from the envelope top level). Chips read legibly across all four themes with a plain-English tooltip on hover and keyboard focus, and a reserved row keeps every card's sync line aligned when a chip is hidden (STRK-161).

---

## [3.35.12] - 2026-06-06

### Changed — STRK-162: Cache user-image storage usage (O(1) pre-flight)

- **Performance**: The per-save image storage-quota check no longer re-scans the entire IndexedDB user-image store on every save. The total is cached on the `ImageCache` singleton (computed lazily, updated by the signed delta on each successful save, and invalidated on delete/clear/import), keeping saves fast as an image library grows. The STRK-146 storage-full warnings and over-quota blocks are unchanged (STRK-162).

---

## [3.35.11] - 2026-06-06

### Changed — STRK-165: Numista CSV import safety gate (interim)

- **Numista import**: The Numista CSV importer is now a one-time onboarding action that explicitly warns it **replaces** your inventory rather than silently merging — preventing the duplicate-explosion bug. Importing into a non-empty inventory requires confirming a destructive replace; importing into an empty inventory simply populates it. A proper instance-aware merge follows later (STRK-165).

---

## [3.35.10] - 2026-06-06

### Added — STRK-166: Restore bulk Sync Image URLs

- **Image sync**: A new "Sync Image URLs" button (in the Numista bulk-sync modal) backfills obverse/reverse coin images for items missing them — e.g. CSV imports. It is cache-first to conserve Numista API quota, dedups by catalog ID, and never overwrites images you've already set. Restores the capability removed in STAK-432 (STRK-166).

---

## [3.35.9] - 2026-06-06

### Fixed — STRK-146: Image storage quota warning

- **Image storage**: Saving a coin image when device storage is nearly full now shows an explicit "storage full" message instead of silently failing and rendering a broken colored square. A warning also appears as image storage approaches its limit, so you can free space before saves start failing (STRK-146).

---

## [3.35.8] - 2026-06-05

### Fixed — STRK-83: Disposition predicate alignment

- **Disposition**: An item with an empty disposition object (`{}`) is now treated consistently as not disposed everywhere — no "disposed" badge or styling, present in the active view, excluded from the disposed view, and uncounted in disposed totals. `isDisposed()` is now the single source of truth: the section renderer, disposed filter, summary totals, trade-link guards, and trade autocomplete all route through it, resolving the STRK-73 predicate inconsistency (STRK-83).

---

## [3.35.7] - 2026-06-05

### Changed — STRK-154: Cloud Sync Convergence & Auto-Healing

- **Cloud sync**: Fixed a permanent "Review Sync Changes" loop between two devices — per-item tag merges now converge deterministically (commutative union on a timestamp tie) and auto-heal diverged tags on the next sync with no user action (STRK-155).
- **Cloud sync**: Settings compare by logical content instead of raw storage, so a value compressed on one device and plain on another (or stored in a different key order) no longer triggers an endless sync (STRK-156).
- **Cloud sync**: Added apply/restore integrity guards and a one-time boot-repair that clears unrecoverable `[object Object]` corruption without touching valid data (STRK-157).
- **Cloud sync**: The Review Sync Changes modal no longer shows phantom conflicts — timestamps differing only in format and reordered attachments are recognized as unchanged (STRK-158).
- **Cloud sync**: Audited and hardened every sync compare/merge/hash surface for convergence and documented the invariant (STRK-159).

---

## [3.35.6] - 2026-06-05

### Changed — STRK-32: Isolate price extractor Vendor modules

- **Retail poller**: Price extraction now routes migrated Vendors through isolated modules, keeps the orchestrator import-safe for single-Vendor dashboard retry, and packages the new shared modules for poller deploys (STRK-32).

---

## [3.35.5] - 2026-06-05

### Fixed — STRK-138: Numista Goldback import + Type-drives-Metal coupling

- **Goldback import**: Selecting a Goldback/Silverback Numista result now auto-detects the type from the title/denomination and fills Type, Metal (Gold/Silver), and weight unit with no manual re-selection (STRK-138).
- **Fractional denomination**: A fractional Goldback (e.g. "1/4 Idaho Goldback") now sets the denomination picker to the matching weight; goldbacks without a denomination keep the default (STRK-138).
- **Type drives Metal**: Goldback/Silverback are always selectable in the Type dropdown; choosing one sets the metal automatically, while nonsensical metal×type combinations stay blocked (STAK-580).

### Fixed — STRK-153: Spot cards lock on "Seed" label with a today-dated seed entry

- **Spot timestamps**: Spot-price cards no longer lock on the "Seed" label when the seed bundle includes the current day; the live API/provider label now wins once a same-day sync runs. The label compares by local calendar day rather than raw timestamps, so a noon-dated seed entry no longer outranks a real morning sync (STRK-153).

---

## [3.35.3] - 2026-06-04

### Changed — STRK-141: Migrate market histories to IndexedDB

- **Storage**: Spot and retail price history now live in a dedicated IndexedDB store (`StakTrakrHistory`) instead of localStorage, permanently removing the storage-quota ceiling. Existing history migrates automatically and losslessly on first load, with a localStorage fallback when IndexedDB is unavailable (STRK-141).
- **Item price history**: Now bounded by a silent retention cap (365-day age cutoff plus 1000 entries per item) so the one remaining localStorage history key can no longer re-trigger a quota error (STRK-141).
- **Backups**: Manual encrypted vault and ZIP backups no longer carry the reproducible spot/retail caches; item price history remains included, and older backups containing spot/retail history restore cleanly by ignoring those entries (STRK-141).

---

## [3.35.2] - 2026-06-03

### Fixed — STRK-144: Summit Metals false-OOS + wrong (bulk) price tier

- **Retail accuracy**: Summit Metals items no longer false-flag as Out of Stock. Every Summit product page embeds an identical FAQ accordion containing the literal phrase "Out of stock", which the shared stock detector matched on every page; a `MARKDOWN_CUTOFF_PATTERNS.summitmetals` entry now trims the description/reviews/FAQ tail before stock and price detection. The Summit price branch also now prefers the single-unit (1–9) tier via `firstTableRowFirstPrice()` / `tierAnchoredPrice()` instead of the 100+ bulk "Regular price" card, correcting a ~0.3% low read and a spurious bulk tier (STRK-144).

### Fixed — STRK-145: Metal-neutral purity labels

- **Add/edit item form & bulk editor**: Fineness dropdown labels no longer bake a metal name into the descriptor, so selecting `.900` on a gold item no longer re-renders as ".900 — 90% Silver". Labels are now metal-neutral in both `index.html` and the bulk editor; saved values and melt calculations are unchanged (STRK-145).

### Fixed — STRK-142: Retail-market history test time-bomb

- **Test hardening**: Froze the browser clock in the shared retail-market Playwright fixture (`page.clock.setFixedTime`) so the 7-day market-history assertion no longer fails once the real wall clock drifts past the seeded `RECENT_DATE` window (STRK-142).

---

## [3.35.1] - 2026-06-02

### Fixed — STRK-140: localStorage quota relief (compression stop-gap)

- **Storage compression**: Activated real lz-string compression for the large market-history caches (`metalSpotHistory`, `v2RetailHistory`, `item-price-history`), resolving the `QuotaExceededError` ("Failed to save v2 retail history") that affected all users. ~8–9× size reduction. Existing data is read transparently and migrated to the compressed format with no data loss; a versioned `CMP2:` prefix and a fail-closed write-guard protect against engine-load failures (STRK-140).

---

## [3.35.0] - 2026-05-26

### Changed — STRK-123: Trade linking

- **Trade provenance and value tracking**: Added bidirectional trade links between disposed traded items and received inventory, with editable trade relationships, spot-derived trade values, provenance display, undo support, CSV/ZIP backup coverage, and cloud-sync hash visibility. (STRK-123)

---

## [3.34.99] - 2026-05-26

### Changed — STRK-122: Playwright consolidation closeout

- **Settings API closeout and suite audit**: Consolidated the final 3
  root-level Playwright specs (14 historical tests) into
  `settings-api.spec.js` (3 compact tests), archived the source specs, and
  added a consolidation audit documenting the final core, extended, legacy, and
  root-level test inventory after the STRK-97 through STRK-122 consolidation
  sequence. (STRK-122)

---

## [3.34.98] - 2026-05-26

### Changed — STRK-121: Playwright consolidation batch

- **Settings, mobile layout, static page, service worker, and config coverage**:
  Consolidated 17 remaining settings/layout/static/browser-edge Playwright
  specs (258 historical tests) into compact core, extended, and unit targets:
  `settings.spec.js` (4 tests), `mobile-and-layout.spec.js` (4 tests),
  `visual-layout-regressions.spec.js` (4 tests), `service-worker.spec.js` (3
  tests), and `config-validation.test.js` (94 unit tests), with historical
  source specs retained in the archive for on-demand legacy verification.
  (STRK-121)

---

## [3.34.97] - 2026-05-26

### Changed — STRK-120: Playwright consolidation batch

- **Retail market and valuation chart coverage**: Consolidated 6 retail,
  premium, slug-resolution, valuation, and chart Playwright specs (60
  historical tests) into `retail-market.spec.js` (6 tests) and
  `valuation.spec.js` (7 tests), preserving market sorting, premium tiers,
  display currency, slug quarantine, valuation math, responsive layout, and
  representative chart behavior with archived source specs retained for
  on-demand legacy verification. (STRK-120)

---

## [3.34.96] - 2026-05-26

### Changed — STRK-119: Playwright consolidation batch

- **Catalog, Numista, and tag coverage**: Consolidated 6 catalog and tag
  Playwright specs (64 historical tests) into `numista-catalog.spec.js` (9
  tests), preserving configured and unconfigured search, picker tag opt-outs,
  tag delimiters, no-auto-resync behavior, and Numista metadata merge coverage
  with archived source specs retained for on-demand legacy verification.
  (STRK-119)

---

## [3.34.95] - 2026-05-26

### Changed — STRK-118: Playwright consolidation batch

- **Attachments, cloud sync, and import/export coverage**: Consolidated 15
  backup, attachment, cloud sync, vault, and CSV Playwright specs (93 historical
  tests) into compact core and extended suites — `attachments-cloud.spec.js`
  (8 tests), `import-export.spec.js` (5 tests), and `attachment-zip.spec.js`
  (3 tests) — while preserving archived source coverage for on-demand legacy
  verification. (STRK-118)

---

## [3.34.94] - 2026-05-26

### Changed — STRK-117: Playwright consolidation batch

- **Money and disposition coverage**: Consolidated 6 high-risk Playwright specs
  (132 historical tests) into 2 compact core suites — `inventory-math.spec.js`
  (10 tests) and `disposition.spec.js` (13 tests) — while preserving archived
  source coverage for on-demand legacy verification. (STRK-117)

---

## [3.34.93] - 2026-05-26

### Changed — STRK-116: Playwright suite consolidation batch

- **Test consolidation**: Consolidated 7 scattered Playwright spec files (63 tests)
  into 2 compact domain suites under `tests/playwright/core/` — `smoke.spec.js`
  (12 tests) and `inventory-crud.spec.js` (53 tests) — without deleting historical
  coverage. Original source files removed after verifying all assertions migrated.
  (STRK-116)

---

## [3.34.92] - 2026-05-26

### Changed — STRK-97: Playwright suite consolidation pilot

- **Test tiers**: Added the `core`, `extended`, and `archive` Playwright tiers,
  made `npm test` run the new core gate, and kept archived issue acceptance
  matrices available through `npm run test:legacy`. (STRK-97)
- **Issue-spec archive pilot**: Folded the first issue-prefixed regression cluster
  into compact core coverage and moved the original historical specs to
  `tests/playwright/archive/issue-ac-matrices/` as the rollback reference.
  (STRK-97)

---

## [3.34.91] - 2026-05-25

### Changed — STRK-111: Sweep cleanup

- **Dead code**: Removed unused `cacheFirst()` strategy function from service worker (STRK-111)
- **Dependencies**: Bumped `flatted`, `ajv`, and `brace-expansion` to fix 3 npm audit vulnerabilities (1 high, 2 moderate) (STRK-112)

---

## [3.34.90] - 2026-05-25

### Fixed — STRK-114: Autocomplete field name casing

- **Autocomplete**: Purchase Location and Storage Location autocomplete suggestions
  now pull from the user's actual inventory entries instead of only showing hardcoded
  defaults — snake_case field keys corrected to camelCase in `extractUniqueValues()`
  calls. (STRK-114)

---

## [3.34.89] - 2026-05-25

### Fixed — STRK-110: Consistent return cleanup

- **Code quality**: Normalized `updateManualSpot()` and `openRetailViewModal()`
  to return `undefined` explicitly without leaking helper return values, clearing
  PMD ConsistentReturn findings while preserving existing UI behavior. (STRK-110)

---

## [3.34.88] - 2026-05-25

### Fixed — STRK-108: Cloud sync tag merge

- **Cloud sync tags**: Selective cloud sync now carries per-item tags,
  removed-tag opt-outs, and per-UUID tag timestamps through the encrypted sync
  payload, using last-writer-wins merge semantics and refreshing in-memory tag
  state after pulls. (STRK-108)
- **Tag-only pulls**: Manifest-first sync now detects tag-only remote changes
  and routes version-upgrade tag keys through dedicated merge logic instead of
  generic settings writes. (STRK-108)

---

## [3.34.87] - 2026-05-25

### Changed — STRK-107: Cloud sync conflict loop after accepting remote changes

- **Cloud sync conflicts**: Accepting remote item changes now neutralizes superseded
  local changelog entries at the acceptance cutoff, preserving Activity Log history
  while preventing stale local edits from reappearing in the next sync manifest.
  (STRK-107)
- **Regression coverage**: Added cloud sync conflict-loop Playwright coverage for
  repeated conflicts, `lastModified`, rollback safety, and post-acceptance local
  edit cutoff behavior. (STRK-107)

---

## [3.34.86] - 2026-05-24

### Fixed — STRK-106: Bullion Exchanges gold scrape failures

- **Byparr content-quality retry**: The cf-clearance sidecar client now inspects
  Byparr's returned HTML for price-token density and retries up to 3 attempts
  when the response looks like a pre-hydration shell (BE's React price grid
  hydrates asynchronously after Playwright's `load` event, causing ~26% of
  gold-page scrapes to snapshot before the price table renders). Retry threshold,
  attempt cap, and backoff are tunable via `CF_CLEARANCE_MIN_DOLLARS`,
  `CF_CLEARANCE_MAX_ATTEMPTS`, and `CF_CLEARANCE_RETRY_DELAY_MS` env vars.
  Network/HTTP errors are not retried here — the caller's existing fallback
  chain handles those. (STRK-106)

---

## [3.34.85] - 2026-05-24

### Fixed — STRK-96: Playwright suite failures

- **Add Item tag entry**: The Add Item modal now wires its tag controls to a
  pending tag buffer and persists those tags to the newly-created item UUID on
  save, while keeping stale edit-mode chips and handlers cleared. (STRK-96)
- **Regression expectations**: Playwright coverage now matches current
  Goldback retail lookup date semantics, currency-rounded purchase input
  formatting, and Numista description-field default selection behavior.
  (STRK-96)

---

## [3.34.84] - 2026-05-23

### Fixed — STRK-101: manifest-first sync item edits

- **Cloud sync manifest diff**: Manifest consumers now normalize legacy
  `item-add`, `item-edit`, and `item-delete` changelog types before summary
  counting, diff classification, and conflict detection, so manifest-first
  pulls no longer silently skip item field edits. (STRK-101)
- **Manifest grouping**: Multiple changelog entries for one item now merge in
  chronological order, preserving re-add and delete transitions without relying
  on a static priority map. (STRK-101)
- **Backup/export parity**: ZIP JSON exports now include the DIFF_FIELDS values
  previously omitted from the allowlist, and both ZIP and standalone CSV exports
  include Obverse Frame and Reverse Frame columns. (STRK-101)

---

## [3.34.83] - 2026-05-23

### Fixed — STRK-99 hotfix: SDB + BE spot-ticker / sidebar leak

- **Retail poller — HTML chrome strip**: `htmlToPlainText()` now drops
  `<nav>`, `<header>`, and `<footer>` content the same way it already drops
  `<script>` and `<style>`. v3.34.82's STRK-99 denylist forced BE through the
  markdown extractor, which then matched the spot ticker inside `<header>`
  (silver $75.92 / gold $4,520) instead of the product price. (STRK-99)
- **Retail poller — tier-anchored extractor**: New `tierAnchoredPrice()`
  matches qty-range patterns (`1-24`, `1 - 49`, `50+`, `1+`) and returns the
  first wire price after the first match. For `UNTRUSTED_OFFER_PRICE_VENDORS`
  (sdbullion, bullionexchanges), this is the only prose fallback after JSON-LD
  is denied — `firstInRangePriceProse` is no longer reachable for these
  vendors, so spot tickers and "Related Products" sidebar prices can never
  poison the dashboard again. When neither a pipe table nor a tier-anchored
  pattern is present, extraction returns null (the page is treated as OOS
  rather than written with a misleading value). (STRK-99)
- **Tests**: 12 new fixtures in `price-extract-html-chrome-strip.test.mjs` and
  18 new fixtures in `price-extract-tier-anchored.test.mjs`, including
  regressions for SDB's `1 - 49` whitespace pattern (which the v1 of the
  regex silently skipped, returning the bulk tier) and year-range guards
  (`2024 - 2025 $99` must NOT match). 55/55 tests across the three poller
  suites pass green. (STRK-99)
- **In-container live verification** (DRY_RUN against home-poller Byparr):
  SDB silver maple → $79.23 (correct 1-unit); SDB gold maple → $4,580.63
  (correct 1-unit); BE silver maple → $77.82 (correct 1-unit Check/Wire);
  BE gold maple → NULL (safe-OOS — Byparr couldn't hydrate the price grid
  in its render window, which is the new desired behavior over recording
  a spot or sidebar value). (STRK-99)

---

## [3.34.82] - 2026-05-23

### Changed — STRK-99: SDB + BE bulk-tier scrape fix

- **Retail poller**: Add `UNTRUSTED_OFFER_PRICE_VENDORS` denylist
  (`sdbullion`, `bullionexchanges`) in `extractJsonLdPrice()` to skip the bare
  `offer.price` JSON-LD fallback when no `priceSpecification` is present.
  Both vendors recently shipped a Magento template change that publishes the
  deepest "As Low As" bulk-tier price as `offer.price`, causing the home poller
  to record bulk prices instead of single-unit Check/Wire prices. With the
  denylist, `extractPrice()` falls through to the markdown-table extractor
  which reads the 1-unit row correctly. Tiered `priceSpecification` blocks and
  the zero-price OOS sentinel still apply for denied vendors. (STRK-99)
- **Tests**: 6 new fixtures in `price-extract-jsonld.test.mjs` lock in the
  STRK-99 behavior, including a verbatim capture of SDB's live Product JSON-LD
  payload from 2026-05-23. (STRK-99)

---

## [3.34.81] - 2026-05-23

### Changed — STRK-91: Bulk editor mobile parity + field gap closure

- **Mobile bulk editor**: Sticky identity columns (checkbox / image / name) pin while scrolling; 24×24 base / 44×44 mobile tap targets; safe-area padding for fullscreen modal; collapsible field panel at ≤768px (STRK-91).
- **Bulk field parity**: Adds `shape`, `capsule`, `capsuleNotes` to the bulk editor with nested-path apply via `BULK_FIELD_STORAGE_MAP` and dimension cleanup on shape change (STRK-91).
- **Catalog display columns**: New `Catalog Composition` and `Diameter` read-only columns sourced from `numistaData.*`; raw JSON blob column suppressed; search/sort routed through dot-path resolver (STRK-91).
- **Change-log + sync coverage**: `capsule`, `capsuleNotes`, `paymentMethod`, `numistaData`, `fieldMeta` now produce activity-log + sync manifest entries; deep-equality comparison prevents false change rows on nested objects (STRK-91).

---

## [3.34.80] - 2026-05-23

### Changed — STRK-85: Goldback premium in ticker + tiered premium colors

- **Goldback premium**: Ticker now shows G1-rate-based premium % for Goldback items; three-tier color scheme (low <2%, mid 2–5%, high ≥5%) applied consistently across ticker, vendor price Matrix, and market detail modal via shared `_calcMarketPremium` helper (STRK-85).

---

## [3.34.79] - 2026-05-22

### Changed — STRK-74: Align inline chip config to saveData wrapper

- **Storage**: Align `saveInlineChipConfig` and `getInlineChipConfig` to project-standard `saveDataSync`/`loadDataSync` wrappers instead of raw `localStorage` calls, improving consistency with compression, quota handling, and future storage middleware (STRK-74).

---

## [3.34.78] - 2026-05-22

### Changed — STRK-92: Fill 90-day Market History with per-vendor data

- **Feature**: 90-day retail history endpoint now includes per-vendor daily breakdown matching the 30-day schema, so Market History "All" view shows vendor prices for the full 90-day window instead of dashes on older rows (STRK-92).
- **Bug fix**: Frontend dedup merge uses vendor-set union instead of all-or-nothing overwrite, retaining departed vendors on overlapping dates (STRK-92).

---

## [3.34.77] - 2026-05-21

### Changed — STRK-93: Fix header Spot button 4× API sync

- **Bug fix**: Header Spot sync button now calls `syncSpotPricesFromApi` once instead of looping over 4 per-metal sync icons — eliminates 4× redundant API calls, 4× stacked cache-age dialogs, and 4× toast notifications per click (STRK-93).

---

## [3.34.76] - 2026-05-21

### Changed — STRK-89: Add gold-api.com as first-class spot price provider

- **New provider**: Added gold-api.com as a built-in spot price source with free unlimited real-time prices for all four metals (XAU, XAG, XPT, XPD) — no API key required (STRK-89).
- **Optional key support**: Introduced `optionalKey: true` provider flag with a collapsible `<details>/<summary>` disclosure widget for premium API key entry, collapsed by default for zero-friction free-tier use (STRK-89).
- **Settings UI**: Gold API pill at position 5 of 7 in the Spot Price pill-radio group with dedicated sub-card renderer, connection test, and metal selection checkboxes (STRK-89).

---

## [3.34.75] - 2026-05-20

### Changed — STRK-88: Lot/each purchase price rounding and CSV normalization

- **Precision rounding**: Preserved full decimal precision in memory for purchase price values while formatting them for display in UI grids, inputs, and duplicate/edit modal states (STRK-88).
- **Lot/each toggle**: Parameterized lot/each toggle helpers to safely initialize and restore toggle states during edit, duplication, and quantity boundaries (STRK-88).
- **Numista import/export**: Normalized CSV parsing/export routines to support decimal-precision purchase values across both lot and unit boundaries (STRK-88).
- **Test coverage**: Corrected Playwright tests for lot/each purchase price rounding, ensuring deterministic validation in localized environments (STRK-88).

---

## [3.34.74] - 2026-05-19

### Changed — STRK-87: Add Item Numista reset hygiene

- **Catalog reset hardening**: Add Item now explicitly clears the Numista catalog input after editing another item, so new entries cannot inherit a previous item's hidden catalog value if browser form reset behavior changes (STRK-87).
- **Tag state cleanup**: Add Item clears stale edit-modal tag chips, tag input state, and edit-bound tag handlers so tags added in Add mode cannot write back to the previously edited item (STRK-87).
- **Regression coverage**: Added Playwright coverage for edit-with-Numista-ID → Add Item and edit-with-tags → Add Item flows (STRK-87).

---

## [3.34.73] - 2026-05-18

### Changed — STRK-84: Numista picker tags applied on first Fill Fields for new items

- **Tag persistence**: Numista picker tag checkboxes now persist on the first Fill Fields click when adding a new item — no second sync required. Captures picker state as a snapshot before modal teardown, consumed after UUID minting in the Add-branch submit handler (STRK-84).
- **Opt-out recording**: Unchecked default-on tags are recorded as opt-outs (`itemRemovedTags`) for new items, matching the existing Edit flow behavior from STRK-52 (STRK-84).
- **Dead code removal**: Removed unreachable STAK-126 fallback in events.js that referenced `window.selectedNumistaResult` (never set due to `let` vs `window` namespace isolation) (STRK-84).

---

## [3.34.72] - 2026-05-17

### Changed — STRK-48: Per-oz/per-coin premium in Item Detail modal

- **Premium display**: Valuation section now shows premium as a percentage of spot at purchase, gain/loss %, and lot-aware rows (total + per-unit) in a 6-column grid layout that collapses to 3×2 on mobile (STRK-48).
- **Spot lookup**: New `lookupHistoricalSpot()` synchronous cache-only helper resolves the nearest trading day spot from `historicalDataCache` with progressive date widening (STRK-48).
- **Search fix**: Fixed `catalogText` ReferenceError in `filterInventoryAdvanced()` where the variable was declared in `getItemSearchHaystack()` but referenced in a different function scope (STRK-86).

---

## [3.34.71] - 2026-05-17

### Changed — STRK-49: Direct Print button + Settings Data tab UI fixes

- **Print button**: New one-click Print button (Export card, teal-green) renders the full inventory as a landscape jsPDF report and opens it in a new tab with `autoPrint()` — native print dialog fires automatically in Chrome, Edge, and Safari; Firefox opens the PDF for manual Ctrl+P (accepted v1 limitation) (STRK-49).
- **Restore ZIP relocated**: "Restore ZIP Backup" button moved from Export card to Import card where restore/import actions belong; no JS wiring changes — ID-based listeners remain intact (STRK-49).
- **Data Reset button sizing**: "Remove Inventory" and "Wipe All Data" buttons now match the 0.82rem / 0.4rem 0.6rem inline sizing of all other card buttons for visual consistency (STRK-49).

---

## [3.34.70] - 2026-05-17

### Changed — STRK-86: Search ignores Numista catalog data

- **Catalog-aware search**: Inventory search now matches against Numista-synced catalog data (country, denomination, composition, technique, obverse/reverse/edge descriptions, KM reference, etc.), not just title and top-level item fields. Searching "Australia" now returns coins whose Country catalog field equals Australia even when the title does not contain the word (STRK-86).
- **Cache-aware integration**: New `catalogText` field is computed once per item and stored in the existing `searchCache` WeakMap; cache invalidates automatically on item edit, so no migration is required (STRK-86).

---

## [3.34.69] - 2026-05-16

### Changed — STRK-73: Make Disposition section position-configurable

- **Configurable placement**: Disposition section now appears as a draggable row in Settings → Appearance → Item Detail Modal; users can reorder it relative to the other nine sections and the preference persists across reloads (STRK-73).
- **Legacy migration**: `_loadSectionConfig()` auto-appends a Disposition entry for users with pre-STRK-73 saved configs, placing it last by default without overwriting existing order (STRK-73).
- **Empty-object guard**: `_buildDispositionSection()` returns `null` for both falsy and empty-object `disposition` payloads, preventing ghost section renders for items with no valid disposition data (STRK-73).
- **Test coverage**: 6 Playwright tests covering settings-row presence after legacy seed, reorder controls at the 10-entry boundary, configured section placement, non-disposed absence, persist-after-reload, and DOM-absent empty-object guard (STRK-73).

---

## [3.34.68] - 2026-05-15

### Changed — STRK-79: Market API service-worker routing

- **Classified caching**: New `sw-router.js` endpoint-family classifier routes all StakTrakr API and spot-history requests through cache-first-with-TTL with per-family freshness windows; envelope `stale_after` fields take precedence over floor TTLs when present (STRK-79).
- **Age-gate mechanism**: Synthesized `x-generated-at` / `x-cached-at` headers on cached responses provide publisher-mint-time accuracy; legacy entries without age headers are force-revalidated once (STRK-79).
- **Test coverage**: 26 unit tests for `classifyEndpoint` (all 10 families × both API hosts + local origin + negative cases); 3 Playwright integration tests verifying cache-miss/network, stale-revalidation, and offline fallback strategies (STRK-79).

---

## [3.34.67] - 2026-05-15

### Changed — STRK-78: Playwright test suite mock audit and consolidation

- **Shared mock layer**: New `tests/playwright/helpers/mocks/` with canonical fixtures (`fixtures.js`), route installers (`routes.js`), and an extended Playwright fixture (`extended-test.js`) that auto-installs mocks before every test — eliminating real external API calls across the suite (STRK-78).
- **App-shell migration**: 47 spec files migrated to shared mocks; 4 `@network`-tagged tests in `01-page-load` now run offline with deterministic fixture data (STRK-78).
- **Market/retail/catalog cleanup**: Existing mocked specs refactored to use shared helpers, removing duplicate inline response blobs while preserving per-spec override behavior (STRK-78).

---

## [3.34.66] - 2026-05-14

### Fixed — STRK-38: Rectangular item images auto-size in card/table views

- **Card views (A/B/C):** Rectangular items (bars, notes, Goldbacks, Silverbacks, proof sets) now render with transparent backgrounds and `object-fit: contain` instead of floating inside a visible `--bg-tertiary` dead-space box. Card A images bumped from 36px to 44px. Card B `.bar-shape` gains `border: none` to suppress the inherited border on transparent backgrounds (STRK-38).
- **Table view:** Rectangular thumbnails get transparent backgrounds. SVG placeholders use `<rect>` outer shape (instead of `<circle>`) for rect items, resolved via `resolveImageFrame()` to honor manual overrides, grading authority, and Numista shape (STRK-38).
- **Tests:** New `rect-image-card-table.spec.js` covering AC-1 through AC-7; extended `image-frame-override.spec.js` with Card B/C mixed-side assertions (STRK-38).

---

## [3.34.65] - 2026-05-13

### Changed — STRK-75: All tab as default in vendor price matrix

- **All tab**: Adds an All tab as the first and default entry in the vendor price matrix tab bar; new users land on a unified view of all market-tracked metals grouped Gold → Silver → Platinum → Palladium → Goldback (STRK-75).
- **Tab preference preserved**: Returning users whose stored tab is valid (e.g. Silver) keep their selection; missing or unrecognised saved values fall back to All (STRK-75).

---

## [3.34.64] - 2026-05-13

### Changed — STRK-50: Optional structured Payment Method dropdown

- **Payment method field**: Adds an optional Payment Method dropdown to the item add/edit form, persists it on inventory records only when selected, and preserves it through edit, clone, bulk edit, JSON/CSV import/export, ZIP backup, and view details (STRK-50).
- **Filtering and search**: Payment Method is now available as a filter chip category and participates in inventory text search without changing totals or valuation math (STRK-50).

---

## [3.34.63] - 2026-05-12

### Changed — STRK-71: Attachment chip controllable in inline chip settings

- **Inline chip settings**: The attachment count badge (📎) is now part of the inline chip settings panel — it can be toggled and reordered alongside the other name-cell chips (grade, year, numista, etc.) in Settings → Appearance → Layout (STRK-71).

---

## [3.34.62] - 2026-05-12

### Changed — STRK-53: Constrained quantity selector for partial-stack disposition

- **Chip mode**: Dispose modal now renders chip buttons (1–N) for stacks of 8 or fewer, making invalid quantities unreachable. Chips use roving tabindex with ArrowLeft/Right/Home/End keyboard navigation and aria-pressed state (STRK-53).
- **Select mode**: Stacks larger than 8 use a native `<select>` pre-populated with options 1–N and the maximum quantity pre-selected, replacing the free-entry number input (STRK-53).
- **Single-item stacks**: A stack of 1 now shows a pre-selected, dimmed chip control instead of hiding the quantity field, making the affordance consistent and accessible (STRK-53).
- **Hidden carrier**: Both modes write through a hidden `<input id="removeItemQty">` via `writeDisposeQty()` so the existing preview-update handler fires without modification (STRK-53).

---

## [3.34.61] - 2026-05-12

### Changed — STRK-66: Add ¼ Goldback denomination support (Idaho, g0.25)

- **GOLDBACK_DENOMINATIONS**: Prepend `{ weight: 0.25, label: "¼ Goldback", goldOz: 0.00025 }` as the new first entry; array now has 9 denominations (STRK-66).
- **Label rendering**: Add `d.weight === 0.25 ? "¼"` branch in `updateDenomLabels` and `updateBulkDenomLabels` so the denomination shows as "¼ Goldback" in item add/edit and bulk-edit modals (STRK-66).
- **Slug parser**: Add `"g0.25": 0.00025` to `GOLDBACK_WEIGHTS` so `goldback-idaho-g0.25` resolves to 0.00025 oz (STRK-66).
- **Poller**: Add `g0.25` to `DENOMINATION_MULTIPLIERS` in `goldback-scraper.js` and to `buildGoldbackDenominations` in `api-export.js` and `api-export-v2.js` (STRK-66).
- **Bounds-guard fix**: Update price-extract.js regex to `/goldback-.*?-?g(\d+(?:\.\d+)?)$/i` so decimal denomination slugs are matched and their multiplier is computed correctly (STRK-66).

---

## [3.34.60] - 2026-05-11

### Changed — STRK-68: Chart unit alignment for lot/each pricing

- **pricingType field**: Persist the lot/each toggle choice on each item (`pricingType: "each" | "lot"`) so the price history chart can display all three lines in the intended unit (STRK-68).
- **Chart scaling**: Purchase, melt, and retail chart lines now use the same unit — per-unit when `pricingType="each"`, lot-total when `"lot"` or absent. Fixes the pre-existing retail-line inconsistency where midpoints were per-unit and endpoints were lot-total (STRK-68).
- **Edit modal restore**: Re-editing an item now restores the lot/each toggle and shows the lot-total price in the price field when the item was priced in lot mode (STRK-68).

---

## [3.34.59] - 2026-05-11

### Fixed — STRK-69: Goldback daily retail chart history

- **Goldback history**: Store one Goldback denomination history row per calendar day even when the vendor price is unchanged, so flat weekend pricing still appears as daily chart points (STRK-69).
- **Item detail charts**: Use Goldback denomination retail history and current denomination valuation in the item detail modal when item `marketValue` is empty, falling back to melt only when denomination pricing is unavailable (STRK-69).

---

## [3.34.58] - 2026-05-11

### Changed — STRK-42: Chart viewport scaling

- **Chart viewport**: Fit item detail chart y-axis bounds to visible purchase, melt, and retail lines with padding so short-range views no longer clip outlier purchase prices (STRK-42).
- **Historical ranges**: Limit bounded long-range fetches to needed years and anchor sparse 1Y lines at the viewport start so melt, retail, and purchase traces stay visible (STRK-42).
- **Regression coverage**: Add Playwright coverage for short-range purchase lines, 1Y range anchoring, wide ranges, and mobile/desktop chart heights (STRK-42).

---

## [3.34.57] - 2026-05-10

### Changed — STRK-67: Per-side image frame override

- **Image frames**: Add per-side Auto/Circle/Rectangle frame overrides for obverse and reverse images, preserving automatic shape detection while allowing graded slabs, bars, notes, and other rectangular media to be corrected from the item form (STRK-67).
- **Display consistency**: Apply the resolved frame independently in upload previews, table thumbnails, card images, view-modal image slots, field diffs, change history, and JSON backup data (STRK-67).

---

## [3.34.56] - 2026-05-10

### Changed — STRK-65: Attachment review follow-ups

- **Queue identity**: Duplicate filenames can now be removed independently — queue entries use stable ids instead of filename matching (STRK-59).
- **Object URL lifecycle**: Open-in-new-tab no longer revokes blob URLs on a fixed timer; tracked URLs are cleaned up on page unload (STRK-60).
- **Cloud sync hash**: All 6 attachment pull paths now use a shared helper; manifest-first path writes attachmentHash to last-pull metadata (STRK-61).
- **Size guard**: Cloud sync and manual export check attachment size against threshold before Base64 serialization; syncAttachments opt-out respected (STRK-62).
- **DiffEngine safety**: Duplicate-filename attachments are emitted as additions, not replacements, unless the match is unambiguous (STRK-63).
- **Split behavior change**: Stack split now duplicates attachment metadata and IDB blobs for both original and split-off items (STRK-64).
- **Storage diagnostics**: Footer, summary cards, and detail tables distinguish localStorage (~5 MB) from IndexedDB and note that browser quota varies (STRK-65).
- **Data integrity**: missingBinary is derived locally instead of persisted; orphan IDB records reconciled after restore/sync; deleteAttachmentsForItem uses key cursor without loading blobs.
- **UI polish**: Browse button is keyboard-accessible; table badge uses shared helper; icon colors use theme custom properties; malformed attachment manifests fail soft during restore.

---

## [3.34.55] - 2026-05-09

### Changed — STRK-45: Per-item PDF/image attachments

- **Attachments**: Attach receipts, COAs, and dealer invoices to individual inventory items (PDF, PNG, JPG) — persisted in IndexedDB, visible as a badge on card/table/detail views, included in zip/stvault backups and CSV exports, and synced via cloud sync with an opt-out toggle (STRK-45).

---

## [3.34.54] - 2026-05-08

### Changed — STRK-52: Numista re-sync tag membership

- **Tag picker**: Existing on-item tags in the Numista re-sync picker are now shown checked and enabled instead of locked-disabled, allowing users to explicitly uncheck them to record an opt-out removal (STRK-52).
- **Bulk controls**: Uncheck-all now preserves existing on-item tags (in addition to blacklisted tags), preventing accidental mass-removal of tags already on an item (STRK-52).

---

## [3.34.53] - 2026-05-08

### Changed — STRK-46: Structured Capsule field + capsule notes

- **Capsules**: Added structured Capsule and Capsule Notes fields to the inventory form, edit flow, view modal, search/filter paths, autocomplete, and JSON backup round trip so holder fit data no longer has to live in general notes or tags (STRK-46).
- **Suggestions**: Capsule entry now suggests the nearest bundled Air-Tite model from entered round diameter values, while blank, non-numeric, and non-round dimensions leave the hint empty (STRK-46).
- **Seed rules**: Hardened seed image rule loading so clearing rule storage during a reload cannot leave a version-only marker without persisted seed rules (STRK-46).

---

## [3.34.52] - 2026-05-08

### Changed — STRK-54: Lost disposition realized loss

- **Disposition**: Partial-stack Lost dispositions now record zero proceeds and a realized loss equal to the disposed units' cost basis, so item-level and portfolio realized G/L totals match full-stack lost behavior (STRK-54).

---

## [3.34.51] - 2026-05-08

### Changed — STRK-56: Service worker cache recovery

- **Recovery**: Runtime asset requests now fall back to cached service-worker responses when refresh fetches return non-OK responses, and initialization offers a Reset App action that clears registered service workers plus StakTrakr caches when stale cached assets persist (STRK-56).

---

## [3.34.50] - 2026-05-08

### Changed — STRK-55: View modal respects per-item Numista edits

- **View modal**: The item detail modal now shows saved per-item Numista customizations before falling back to the shared IndexedDB catalog snapshot. Obverse and reverse descriptions render as visible Catalog Data rows while retaining image hover tooltips, flat item-level mintage/KM reference values take precedence over cache arrays, and items with only partial Numista edits still use refreshed catalog fallback data for the rest (STRK-55).
- **Cleanup**: Removed the redundant Catalog Data tags row so tags appear only in the dedicated TAGS section chips (STRK-55).

---

## [3.34.49] - 2026-05-08

### Changed — STRK-51: Expanded Numista import modal fields

- **Feature**: The Numista import-confirmation modal now shows all 18 Numista-backed stored fields (country, denomination, composition, shape, diameter, length, width, thickness, orientation, technique, mintage, rarity index, KM reference, commemorative flag, commemorative description, and obverse/reverse/edge descriptions) in addition to the existing 8 main-form fields. Fields without candidate values are disabled. First-time imports default physical/reference fields checked; descriptions default unchecked (STRK-51).
- **Protection**: Fields manually edited by the user (tracked via `fieldMeta.userModified`) appear unchecked with an "✎ edited" badge so re-syncs never silently overwrite custom values. Checking a user-modified field and clicking Fill Fields clears the flag (STRK-51).
- **Scroll**: The Numista (and PCGS) stacked import modal now constrains to 90vh with a scrolling body; the Fill Fields/Cancel action bar is sticky so it remains reachable with 15+ picker rows (STRK-51).

---

## [3.34.48] - 2026-05-07

### Changed — STRK-47: Sort by Storage Location and Year

- **Feature**: Added `Storage Location` and `Year` as virtual sortable options in both the card sort dropdown and the Settings default sort selector.
- **Sorting**: Year sorts numerically with missing/unknown values bucketed to the end regardless of direction. Storage Location sorts alphabetically while remaining an inline chip in the Name cell.

---

## [3.34.47] - 2026-05-07

### Changed — STRK-44: Partial-stack disposition

- **Feature**: Dispose fewer than the full stack quantity in one action — a Quantity field appears on the disposition modal when qty > 1, pre-filled with the full stack. An inline preview shows remaining units. A Lot/Each toggle on the Amount field mirrors the purchase-price toggle pattern. The original record is decremented in place and a disposed clone is created adjacent, carrying all metadata (notes, tags, images, location, numismatic fields). The Activity Log records two correlated entries with a shared transaction marker that undo atomically via a cascade-undo prompt. Restoring a split-clone offers a Merge-or-Separate choice (STRK-44).

---

## [3.34.46] - 2026-05-05

### Changed — STRK-18: Vault settings parse helper

- **Refactored**: Extracted a shared vault settings parser in `js/vault.js` so remote and local settings diff paths use the same CMP1 decompression, JSON parsing, and raw-value fallback behavior.

---

## [3.34.45] - 2026-05-05

### Added — STRK-25: New metallic dark theme + oklch token system

- **New dark theme**: Warm-gunmetal palette using oklch (hue 85, low chroma) replaces the Tailwind Slate look as the default dark option. Brand principle: metallic, not digital.
- **Slate preserved**: Existing Tailwind Slate palette kept as a 4th theme option (Light | Dark | Slate | Sepia).
- **oklch migration**: `:root` (light) and `[data-theme="sepia"]` palettes migrated from hex/rgba to oklch for perceptual uniformity. `[data-theme="dark"]` already in oklch. `[data-theme="slate"]` keeps original Tailwind hex (preservation intent).
- **26 new semantic tokens** added to all 4 theme blocks: `--text-inverse`, `--focus-ring`, `--hover-mix`, `--tag-bg/text/border`, `--brand-gold`, `--authority-pcgs/ngc/anacs/icg`, `--disposition-{sold,traded,lost,gifted,returned}-{bg,text}`, `--col-{qty,weight,purchase,melt,retail}`.
- **JS bridge utilities**: `window.getThemeColor(token)` and `window.isDarkTheme()` allow JS to read CSS tokens dynamically — replaces hardcoded color maps in 8 JS files (charts, card-view, inventory-table, spot, viewModal, diff-modal, chart-utils, retail-view-modal, settings, market-data).

### Changed

- **CSS cleanup**: ~215 hardcoded color values across `css/styles.css` replaced with semantic tokens or `color-mix(in oklch, var(--token), var(--hover-mix) N%)` derivations for hovers. 12 hardcoded gradient endpoints standardized to token references.
- **Modal headers flattened**: `#changeLogModal`, `#detailsModal`, `#storageReportModal`, `#itemModal` headers no longer use the blue primary-gradient — now flat panel-pattern using `var(--bg-secondary)` + `var(--text-primary)`. Consistent with the metallic-not-digital design intent.
- **Metal token tuning**: Dark theme `--silver/--platinum/--palladium` shifted from warm hue 85 (which produced no chroma contrast against the warm-gunmetal bg) to cool hues (249/265/306). Final RGB matches the slate-theme reference look. Gold stays warm (hue 79) but high chroma 0.157 makes it stand out against the near-zero-chroma bg.

### Fixed

- **Cascade-poisoning**: `:is([data-theme="dark"], [data-theme="slate"])` rules that hardcoded Tailwind Slate-blue rgba (`rgba(30,41,59,0.95)`, etc.) into BOTH dark themes have been split — dark uses metallic tokens, slate keeps original Tailwind values. Affected `.modal-content`, `.faq-item`, `.faq-technical`, `.cloud-sync-update-meta`.
- **Light-theme palette leakage**: Table cell borders (`rgba(51,65,85,...)`) and bulk-log line border were applying Tailwind Slate-blue to ALL themes via base rules. Now use `var(--border)`.
- **viewItemModal header gradient**: `_parseColor` in `js/viewModal.js` had no oklch handler, so `_darkenColor` fell through to indigo fallback when fed the new oklch metal tokens, producing a broken blue-purple "AI slop" gradient. Added a canvas-based fallback that forces any CSS color form to sRGB via 1×1 canvas read.

### Tests

- 5 new theme-token Playwright tests (`tests/playwright/theme-tokens.spec.js`):
  - TT-1: all 4 themes load without JS runtime errors
  - TT-2: required tokens resolve in every theme
  - TT-3: theme picker cycles light → dark → slate → sepia → light
  - TT-4: modal headers consume `--text-primary` / `--text-inverse` tokens, not hardcoded literals (refactored from literal-string match)
  - TT-5: dark-theme modal-content backgrounds use metallic tokens, not legacy Slate-blue rgba (catches cascade-poisoning bugs)

### Known follow-up (deferred to future patch)

- Sepia theme metal tokens (`--silver`, `--platinum`, `--palladium`) still use warm low-chroma values that may not tint visibly in the image-section gradient. Pattern matches the dark-theme issue fixed in this release.
- A few minor unrelated visual polish issues to be tracked in a follow-up issue post-merge.

---

## [3.34.44] - 2026-05-04

### Changed — STRK-27: CSS polish pass

- **Normalized**: Border-radius token usage — reclassified 12 of 13 `--radius-xl` usages to semantic tokens (`--radius-lg` for cards/panels, `--radius-pill` for pills/sliders/buttons). Only the decorative about-logo retains `--radius-xl`.
- **Refactored**: Eliminated 21 `!important` declarations (99 → 78) by converting `.img-btn` pill block to compound selectors (`.btn.img-btn`) that naturally beat `.btn` specificity.

---

## [3.34.42] - 2026-05-04

### Changed — STRK-26: Remove side-stripe accents from cards

- **Removed**: 3px metal-color `border-left` accents from `.card-a`, `.card-b`, and `.card-c` — flagged by the Impeccable design critique as the strongest AI-dashboard tell.
- **Removed**: Card C's `.cv-image-col::before` radial-gradient halo, which was anchored to the now-removed stripe and would have become visually orphaned.
- **Removed**: Dormant `.cv-sparkline-strip` element from Card C — hidden via `display: none` since the card view engine first shipped (STAK-118), no longer needed.
- **Note**: 4 remaining `border-left` indicators using 3 variables (`--danger`, `--warning`, `--primary` × 2) encode functional state and are preserved; evaluation tracked separately in STRK-31.

---

## [3.34.41] - 2026-05-03

### Changed — STRK-29: Monospace font consolidation and font-size-base review

- **Added**: Geist Mono variable font — self-hosted woff2, registered in sw.js for offline PWA support.
- **Added**: `--font-mono` CSS custom property in `:root` with cross-platform fallback chain.
- **Changed**: All 11 monospace `font-family` declarations consolidated to `var(--font-mono)`.
- **Changed**: 5 JS inline monospace styles migrated to CSS classes (`.cache-id`, `.cache-log-line`, `.market-value`, `.market-price`, `.pattern-cell`).
- **Kept**: `--font-size-base` at 0.8125rem (13px) — Geist's high x-height compensates.

---

## [3.34.40] - 2026-05-03

### Changed — STRK-24: Replace Inter font with distinctive typeface pairing

- **Changed**: Body font replaced from Inter to Geist (variable WOFF2, weights 100–900) — locally bundled, no CDN.
- **Changed**: Heading font (h1, h2, .section-title) now uses Instrument Serif — high-contrast serif for visual hierarchy.
- **Added**: `--font-body` and `--font-heading` CSS custom properties in `:root`.
- **Added**: Font preload links in `index.html` for faster first render.
- **Added**: Font files registered in service worker precache for offline availability.
- **Fixed**: Chart canvas font in market-charts.js updated from Inter to Geist.
- **Fixed**: preview.html font reference updated from Inter to Geist.

---

## [3.34.39] - 2026-05-01

### Fixed — STRK-21: Market price matrix alphabetical sorting

- **Fixed**: Vendor columns in the market price matrix now appear in alphabetical order by display name (APMEX, BullionX, Gville, Hero, JM, Monument, Provident, SD, Summit) instead of reflecting unpredictable data load order.
- **Fixed**: Item rows in the market price matrix now appear in alphabetical order by item name instead of JSON key enumeration order.

---

## [3.34.38] - 2026-04-29

### Fixed — STRK-20: Backup conflict modal context-aware messaging

- **Fixed**: Cloud restore conflict modal now shows "A more recent remote backup exists" vs. "An existing remote backup was found" based on `conflict.reason`, instead of always claiming the remote is stale.
- **Fixed**: `cloud_last_backup` is now always persisted after a successful sync, preventing stale-timestamp false negatives in conflict detection.

### Fixed — STRK-19: View modal eBay search button overlap

- **Fixed**: eBay search button moved from the title row to the badges row in the View Item modal header, eliminating the overlap with the absolute-positioned close (X) button.
- **Fixed**: Title row `padding-right` bumped to `32px` to prevent title text from running under the close button on mobile viewports.

### Fixed — STRK-15: Silverback denomination aria-label

- **Fixed**: Silverback denomination selector no longer carries a stale `aria-label="Goldback denomination"` attribute. The dynamically managed `<label for>` association in `toggleGbDenomPicker` now provides the only accessible name, eliminating the misleading screen-reader announcement.

---

## [3.34.37] - 2026-04-29

### Fixed — STRK-17: Silverback weight unit wrong retail pricing

- **Fixed**: Silverbacks now use a dedicated `sb` weight unit at 0.001 troy ounces so melt, premium, and display calculations no longer reuse Goldback retail pricing semantics.
- **Added**: Legacy Silverback records stored as `gb` migrate to `sb` on local load, CSV import, encrypted backup preview, and cloud restore/diff paths.
- **Added**: Playwright coverage for Silverback add/edit, display, bulk edit, migration, and encrypted backup preview behavior.

---

## [3.34.36] - 2026-04-29

### Fixed — STRK-14: Encrypted backup round-trip duplicate prevention

- **Fixed**: Re-importing your own encrypted vault backup no longer produces duplicate items. `DiffEngine.enrichItemIdentities()` copies local UUIDs onto incoming backup items by serial (primary), numistaId+date (secondary), or name+date (tertiary) matching before comparison.
- **Fixed**: Vault settings comparison now mirrors the export parse logic (JSON.parse with raw-string fallback), preventing false-positive diffs for version strings stored via raw `localStorage.setItem`.
- **Added**: `VAULT_SETTINGS_DIFF_SKIP` — volatile cache keys (spot prices, exchange rates, API timestamps) are excluded from vault settings-diff comparison to prevent false diffs from async initialization.
- **Refactored**: Inline UUID enrichment in `showImportDiffReview()` replaced with shared `DiffEngine.enrichItemIdentities()` call, eliminating code duplication between vault restore and CSV/JSON import paths.

## [3.34.35] - 2026-04-29

### Fixed — STRK-13: Inventory seed guard prevents data loss on storage failure

- **Fixed**: Startup no longer overwrites user inventory with sample data when localStorage is missing or corrupt. A new `classifyBootState()` function distinguishes first-run (no prior evidence) from storage failure (orphaned keys like `inventorySerial` exist without `metalInventory`).
- **Added**: Seed sentinel (`inventorySeedApplied`) — sample data is only persisted once per origin; returning users with existing data are never re-seeded.
- **Added**: Recovery banner — when storage damage is detected, a dismissible warning surfaces above the inventory table instead of silently replacing data with samples. Users can restore from cloud backup or dismiss the banner.
- **Added**: Boot diagnostics ring buffer (`staktrakr.bootDiagnostics`) — records the last 10 boot classifications for post-mortem analysis without storing PII.
- **Fixed**: `classifyBootState()` now decompresses CMP1-prefixed inventory before parsing, preventing large inventories from being misclassified as corrupt.
- **Added**: `migrateSentinelIfMissing()` — one-shot migration writes the seed sentinel for existing users so they are never re-seeded on future boots.

---

## [3.34.34] - 2026-04-27

### Added — STRK-4: Lot ⇄ Each toggle for Purchase Price

- **Added**: Purchase Price field in the Add/Edit modal now has a segmented Lot / Each toggle. In Lot mode, enter the total paid for the whole lot — the app divides by quantity and stores a per-unit price automatically.
- **Added**: Toggle visibility is tied to quantity: at qty ≤ 1 the control is hidden and mode resets to Each (Lot and Each are equivalent at that point).
- **Changed**: Purchase column in the inventory table now shows the qty-multiplied total (price × qty) instead of the per-unit price, matching the column header tooltip.
- **Fixed**: `parseInt` replaced with `Number()` for quantity parsing so fractional inputs like "2.5" are properly rejected by downstream integer validation instead of being silently truncated.

---

## [3.34.33] - 2026-04-25

### Changed — STAK-581: Retail currency conversion phase 1

- **Changed**: Retail history, market ticker cards, vendor price grids, and Goldback settings now honor the selected display currency instead of leaving active retail surfaces pinned to USD.
- **Added**: `saveDisplayCurrency()` now dispatches a shared `currencychange` event so market, retail, inventory, spot sparkline, and Goldback settings surfaces refresh from one signal instead of duplicated manual render calls.
- **Added**: Non-USD market vendor tables now show a convenience-conversion footer note explaining that vendor checkout remains US-based.

---

## [3.34.32] - 2026-04-25

### Changed — STAK-571: Confirm spot provider changes

- **Added**: Settings → API spot provider pills now show an in-app confirmation dialog before switching to a different provider, naming the destination provider and explaining that spot prices, charts, ticker, and portfolio values are affected.
- **Fixed**: Canceling the provider switch leaves the previous provider active and does not write `spotPricingSource`; clicking the already-active provider remains a no-op with no dialog.
- **Added**: Playwright coverage for confirm, cancel, and already-active spot provider click behavior in the API tab suite.

---

## [3.34.31] - 2026-04-25

### Fixed — STAK-578: Mobile modal action buttons clipped by browser chrome

- **Fixed**: View Item modal footer (Remove / Edit / Clone / Close) now clears the Android gesture-nav zone and iOS home indicator via `padding-bottom: max(0.75rem, env(safe-area-inset-bottom))` on `.view-modal-footer`. Previously the bottom row of buttons was unreachable on Android Chrome with gesture-nav enabled.
- **Fixed**: Add/Edit Item modal action bar (Save / Cancel / Remove / View / Clone / Save & Clone Another) now clears the gesture zone via `padding-bottom: max(0.65rem, env(safe-area-inset-bottom))` on `#inventoryForm .item-modal-actions`. Sticky positioning is preserved unchanged.
- **Fixed**: View Item modal footer + Add/Edit modal action bar now clear iOS landscape side-notch insets via `padding-left/right: max(<existing>, env(safe-area-inset-left/right))` overrides — edge buttons no longer sit underneath the notch on iPhone in landscape.
- **Fixed**: Mobile fullscreen modal headers for `#itemModal` and `#viewItemModal` now clear the iOS notch / status bar via a scoped `padding-top: max(<existing>, env(safe-area-inset-top))` rule inside `@media (max-width: 768px)`. Per-modal static fallbacks (`var(--spacing)` for `#itemModal`, `var(--spacing-sm)` for `#viewItemModal`) preserve existing rendering on non-notched devices.
- **Added**: `viewport-fit=cover` to viewport meta — required for iOS to resolve `env(safe-area-inset-*)` to non-zero values on notched devices and in PWA mode.
- **Added**: 7 Playwright TDD regression tests in `tests/playwright/mobile-modal-safe-area.spec.js` covering all four `env()` declaration sites and the viewport meta. Tests use `document.styleSheets` rule-text traversal because Playwright's emulated viewport supplies env() as 0; the rule-text pattern catches future regressions deterministically.

---

## [3.34.30] - 2026-04-25

### Changed — STAK-582: Remove dead retail card-list view

- **Removed**: Legacy Market Settings retail card/list render path that no longer mounts in the app, including stale exports, event listeners, trend-mode storage, and orphaned sync-error state.
- **Removed**: Obsolete retail card/list CSS while preserving the active main-page ticker, vendor price matrix, market detail modal, market filter matrix, and retail history table.
- **Changed**: Stale market copy/comments now refer to the active ticker and price table instead of retired market cards.

---

## [3.34.29] - 2026-04-24

### Fixed — STAK-576: Numista search magnifier shows misleading error when API key missing

- **Fixed**: Catalog search magnifiers (Name and Catalog N#) now detect the "Numista not configured" state first and open a confirm dialog that links directly to Settings → API instead of showing `Enter a Name or Catalog N# to search.` (STAK-576 ISSUE-005)
- **Changed**: Disconnected magnifier dot now announces "Numista API not configured — click to configure" via tooltip, and the button `title` flips to match so the hint is visible before clicking
- **Changed**: `updateNumistaModalDot()` now runs whenever the Add/Edit item modal opens so the dot reflects the current configuration state without requiring a save round-trip

---

## [3.34.28] - 2026-04-24

### Fixed — STAK-576: AutoTable vendor fallback warning

- **Fixed**: jsPDF AutoTable fallback detection now checks the plugin API registered by the local vendor bundle, preventing the false CDN fallback warning/request when PDF export support is already available offline (STAK-576)

---

## [3.34.27] - 2026-04-24

### Fixed — STAK-576: Duplicate network fetches on cold load

- **Fixed**: Startup spot-price sync now shares an in-flight provider sync/backfill instead of letting `autoSyncSpotPrices()` and `startSpotBackgroundSync()` fetch the same `spot/latest.json` and daily spot files concurrently (STAK-576)
- **Fixed**: Exchange-rate refresh now dedupes concurrent startup calls and suppresses repeated `open.er-api.com/v6/latest/USD` fetches within the same burst (STAK-576)
- **Changed**: Market vendor table reuses the retail cache populated by startup sync and only fetches per-slug `latest.json` when a slug is missing from cache (STAK-576)

---

## [3.34.26] - 2026-04-23

### Fixed — STAK-565: JM Bullion scraper picking wrong price column

- **Fixed**: JM Bullion price readings oscillating between the correct eCheck/Wire tier (~$86 on ASE) and the wrong Card tier (~$95) depending on which scrape engine rendered the page. Root cause: pipe-table fallback was column-blind (STAK-565)
- **Added**: `jmPriceFromPipeTable()` locates the `(e)Check/Wire` column by header label, returns that column's first in-range data-row price. Handles column reorder, format variants, and shipping-price noise (STAK-565)
- **Removed**: Column-blind `firstTableRowFirstPrice()` fallback for jmbullion. Missed ticks are preferred over wrong-tier prices — matches existing As-Low-As rejection philosophy (STAK-565, STAK-475 P2)
- **Docs**: CLAUDE.md — Dual Config Store section carried forward from STAK-573 session

---

## [3.34.25] - 2026-04-23

### Changed — STAK-573: API tab QA pass — catalog UX, spot card polish, Bulk Sync modal rework

- **Added**: Save button on Numista and PCGS catalog expand panels with toast feedback (STAK-573)
- **Added**: Masked key indicator (`••••••••`) when API key is stored — clears on focus (STAK-573)
- **Fixed**: Usage bar reads from CatalogConfig instead of showing static "No key configured" (STAK-573)
- **Fixed**: Numista Test button saves key first, shows success/failure toast (STAK-573)
- **Added**: PCGS Test button with real API validation via `testPcgsKey()` (STAK-573)
- **Changed**: "Open Bulk Sync" button renamed to "Advanced Settings" (STAK-573)
- **Changed**: Bulk Sync modal consolidated from 4 tabs to 2 (Overview + Sync Settings), Activity tab removed (STAK-573)
- **Added**: "Sync Unsynced" button in Bulk Sync Overview tab (STAK-573)
- **Fixed**: Bulk Sync modal width constrained to ≤ Settings modal (STAK-573)
- **Added**: `.btn-action-primary` and `.btn-action-neutral` button color variants for action differentiation (STAK-573)
- **Fixed**: Metals.dev "Polls on cache TTL interval." leftover text removed (STAK-573)
- **Added**: Provider attribution footers to Metals-API and MetalPriceAPI spot cards (STAK-573)
- **Fixed**: Catalog History buttons now use `btn-history` class for consistent blue color (STAK-573)
- **Fixed**: Provider reinitialization after catalog key save to prevent stale credentials (STAK-573)

---

## [3.34.24] - 2026-04-23

### Changed — STAK-443: Settings Redesign — API tab sectioned card layout

- **Changed**: Replaced monolithic provider-tab panel with three `.settings-fieldset` cards — Market Prices, Spot Price, Catalog (STAK-443)
- **Changed**: Spot Price card uses single-select pill radio (`.gb-source-group`) with six options — StakTrakr, Metals.dev, Metals-API, MetalPriceAPI, Custom, Manual — replacing the fallback-chain priority system (STAK-443)
- **Added**: Manual spot-price mode — full offline replacement that disables all feed fetches and accepts direct Au/Ag/Pt/Pd inputs (STAK-443)
- **Added**: `spotPricingSource` localStorage key + idempotent migration from legacy `providerPriority` / `apiProviderOrder` (STAK-443)
- **Changed**: Numista + PCGS catalog UI reduced to two `.catalog-row` cards; bulk sync, field toggles, tag blacklist, and activity log moved to a dedicated Bulk Sync modal with 4 tabs (STAK-443)
- **Added**: Violet `.btn-history` button variant so History actions separate visually from Save/Test on `--bg-tertiary` cards (STAK-443)

---

## [3.34.23] - 2026-04-22

### Changed — STAK-446: Activity Log tab redesign and undo audit

- **Changed**: Activity Log sub-tabs renamed — "Metals" → "Spot Price", "Price History" → "Item History" (STAK-446)
- **Changed**: Activity Log sub-tabs reordered — Changelog, Catalogs, Cloud, Spot Price, Market, Item History, LBMA History (STAK-446)
- **Added**: Undo/redo support for "Added" changelog entries — undo removes the item, redo restores it from snapshot (STAK-446)
- **Fixed**: JSON.parse on redo path now guarded with try/catch for corrupted localStorage resilience (STAK-446)
- **Added**: 7 Playwright TDD tests covering tab rename, tab order, undo-add, and redo-add (STAK-446)

---

## [3.34.22] - 2026-04-22

### Changed — STAK-570: Currency tab Goldback pricing redesign

- **Changed**: Goldback pricing controls now live inside Settings > Currency — the separate Goldback sidebar tab and panel were removed (STAK-570)
- **Changed**: Goldback pricing source now uses a single Off / StakTrakr API / Estimate from Spot / Manual selector with contextual spot-modifier and manual-rate inputs (STAK-570)
- **Changed**: Denomination prices render as a read-only Currency-tab table with source labels, and stale async/manual updates are guarded when users switch pricing modes quickly (STAK-570)
- **Added**: Storage migration from legacy Goldback toggle booleans to `goldback-pricing-source`, with compatibility booleans still derived for existing code paths (STAK-570)
- **Added**: 7 Playwright tests covering the merged Currency-tab Goldback pricing flow and no-regression behavior (STAK-570)

---

## [3.34.21] - 2026-04-22

### Changed — STAK-439: Images tab redesign

- **Removed**: Storage fieldset from Images settings tab — redundant with Storage tab (STAK-439)
- **Added**: Collapse/expand trigger for Add Pattern Rule form — "+ New Rule" pill button toggles form visibility (STAK-439)
- **Added**: Styled upload buttons with image preview in dashed-border cards, replacing native file inputs (STAK-439)
- **Added**: Swap button to exchange obverse/reverse images in both Add and Edit forms (STAK-439)
- **Changed**: Image Display section uses flat 2-column grid layout without nested card borders (STAK-439)
- **Changed**: Edit form for custom pattern rules restyled to match Add form — cloud-provider-card, Keywords/Regex toggle, upload sides (STAK-439)
- **Changed**: Edit/Delete buttons in Custom Pattern Rules and Per-Item User Images use solid pill styling for proper dark mode contrast (STAK-439)
- **Added**: 11 Playwright E2E tests covering all Images tab redesign acceptance criteria (STAK-439)

---

## [3.34.20] - 2026-04-21

### Fixed — STAK-569: Numista search metal prepend removed

- **Fixed**: Numista search no longer auto-prepends the metal dropdown value to the name query — searches use exactly what the user typed (STAK-569)
- **Preserved**: Custom Numista pattern rules still fire when a match is found; raw fallback query uses the name field value without metal injection (STAK-569)
- **Added**: 5 Playwright tests covering the metal prepend bug fix and pattern rule fallback behavior (STAK-569)

---

## [3.34.19] - 2026-04-21

### Changed — STAK-564: Move Force Refresh to About tab as Troubleshooting card

- **Moved**: Force Refresh / App Updates control relocated from Settings > Inventory to Settings > About tab as a compact Troubleshooting card below the disclaimer (STAK-564)
- **Renamed**: Button label changed from "Force Refresh" to "Clear Cache & Reload" with plain-language copy explaining cache behavior (STAK-564)
- **Removed**: App Updates fieldset removed from Inventory tab — all app-level utilities now live on the About tab (STAK-564)

---

## [3.34.18] - 2026-04-20

### Changed — STAK-442: Move Data Reset buttons from Storage to Inventory tab

- **Changed**: "Remove Inventory" and "Wipe All Data" buttons moved from Settings > Storage to Settings > Inventory, placing all data management actions (import, export, backup, delete) in one tab (STAK-442)
- **Changed**: Data Reset layout flattened from nested card (`settings-card-grid > settings-card`) to flat `settings-fieldset` pattern, matching the Inventory tab's existing App Updates style (STAK-442)
- **Changed**: Storage tab is now pure read-only diagnostics — storage summary cards, localStorage keys table, and IndexedDB stores only (STAK-442)

---

## [3.34.17] - 2026-04-20

### Changed — STAK-437: Remove Search tab, consolidate into Filters & Search

- **Changed**: Removed the dedicated "Search" settings sidebar tab and its `settingsPanel_search` panel.
- **Changed**: Moved the Fuzzy autocomplete toggle into a new "Search Behavior" fieldset at the top of the Filters & Search tab.
- **Changed**: Moved the custom Numista Patterns add-form and table into a new "Numista Patterns" fieldset on the Filters & Search tab.
- **Changed**: Deleted the built-in seed rules system (`SEED_RULES` array, 6 seed functions, seed rule loop) from `numista-lookup.js`.
- **Changed**: Custom Numista patterns are now always-on — removed the `NUMISTA_SEARCH_LOOKUP` feature flag and its UI toggle.
- **Changed**: New users get an American Silver Eagle (Numista ID 1493) custom pattern pre-seeded on first load.
- **Changed**: Added 10 Playwright E2E tests in `tests/playwright/stak-437-search-tab-removal.spec.js` covering tab removal, fieldset placement, toggle persistence, pattern CRUD, and always-on rewriting.

---

## [3.34.16] - 2026-04-20

### Changed — STAK-436: Appearance tab realized toggle cleanup

- **Changed**: Moved the Realized G/L visibility control into the Appearance tab Layout card title row and switched it to the existing Yes/No chip toggle pattern for consistency with other settings controls.
- **Changed**: Removed the now-empty Summary Totals card and rewired the realized-row behavior to keep using the existing `showRealizedGainLoss` storage and cloud-sync paths.
- **Changed**: Added focused Playwright coverage in `tests/playwright/realized-toggle.spec.js` for toggle placement, row visibility, persistence, and Summary Totals removal.

---

## [3.34.15] - 2026-04-19

### Changed — STAK-562: Goldback and Silverback as first-class type

- **Changed**: Added dedicated `Goldback` and `Silverback` type options in Add/Edit/Bulk Edit flows and made them available to quick filters, grouped filters, and type chip controls.
- **Changed**: When metal is set to `Gold` or `Silver`, type options now include the corresponding backed note type (`Goldback`/`Silverback`) while preserving existing round filtering and default behavior.
- **Changed**: Inventory cards/table rows now show backed notes using an icon-first display pattern, and type chips are grouped with map aliases for `gb`, `sb`, `goldbacks`, and `silverbacks`.
- **Changed**: Added cross-flow regression coverage for STAK-562 in Playwright (`tests/playwright/goldback-type.spec.js`) to verify add/edit/filter/bulk-edit behaviors.

---

## [3.34.14] - 2026-04-19

### Added — STAK-558: Comma and semicolon delimiters in tag input

- **Added**: Tag input fields in edit modal and view modal now support comma (`,`) and semicolon (`;`) as delimiters. Type `Silver, Bullion, 2024` or `Silver; Bullion; 2024` and all three tags are added at once.
- **Added**: Empty tokens between delimiters are automatically skipped, and each token is trimmed of whitespace before adding.
- **Added**: Single-tag entry without delimiters behaves identically to before — no breaking changes.
- **Added**: Existing deduplication and max-tag limits apply per token, so bulk entry cannot bypass safety rules.

---

## [3.34.13] - 2026-04-19

### Changed — STAK-556: Cherry-pick Numista tags + respect your edits

- **Changed**: Numista picker now uses per-tag checkboxes, so each tag can be individually imported; blacklisted and removed tags stay unchecked by default.
- **Changed**: Manually edited scalar fields (name/year/type/weight/metal) now track as user-edited and default unchecked in Numista re-import, with an “✎ edited” indicator and override option.
- **Changed**: Tag-removal history is persisted and shown in export/cloud backup; re-sync can skip removed or manually edited items.

---

## [3.34.12] - 2026-04-19

### Added — STAK-556 + STAK-555: Numista picker tag checkboxes + userModified flag

- **Added**: Per-tag checkboxes in the edit-modal Numista search picker. When importing a Numista result, each tag now has its own checkbox — no more all-or-nothing tag import. Blacklisted tags default unchecked and dimmed, already-present tags show checked and disabled, and tags you've previously removed default unchecked with a "(removed)" hint. "Check all" / "Uncheck all" buttons respect locked states.
- **Added**: Scalar fields you've manually edited (name, year, type, weight, metal) now default to unchecked in the Numista picker with a "✎ edited" indicator. You can still force-override by re-checking — doing so clears the edit flag so Numista's value becomes canonical.
- **Added**: Tag removal tracking — when you remove a Numista tag from an item, the system remembers. Next time you search Numista for that item, the removed tag defaults to unchecked. Re-importing clears the tracking.
- **Added**: Bulk sync (Settings → API → Sync Metadata) now shows a confirmation dialog with an option to skip tags you've previously removed. The activity log reports which tags were preserved per item.
- **Added**: `itemRemovedTags` included in JSON/CSV export and cloud sync backup/restore.

---

## [3.34.11] - 2026-04-18

### Fixed — STAK-554: Remove redundant view-modal Numista re-sync picker + fix title entity double-escape

- **Fixed**: Opening an inventory item with a Numista catalog ID no longer auto-triggers a "Re-sync from Numista" field picker modal. The auto-invoke was introduced with STAK-126 (2026-02-26) and fired whenever the 30-day metadata TTL expired and the Numista API returned fresh data. Users could not dismiss the modal without clicking Apply or Cancel.
- **Fixed**: Item names containing quote characters (e.g., `1 Dollar "American Silver Eagle" New Reverse`) now render cleanly in the view modal. Previously rendered as literal `&quot;` due to `sanitizeHtml()` output being assigned to `.textContent`, which double-encoded the entities. `.textContent` is XSS-safe natively — the wrap has been removed.
- **Removed**: ~450 lines of dead picker code across `js/viewModal.js` and `js/field-meta.js`. Deleted symbols: `showResyncPicker`, `_resyncPickerShowMore`, `_FIELD_LABELS`, `_valuesMatch`, `_formatPickerValue`, `_buildFieldRow` (viewModal.js); `FIELD_TIERS`, `getFieldMeta`, `applyPickerSelections` (field-meta.js). Retained: `initFieldMeta`, `markUserModified` — still used by `catalog-api.js` and `events.js` respectively. Stored `numistaData` / `fieldMeta` fields on inventory items are untouched.
- **Unchanged**: Settings → API → "Sync Metadata" (batch sync) and Edit/Add → Numista search → "Fill Fields" (per-item) continue to work as the canonical sync paths.

---

## [3.34.10] - 2026-04-18

### Changed — STAK-553: Last Modified sort + sort bar in table view

- **Added**: `Last Modified` sort option in the live sort dropdown and Settings > Default Sort
- **Added**: `lastModified` ISO timestamp stamped on inventory items at create and edit time
- **Added**: Sort bar (`cardSortBar`) now visible in table view (D mode), not just card views
- **Changed**: `sortInventory()` handles new column 12; items without `lastModified` sort as oldest
- **Changed**: Selecting `Last Modified` auto-switches sort direction to descending (newest-first default)

---

## [3.34.09] - 2026-04-17

### Fixed — STAK-548 hotfix: revert shared-sqld-client refactor in home-poller

- **Fixed**: `dashboard.js` and `metrics-exporter.js` reverted to inline env-selection for sqld client creation. The `../shared/sqld-client.js` import failed at runtime because the home-poller Dockerfile flattens `shared/*.js` into `/app/` alongside the home-poller JS, so the relative `../shared/` path resolved outside `/app/` and hit `ERR_MODULE_NOT_FOUND` on container start. Containers were entering FATAL state after the v3.34.08 deploy.
- **Kept**: `shared/sqld-client.js` continues to serve `spot-extract.js` and `migrate-providers.js`, which live in `shared/` and import it as `./sqld-client.js` — that path works in both source tree and the flattened container layout.

---

## [3.34.08] - 2026-04-17

### Changed — STAK-548: Rename `TURSO_DATABASE_URL` → `SQLD_URL` in poller code

- **Changed**: Poller code now reads `SQLD_URL`/`SQLD_AUTH_TOKEN` for the local sqld database (home poller + remote poller via Tailscale). Legacy `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` remain as fallbacks so existing Portainer stacks keep working through rollout (STAK-548)
- **Changed**: `TURSO_BACKUP_URL`/`TURSO_BACKUP_TOKEN` remain distinct — those target the Turso Cloud DR backup used by `turso-backup-sync.js`, not local sqld (STAK-548)
- **Changed**: `.env` examples, `docker-compose.home.yml`, `docker-entrypoint.sh` cron, and remote poller run scripts updated to pass the new names alongside legacy fallbacks (STAK-548)

---

## [3.34.07] - 2026-04-17

### Fixed — STAK-517: Invalidate market filter cache after vault restore

- **Fixed**: Market filter matrix now reflects restored settings immediately after vault restore or cloud sync pull — no page reload required (STAK-517)
- **Fixed**: `restoreVaultData()` now calls `_invalidateMarketFilterCache()` to clear stale in-memory cache after writing `staktrakr.market_filter` to localStorage (STAK-517)

---

## [3.34.06] - 2026-04-17

### Fixed — STAK-551: Fix filter chip predicate logic

- **Fixed**: Scalar fields (metal, type, name, purchaseLocation, storageLocation) use OR within-field — Silver+Gold shows both metals (STAK-551)
- **Fixed**: Expansion chips (customGroup, dynamicName, groupedName) store single constraints and expand at predicate time — Florida chip no longer returns zero results (STAK-551)
- **Fixed**: Chip threshold honored when filters active — no more minCount=1 override flooding chip bar (STAK-551)
- **Changed**: `isMultiSelect` renamed to `isAccumulate` for clarity (STAK-551)

---

## [3.34.05] - 2026-04-16

### Fixed — STAK-546: Restore AND semantics to filter chip predicate

- **Fixed**: Restore AND semantics to filter chip predicate — selecting multiple chips intersects instead of unions (STAK-546)

---

## [3.34.04] - 2026-04-15

### Fixed — STAK-549: Cloud sync header button silent failure

- **Fixed**: Header cloud sync button no longer shows a false "Synced" toast when the vault password is not cached. `syncNow()` now returns `{ synced: boolean }` so the caller can distinguish success from abort. Password prompt modal appears correctly when needed; cancel shows "Cloud sync requires a vault password" instead of false success. (STAK-549)

---

## [3.34.03] - 2026-04-15

### Changed — STAK-544: Header cloud button sync or open settings

- **Changed**: Header cloud button now triggers a manual sync for configured users (green/ready states) or opens Settings → Cloud for setup users (orange/gray states). Replaced the previous dead-end "autosync disabled" toast behavior. Added `resolveHeaderCloudAction()` helper in `cloud-sync.js` to centralize state-to-action mapping. Added Playwright regression coverage for unconfigured, auto-sync-off, and auto-sync-on header cloud button states. (STAK-544)

---

## [3.34.02] - 2026-04-15

### Changed — STAK-545: Market button triggers refresh instead of opening Settings modal

- **Changed**: Header Market button now calls `syncRetailPrices()` (market data refresh) instead of opening the Market Settings panel. A new gear icon (`#marketSettingsBtn`) in the Market block vendor prices section provides direct access to Market settings, matching the existing refresh button visual pattern. (STAK-545)

---

## [3.34.01] - 2026-04-15

### Changed — STAK-445: Move FAQ below LOG in Settings

- **Changed**: Reordered the Settings modal sidebar so Log now appears immediately before FAQ. FAQ content, Activity Log content, and settings panel behavior remain unchanged. (STAK-445)

---

## [3.34.00] - 2026-04-15

### Changed — STAK-444: Cloud tab settings panel

- **Moved**: Dropbox and Cloud Sync Beta cards from System tab to dedicated Cloud tab in Settings modal. Created `settingsPanel_cloud` div — the Cloud nav button was already present but fell back to About due to the missing panel. All Dropbox connection, auto-sync, backup/restore, and advanced controls remain intact at their existing element IDs. Added `syncCloudUI()` call in `switchSettingsSection()` for the Cloud tab so connection state refreshes on navigation. (STAK-444)

---

## [3.33.99] - 2026-04-13

### Changed — STAK-538: Remove first-run acknowledgment modal

- **Removed**: First-run acknowledgment modal (`#ackModal`) — the Info tab and What's New popup already cover disclaimers and version announcements. Deleted 5 functions from `about.js` (`showAckModal`, `hideAckModal`, `acceptAck`, `populateAckModal`, `setupAckModalEvents`), removed `ACK_DISMISSED_KEY` constant, cleaned storage lookups, and deleted modal markup from `index.html`. First-time users now see the app immediately without friction. (STAK-538)

---

## [3.33.98] - 2026-04-12

### Added — STAK-529: Sort Direction Toggle in Settings

- **Added**: Asc/Desc sort direction toggle in Settings > Appearance, positioned horizontally next to the Default Sort Column dropdown. Uses existing `.chip-sort-toggle` / `.chip-sort-btn` CSS pattern. JavaScript listener already existed at `settings-listeners.js:663-678`; this adds the HTML markup it expects. Persists to localStorage via `DEFAULT_SORT_DIR_KEY`. Includes 7 Playwright tests covering toggle behavior, persistence, and default state. (STAK-529)

---

## [3.33.96] - 2026-04-11

### Added — STAK-521: Quarantine unresolved slugs

- **Fixed**: Three-plane asymmetry in market filter — unresolved slugs (metadata not yet landed from manifest) were hidden from the filter matrix UI but defaulted to enabled in the control plane, leaking into cards/ticker/table with raw-string labels users could not toggle off. Closed at the upstream chokepoint via new `_isSlugResolved` predicate in `getActiveRetailSlugs()`. Also removes redundant `displaySlugs` filter in `settings.js` and deletes the obsolete `_HIDDEN_SLUGS` hardcoded exclusion set. Latent fail-safe — historical trigger already retired by v2 API publisher refactor. (STAK-521)

---

## [3.33.95] - 2026-04-10

### Fixed — Cloud Sync Atomic Rollback on Settings Write Failure (STAK-526)

- **Fixed**: `_applyAndFinalize()` now atomically rolls back on settings write failure — inventory restored, `lastPull` not advanced, success toast suppressed. `ALLOWED_STORAGE_KEYS` guard added; earlier-written settings keys removed via compensating `localStorage.removeItem()` calls on failure (STAK-526)

---

## [3.33.94] - 2026-04-05

### Fixed — Catalog API Key Cloud Sync (STAK-533)

- **Fixed**: Numista API key and PCGS bearer token now sync across devices via cloud sync. `catalog_api_config` was missing from `SYNC_SCOPE_KEYS` — the root cause of recurring sync failures across STAK-519 and STAK-526
- **Fixed**: Misleading comment on `metalApiConfig` that incorrectly claimed it stored Numista/PCGS keys — it only stores spot provider keys
- **Added**: Catalog API key conflicts now appear in the merge diff modal under "API & Numista" group

---

## [3.33.93] - 2026-04-03

### Added — Shape-Aware Dimension Fields (STAK-528)

- **Added**: Shape-aware dimension fields — rectangular items (bars, ingots) show Length/Width instead of Diameter. Shape selector drives conditional field display. Numista API size field mapped by shape. Existing "LxW" diameter strings auto-migrated on edit
- **Changed**: View modal displays "105 x 74 mm" for rectangular items, "40.6 mm" for round items. Composite dimensions include thickness when available

---

## [3.33.92] - 2026-04-01

### Changed — Remove V1 API Dead Code + Dynamic Market Log Vendors (STAK-509)

- **Removed**: All v1 API code paths (USE_V2_API flag, v1 fetch blocks, v1 health checks, v1 URL constants) — v2 has been sole data source since v3.33.87
- **Removed**: `fetchStaktrakr15minRange()` function (zero callers, confirmed dead)
- **Fixed**: Market log tab (Settings > Activity Log > Market) now renders vendor columns dynamically from v2 manifest metadata instead of hardcoded APMEX/Monument/SDB/JM columns that went blank after v2 cutover
- **Changed**: Net reduction of ~486 lines across 7 JS files

---

## [3.33.91] - 2026-04-01

### Fixed — Cloud Sync API Key + StorageLocation Loop (STAK-519)

- **Fixed**: Accepting remote API keys in cloud sync merge no longer destroys them as `[object Object]` — whole-setting fallback now preserves raw strings
- **Fixed**: `_applyAndFinalize()` stringify guard prevents any future object-to-string coercion in localStorage writes
- **Fixed**: New items with blank storageLocation default to `""` instead of `"Unknown"`, breaking the infinite sync conflict loop
- **Fixed**: `_valuesEqual()` now treats `""`, `null`, and `undefined` as equivalent, preventing spurious sync conflicts on blank fields

---

## [3.33.90] - 2026-04-01

### Fixed — Simplify StakTrakr API Settings (STAK-518)

- **Fixed**: StakTrakr API cache settings no longer revert to 24h on page load — config reconstruction now forces cache to 0
- **Changed**: StakTrakr provider panel simplified to Enabled toggle + auto-refresh checkbox (removed dead cache, priority, metals, history controls)
- **Changed**: StakTrakr tab moved to first position in Settings > Market as the primary free built-in provider
- **Fixed**: Priority migration simplified — STAKTRAKR uses enabled/disabled model instead of ranked priority ordering

---

## [3.33.89] - 2026-03-29

### Added — Market Filter Matrix (STAK-515)

- **Added**: Settings > Market tab redesigned with checkbox filter matrix — enable/disable specific item/vendor combinations for ticker and vendor prices table
- **Added**: Metal pill tabs (All/Silver/Gold/Platinum/Palladium/Goldback) scope the filter matrix view
- **Added**: Row and column ALL toggles for bulk enable/disable with indeterminate state support
- **Added**: Filter consumption in ticker (`renderBestPriceTicker`) and vendor prices table (`_renderVendorTable`) — disabled items excluded from display and price calculations
- **Removed**: Legacy market price cards grid, search/sort/filter controls, and Sync Now button from settings (now on main page only)

---

## [3.33.88] - 2026-03-29

### Fixed — Ticker Duplication & Stale What's New (STAK-513)

- **Fixed**: Market ticker marquee duplicating into 4-5 stacked rows due to race condition in renderBestPriceTicker() — orphaned .ticker-track elements now swept on every finalize (STAK-513)
- **Fixed**: Removed redundant renderBestPriceTicker() call inside async \_renderVendorTable completion that was the primary trigger for the race (STAK-513)
- **Fixed**: Stale What's New content on Cloudflare-proxied deployments — SPA fallback returning HTML instead of 404 for deleted announcements.md now detected and bypassed (STAK-513)
- **Added**: CSS max-height safety clamp on .market-ticker to prevent visual overflow if ticker tracks accumulate (STAK-513)

---

## [3.33.87] - 2026-03-26

### Added — Market Data Module (STAK-504)

- **Added**: Best Price Ticker strip below spot cards showing cheapest vendor per coin with premium percentages (STAK-504)
- **Added**: Vendor Prices comparison table with metal tabs (Gold/Silver/Platinum/Palladium/Goldback), per-vendor prices, premium badges, and clickable buy links opening vendor product pages (STAK-504)
- **Added**: Market Detail Modal with TradingView Lightweight Charts 7-day spot history and per-vendor price comparison for any coin (STAK-504)
- **Added**: Vendor Prices and Best Price Ticker sections are toggleable and reorderable in Settings > Layout (STAK-504)

---

## [3.33.86] - 2026-03-22

### Fixed — What's New modal flash fix (STAK-500)

- **Fixed**: What's New modal no longer flashes old content before showing current announcements — loadAnnouncements() race condition eliminated (STAK-500)

---

## [3.33.84] - 2026-03-22

### Fixed — Market price fixes (STAK-498)

- **Fixed**: JM Bullion price extraction now uses column-aware eCheck/Wire parser first, preventing inflated Card/PayPal prices (STAK-498)
- **Fixed**: Goldback-g1 baseline reference no longer appears as a ghost card in market view (STAK-498)

---

## [3.33.83] - 2026-03-22

### Fixed — Intraday chart 24h hourly view (STAK-498)

- **Fixed**: Intraday charts now show exactly 24 hourly data points instead of 2-3 days of multi-day data with excessive dotted lines (STAK-498)
- **Fixed**: Dotted chart lines only appear for genuinely missing data (2+ consecutive hour gaps), not for normal hourly polling jitter (STAK-498)
- **Fixed**: Out-of-stock vendors excluded from intraday chart datasets — no more phantom lines for vendors with zero real prices (STAK-498)
- **Fixed**: API `readRecentWindows()` uses time-based 24h cutoff instead of row-count over-fetch spanning multiple days (STAK-498)

---

## [3.33.82] - 2026-03-22

### Removed — Remove decommissioned grid/card view code (STAK-473)

- **Removed**: Dead grid/card view rendering code from retail.js (~260 lines) — `_buildRetailCard()`, `_renderRetailSparkline()`, `_retailSparklines` Map, and grid branch of `renderRetailCards()` (STAK-473)
- **Removed**: `MARKET_LIST_VIEW` feature flag from constants.js — list view is now unconditional (STAK-473)
- **Removed**: Orphaned `.retail-card-footer` and `.retail-sparkline` CSS rules (STAK-473)

---

## [3.33.81] - 2026-03-21

### Added — Price bounds guard for retail poller (STAK-496)

- **Added**: Dynamic price bounds check in `writeSnapshot()` rejects vendor prices >+50% or <-30% of spot-based melt value — prevents data pollution from wrong product pages, multi-packs, and scraper failures (STAK-496)
- **Added**: Goldback baseline from `goldback-spot.json` G1 rate with gold spot fallback — denomination-aware for G1 through G50 (STAK-496)
- **Added**: Per-vendor `skip_bounds` exemption in `provider_vendors` table for legitimate outliers like limited edition Goldbacks (STAK-496)

---

## [3.33.80] - 2026-03-21

### Fixed — Chart daily average diverges from current price on volatile days (STAK-483)

- **Fixed**: 7-day trend chart and trend badge now use live vendor prices for today's data point instead of a running daily average — eliminates visible divergence from market card on volatile days (STAK-483)

---

## [3.33.79] - 2026-03-21

### Fixed — Cloud sync image vault erasure on cross-device push (STAK-497)

- **Fixed**: Cloud sync preserves image vault metadata when pushing device has no photos — prevents erasing uploaded images from other devices (STAK-497)
- **Fixed**: Inventory hash now includes content fingerprint (image URLs, numistaId, grade, disposition) — prevents silent poll skip when items have same keys but different field values (STAK-497)
- **Fixed**: Image vault push/pull now logs all outcomes (success, skipped, fail) to Activity Log — previously only failures were visible (STAK-497)

---

## [3.33.78] - 2026-03-21

### Fixed — Retail scraper consistency + OOS availability pipeline (STAK-475, STAK-495)

- **Fixed**: JM Bullion extraction removes "As Low As" fallback — volume discount prices (10-90% below retail) no longer recorded (STAK-475 P2)
- **Fixed**: Soft 404 detection for React SPAs — Monument Metals and similar sites now correctly flag OOS instead of scraping nav ticker spot prices (STAK-475)
- **Fixed**: Monument Metals header/nav spot tickers stripped before price extraction to prevent false matches (STAK-475)
- **Fixed**: Intraday chart carry-forward removed from API export — frontend `_forwardFillVendors()` now detects gaps and renders dashed lines for carried/stale prices (STAK-495-B)
- **Added**: OOS vendor indicators on retail cards — dimmed rows with strikethrough price and "(OOS)" label, sorted below in-stock vendors (STAK-495-C)

---

## [3.33.77] - 2026-03-21

### Fixed — Numista search on names with special characters (STAK-494)

- **Fixed**: Numista search now strips operator characters (hyphens, parentheses, quotes, plus) from queries before sending to the API — items with official Numista-style names like "1 Dollar - Charles III (1st Portrait - Australian Kookaburra)" no longer timeout or return empty results (STAK-494)

---

## [3.33.76] - 2026-03-21

### Fixed — Image thumbnail popover crash (STAK-492)

- **Fixed**: Image thumbnail popover now opens correctly — `safeGetElement` returns a dummy object (not null) when element is absent, so `_openThumbPopover` crashed calling `.remove()` on the dummy. Existence check now uses `document.getElementById` directly (STAK-492)
- **Fixed**: `createDummyElement()` now includes `.remove()`, `.dataset`, and `.classList` to prevent similar crashes in other callers

---

## [3.33.75] - 2026-03-21

### Fixed — Cloud sync field coverage (STAK-493)

- **Fixed**: Cloud sync now compares all item fields during diff — previously 15+ fields including image URLs, numistaId, year, grading, and disposition were silently dropped on matched items (STAK-493-A)
- **Fixed**: Manifest-first sync path now resolves full item objects from the vault instead of inserting stub items missing all fields except name (STAK-493-B)
- **Fixed**: changeLog manifest tracks all item fields to match diff engine coverage (STAK-493-A)

---

## [3.33.74] - 2026-03-21

### Fixed — Graceful SW update — auto-reload on cache miss

- **Fixed**: Network-first navigation prevents stale HTML after file-restructuring deploys (STAK-485)
- **Fixed**: Smart error recovery detects stale cache ReferenceErrors and auto-reloads instead of showing a scary error dialog (STAK-485)
- **Fixed**: Cloud sync guard prevents data corruption during SW cache transitions (STAK-485)

---

## [3.33.73] - 2026-03-20

### Fixed — Stored URLs as single source of truth for images

- **Fixed**: View modal no longer independently fetches images from Numista API — stored URLs and user uploads are the single source of truth for images everywhere (STAK-489)
- **Fixed**: Numista search "Fill Fields" now always writes image URLs when checkbox is checked, even when editing items with existing images (STAK-488)
- **Fixed**: Image URL input wrappers now become visible after Fill Fields, giving visual feedback that URLs were populated (STAK-488)

---

## [3.33.72] - 2026-03-20

### Fixed — Allow clearing Numista metadata fields

- **Fixed**: Numista metadata fields (KM Reference, country, denomination, etc.) can now be cleared and saved as empty — previously the `||` fallback chain treated empty strings as falsy and restored the previous value, making it impossible to delete incorrect data (STAK-487)

---

## [3.33.71] - 2026-03-18

### Added — Modularize large JS files: chart-utils, inventory split, convention migration

- **Added**: Shared chart utility library `js/chart-utils.js` with 6 exported functions — eliminates 11 duplicate `new Chart()` patterns across 7 files (STAK-484)
- **Changed**: Split `inventory.js` (4,504 → 1,744 lines) into 4 focused modules: `inventory-backup.js`, `inventory-import.js`, `inventory-table.js`, plus core (STAK-484)
- **Changed**: Migrated 53 `getElementById` → `safeGetElement`, 5 `localStorage` → `saveData`/`loadData`, 23 `var` → `const` across inventory and events files (STAK-484)
- **Changed**: All new modules use IIFE + `window.*` pattern — `file://` protocol continues to work

---

## [3.33.70] - 2026-03-18

### Added — Intraday trends, aggregation fixes, CF bypass hardening

- **Added**: Intraday trend toggle for Market Prices cards — pill button switches between current price and hourly % change (STAK-464)
- **Added**: Chart polish — dashed line segments for OOS vendors + 7-day Goldback baseline on spot charts (STAK-474)
- **Fixed**: aggregateWindows data merge — dropped UNIQUE constraint that caused data loss, upsert cache rows, 30-min consensus buckets carry forward vendor prices across windows (STAK-476)
- **Fixed**: Retail scraper CF bypass — Byparr before Firecrawl phase, JSON-LD price=0 treated as OOS, Camoufox shm_size 1g for shared memory (STAK-475)
- **Fixed**: Goldback cron staggered from :01 to :20 to avoid Fly.io overlap (STAK-477)
- **Changed**: Removed wiki/ after DocVault migration (STAK-471)
- **Changed**: CodeQL warnings cleanup — pre-existing issues resolved (STAK-460)
- **Changed**: Cache Intl.NumberFormat instances for faster rendering
- **Changed**: Reverse tabnabbing mitigation on all window.open() calls
- **Changed**: Vault-based issue tracking replaces Linear section

---

## [3.33.69] - 2026-03-11

### Fixed — STAK-470: Storage hygiene + silent settings-only sync merge

- **Fixed**: `disposedFilterMode` not registered in `ALLOWED_STORAGE_KEYS` — `cleanupStorage()` silently deleted the disposed filter preference on every page reload, resetting it to "hide" (STAK-470)
- **Fixed**: Raw `localStorage` calls for disposed filter in `events.js` replaced with `loadDataSync`/`saveDataSync` to follow project storage conventions (STAK-470)
- **Fixed**: Version upgrades that add new `SYNC_SCOPE_KEYS` no longer trigger a phantom DiffModal — one-sided settings key diffs (key exists on only one side) are now auto-merged silently during cloud sync polling, with a push scheduled to propagate local-only keys back to the remote (STAK-470)

---

## [3.33.68] - 2026-03-11

### Fixed — STAK-469: Catalog Data not saving for items without Numista number

- **Fixed**: Catalog Data fields (diameter, thickness, country, composition, shape, etc.) silently discarded on save for any item without a Numista number — removed overly aggressive early return in `parseNumistaDataFields()` that wiped all metadata when the N# field was empty, even for items that never had one (STAK-469)

---

## [3.33.67] - 2026-03-10

### Fixed — STAK-467: Phase 0 price extraction false positives

- **Fixed**: Strip `nav/header/footer` from page before capturing `innerText` in Phase 0 Playwright direct — prevents spot price tickers in site headers (e.g. Provident Metals gold ticker ~$5,320) from being matched instead of the actual product price (STAK-467)
- **Fixed**: Hero Bullion moved to Firecrawl path — Phase 0 plain text lacks pipe characters so `firstTableRowFirstPrice` always returns null, falling through to `firstInRangePriceProse` which matched the "As Low As" bulk discount price instead of the 1-unit table price (STAK-467)
- **Fixed**: Gainesville Coins moved to Firecrawl path — Phase 0 Playwright direct always times out (15s wasted per coin per run); Firecrawl succeeds reliably (STAK-467)

---

## [3.33.66] - 2026-03-10

### Fixed — STAK-462: Fix cf-clearance.js endpoint for Byparr sidecar

- **Fixed**: `cf-clearance.js` now calls Byparr's FlareSolverr-compatible `POST /v1` endpoint with correct hostname (`staktrakr-byparr:8191`) — previous version targeted the wrong sidecar type (`cf-clearance-scraper:5000`), causing all Byparr bypass attempts to fail with "fetch failed" (STAK-462)

---

## [3.33.65] - 2026-03-10

### Fixed — STAK-462: Byparr Phase 2 fallback for CF invisible challenge

- **Fixed**: Price scraper now triggers Byparr CF bypass when Firecrawl returns a 200 Cloudflare JS-challenge page (no price) — previously only fired on 403. Covers bullionexchanges and jmbullion invisible-challenge pattern (STAK-462)

---

## [3.33.64] - 2026-03-10

### Fixed — STAK-462: Switch Byparr to upstream GHCR image

- **Fixed**: Replaced vendored Byparr source build with `ghcr.io/thephaseless/byparr:latest` image pull — eliminates build-time Camoufox download and Docker multi-stage entrypoint issues (STAK-462)

---

## [3.33.63] - 2026-03-10

### Fixed — STAK-462: Switch CF bypass sidecar to Byparr

- **Fixed**: Replaced `xewdy444/cf-clearance-scraper` sidecar with `Byparr` (Camoufox Firefox engine) — better Cloudflare Bot Management evasion rate and correctly resolves GHCR pull auth issues (STAK-462)

---

## [3.33.62] - 2026-03-10

### Fixed — STAK-463: 7-Day Trend Chart Endpoint Spike Detection and Roll-Forward Drift

- **Fixed**: Endpoint spikes (day 0 / day 6) in the 7-day trend chart now caught by lookahead/lookback peer comparison (10% threshold), preventing anomalous first/last data points from distorting the chart (STAK-463)
- **Fixed**: Cross-vendor median guard lowered from 3 to 2 vendors for endpoint slots, with stricter 20% threshold, so sparse endpoint coverage no longer lets outliers slip through (STAK-463)
- **Fixed**: OOS carry-forward no longer drifts — when a vendor is out-of-stock but the scraper still returns a price, the last in-stock price is used as the carry anchor instead, keeping dotted lines flat (STAK-463)

---

## [3.33.61] - 2026-03-10

### Added — STAK-462: CF-Clearance-Scraper sidecar for home poller

- **Added**: CF-Clearance-Scraper Docker sidecar as Phase 2 fallback in home poller scraping pipeline — Cloudflare-blocked vendors (Bullion Exchanges, JM Bullion) now attempt a Zendriver-based cookie bypass before recording terminal 403 failures (STAK-462)

---

## [3.33.60] - 2026-03-08

### Fixed — STAK-457: ZIP Backup Restore Routes Through DiffModal

- **Fixed**: ZIP backup restore now routes through DiffModal for item and settings review instead of directly overwriting localStorage (STAK-457)

---

## [3.33.59] - 2026-03-07

### Added — STAK-455: DiffModal Settings Cards Rich Renderers

- **Added**: Five type-dispatch renderers (chip-strip, toggle-map, slug-chips, kv-pills, count-summary) replace opaque "N items" text with interactive chip strips for complex settings in DiffModal (STAK-455)
- **Added**: Per-element click-to-pick merge selection for settings arrays and objects — users can cherry-pick individual chip config, seed rules, and provider priorities (STAK-455)
- **Fixed**: `itemTags` UUID-to-tag mappings no longer leak into settings diff via cloud-sync, eliminating the massive "Other" category blob (STAK-455)

---

## [3.33.58] - 2026-03-07

### Added — STAK-454: DiffModal Item Cards

- **Added**: Item cards with bordered card layout, metal-colored image placeholders, and async image loading replace flat checkbox rows in DiffModal (STAK-454)
- **Added**: Click-to-pick field selection on modified items enabling granular merge control with visual local/remote highlighting (STAK-454)
- **Added**: "N fields changed" pill badge on modified item cards with expand/collapse toggle (STAK-454)
- **Changed**: Apply button count now reflects individual field selections, not just item-level selections (STAK-454)

---

## [3.33.57] - 2026-03-06

### Fixed — STAK-452: Australian Coin Slug Names in Market View

- **Fixed**: Kangaroo, Koala, and Kookaburra silver coins now display proper names instead of raw slug strings in Market view (STAK-452)

---

## [3.33.56] - 2026-03-06

### Added — STAK-451: DiffModal UX Overhaul

- **Added**: Summary dashboard with 4 clickable stat cards (Matched, Conflicts, Remote Only, Local Only) with scroll-to-section navigation (STAK-451)
- **Added**: Progress tracker bar for sync conflict resolution showing resolved/total count (STAK-451)
- **Added**: Per-item conflict cards with grouped field rows and click-to-pick local/remote resolution (STAK-451)
- **Added**: Settings category cards grouping 42 settings into 7 meaningful categories with human-readable labels and per-setting click-to-pick resolution (STAK-451)
- **Changed**: DiffModal widened from 640px to 860px desktop, full-screen on mobile/tablet (STAK-451)
- **Changed**: API keys masked in settings diff display — never shown in plain text (STAK-451)

---

## [3.33.55] - 2026-03-06

### Added — STAK-449: Dropbox Multi-Account UX

- **Added**: Connected Dropbox account email and display name now shown in the Cloud settings card below the status indicator (STAK-449)
- **Added**: "Switch Account" button disconnects the current Dropbox account and re-triggers OAuth with forced re-authentication so users can pick a different account (STAK-449)
- **Added**: "Sign out of Dropbox" helper link opens the Dropbox logout page in a new tab for clearing browser sessions (STAK-449)

---

## [3.33.54] - 2026-03-05

### Fixed — STAK-448: Dateless Items Sort as Oldest

- **Fixed**: Dateless items (blank/unknown purchase date) now sort as "infinitely old" — top when oldest-first, bottom when newest-first, instead of always pinned to bottom regardless of direction (STAK-448)

---

## [3.33.53] - 2026-03-05

### Fixed — STAK-431: Numista N# Search Image URL + Metal Auto-Population

- **Fixed**: Numista N# search now auto-populates obverse and reverse image URLs into inventory items — images appear immediately in table and card views without manual re-download (STAK-431)
- **Fixed**: Metal type is now auto-detected from Numista composition data and pre-selected in the form dropdown for gold, silver, platinum, and palladium items (STAK-431)
- **Added**: Field picker now shows Obverse Image, Reverse Image, and Metal checkboxes — users can opt out of any field before filling (STAK-431)

---

## [3.33.52] - 2026-03-05

### Fixed/Added — STAK-433/STAK-434: Market Controls Mobile Fix + Metal Filter Buttons

- **Fixed**: Mobile market view search bar crushed to 2 characters — added `flex-wrap` to controls row at mobile breakpoint (STAK-433)
- **Fixed**: Expand/Collapse button text flipped when typing in search — now resets to "Expand All" on every re-render (STAK-433)
- **Added**: Metal filter pill buttons (All/Silver/Gold/Goldback/Platinum/Palladium) in market list view header — filter by metal type with color-coded pills matching existing badge palette (STAK-434)
- **Added**: Mobile responsive pill layout with wrapping and touch-friendly sizing (STAK-434)

---

## [3.33.51] - 2026-03-05

### Fixed — STAK-430: Pre-ship Security Hardening

- **Fixed**: XSS vulnerability in settings pattern rule display — user-controlled item names now sanitized via `sanitizeHtml()` (STAK-430)
- **Fixed**: OAuth CSRF protection on localStorage relay path — state parameter validated before processing (STAK-430)
- **Fixed**: Sync flag leak — `_syncRemoteChangeActive` no longer gets stuck true when password prompt interrupts (STAK-430)
- **Changed**: Password-change overwrite confirmation now uses styled `appConfirm` modal instead of blocking `window.confirm` (STAK-430)
- **Changed**: Console output sanitized — removed cryptographic metadata (key lengths, password lengths, partial account IDs) from production logs (STAK-430)
- **Removed**: Dead sync modal code (~206 lines) — `showSyncUpdateModal` and `showSyncConflictModal` replaced by DiffModal in STAK-413 (STAK-430)
- **Fixed**: `package.json` version synced from stale `3.32.01` to match `APP_VERSION` (STAK-430)

---

## [3.33.50] - 2026-03-04

### Fixed — Spot Health Dot UX, 7-Day Trend, Timezone Formatting (STAK-429)

- **Fixed**: Spot health dot shows orange (syncing) instead of red on fresh installs when no sync data exists yet (STAK-408)
- **Fixed**: Spot health dot respects cache TTL — shows green when cached data is still valid, falls back to age-based coloring when expired (STAK-384)
- **Fixed**: 7-day retail trend now sorts history by date before comparing, fixing incorrect trend direction when array ordering is inconsistent (STAK-399)
- **Fixed**: Retail sync log Time column now respects user timezone preference via TIMEZONE_KEY, matching the pattern used in retail-view-modal (STAK-281)

---

## [3.33.49] - 2026-03-04

### Fixed — Import/Restore Completeness & Cloud Backup Photos (STAK-427)

- **Added**: "Include photos" checkbox in manual cloud backup — uploads encrypted image vault alongside inventory when checked; failure is non-fatal (STAK-427)
- **Added**: `window.CloudSync.isSyncActive()` read-only accessor for restore isolation guards (STAK-427)
- **Fixed**: ZIP restore and vault restore now blocked while cloud sync pull is active — shows warning toast instead of corrupting mid-sync state (STAK-427)
- **Docs**: Wiki updated with Snapshot Terminology table, ZIP restore destructiveness warning, and manual backup image gap callout (STAK-427)

---

## [3.33.48] - 2026-03-04

### Fixed — DiffModal Settings Fix & Empty-Diff Silent Pull (STAK-387)

- **Fixed**: DiffModal Apply button now correctly detects pending settings changes — was checking `.length` on an object instead of `.changed.length` (STAK-401, STAK-415)
- **Fixed**: DiffModal Apply handler now includes settings entries in selectedChanges, preventing settings from being silently dropped on restore (STAK-387)
- **Fixed**: Manifest-first pull returns silently when both item diff and settings diff are empty — no unnecessary vault download or DiffModal (STAK-417)

---

## [3.33.47] - 2026-03-04

### Changed — Sync Scope & Serialization (STAK-426)

- **Changed**: Expanded cloud sync scope from 8 to 44 keys — all user preferences, header button config, feature toggles, Numista/PCGS settings, provider order, and API credentials now sync across devices (STAK-426)
- **Fixed**: Manifest-first pull now compares and applies settings changes via DiffEngine, showing them in the DiffModal instead of silently skipping them (STAK-426)
- **Fixed**: Manifest-first pull now downloads and restores the image vault when the hash differs, instead of silently skipping photo sync (STAK-426)
- **Added**: Image deletion propagation — deleting all photos locally now removes the remote image vault so other devices don't restore deleted photos (STAK-426)

---

## [3.33.46] - 2026-03-04

### Fixed — Cloud Storage API Hardening (STAK-425)

- **Fixed**: Upload response validation — `cloudUploadVault()` now checks `.ok` on all four provider upload responses (Dropbox vault, Dropbox latest.json, pCloud, Box) and throws on failure instead of silently recording success (STAK-425)
- **Fixed**: Backup list pagination — `cloudListBackups()` now fetches all pages from Dropbox via `files/list_folder/continue`, returning partial results on pagination failure (STAK-425)
- **Fixed**: Disconnect cleanup — `cloudDisconnect()` now removes all 13 cloud state keys and cancels pending sync push, preventing stale sync metadata on reconnect (STAK-425)
- **Fixed**: Delete backup latest pointer — deleting the latest backup now updates remote `staktrakr-latest.json` to point to the next most recent, or deletes it if none remain (STAK-425)
- **Security**: Vault export credential exclusion — `collectVaultData('full')` now filters out OAuth tokens, vault password, and device-specific sync state via `VAULT_EXCLUDE_KEYS` constant (STAK-425)

---

## [3.33.45] - 2026-03-04

### Fixed — FAQ Cloudflare Cookie Disclosure (STAK-428)

- **Fixed**: FAQ now accurately discloses that Cloudflare may set a temporary infrastructure cookie (e.g. `__cf_bm`) for bot protection on the hosted site — previously claimed "No cookies" without distinguishing app code from CDN infrastructure (STAK-428)
- **Fixed**: FAQ technical detail section updated from "Does not: set cookies" to explicitly note the infrastructure cookie is safe to block (STAK-428)

---

## [3.33.44] - 2026-03-04

### Fixed — Data Portability Quickfixes (STAK-424)

- **Fixed**: `chipMaxCount` added to `ALLOWED_STORAGE_KEYS` — previously silently deleted by `cleanupStorage()` on every session (STAK-424)
- **Removed**: Dead `cloudBackupEnabled` flag, `MAX_LOCAL_FILE_SIZE` 2 MB limit, and `checkFileSize()` — import files of any size are now accepted, with QuotaExceeded toast as the safety net (STAK-424)
- **Added**: Storage Location and Tags columns to CSV export; `tags` array to JSON export — re-imports now preserve more data (STAK-424)
- **Fixed**: CSV import tag persistence deferred until user confirms — cancelling an import no longer leaves orphaned tags in localStorage (STAK-424)
- **Fixed**: ZIP image import now handles reverse-only user photos — previously dropped images with no obverse (STAK-424)

---

## [3.33.43] - 2026-03-04

### Fixed — Cloud Sync Storage Blowout and Import Race (STAK-421)

- **Fixed**: `restoreVaultData()` now compresses data before writing to localStorage — previously wrote raw vault payloads, causing metalSpotHistory (9 MB) to blow out localStorage quota on every sync pull (STAK-421)
- **Fixed**: Override imports (CSV/JSON) now cancel the debounced sync push — previously `saveInventory()` would trigger a push that overwrote remote vault with freshly imported local data (STAK-421)
- **Fixed**: `QuotaExceededError` in `saveData()` now shows a toast notification instead of silently logging to console (STAK-421)

---

## [3.33.42] - 2026-03-03

### Fixed — Full Backup for Sync Snapshots (STAK-419)

- **Fixed**: Pre-sync snapshots now contain the FULL encrypted backup (all localStorage keys) instead of a partial sync-scoped copy — previously only contained 8 keys (inventory + display prefs), causing ghost items and data corruption when restored (STAK-419)
- **Fixed**: Restore list now shows all backups (manual + sync) in a single flat list sorted newest first, each labeled "Manual" or "Sync" — previously showed partial sync files in a separate collapsible section (STAK-419)
- **Fixed**: Backup count badge shows total backup count instead of manual-only count (STAK-419)

---

## [3.33.41] - 2026-03-03

### Fixed — Cloud Backup Manual vs Sync Separation (STAK-419)

- **Fixed**: Auto-prune now only deletes sync snapshots (`pre-sync-*`), never user manual backups (`staktrakr-backup-*`) — previously pruned all backups indiscriminately causing data loss (STAK-419)
- **Fixed**: Restore list now shows only manual backups by default with sync snapshots in a collapsible section — previously flooded with identical sync metadata copies (STAK-419)
- **Fixed**: "Backup history" dropdown renamed to "Sync history" and now controls only sync snapshot retention, not total backup count (STAK-419)
- **Fixed**: Manual Backup button now always prompts for password via vault modal — previously silently reused the sync password cache (STAK-419)
- **Fixed**: Manual backups no longer update `cloud_last_backup` sync tracking state or cache the password for auto-sync use (STAK-419)
- **Added**: `MANUAL_BACKUP_PREFIX` and `SYNC_BACKUP_PREFIX` constants for filename-based backup type discrimination (STAK-419)

---

## [3.33.40] - 2026-03-03

### Changed — Simplify Market Price Display (STAK-404)

- **Removed**: Confidence score badges (e.g., "70%") from vendor chips on market cards and expanded card vendor rows — all vendors now display equally (STAK-404)
- **Removed**: Out-of-stock vendor styling — no more grayed-out rows, strikethrough prices, or "OOS" badges; vendors with valid prices display normally regardless of stock flag (STAK-404)
- **Added**: Median anomaly filter for market list vendor chips — vendors with prices deviating more than 40% from the median are silently excluded instead of shown with warnings (STAK-404)
- **Fixed**: Monument Metals false OOS detection — page nav "PRE-ORDER" text no longer triggers out-of-stock flag (STAK-404, StakTrakrApi)

---

## [3.33.39] - 2026-03-03

### Changed — Summary Bar Items + Weight (STAK-418)

- **Changed**: Item count and total weight now display in the portfolio summary bar (ITEMS/WEIGHT alongside Buy/Melt/Market/G/L) instead of a separate bottom footer — shows filtered/total format when filters active (e.g., 172/189), total weight in troy ounces for currently visible items (STAK-418)

---

## [3.33.38] - 2026-03-03

### Fixed — Sync Poll, Settings Sync, DiffModal (STAK-414, STAK-415, STAK-416, STAK-417)

- **Fixed**: Sync poll no longer triggers a pull when local inventory is newer than the remote vault — now compares `lastLocalModified` timestamp (set on every inventory save) against `remoteMeta.timestamp` and triggers a push instead, preventing the user's newly added items from appearing as deletions in the DiffModal (STAK-414)
- **Fixed**: DiffModal Apply button stays enabled when settings changes are pending even if all item checkboxes are unchecked — previously the button disabled with zero item selections, blocking settings-only apply (STAK-415)
- **Fixed**: Sync poll now compares both `inventoryHash` AND `settingsHash` — previously only checked inventory, causing settings-only changes (theme, chip config, etc.) to be silently swallowed on the receiving device (STAK-416)
- **Fixed**: "No changes detected" DiffModal no longer pops up when both inventories and settings are already in sync — empty diffs are now silently recorded without user interaction (STAK-417)

---

## [3.33.37] - 2026-03-03

### Changed — Remove Redundant Sync Update Dialog (STAK-413)

- **Changed**: Removed the "Sync Update Available" intermediate dialog (Accept Update / Push My Data / Not Now) — remote changes now go directly to the Review Sync Changes DiffModal for both conflict and non-conflict paths, completing the UX simplification started in STAK-412

---

## [3.33.36] - 2026-03-03

### Fixed — Cloud Sync Pull Root Cause + UX Cleanup (STAK-412)

- **Fixed**: Vault-first pull path now correctly extracts inventory from `remotePayload.data.metalInventory` (compressed dict of localStorage keys) instead of treating the payload dict as an inventory array — this was the root cause of DiffModal showing only deletions and zero additions, leading to empty inventory on Apply (STAK-412)
- **Fixed**: Remote settings extraction in vault-first path now reads sync-scoped keys from `remotePayload.data` (excluding metalInventory) instead of the empty `remotePayload.settings` field
- **Changed**: Removed redundant Sync Conflict dialog (Keep Mine / Keep Theirs / Skip) — remote changes now go directly to the Review Sync Changes DiffModal which shows the full item-level diff
- **Fixed**: Manifest-first count check now verifies `local + added - deleted == remote` instead of only checking for zero changes — catches incomplete diffs where the manifest changelog misses remote-only additions

---

## [3.33.35] - 2026-03-03

### Fixed — Sync DiffModal Apply Data Loss + Empty-Vault Dialog (STAK-409, STAK-410, STAK-411)

- **Fixed**: DiffModal Apply no longer empties the vault when the manifest-first diff shows only deletions — `_deferredVaultRestore` now falls back to full overwrite when selective apply would produce an empty result but the remote has items, preventing silent data loss when remote-only additions are missed by the local manifest (STAK-409)
- **Fixed**: Empty-vault push guard dialog now correctly calls `pullWithPreview()` on OK — the `showAppConfirm` call was using an old callback-style API, passing the callback as the `title` argument, causing the dialog heading to display `function () { pullWithPreview(); }` and OK to do nothing (STAK-410)
- **Fixed**: Double conflict modal prevented — pre-push check now sets `_syncRemoteChangeActive = true` before `await handleRemoteChange()` so a concurrent auto-poll that fires between the routing decision and the flag being set inside `handleRemoteChange` sees the flag and skips its own modal (STAK-411)

---

## [3.33.34] - 2026-03-03

### Fixed — Cloud Sync Push Race with DiffModal (STAK-406)

- **Fixed**: `pullWithPreview()` now awaits the user's DiffModal decision (Apply or Cancel) before returning — previously it returned immediately after showing the modal, clearing `_syncRemoteChangeActive` while the user was still reading the diff, allowing a concurrent `pushSyncVault()` call to overwrite Dropbox with stale local data before the pull was applied
- **Fixed**: `showRestorePreviewModal()` (vault-first path) now returns a Promise that resolves after the user completes the modal, so the vault-first pull is also fully awaited
- **Fixed**: `_deferredVaultRestore()` is now awaited in the manifest-first `onApply` callback before the modal Promise resolves, ensuring the full vault download and apply completes before any push can proceed

---

## [3.33.33] - 2026-03-03

### Fixed — Cloud Button and Settings Tab Always Visible (STAK-405)

- **Fixed**: Cloud header button is now always visible — removed the `!connected` early-return that hid the button when no OAuth token was stored, blocking access to cloud setup
- **Fixed**: Cloud tab in Settings is now always visible — removed the STAK-317 hide block that suppressed the nav item when no provider was connected; the gray dot state communicates "not connected" without hiding the UI entry point

---

## [3.33.32] - 2026-03-03

### Fixed — Keep Mine Conflict Resolution Infinite Loop (STAK-403)

- **Fixed**: `keepMineBtn.onclick` and "Push My Data" paths now set a one-shot `_syncConflictUserOverride` flag before calling `pushSyncVault()` — the pre-push Layer 0 check bypasses conflict re-detection exactly once, allowing the push to complete instead of looping back to `handleRemoteChange()`
- **Fixed**: `appConfirm` fallback conflict path also sets the override flag, covering the modal-less conflict resolution case

---

## [3.33.31] - 2026-03-03

### Fixed — Manifest-First Pull Shows Real Diff (STAK-402)

- **Fixed**: `pullWithPreview` manifest-first path now falls through to vault-first when manifest reports zero changes but remote item count differs from local — seeded/imported items have no changeLog entries, so the manifest was always empty for first-time sync
- **Fixed**: `DiffModal._onApply` passes `null` (not `[]`) when no diff items were shown, signaling callers to do a full restore rather than apply zero changes

---

## [3.33.30] - 2026-03-03

### Fixed — Bi-Directional Sync Fix (STAK-398)

- **Fixed**: Pre-push remote check — `pushSyncVault()` now checks remote metadata before pushing; if another device pushed since last pull, routes to `handleRemoteChange()` instead of silently overwriting
- **Fixed**: "Sync Now" button calls `syncNow()` (poll-then-push) instead of blind `pushSyncVault()`
- **Fixed**: `enableCloudSync()` polls for existing remote data before initial push, preventing second browser from overwriting first browser's data
- **Fixed**: `computeSettingsHash()` was using async `loadData()` without await — settings hash compared Promise objects instead of strings (now uses `loadDataSync`)
- **Fixed**: `pullWithPreview` vault-first path was using async `loadData()` without await for local settings comparison (now uses `loadDataSync`)

---

## [3.33.29] - 2026-03-03

### Fixed — Cloud Backup/Restore Pipeline Fix (STAK-398, STAK-382)

- **Fixed**: All 4 backup path functions now target `/StakTrakr/backups/` subfolder instead of root (STAK-398)
- **Fixed**: Backup history dropdown async/sync mismatch — was showing `[object Promise]` instead of saved value
- **Fixed**: Prune depth read async/sync mismatch — was getting `NaN` from Promise
- **Fixed**: Migration check async/sync mismatch — `loadData` → `loadDataSync` for `cloud_sync_migrated` flag
- **Fixed**: Conflict check reads `latest.json` from `/backups/` with legacy root fallback
- **Security**: Sync metadata file encrypted with AES-256-GCM, backward-compatible plaintext fallback (STAK-382)
- **Changed**: Cloud card restructured — auto-sync first, manual backup section with count badge, View Sync Log on main card
- **Changed**: Export button descriptions converted to native `title` tooltips
- **Changed**: `CLOUD_LATEST_FILENAME` promoted to `constants.js` global

---

## [3.33.27] - 2026-03-03

### Fixed — Documentation & Instruction Accuracy Cleanup (STAK-397)

- **Fixed**: Script count corrected from 67/57 to 70 across all instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, copilot-instructions.md)
- **Fixed**: Test runbook section names corrected in instruction files (03-backup-restore, 05-market, 08-spot-prices)
- **Fixed**: safeGetElement location corrected in GEMINI.md (js/init.js, not js/utils.js)
- **Fixed**: Stale StakTrakrWiki references replaced with in-repo wiki/ in 3 skill files
- **Fixed**: smoke-test spec inventory rebuilt — 123 tests across 19 spec files (was 27 across 8)
- **Fixed**: CORE_ASSETS count corrected in wiki/frontend-overview.md (57 to 76)
- **Fixed**: Skills list in CLAUDE.md updated to 25 entries (added sync-poller, wiki-nightwatch)
- **Removed**: 6 stale devops files (design-explorer.html, design-preview.html, firebase-debug.log, claude-backup/, screenshots/, test-results/)

---

## [3.33.25] - 2026-03-02

### Added — Browserbase Test Runbook v2 (STAK-396)

- **Added**: Modular test runbook at `tests/runbook/` — 75+ tests across 8 section files (01-page-load, 02-crud, 03-backup-restore, 04-import-export, 05-market, 06-ui-ux, 07-activity-log, 08-spot-prices)
- **Changed**: `/bb-test` skill rewritten as a runtime runbook reader — parses `tests/runbook/*.md` at run time, supports `sections=`, `tags=`, and `dry-run` filter flags, auto-discovers PR preview URL from `gh pr checks`
- **Changed**: `browserbase-test-maintenance` skill updated to point agents to `tests/runbook/*.md` instead of legacy TypeScript files
- **Added**: Manual execution guide — Chrome DevTools and Claude browser extension as $0 alternatives for 1-3 test verification (STAK-396)

---

## [3.33.24] - 2026-03-02

### Added — Backup Integrity Audit (STAK-374)

- **Added**: `exportOrigin` metadata to all export formats (CSV, JSON, vault) identifying the source app and version
- **Added**: Cross-domain import warning when importing data from a different StakTrakr instance
- **Added**: Pre-validation step in `importJson` and `importCsv` — checks structure before applying changes
- **Added**: DiffModal count header showing added/modified/deleted item counts with Select All toggle
- **Added**: Post-import summary banner showing import results (added, updated, skipped)
- **Fixed**: CSV import with `# exportOrigin:` comment header now uses PapaParse `comments: '#'` option to skip the comment line correctly
- **Fixed**: `const imported = []` reassignment crash in `importCsv` and `importJson` — changed to `let`
- **Fixed**: `showImportSummaryBanner` target element detection — switched from `safeGetElement` (truthy dummy) to `document.getElementById` for correct `||` fallback chain
- **Fixed**: `_toggleSelectAll` now explicitly deselects deleted items when entering added+modified-only mode

---

## [3.33.23] - 2026-03-02

### Added — Chip Max Count Setting (STAK-169)

- **Added**: `chipMaxCount` setting to cap the number of filter chips displayed in the chip bar — prevents overflow on small screens
- **Added**: `settingsChipMaxCount` selector in Settings panel to configure the cap (0 = unlimited)
- **Fixed**: Search-term chips excluded from the cap so they always render regardless of the limit

---

## [3.33.22] - 2026-03-02

### Fixed — Suppress Storage Error Modal for Intraday Cache (STAK-383)

- **Fixed**: `saveRetailIntradayData()` catch block now uses `debugLog` warn instead of `_handleSaveError`, suppressing user-visible Storage Error modal for non-critical 24h sparkline cache save failures (STAK-383)

---

## [3.33.21] - 2026-03-02

### Fixed — Disposed Items: Restore and View (STAK-388)

- **Fixed**: Three-state disposed filter replaces checkbox — Hide (default), Show All, Disposed Only with persistent selection and active-filter chip (STAK-388)
- **Fixed**: Changelog undo now correctly reverses disposition — previously set spurious `item['Disposed']` property instead of clearing `item.disposition` (STAK-388)
- **Fixed**: "Restore to Inventory" button added to view modal footer for disposed items (STAK-388)

---

## [3.33.20] - 2026-03-02

### Fixed — Market Panel Bug Fixes (STAK-389)

- **Fixed**: API-driven item names — all rendering paths now use `getRetailCoinMeta()` with manifest as source of truth, fallback parser corrected to denomination-first format (STAK-389)
- **Fixed**: Grid/list view sync status shows "just now" after sync, time-ago when lingering, "Sync error — prices may be stale" on API failure (STAK-389)
- **Fixed**: Activity log dropdown dynamically populated from API manifest instead of hardcoded HTML (STAK-389)

---

## [3.33.19] - 2026-03-01

### Added — DiffMerge Integration: Selective Apply for Cloud Sync and Vault Restore (STAK-190)

- **Added**: `_applyAndFinalize()` shared post-apply helper consolidating backup, inventory assignment, settings apply, save/render, pull metadata, toast summary, status indicator, and tab broadcast
- **Changed**: Cloud sync vault-first pull uses DiffModal for selective apply instead of full overwrite via `restoreVaultData()`
- **Changed**: Cloud sync manifest-first pull passes user selections through `_deferredVaultRestore()` for selective apply after vault download
- **Changed**: Encrypted vault restore (.stvault) shows DiffModal preview with item and settings diffs — users choose which changes to accept
- **Added**: E2E Playwright tests for selective apply paths covering CSV import deselection, vault restore preview, and DiffModal callback structure

---

## [3.33.18] - 2026-03-01

### Added — Diff/Merge Architecture Foundation (STAK-184)

- **Added**: `SYNC_MANIFEST_PATH` and `SYNC_MANIFEST_PATH_LEGACY` constants for encrypted change manifest storage
- **Added**: `manifestPruningThreshold` storage key for configurable manifest entry retention
- **Added**: `diffReviewModal` HTML scaffold — reusable change-review modal for sync, CSV import, and JSON import
- **Added**: `diff-modal.js` script load order and service worker cache registration

---

## [3.33.17] - 2026-02-28

### Added — Realized Gains/Losses — Item Disposition (STAK-72)

- **Added**: Disposition workflow — mark items as Sold, Traded, Lost, Gifted, or Returned via glassmorphic modal
- **Added**: Realized gain/loss calculation based on disposition amount vs purchase cost
- **Added**: Disposition badge on table rows and card views with type-specific color coding
- **Added**: Disposed items shown with reduced opacity and strikethrough styling
- **Added**: Show/Hide Disposed toggle in filter controls (hidden by default)
- **Added**: Disposition details section in View Item modal with full transaction history
- **Added**: Undo Disposition action to restore items to active inventory
- **Added**: Portfolio summary cards show disposed item count and realized gain/loss per metal
- **Added**: CSV export includes Disposition Type, Disposition Date, Disposition Amount, and Realized G/L columns

---

## [3.33.16] - 2026-02-28

### Added — Clone Mode Redesign + Edit Modal UX (STAK-375)

- **Changed**: Clone button now activates clone mode on the edit modal with field-level checkboxes instead of opening a separate modal
- **Changed**: Edit modal sections are now always visible (non-collapsible) for easier scrolling
- **Changed**: Purchase Date N/A is now a toggle button matching the spot lookup button style
- **Removed**: Numista image refresh button (unused, cluttered UI)
- **Added**: Save & Clone Another button for creating multiple clones in one session

---

## [3.33.15] - 2026-02-28

### Added — Beta Domain Toast (STAK-376)

- **Added**: Environment badge (BETA / PREVIEW / LOCAL) next to app logo on non-production domains
- **Added**: One-time session toast explaining data isolation between origins (e.g. beta vs production)
- **Added**: Domain detection for `beta.staktrakr.com`, `*.pages.dev`, `localhost`, and `file://` protocol

---

## [3.33.14] - 2026-02-28

### Fixed — Goldback G½ Slug Resolution (STAK-373)

- **Fixed**: Goldback G½ slugs (`ghalf`) now resolved correctly on market page — regex and weight map accept both `ghalf` and `g0.5` formats (STAK-373)

---

## [3.33.13] - 2026-02-28

### Added — Market Page Phase 2: Manifest-Driven Coins & Goldback Vendor (STAK-371)

- **Added**: Manifest-driven coin discovery — API can add new coins without frontend code changes (STAK-371)
- **Added**: 3-tier metadata resolution chain: manifest → hardcoded → goldback slug parser → default
- **Added**: Goldback vendor chip on market cards showing goldback.com reference price with staleness indicator
- **Added**: `GOLDBACK_WEIGHTS` table and `_parseGoldbackSlug()` for auto-deriving metadata from any goldback slug
- **Added**: `getActiveRetailSlugs()`, `getRetailCoinMeta()`, `getVendorDisplay()` resolver functions
- **Changed**: All rendering functions use resolver layer instead of direct constant lookups

---

## [3.33.12] - 2026-02-28

### Fixed — Version Drift Correction

- **Fixed**: Version number corrected to v3.33.12 — PR #591 (v3.33.11) merged before PR #590 (v3.33.10), reverting the version number

---

## [3.33.10] - 2026-02-28

### Added — Mobile Long-Press Spot Price Entry (STAK-285)

- **Added**: Long-press (600ms) on spot price card opens inline manual input on mobile/touch devices, mirroring desktop Shift+click behavior (STAK-285)
- **Changed**: Hint text updated from "Shift+click" to "Shift+click or long-press" for discoverability

---

## [3.33.11] - 2026-02-28

### Fixed — Spot Price Card Label Root Cause (STAK-274)

- **Fixed**: Spot timestamp label now compares raw storage data (provider+timestamp) instead of rendered HTML to detect when cache and API are identical, correctly showing "Last API Sync" when cache is disabled

---

## [3.33.09] - 2026-02-28

### Fixed — Spot Price Card Cache Label (STAK-274)

- **Fixed**: Spot price card shows "Last API Sync" directly when cache is disabled (duration=0) or when cache and API timestamps are identical, instead of misleading "Last Cache Refresh" label

---

## [3.33.08] - 2026-02-28

### Fixed — Vendor Medal Ranking

- **Fixed**: Vendor medals now awarded to all in-stock vendors with a price, not just those with confidence >= 60 (STAK-370)

---

## [3.33.07] - 2026-02-28

### Added — Oklahoma Goldback G1 on Market Page

- **Added**: Oklahoma Goldback G1 (`goldback-oklahoma-g1`) on market prices page with APMEX and Hero Bullion vendor tracking (STAK-370)
- **Added**: Goldback vendor display name, brand color, and homepage URL in retail vendor config (STAK-370)

---

## [3.33.06] - 2026-02-27

### Added — Market Page Redesign Phase 1

- **Added**: Market list view with full-width card layout — CSS Grid responsive at desktop/tablet/mobile breakpoints, metal accent border, image placeholders (STAK-369)
- **Added**: Inline 7-day trend charts per card with Chart.js — spike detection (two-pass temporal + cross-vendor median), dashed interpolation for gaps, OOS carry-forward pricing (STAK-369)
- **Added**: Vendor price chips with color-coded brand labels, medal rankings for best prices, OOS strikethrough styling (STAK-369)
- **Added**: Computed MED/LOW/AVG stats row with live vendor + history fallback (STAK-369)
- **Added**: Card click-to-expand chart interaction, functional search filtering, sort by name/metal/price/trend (STAK-369)
- **Added**: Enabled by default — disable with `?market_list_view=false` URL parameter (STAK-369)
- **Added**: Sponsor badge with GitHub Sponsors link in market footer (STAK-369)
- **Fixed**: Reverse tabnabbing protection on vendor links — `popup.opener = null` + `noopener,noreferrer` (STAK-369)
- **Fixed**: Chart.js canvas color rendering — hex value instead of CSS `var()` (STAK-369)
- **Fixed**: Chart.js `maxTicksLimit` option (was silently ignored `maxTicksToShow`) (STAK-369)
- **Fixed**: Accessibility — `aria-label` on market search input (STAK-369)
- **Fixed**: Mobile breakpoint — stats column spans full width at 767px (STAK-369)

---

## [3.33.05] - 2026-02-27

### Fixed — Daily Maintenance: Search Cache, Dead Code Cleanup

- **Fixed**: Search cache upgraded from string to object — caches formatted date to avoid re-parsing on every keystroke. Formatted date now included in multi-word search text (STAK-368)
- **Removed**: Dead `downloadStorageReport()` function (62 lines, zero callers) from utils.js (STAK-368)
- **Removed**: Duplicate `window.MAX_LOCAL_FILE_SIZE` export from utils.js — already exported from constants.js (STAK-368)

---

## [3.33.04] - 2026-02-27

### Fixed — Quick-Fix Batch (NGC Lookup, Fractional Oz, Cloud Sync Reorder)

- **Fixed**: NGC cert lookup link now extracts numeric grade only — e.g. "65" instead of "MS 65 CAM" (STAK-357)
- **Fixed**: Fractional troy ounce weights display as "0.25 oz" instead of auto-converting to grams (STAK-361)
- **Added**: Cloud Sync button registered in reorderable header system — toggle and reorder via Settings (STAK-365)

---

## [3.33.03] - 2026-02-27

### Fixed — Announcements Cleanup

- **Fixed**: Removed stale v3.32.44/v3.32.45 entries from What's New — these were pre-release patches already rolled into v3.33.00
- **Fixed**: Removed completed "Numista Field Origin Tracking" from roadmap — shipped in v3.33.01
- **Fixed**: Restored "Cloud Backup Conflict Detection (STAK-150)" to roadmap as next priority

---

## [3.33.02] - 2026-02-27

### Added — Cloud Sync Safety Overhaul

- **Added**: Empty-vault push guard — blocks syncing 0-item vault over populated cloud data, offers pull instead (STAK-295)
- **Added**: Cloud-side backup-before-overwrite — copies existing vault to /backups/ before every sync push
- **Added**: Dropbox folder restructuring — /sync/ and /backups/ subfolders with automatic migration from flat layout
- **Added**: Enhanced manifest schema v2 — inventory hash, metals summary, vault size for efficient change detection
- **Added**: DiffEngine restore preview modal — full field-level diff before applying remote sync updates (STAK-190)
- **Added**: Configurable backup history depth — Settings dropdown (3/5/10/20, default 5) with auto-prune
- **Added**: Multi-tab sync guard — BroadcastChannel leader election prevents concurrent sync from multiple tabs (STAK-360)

---

## [3.33.01] - 2026-02-27

### Added — Numista Search Overhaul

- **Added**: Per-field origin tracking (fieldMeta) — tracks whether each field came from Numista, PCGS, CSV import, or manual entry (STAK-363)
- **Added**: Two-tier re-sync picker modal with diff hints and smart pre-check defaults based on field origin (STAK-345)
- **Added**: Independent tag blacklist with Settings UI management, separate from chip grouping blacklist (STAK-354)
- **Added**: Auto-apply Numista tags toggle — global setting with per-action override in re-sync picker (STAK-346)
- **Added**: Backup export/import now includes numistaData and fieldMeta for complete round-trip preservation (STAK-362)

---

## [3.33.00] - 2026-02-26

### Added — Cloud Sync Overhaul, Image Pipeline, Numista Integrity, Menu UX, Retail Charts

- **Added**: Unified encryption mode for cloud sync — zero-config for most users, ambient header status icon, configurable idle timeout
- **Added**: 24h retail intraday chart with 30-min buckets, vendor carry-forward, two-pass anomaly filtering, OOS badges
- **Added**: Kilogram (kg) and pound (lb) weight units with automatic troy ounce conversion
- **Added**: Reorderable header buttons with show-text toggle, health status dots on Sync/Market buttons
- **Changed**: Removed `coinImages` IDB cache — CDN URLs are now the sole Numista image source, dynamic IndexedDB quota
- **Changed**: Overhauled `.gitattributes` export-ignore — release ZIP contains only runtime files (~4.5MB)
- **Fixed**: N#/image/metadata re-population after edit+save, image cross-contamination between items
- **Fixed**: Per-item Numista tag deletion, tags visible in edit modal and card view
- **Security**: Sentinel tabnabbing hardening on all external links, OAuth CSRF/PKCE improvements

---

## [3.32.45] - 2026-02-26

### Added — Filter Anomalous Vendor Price Spikes from 24h Retail Chart

- **Added**: Two-pass anomaly detection in 24h retail chart — temporal spike detection (before/after ±5% neighbor consensus) nulls single-window spikes, cross-vendor median (>40%) as safety net (STAK-325)
- **Added**: Anomalous table cells shown with line-through styling for visual distinction
- **Added**: `RETAIL_SPIKE_NEIGHBOR_TOLERANCE` (0.05) and `RETAIL_ANOMALY_THRESHOLD` (0.40) constants for configurable sensitivity

---

## [3.32.44] - 2026-02-25

### Added — Kilo and Pound Weight Units

- **Added**: Kilogram (kg) and pound (lb) weight units in add/edit/bulk-edit dropdowns (STAK-338)
- **Added**: Eager conversion to troy ounces on save with reverse conversion for display — follows existing gram pattern
- **Fixed**: Weight tooltip in inventory table now uses explicit unit lookup instead of `weight < 1` heuristic
- **Fixed**: Card view weight chip now uses `formatWeight()` for correct unit display across all 5 unit types

---

## [3.32.43] - 2026-02-25

### Fixed — Numista Tag Rendering + Per-Item Tag Deletion

- **Fixed**: Numista tags now visible in edit modal — `numistaTagsChips` and `customTagsChips` containers populated with removable tag chips when editing an item (STAK-343)
- **Fixed**: Tags now display as chips in card view (all 3 card styles A/B/C), matching the existing table inline behavior (STAK-343)
- **Fixed**: All tags (including Numista-applied) are now removable per-item via `×` button — previously Numista tags were locked as read-only with no delete path (STAK-344)

---

## [3.32.42] - 2026-02-25

### Fixed — Pattern Rule Promotion Bug

- **Fixed**: "Apply to all matching items" now correctly promotes images to a pattern rule even when the item was saved previously — reads from existing per-item IDB record when no pending upload blobs are in memory (STAK-339-followup)
- **Fixed**: Promoting to a pattern rule now removes the per-item `userImages` IDB record (avoids duplicate storage)

---

## [3.32.41] - 2026-02-25

### Changed — Image Pipeline Simplification

- **Removed**: `coinImages` IDB cache layer — CDN URLs on inventory items are now the sole Numista image source, eliminating the root cause of STAK-309/311/332/333/339 image bugs (STAK-339)
- **Removed**: `numistaOverridePersonal` settings toggle — no longer meaningful without cached blobs to prioritize
- **Removed**: CDN blob export/import from ZIP backup — CDN images are URLs, not local blobs
- **Simplified**: Image resolution cascade is now: user upload → pattern image → CDN URL → placeholder

---

## [3.32.40] - 2026-02-25

### Fixed — Numista Image Race Condition

- **Fixed**: Numista images now appear in table/card views immediately after applying — cacheImages re-renders on completion instead of fire-and-forget (STAK-337)

---

## [3.32.39] - 2026-02-25

### Fixed — Image Bug Fixes + API Health Refresh

- **Fixed**: `resyncCachedEntry()` and bulk image cache no longer write CDN URLs back to inventory items — IDB cache is the correct storage location (STAK-333)
- **Fixed**: Remove button now clears hidden URL input fields so deleted CDN URLs don't persist on save (STAK-308)
- **Added**: Per-item "Ignore image pattern rules" checkbox — prevents pattern rule images from reappearing after explicit removal (STAK-332)
- **Fixed**: Remaining image cross-contamination paths plugged by CDN writeback removal + pattern opt-out (STAK-311)
- **Fixed**: API health badge no longer shows stale data due to service worker caching — cache-busting query param defeats SW match (STAK-334)

---

## [3.32.38] - 2026-02-25

### Added — Home Poller SSH Skill + Skill Updates

- **Added**: `homepoller-ssh` skill — SSH reference for direct access to the home poller VM (192.168.1.81) via `stakpoller` user with NOPASSWD sudo
- **Changed**: `repo-boundaries` skill — fixed IP (192.168.1.48 → 192.168.1.81), replaced stakscrapr Claude delegation with SSH commands, corrected tinyproxy port (8889 → 8888)
- **Changed**: `retail-poller` and `api-infrastructure` skills — added SSH diagnostic references for home VM
- **Changed**: CLAUDE.md — added home poller SSH quick reference and `homepoller-ssh` to skills list

---

## [3.32.37] - 2026-02-25

### Changed — Wiki-First Documentation Policy

- **Changed**: StakTrakrWiki declared as sole source of truth; Notion infrastructure pages deprecated — do not update them
- **Changed**: `docs/devops/api-infrastructure-runbook.md` deprecated with banner; wiki pages `health.md`, `fly-container.md`, `spot-pipeline.md` are now authoritative
- **Added**: `wiki-search` skill for indexing and querying StakTrakrWiki via `mcp__claude-context__search_code` with `path: /Volumes/DATA/GitHub/StakTrakrWiki`
- **Changed**: `mcp__claude-context__search_code` documented in CLAUDE.md for both code and wiki search
- **Changed**: `finishing-a-development-branch` skill updated with mandatory Wiki Update Gate before PR creation
- **Changed**: AGENTS.md, GEMINI.md, copilot-instructions.md updated with Documentation Policy section

---

## [3.32.36] - 2026-02-25

### Fixed — STAK-309/STAK-311: Numista Data Integrity

- **Fixed**: Numista image URLs no longer re-populate after being cleared in the edit form — removed stale `oldItem` fallback from the save path (STAK-309)
- **Fixed**: Clearing the N# field now also wipes all associated Numista metadata (country, denomination, etc.) instead of silently preserving it (STAK-309)
- **Fixed**: CDN backfill on page load removed — URLs were being re-applied from catalog cache on every reload, undoing deliberate clears (STAK-309)
- **Fixed**: Numista images no longer cross-contaminate between items — view modal no longer mutates the live inventory item object (STAK-311)
- **Changed**: N# field removed from custom pattern rules edit form — Numista lookup for pattern rules is handled via the pattern replacement query, not a direct catalog ID (STAK-306)
- **Added**: "Purge Numista URLs" button in Settings → Images — removes all CDN image URLs from inventory items without touching user uploads or pattern rule images (STAK-312)

---

## [3.32.35] - 2026-02-24

### Added — STAK-320: Header Buttons Reorder & Apply to Header

- **Added**: Checkbox + arrow reorder table for header buttons in Settings → Appearance → Header Buttons; toggle visibility and reorder with ↑/↓ arrows (STAK-320)
- **Added**: Order persists to `headerBtnOrder` in localStorage and is applied both to the settings table and the live app header (STAK-320)

---

## [3.32.34] - 2026-02-24

### Added — STAK-324: Force Refresh button

- **Added**: Force Refresh button in Settings → System → App Updates — unregisters all service workers and reloads to fetch the latest version from the network; inventory data is not affected (STAK-324)

---

## [3.32.33] - 2026-02-24

### Fixed — STAK-303: 7-day sparklines straight line on fresh load

- **Fixed**: 7-day sparklines now draw a full curved historical line on fresh load by extending the automatic hourly backfill from 24 h to 7 days when no recent hourly data is present — seed bundle LBMA data can lag ~9 days, leaving the 7-day window empty (STAK-303)

---

## [3.32.32] - 2026-02-24

### Added — STAK-316: Cloud backup file type label

- **Added**: File type label ("Inventory backup" / "Image backup") in each cloud backup row, derived from filename — makes it easy to distinguish between `.stvault` inventory and image backup files at a glance (STAK-316)

---

## [3.32.31] - 2026-02-24

### Removed — STAK-321: Dead code cleanup

- **Removed**: `generateItemDataTable()` from `js/utils.js` — zero call sites remaining after PR #490 removed its only caller `createStorageItemModal` (STAK-321)

---

## [3.32.30] - 2026-02-24

### Added — STAK-314: Menu Enhancements

- **Added**: Trend period labels (e.g. "90d") on spot card headers that update in sync with the trend cycle button (STAK-314)
- **Added**: Health status dots on Sync and Market header buttons reflecting spot and market data freshness — green < 60 min, orange < 24 hr, red > 24 hr (STAK-314)
- **Added**: Vault and Restore header buttons (shown by default; can be hidden in Settings → Header Buttons) that open Settings → System for backup/restore (STAK-314)
- **Added**: Show Text toggle in Settings → Header Buttons that displays icon labels beneath all header buttons (STAK-314)
- **Added**: `flex-direction: column` layout on header buttons for uniform sizing and show-text mode support (STAK-314)

---

## [3.32.29] - 2026-02-24

### Added — Parallel Agent Workflow Improvements

- **Added**: Claims-array version lock replaces binary lock — multiple agents can now hold concurrent patch versions without blocking each other (supports parallel agent development)
- **Added**: Brainstorming skill project override with Phase 0 worktree gate — prevents implementation starting outside a `patch/VERSION` worktree
- **Added**: `devops/version-lock-protocol.md` updated with full claims-array protocol, parallel agent example, and prune-on-read TTL rules

---

## [3.32.27] - 2026-02-23

### Added — Image Storage Expansion — Dynamic Quota, Split Gauge, sharedImageId Foundation (STAK-305)

- **Added**: Dynamic IndexedDB quota via `navigator.storage.estimate()` — replaces hardcoded 50 MB cap; adapts to 60% of available disk space (min 500 MB, max 4 GB)
- **Added**: Persistent storage request on first photo upload — prevents browser from silently evicting user images
- **Added**: Split storage gauge in Settings → Images → Storage — separate rows for Your Photos vs. Numista Cache, each with progress bar and byte count
- **Added**: `sharedImageId` field on `userImages` records and `obverseSharedImageId`/`reverseSharedImageId` on inventory items — foundation for future image reuse across items

---

## [3.32.26] - 2026-02-23

### Fixed — Storage Quota, Chrome Init Race, Numista Data Integrity

- **Fixed**: `retailIntradayData` capped at 96 windows per slug — prevents localStorage quota overflow for users with large collections or many item images (STAK-300)
- **Fixed**: Chrome initialization race — "Cannot access 'inventory' before initialization" error on page refresh no longer appears (STAK-301)
- **Fixed**: Numista N# and photos no longer repopulate after being deleted from an item — `syncItem` now respects explicitly-cleared fields (STAK-302)
- **Fixed**: Numista serial→catalogId mapping cleared on save when N# is removed — stale mappings no longer cause cross-item data bleed (STAK-302)

---

## [3.32.25] - 2026-02-23

### Added — Vendor Price Carry-Forward + OOS Legend Links (STAK-299)

- **Added**: `_forwardFillVendors` — post-bucketing enrichment pass that fills vendor gaps with the most recent known price, annotating each window with `_carriedVendors: Set`
- **Added**: 24h chart carries forward vendor prices — carried data points render with `~` tooltip prefix and a muted/dashed dataset line; trend glyphs suppressed for carried entries
- **Added**: "Recent windows" table carries forward vendor prices — gap windows show `~$XX.XX` in muted italic with no trend glyph
- **Added**: OOS vendors shown in coin detail legend as clickable links — opens product page popup, `opacity: 0.5`, strikethrough last-known price, `OOS` badge in red
- **Fixed**: Vendor legend was hidden for coins where all vendors are currently OOS — `hasAny` guard now includes availability feed check

---

## [3.32.24] - 2026-02-23

### Fixed — Cloud Sync Reliability

- **Fixed**: Vault-overwrite race condition — debounced startup push could overwrite remote vault during conflict resolution, causing "Keep Remote" to silently discard the other device's changes. Both devices must be on v3.32.24+ for the race to be fully closed.
- **Fixed**: `getSyncPassword()` fast-path incorrectly gated on a plain localStorage read, breaking Simple-mode migration path on page reload.
- **Fixed**: Manual Backup button now reads cached localStorage password on page reload — no re-entry required after refresh.
- **Fixed**: Two bare `pullSyncVault()` calls in conflict modal had no `.catch()` — silent unhandled rejections on no-token pull failures now surface as status indicator errors.
- **Fixed**: `changeLog` IIFE parse failures now emit `console.warn` instead of silently returning `[]`.

---

## [3.32.23] - 2026-02-23

### Changed — Cloud Settings Redesign + Unified Encryption

- **Changed**: Cloud settings compacted to ≤400px card — Dropbox configuration moved to Advanced sub-modal
- **Changed**: Unified encryption mode — vault password stored in browser, combined with Dropbox account for zero-knowledge encryption (replaces Simple/Secure toggle)
- **Fixed**: Action buttons (Disconnect, Backup, Restore) use compact app button style, removed from main card view
- **Removed**: Encryption mode selector (Simple/Secure radio buttons) — single seamless mode replaces both

---

## [3.32.22] - 2026-02-23

### Fixed — Sync UI Dark-Theme CSS Fix

- **Fixed**: Cloud sync header popover now uses correct dark-theme CSS variables (`--bg-card`, `--border`, `--bg-tertiary`) — previously appeared white/light on dark theme
- **Fixed**: Mode selector in Settings → Cloud uses correct border and background variables across all themes
- **Fixed**: Backup warning banner uses transparent amber tint instead of hardcoded light-yellow (`#fff8e6`)
- **Fixed**: Popover header label uses SVG lock icon matching the app's stroke-icon style

---

## [3.32.21] - 2026-02-23

### Added — Sync UX Overhaul + Simple Mode

- **Added**: "Simple" sync mode — Dropbox account acts as encryption key; no vault password needed on any device
- **Added**: Mode selector in Settings → Cloud (Simple / Secure) with backup warning before switching modes
- **Fixed**: Sync password modal no longer auto-opens on page load; replaced with ambient toast + orange header dot
- **Changed**: Header cloud button is mode-aware — orange-simple reconnects Dropbox; orange (Secure) opens an inline password popover below the header button

---

## [3.32.20] - 2026-02-23

### Added — api2 Backup Endpoint

- **Added**: `api2.staktrakr.com` as a fallback for all three API feeds — spot (hourly + 15-min), market (manifest.json), and goldback (goldback-spot.json)
- **Changed**: All API fetches now try the primary endpoint with a 5-second timeout; if unreachable, automatically fall through to api2 before giving up
- **Changed**: API Health modal now shows per-endpoint columns (api vs api2) with live drift benchmarking in the verdict line

---

## [3.32.19] - 2026-02-23

### Added — 15-Min Spot Price Endpoint

- **Added**: New `data/15min/YYYY/MM/DD/HHMM.json` API endpoint — immutable sub-hourly price snapshots written every 15 min by the spot poller (GHA :05/:20/:35/:50)
- **Added**: `fetchStaktrakr15minRange()` fetches 24h of 15-min spot data into spotHistory, tagged `api-15min` and visible in the API history table

---

## [3.32.18] - 2026-02-23

### Added — Cloud Sync Header Status Icon (STAK-264)

- **Added**: Ambient cloud sync status icon in the header replaces the jarring on-load vault password modal — orange when password is needed (tap to unlock), green when active, gray when not yet configured (STAK-264)

---

## [3.32.17] - 2026-02-23

### Added — STAK-270: 24hr Intraday Chart Improvements

- **Improved**: 24hr intraday chart now buckets raw API windows into clean 30-min aligned slots, eliminating irregular tick spacing caused by poller timing variance
- **Improved**: Chart X-axis now visually distinguishes hour marks (full opacity, 11px) from half-hour marks (dimmed, 9px) for faster time-at-a-glance reading
- **Added**: Intraday table extended from 5 rows to configurable 12/24/48 rows with scrollable container and row-count dropdown
- **Added**: Trend column (▲/▼/—) in intraday table shows price direction vs. previous 30-min slot

---

## [3.32.16] - 2026-02-22

### Fixed — Market Chart Timezone + Seed Sync Automation (STAK-275, STAK-266)

- **Fixed**: 24hr market price chart X-axis and table now display times in the user's selected timezone instead of UTC (STAK-275)
- **Added**: seed-sync skill gains Phase 5 — fetches latest spot-history from live API and merges before staging, ensuring releases ship with up-to-date seed data (STAK-266)

---

## [3.32.15] - 2026-02-22

### Fixed — Nitpick Polish — API Health Modal Wording + Desktop Footer Layout (STAK-272, STAK-273)

- **Fixed**: API health modal Coverage row now shows "items tracked" instead of "coins" — rounds and bars are not coins (STAK-272)
- **Fixed**: Desktop footer restructured — badges moved to top row, "Special thanks to r/Silverbugs" moved to its own line below the main footer text (STAK-273)

---

## [3.32.14] - 2026-02-22

### Fixed — API Health Stale Timestamp Parsing (STAK-265)

- **Fixed**: Naive `"YYYY-MM-DD HH:MM:SS"` timestamps from spot history and Goldback feeds now normalized to UTC before parsing — previously treated as local time, inflating staleness readings by the user's UTC offset (e.g. 6 hours on CST)
- **Changed**: Market feed stale threshold raised from 15 → 30 min to match typical poller cadence and prevent false-positive stale warnings

---

## [3.32.13] - 2026-02-22

### Fixed — API Health Modal z-index + Three-Feed Freshness Checks

- **Fixed**: API health modal now renders above the About modal (z-index raised to 10000)
- **Improved**: API health now checks three feeds independently — market prices (15 min threshold), spot prices (75 min), and Goldback daily scrape; badges show per-feed freshness
- **Changed**: Footer and About modal badge text now shows `✅ Market Xm · Spot Xm` format

---

## [3.32.12] - 2026-02-22

### Added — Configurable Vault Password Idle Timeout (STAK-183)

- **Added**: "Auto-lock after idle" dropdown in Settings → Cloud Sync → Session Password Cache — choose 15 min, 30 min, 1 hour, 2 hours, or Never
- **Changed**: Vault password idle lock reads the user's setting at arm time instead of a hardcoded 15-minute constant; "Never" disables auto-clear entirely

---

## [3.32.11] - 2026-02-22

### Fixed — PR #395 Review Fixes — Code Quality & Correctness

- **Fixed**: `logItemChanges` null-dereference on item-add/delete — guarded `forEach` loop for null `oldItem`/`newItem`; now records single Added/Deleted entry
- **Fixed**: `changeLog` raw `localStorage.setItem` calls replaced with `saveDataSync()` across all callsites
- **Fixed**: `getManifestEntries`/`markSynced` exposed as `window.*` globals — array property approach lost on `changeLog = []` reassignment
- **Fixed**: Sync toast showed wrong provider — status string was `"success"` but `syncProviderChain` returns `"ok"`
- **Fixed**: Swallowed post-reset backfill error now logs to `console.warn` for debuggability
- **Fixed**: `api-health.js` modal calls use `window.` prefix; `readyState` guard added for late-loading scripts
- **Fixed**: `safeGetElement` used in `initSpotHistoryButtons` (was raw `document.getElementById`)

---

## [3.32.10] - 2026-02-22

### Added — Worktree Protocol & Branch Protection Infrastructure

- **Added**: Version lock + worktree protocol — agents now create isolated `patch/VERSION` git worktrees in `.claude/worktrees/` for concurrent work, preventing filesystem conflicts between agents
- **Added**: `main` branch protection — Codacy Static Code Analysis required, no force pushes, prevents direct pushes to production
- **Changed**: Release skill Step 0a now creates worktree + branch on lock claim; Phase 3 cleanup removes them after merge
- **Changed**: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` updated with full worktree workflow and "never push directly to main" rule
- **Changed**: `devops/version-lock-protocol.md` — full 9-step lock+worktree protocol replacing the previous 5-step lock-only protocol

---

## [3.32.09] - 2026-02-22

### Fixed — WeakMap Search Cache Correctness

- **Fixed**: Cache miss check uses `=== undefined` instead of falsy — prevents treating a valid cached empty string as a miss (`js/filters.js`)
- **Fixed**: Notes save handler now invalidates search cache after in-place mutation — multi-word search reflects updated notes immediately (`js/events.js`)
- **Fixed**: Removed redundant post-loop `invalidateSearchCache` from `applyNumistaTags()` — `addItemTag()` already invalidates per item, eliminating a duplicate O(N) scan per tag (`js/tags.js`)
- **Fixed**: Undo/redo now invalidates search cache after in-place field mutation — multi-word searches reflect reverted values immediately (`js/changeLog.js`)

---

## [3.32.08] - 2026-02-22

### Fixed — OAuth State Security Hardening & Agent Instruction Sync

- **Fixed**: OAuth provider now parsed from trusted `savedState` after CSRF validation — not attacker-controlled `state` string before check (`js/cloud-storage.js`)
- **Fixed**: PKCE challenge promise now has `.catch()` handler — cleans `sessionStorage` and closes popup on failure
- **Fixed**: OAuth exchange failure path removes stale `cloud_oauth_state` from `sessionStorage` to prevent replay
- **Changed**: `AGENTS.md`, `GEMINI.md` updated — version lock protocol, Stitch removal, MCP parity sync (2026-02-22)
- **Changed**: `.gitignore` — added `devops/version.lock` multi-agent version mutex entry

---

## [3.32.07] - 2026-02-22

### Fixed — Backend Data Integrity & Sparkline Fix

- **Fixed**: Sync restore now clears all scoped localStorage keys before writing backup data — prevents stale entries leaking across restore (STAK-183)
- **Added**: DiffEngine module — pure-data compare, merge, and conflict detection for inventory sync (STAK-186)
- **Added**: changeLog manifest entries — scope tags, itemKey, type fields, and markSynced() for sync audit trail (STAK-187)
- **Added**: Vault manifest crypto — AES-256-GCM encryptManifest/decryptManifest with STMF header magic (STAK-188)
- **Fixed**: Sparkline intraday dedup removes duplicate timestamps that caused V-spike artifacts on spot price cards
- **Fixed**: Sparkline Y-axis normalized to ±1% of price range — eliminates over-zoom on flat intraday data
- **Fixed**: Post-wipe spot history initialized as array (not object) and triggers backfill correctly

---

## [3.32.05] - 2026-02-22

### Fixed — Service Worker Cache Coverage

- **Fixed**: Add `image-processor.js`, `bulk-image-cache.js`, and `image-cache-modal.js` to `sw.js` CORE_ASSETS — offline image workflows no longer 404 on first offline visit

---

## [3.32.04] - 2026-02-22

### Fixed — Async Save Reliability

- **Fixed**: `await saveData()` in `updateLastTimestamps`, `CatalogManager._save`, and `saveInventory` — prevents silently dropped Promises if localStorage throws

---

## [3.32.03] - 2026-02-22

### Fixed — Sync Toast

- **Fixed**: Spot price sync completion now shows a non-blocking toast instead of a blocking modal dialog

---

## [3.32.02] - 2026-02-22

### Changed — Appearance Settings Redesign

- **Changed**: Appearance tab redesigned — Color scheme and Inventory View as compact pill-button pickers in one card; Timezone, Default Sort, and Visible Items as full-width dropdowns in a second card; thumb-friendly touch targets throughout (STAK-258)

---

## [3.32.01] - 2026-02-21

### Fixed — Dual-Poller API Endpoint & Spot Pipeline Fixes

- **Fixed**: Correct retail endpoint paths for api1.staktrakr.com fallback — both RETAIL_API_ENDPOINTS now resolve to valid URLs
- **Fixed**: Point all pollers to correct API repos — StakTrakrApi (Fly.io) and StakTrakrApi1 (Mac) no longer cross-wired
- **Fixed**: Hourly spot data pipeline — backfill, dual-checkout, and endpoint migration corrected (STAK-255)
- **Fixed**: Race both hourlyBaseUrls in parallel per hour for spec compliance
- **Added**: Nightly sync between StakTrakrApi and StakTrakrApi1 repos via GitHub Actions

---

## [3.32.0] - 2026-02-21

### Added — Market Prices Module, OOS Detection & Image Vault Sync

- **Added**: Market Prices Module — live bullion retail prices from APMEX, Monument Metals, SDB, and JM Bullion with per-coin cards, 30-day price history, and intraday 15-min data (retail.js, retail-view-modal.js)
- **Added**: Out-of-stock detection via AI vision (Gemini) and Firecrawl scraping consensus — OOS coins display strikethrough pricing and gaps in history charts
- **Added**: Image Vault Sync — user-uploaded coin photos sync to cloud via encrypted image vault (STAK-181)
- **Added**: Serial Number column in PDF export (STAK-234)
- **Added**: Retail poller PATCH_GAPS gap-fill mode — backfills missing hourly windows without re-scraping existing data (replaces FBP GHA workflow)
- **Fixed**: Numista cache now clears on N# change; added remove button for cached Numista data (STAK-244)
- **Fixed**: Card view portal height calculation corrected for multi-row layouts (STAK-206)
- **Fixed**: UUID generation upgraded to CSPRNG (`crypto.getRandomValues`) for all item IDs

---

## [3.31.6] - 2026-02-19

### Added — STAK-173: Collapsible Form Modal, Numista Data Persistence & Dialog Migration

- **Added**: Collapsible add/edit form with glassmorphic sections — core fields always visible, Grading & Certification, Pricing & Details, Numista Data, and Notes collapse via native `<details>`/`<summary>` (STAK-173)
- **Added**: Per-item Numista metadata persistence — API data seeds fields, user edits override, layered provider priority for future catalog APIs (STAK-173)
- **Added**: Numista Data fields auto-populate from IndexedDB cache on edit and after Numista search (STAK-173)
- **Added**: Date N/A checkbox to blank out purchase date for items without acquisition dates (STAK-173)
- **Added**: Color-coded image upload pill buttons (Upload/URL/Camera/Remove) with card layout (STAK-173)
- **Changed**: Migrate all native alert/confirm/prompt calls to async appDialog wrappers across 18 modules
- **Changed**: Expand bulk edit search to match across Numista metadata fields (STAK-175)
- **Fixed**: Currency symbol ($) no longer overlaps placeholder text in purchase/retail price fields (STAK-173)

---

## [3.31.5] - 2026-02-19

### Added — STAK-149: Cloud Auto-Sync, Bulk Edit Fixes & Code Cleanup

- **Added**: Real-time encrypted auto-sync to Dropbox — inventory changes push automatically and other devices are notified with an "Update Available" modal showing item count, timestamp, and device before pulling (STAK-149)
- **Added**: Per-backup delete button in cloud backup list — remove individual backups from Dropbox without logging in (STAK-149)
- **Added**: View Sync Log shortcut in Dropbox card footer navigates directly to cloud activity log (STAK-149)
- **Fixed**: Bulk Edit Delete, Copy, and Apply operations now work correctly inside the modal — replaced window.confirm/alert with modal-based confirmations
- **Removed**: isCollectable field removed from inventory items, bulk editor, import/export, and seed data — superseded by the tag system

---

## [3.31.4] - 2026-02-19

### Added — Vendored Libraries & True Offline Support

- **Added**: All CDN dependencies (PapaParse, jsPDF, Chart.js, JSZip, Forge, and plugins) bundled locally in `vendor/` — app is now fully functional with no internet connection and on `file://` protocol
- **Added**: CDN fallback loader fires automatically if a vendor file fails to define its global — no silent failures
- **Fixed**: `importCsv`, `exportCsv`, `importNumistaCsv`, and `exportPdf` now show a clear user-facing error if the required library failed to load, instead of a silent crash
- **Added**: Vendor files pre-cached in service worker `CORE_ASSETS` — offline PWA install now bundles all dependencies
- **Added**: `vendor/**` excluded from Codacy analysis to prevent false positives on minified third-party code

---

## [3.31.3] - 2026-02-19

### Added — Filter Chip Active-State UX & Bug Fixes

- **Added**: Filter chips now hide × on idle — only active/search chips show the remove button and a themed border ring, eliminating visual noise from ~60 always-visible × buttons (STAK-172)
- **Fixed**: Clicking × on an active filter chip now correctly removes the filter instead of erroneously replacing it with an exclude entry
- **Fixed**: Card view pagination, mobile image tap, and bulk popover rendering polish
- **Fixed**: VIEW_METADATA_TTL promoted to global scope; O(1) Map pre-built for Numista tag lookup (PR #257 review)
- **Fixed**: MD013 disabled in markdownlint config to match Codacy dashboard setting

---

## [3.31.2] - 2026-02-18

### Added — Numista Metadata Pipeline Fixes

- **Fixed**: Vault restore now reloads in-memory item tags immediately — filter chips show correct tags without requiring a page reload (STAK-168)
- **Fixed**: Bulk sync now writes Numista tags to all matching inventory items eagerly — filter chips no longer require opening each item's view modal (STAK-168)
- **Fixed**: View modal skips API call when metadata is already cached in IndexedDB — eliminates reload delay for previously bulk-synced items (STAK-168)
- **Fixed**: Numista search result weight field now pre-checked by default when value is available (STAK-168)

---

## [3.31.1] - 2026-02-18

### Added — FAQ Modal, Settings Consolidation & Privacy Improvements

- **Added**: Interactive FAQ modal with 13 questions across 6 sections — accessible via Settings sidebar tab, About modal, and app footer
- **Added**: ZIP export and ZIP restore buttons exposed in Settings → Inventory (previously orphaned globals with no UI)
- **Added**: pCloud and Box as coming-soon cloud provider cards alongside Google Drive and OneDrive in Settings → Cloud
- **Changed**: Files settings tab consolidated into Inventory tab — all import/export now in one place
- **Changed**: Bulk Editor wrapped in settings card with BETA badge
- **Changed**: Data Reset promoted to standalone fieldset (removed redundant Backup & Security wrapper)
- **Changed**: StakTrakr Cloud (Sponsors) card moved above Dropbox in Cloud settings
- **Fixed**: privacy.html now inherits app theme and syncs with user's stored theme preference
- **Fixed**: "Back to StakTrakr" link on privacy.html works correctly on file:// protocol
- **Fixed**: Footer thank-you updated to credit r/Silverbugs community

---

## [3.31.0] - 2026-02-17

### Added — Cloud Storage Backup (Dropbox)

- **Added**: Cloud storage backup — encrypt and upload .stvault files to Dropbox via OAuth PKCE popup flow
- **Added**: Privacy policy page for OAuth provider compliance
- **Added**: Cloudflare Pages Function scaffold for future pCloud/Box token exchange proxy
- **Fixed**: Favicon and PWA SVG icons updated to match ST branding (gold ST on navy)

---

## [3.30.09] - 2026-02-17

### Added — Settings & Header Controls Overhaul

- **Added**: Optional Trend and Sync buttons in header (hidden by default, enable in Appearance > Header Buttons)
- **Changed**: Removed global spot trend/sync bar; trend cycling and sync now available as header buttons
- **Changed**: Settings Appearance panel reorganized — Header Buttons 2×2 grid, Layout card, Inventory View cards (Card View A/B/C/D, Default Sort, Visible Items)
- **Changed**: Images panel restructured — actions row at top, 1×3 display grid, camera capture support, fieldset cards
- **Changed**: Metal Order and Inline Chips consolidated into Chips panel; removed Table Display tab
- **Changed**: Currency header button hidden by default; Trend and Sync default to ON

---

## [3.30.08] - 2026-02-17

### Added — Default Settings Overhaul & Seed Pattern Images

- **Changed**: Default sort to Name ascending, show all rows, dark theme for new users
- **Changed**: Header theme button hidden by default (existing users migrated to keep visible)
- **Changed**: Dynamic Name Chips disabled by default
- **Changed**: Goldback denomination pricing and real-time estimation enabled by default
- **Added**: Per-rule enable/disable toggles for built-in Numista lookup patterns with Enable All / Disable All controls
- **Added**: Seed pattern images — American Silver Eagle and Canadian Gold Maple demo rules with coin photos in Custom Pattern Rules for first-time user coaching

---

## [3.30.07] - 2026-02-17

### Added — STAK-104: Save Search as Filter Chip

- **Added**: Bookmark button inside search input to save multi-term comma-separated searches as custom filter chips (STAK-104)
- **Added**: Smart enable/disable logic — button activates only for 2+ comma-separated terms that don't already exist as a saved group or auto-generated chip
- **Added**: Button disabled during fuzzy search mode to prevent saving approximate matches
- **Added**: Save button state syncs with filter clear and filter remove actions

---

## [3.30.06] - 2026-02-17

### Added — Card View Sort Controls & UX Polish

- **Added**: Card sort bar with sort-by dropdown, direction toggle, and A/B/C card style toggle — visible only in card view (STAK-131)
- **Changed**: Pagination dropdown hidden in card view — cards always show all items
- **Changed**: Default table rows changed from 6 to 12
- **Changed**: Header card view button now simply toggles card/table view
- **Changed**: Numista name matching (NUMISTA_SEARCH_LOOKUP) disabled by default

---

## [3.30.05] - 2026-02-16

### Fixed — Sort Column Index Realignment

- **Fixed**: All table sorts after the Type column were off by one — the Image column added in v3.30.00 was missing from the sort index map, causing every click from Name onward to sort by the wrong field (e.g. clicking Purchase sorted by Melt, clicking Gain/Loss sorted by Source)
- **Fixed**: Sorting by Retail and Gain/Loss now uses `computeMeltValue()` and `getGoldbackRetailPrice()` matching the table render logic
- **Fixed**: Image column header click is now a no-op instead of incorrectly sorting by Name
- **Fixed**: Secondary year sub-sort on Name column updated to correct index

---

## [3.30.04] - 2026-02-16

### Fixed — Pagination Dropdown Fix & Settings Reorganization

- **Fixed**: Settings modal "Visible rows" dropdown now includes value 6 — prevents silent fallback to 12 when switching between card and table views
- **Changed**: Items-per-page default changed from 12 to 6 across all code paths
- **Added**: 128 and 512 options to both footer and settings dropdowns
- **Changed**: "Table" settings tab renamed to "Inventory" with card settings consolidated under it

---

## [3.30.03] - 2026-02-17

### Fixed — STAK-130: PumpkinCrouton Patch — Purity Input & Save Fix

- **Fixed**: Purity dropdown now includes .9995 (standard pure platinum) as a preset option (STAK-130)
- **Fixed**: Custom purity input accepts 4 decimal places instead of 3 (STAK-130)
- **Fixed**: Hidden custom purity input no longer blocks form submission — resolves save corruption where no items could be edited after entering an invalid custom purity value (STAK-130)
- **Fixed**: Duplicate item preserves original purchase date instead of defaulting to today (STAK-130)

Thanks to u/PumpkinCrouton for finding and reporting this bug.

---

## [3.30.02] - 2026-02-16

### Fixed — Keyless Provider Fixes & Hourly History Pull

- **Fixed**: Keyless providers (STAKTRAKR) now enable sync buttons, show "Connected" status, and auto-select correctly
- **Fixed**: STAKTRAKR usage counter tracks API calls with 5000 default quota
- **Added**: Hourly history pull for STAKTRAKR provider (1–30 days of hourly files)
- **Added**: Hourly history pull for MetalPriceAPI provider (up to 7 days, per-metal)
- **Added**: History log distinguishes hourly entries with "(hourly)" source label
- **Added**: One-time migration re-tags existing StakTrakr hourly entries for production users

---

## [3.30.01] - 2026-02-16

### Added — StakTrakr Free API Provider & UTC Poller Fix

- **Added**: StakTrakr as a free, keyless API provider (rank 1 by default) fetching hourly spot prices from api.staktrakr.com
- **Added**: Provider panel with "Free" badge, best-effort disclaimer, and 1st–5th priority labels across all providers
- **Changed**: Poller switched from EST to UTC for timezone-neutral hourly file paths
- **Changed**: Service worker caches api.staktrakr.com with stale-while-revalidate strategy
- **Fixed**: Auto-sync and provider chain now work without any API keys via keyless providers

---

## [3.30.00] - 2026-02-16

### Added — Card View Engine, Mobile Overhaul & UI Polish

- **Added**: Three card view styles — Sparkline Header (A), Full-Bleed Overlay (B), Split Card (C) — with header button cycling and shift+click table/card toggle (STAK-118)
- **Added**: CDN image URLs for obverse/reverse with dedicated table image column, settings toggle for obverse/reverse/both, and card view thumbnails (STAK-118)
- **Added**: Mobile viewport overhaul — responsive breakpoints, touch-friendly controls, viewport scaling fixes (STAK-124, STAK-125, STAK-126)
- **Added**: Mobile summary cards — compact 2-col grid with spanning All Metals card (STAK-106)
- **Added**: Rows-per-page options (3/12/24/48/96/All) with floating back-to-top button and portal scroll override
- **Added**: CSV, JSON, and ZIP backup/restore now include obverse/reverse image URL fields
- **Changed**: Theme-aware sparkline colors — bold strokes and fills clearly visible on light, sepia, and dark themes
- **Changed**: Default card style set to Sparkline Header (A), default rows-per-page set to 12
- **Fixed**: Service worker DEV_MODE toggle for cache bypass during development

---

## [3.29.08] - 2026-02-15

### Fixed — Fix What's New Modal Showing Stale Version

- **Fixed**: What's New modal no longer shows stale version content after deployments — version check now uses `APP_VERSION` directly instead of potentially stale localStorage value
- **Fixed**: Service worker local asset strategy changed from cache-first to stale-while-revalidate so deployment updates propagate on next page load

---

## [3.29.07] - 2026-02-15

### Fixed — Fix Image Deletion in Edit Modal

- **Fixed**: Users can now properly remove uploaded photos from items via Remove button in edit modal — deletion intent flags ensure images are removed from IndexedDB on Save (STAK-120)
- **Fixed**: Orphaned user images are now cleaned up from IndexedDB when inventory items are deleted, preventing storage bloat (STAK-120)

---

## [3.29.06] - 2026-02-15

### Changed — STAK-115, STAK-116, STAK-117: Design System & Settings Polish

- **Changed**: Unified Settings toggle styles — replaced iOS-style switches with chip-sort-toggle pattern for Table Thumbnails, Numista Priority, and header shortcut settings (STAK-116)
- **Changed**: Redesigned Settings > Appearance tab with grouped fieldsets — Theme, Currency & Pricing, Image Display, and Custom Themes placeholder (STAK-115)
- **Added**: Living style guide (`style.html`) — standalone design system reference with theme switching, color token swatches, and all UI component samples (STAK-117)
- **Added**: CSS & Design System coding standards — token usage rules, toggle standard, button variants, settings group patterns (STAK-117)

---

## [3.29.05] - 2026-02-15

### Fixed — Post-Release Hardening & Seed Cache Fix

- **Fixed**: Seed data cache staleness — service worker now uses stale-while-revalidate for spot-history files so Docker poller updates reach users between releases
- **Fixed**: CoinFacts URL fallback for Raw/Authentic grades in View Modal cert badge (PR #161)
- **Fixed**: Purchased chart range clamped to minimum 1 day to avoid All-range collision (PR #161)
- **Fixed**: Verify promise unhandled rejection and window.open name sanitization (PR #161)
- **Fixed**: Keyboard activation (Enter/Space) added to cert badge buttons for accessibility (PR #161)
- **Fixed**: dailySpotEntries fallback on fetch failure, verify button visibility guard (PR #161)

---

## [3.29.04] - 2026-02-15

### Added — STAK-110, STAK-111, STAK-113: View Modal Visual Sprint

- **Added**: Certification badge overlay on View Modal images — authority-specific colors (PCGS, NGC, ANACS, ICG), clickable grade for cert lookup, verification checkmark with pass/fail states (STAK-113)
- **Added**: Chart range pills for 1Y, 5Y, 10Y, and Purchased (purchase date → present) with Purchased as default (STAK-113)
- **Changed**: View Modal default section order — Images first, then Valuation (STAK-110)
- **Added**: Purchase date in parentheses next to purchase total in Valuation section (STAK-111)
- **Fixed**: Date range picker "From" clearing not resetting "To" minimum constraint

---

## [3.29.03] - 2026-02-15

### Fixed — STAK-108, STAK-109, STAK-103: Price History Fixes & Chart Improvements

- **Fixed**: Goldback items recording $0.00 retail in price history — added 3-tier retail hierarchy lookup with `getGoldbackRetailPrice()` (STAK-108)
- **Fixed**: API sync timing — Goldback denomination prices now update before price history snapshots are recorded (STAK-108)
- **Added**: Per-item price history modal with inline delete and undo/redo from Edit Modal retail price field (STAK-109)
- **Added**: Delete buttons on Settings > Price History table with change log integration (STAK-109)
- **Fixed**: All-time chart showing only ~1 year on file:// protocol — 749KB seed bundle loaded via `<script>` tag bypasses Chrome fetch restrictions
- **Added**: Adaptive x-axis year labels — decade+ ranges show compact 2-digit year, multi-year ranges show two-line date+year
- **Added**: Custom date range picker on Item View chart with cross-constrained from/to inputs (STAK-103)
- **Fixed**: WCAG accessibility — date input font-size increased from 0.6rem to 0.75rem
- **Fixed**: Async chart error handling with graceful fallback on fetch failure

---

## [3.29.02] - 2026-02-15

### Fixed — PWA Crash Fix: Service Worker Error Handling

- **Fixed**: Navigation fetch handler crash in installed PWAs — added 3-tier fallback (cached index.html → cached root → inline offline page) so `respondWith()` never receives a rejected promise
- **Fixed**: `fetchAndCache`, `cacheFirst`, and `networkFirst` strategy functions now catch network/cache failures instead of propagating rejections
- **Fixed**: Install event failures are now logged with detailed error information to make SW install issues diagnosable

---

## [3.29.01] - 2026-02-15

### Changed — Codacy Duplication Reduction

- **Changed**: Extracted `wireFeatureFlagToggle` and `wireChipSortToggle` helpers to deduplicate 6 identical chip toggle handlers across settings.js and events.js
- **Changed**: Merged `renderInlineChipConfigTable` into generic `_renderSectionConfigTable` with `emptyText` option
- **Changed**: Extracted `buildItemFields` helper to deduplicate item field listings in add/edit paths
- **Changed**: Extracted `closeItemModal` to deduplicate cancel/close button handlers
- **Removed**: Unused Numista Query and N# form fields from pattern image rule form

---

## [3.29.00] - 2026-02-15

### Added — Edit Modal Pattern Rule Toggle

- **Added**: "Apply to all matching items" checkbox in edit modal image upload — creates a pattern rule from keywords instead of saving a per-item image
- **Changed**: Extracted shared section config helpers to reduce code clones across layout/view modal settings

---

## [3.28.00] - 2026-02-14

### Added — Price History Chart Overhaul & View Modal Customization

- **Added**: Price history chart derives melt value from spot price history — every item gets a chart from day one
- **Added**: Chart range toggle pills (7d / 14d / 30d / 60d / 90d / 180d / All) with 30d default
- **Added**: Retail value line anchored from purchase date/price to current market value with sparse midpoint snapshots
- **Added**: Layered chart fills — purchase (red), melt (green), retail (blue) with transparency blending
- **Changed**: View modal section order: Images → Price History → Valuation → Inventory → Grading → Numista → Notes
- **Added**: Configurable view modal section order in Settings > Layout with checkbox + arrow reorder table

---

## [3.27.06] - 2026-02-14

### Added — Timezone Selection & PWA Fixes

- **Added**: Display timezone selector in Settings > System — all timestamps respect user-chosen timezone while stored data stays UTC (STAK-63)
- **Fixed**: Spot card and history timestamps displayed UTC values regardless of browser timezone — bare UTC strings now parsed correctly (STAK-63)
- **Fixed**: PWA installed app failed to load on second launch — absolute start_url and navigation-aware service worker
- **Fixed**: What's New splash re-triggering from stale SW cache + missing ESC handler (STAK-93)

---

## [3.27.05] - 2026-02-14

### Added — Numista Bulk Sync & IDB Cache Fix

- **Added**: Numista Bulk Sync — metadata + image syncing from API card with inline stats, progress, and activity log (STAK-87, STAK-88)
- **Changed**: Moved image cache controls from Settings > System into the Numista API card as "Bulk Sync"
- **Fixed**: Opaque blob IDB corruption — images disappeared after bulk cache on HTTPS (STAK-87)
- **Fixed**: Empty blob safety guard in getImageUrl() prevents blocking CDN fallback
- **Added**: Table row thumbnail images with hover preloading (STAK-84)

---

## [3.27.04] - 2026-02-14

### Added — Spot Comparison Mode & Mobile API Settings

- **Added**: User setting for 24h % comparison mode — Close/Close, Open/Open, Open/Close (STAK-92)
- **Changed**: Replaced drag-to-sort provider tabs with explicit Sync Priority dropdowns that work on all devices (STAK-90)
- **Changed**: Provider tabs now scroll horizontally on mobile instead of overflowing (STAK-90)
- **Removed**: Sync Mode toggle (Always/Backup) — replaced by priority numbers (STAK-90)
- **Fixed**: Cache-bust favicon and add root-level copies for PWA
- **Fixed**: Consistent 24h % across all spot card views (STAK-89)
- **Changed**: Extract fetchAndCache helper in service worker

---

## [3.27.03] - 2026-02-14

### Added — PWA Support & Bug Fixes

- **Added**: PWA support — manifest.json, service worker with offline caching, installable app experience (STAK-74)
- **Added**: PWA icons (192×192, 512×512) and Apple mobile web app meta tags
- **Fixed**: `parsePriceToUSD` now preserves existing price when edit field is left empty instead of zeroing it (STAK-81)
- **Fixed**: Date change in add/edit form now clears stale spot-lookup override price (STAK-82)
- **Fixed**: Activity Log sub-tabs (spot history, catalog history, price history) now re-render on every switch instead of showing stale data (STAK-83)
- **Fixed**: Item detail modal layout on Samsung S24+ Ultra — raised breakpoint from 400px to 480px for single-column grid (STAK-85)
- **Removed**: Redundant View (eye) icon from table action column — item name click already opens view modal (STAK-86)
- **Added**: Spot history seed data for Jan 2 – Feb 14, 2026 (32 dates × 4 metals) from Docker poller infrastructure
- **Changed**: Spot history and spot lookup display "Seed" label for seed-sourced entries

---

## [3.27.02] - 2026-02-13

### Changed — Multi-Color Storage Bar

- **Changed**: Footer storage bar now shows localStorage (blue) and IndexedDB (green) as stacked segments with color legend dots
- **Changed**: Storage text displays per-source breakdown (LS KB + IDB KB) with combined total
- **Changed**: Hover tooltips on bar segments show individual source limits

---

## [3.27.01] - 2026-02-13

### Fixed — Iframe to Popup Window Migration

- **Fixed**: Source URL and N# Numista links in view modal now open in popup windows instead of iframe overlays — external sites block iframe embedding via X-Frame-Options headers
- **Removed**: Iframe popup modal HTML and CSS (replaced by standard window.open popups)

---

## [3.27.00] - 2026-02-13

### Added — Coin Image Cache & Item View Modal

- **Added**: IndexedDB image cache (`js/image-cache.js`) — fetches, resizes, and stores Numista coin images with 50MB quota and graceful `file://` degradation
- **Added**: Item view modal (`js/viewModal.js`) with coin images, inventory data, valuation, grading, and Numista enrichment — opens via item name click or card tap
- **Added**: Numista metadata caching with 30-day TTL — denomination, shape, diameter, thickness, orientation, composition, technique, references, rarity, mintage, edge, tags, and commemorative info
- **Added**: Settings toggles for 15 Numista view modal fields in API settings panel
- **Added**: View (eye) button in table/card actions, card tap opens view modal on mobile
- **Added**: Clickable source URLs and N# Numista badges open in 1250px popup windows
- **Added**: IndexedDB storage reporting in settings footer (LS + IDB) and storage report modal
- **Added**: Search eBay button in view modal footer
- **Added**: `COIN_IMAGES` feature flag (beta) gating entire image/view system
- **Changed**: All popup windows widened from 1200px to 1250px
- **Changed**: Full-screen view modal on mobile with sticky footer, safe-area insets, and 44px touch targets
- **Changed**: Rectangular image frames for bars, notes, and Aurum/Goldback items in view modal

---

## [3.26.03] - 2026-02-13

### Fixed — STAK-79, STAK-80: XSS & HTML Injection Hardening

- **Fixed**: DOM XSS in Price History table — item names now escaped via `escapeHtml()` before innerHTML interpolation (STAK-79)
- **Fixed**: HTML injection in Spot History table — metal, source, and provider fields now escaped (STAK-80)
- **Fixed**: HTML injection in Spot Lookup modal — source and data attributes now escaped (STAK-80)
- **Added**: Shared `escapeHtml()` utility in `utils.js` for consistent XSS prevention across modules

---

## [3.26.02] - 2026-02-13

### Fixed — Autocomplete Migration & Version Check CORS

- **Fixed**: One-time migration auto-enables `FUZZY_AUTOCOMPLETE` for users who had it silently disabled before the settings toggle existed
- **Fixed**: Version check CORS failure — `staktrakr.com` 301 redirects to `www.staktrakr.com` without CORS headers; updated URL to skip redirect

---

## [3.26.01] - 2026-02-13

### Added — Fuzzy Autocomplete Settings Toggle

- **Added**: Fuzzy autocomplete On/Off toggle in Settings > Filter Chips panel
- **Fixed**: Autocomplete feature flag not discoverable — persisted disabled state had no UI to re-enable

---

## [3.26.00] - 2026-02-13

### Added — STAK-62: Autocomplete & Fuzzy Search Pipeline

- **Added**: Autocomplete dropdown on Name, Purchase Location, and Storage Location form inputs — suggestions from inventory + prebuilt coin database (STAK-62)
- **Added**: Abbreviation expansion in search — "ASE", "AGE", "kook", "krug" etc. match full coin names (STAK-62)
- **Added**: Fuzzy search fallback — approximate matches shown with indicator banner when exact search returns no results (STAK-62)
- **Added**: `registerName()` dynamically adds new item names to autocomplete suggestions (STAK-62)
- **Fixed**: Firefox autocomplete suppression using non-standard attribute value (STAK-62)
- **Fixed**: Autocomplete cache invalidated on inventory save, clear, and boating accident (STAK-62)
- **Changed**: `FUZZY_AUTOCOMPLETE` feature flag promoted to stable (STAK-62)

---

## [3.25.05] - 2026-02-13

### Added — STAK-71: Details modal QoL — responsive charts, slice labels, scrollable breakdown

- **Added**: Pie chart percentage labels via chartjs-plugin-datalabels — slices ≥5% show percentage directly on the chart (STAK-71)
- **Added**: Sticky metric toggle (Purchase/Melt/Retail/Gain-Loss) stays visible while scrolling the modal body (STAK-71)
- **Fixed**: Details modal overflow cascade — breakdowns no longer clipped off-screen at any viewport size (STAK-71)
- **Fixed**: Chart container uses `aspect-ratio: 1` for circular pie charts instead of rigid 300px height (STAK-71)
- **Fixed**: ResizeObserver memory leak — observer now disconnected on modal close (STAK-71)
- **Fixed**: Sepia theme chart colors — tooltips now use correct background/text colors for all 4 themes (STAK-71)
- **Fixed**: Allow clearing optional form fields on edit
- **Removed**: Dead CSS chart-height rules at ≤768px/≤640px/≤480px (already hidden by STAK-70)

---

## [3.25.04] - 2026-02-12

### Added — STAK-70: Mobile-optimized modals

- **Added**: Full-screen modals at ≤768px using `100dvh` with `100vh` fallback — all primary modals fill the viewport on mobile (STAK-70)
- **Added**: Settings sidebar 5×2 tab grid replacing horizontal scroll — all 10 tabs visible simultaneously (STAK-70)
- **Added**: Touch-sized inputs (44px min-height) and stacked action buttons in add/edit item modal (STAK-70)
- **Added**: Landscape card view for touch devices 769–1024px via `pointer: coarse` detection and `body.force-card-view` class (STAK-70)
- **Added**: 2-column card grid for portrait ≤768px in landscape orientation (STAK-70)
- **Changed**: Pie charts and metric toggle hidden on mobile in details modal — Chart.js creation skipped entirely for performance (STAK-70)
- **Changed**: Bulk edit modal stacks vertically with full-screen integration and touch-sized inputs (STAK-70)
- **Changed**: `updateColumnVisibility()` extended to apply `.force-card-view` for landscape touch devices (STAK-70)
- **Changed**: `updatePortalHeight()` clears max-height for `.force-card-view` card layout (STAK-70)
- **Fixed**: Small utility modals (notes, API info, storage options, cloud sync) remain as centered popups, not full-screen (STAK-70)

---

## [3.25.03] - 2026-02-12

### Added — STAK-38/STAK-31: Responsive card view & mobile layout

- **Added**: CSS card view at ≤768px — inventory table converts to flexbox cards with name title, horizontal chips, metal subtitle, 2-column financial grid, and centered touch-friendly action buttons (44px targets per Apple HIG) (STAK-31)
- **Added**: `data-label` attributes on all `<td>` elements for card view `::before` labels (STAK-31)
- **Added**: Card tap-to-edit — tapping card body opens edit modal; buttons/links work normally (STAK-31)
- **Added**: Details modal fixes at ≤640px — single-column breakdown grid, 150px chart, stacked panels (STAK-38)
- **Added**: Short-viewport portal scroll cap at ≤500px height for 300% zoom scenarios (STAK-38)
- **Changed**: Consolidated 3 duplicate responsive table CSS sections into single canonical block (STAK-38)
- **Changed**: `updateColumnVisibility()` skips at ≤768px — card CSS handles visibility (STAK-38)
- **Changed**: `updatePortalHeight()` clears max-height at ≤768px — cards scroll naturally (STAK-38)
- **Fixed**: Footer badges wrap on mobile instead of overflowing card
- **Fixed**: Filter chips stay horizontal and wrap instead of stacking vertically at narrow widths
- **Fixed**: Header logo scales to fill mobile width with centered action buttons below

---

## [3.25.02] - 2026-02-12

### Fixed — STAK-68: Goldback spot lookup fix

- **Fixed**: Spot price lookup now applies Goldback formula (`2 × (goldSpot / 1000) × modifier × denomination`) instead of raw gold spot for purchase price (STAK-68)

---

## [3.25.01] - 2026-02-12

### Fixed — STAK-64: Version splash content source

- **Fixed**: Version splash modal now shows user-friendly "What's New" announcements instead of raw changelog entries (STAK-64)
- **Removed**: ~270 lines of embedded changelog data from `versionCheck.js` — content now sourced from `loadAnnouncements()` shared with the About modal

### Added — STAK-67: Remote version check badge

- **Added**: Footer version badge shows installed version with link to GitHub releases (STAK-67)
- **Added**: Remote version check fetches `version.json` from staktrakr.com with 24hr cache (STAK-67)
- **Added**: Badge upgrades to green "up to date" or amber "available" on hosted deployments (STAK-67)
- **Added**: `version.json` at project root for self-hosted version checking
- **Changed**: Footer `staktrakr.com` text is now a clickable link

---

## [3.25.00] - 2026-02-12

### Added — STAK-54, STAK-66: Appearance settings, spot lookup & sparkline improvements

- **Added**: Header quick-access buttons — theme cycle and currency picker dropdown (STAK-54)
- **Added**: Layout visibility toggles — show/hide spot cards, totals, search bar, inventory table (STAK-54)
- **Added**: Settings nav item and panel for Layout controls (STAK-54)
- **Added**: 1-day sparkline shows yesterday→today trend with daily-averaged data points (STAK-66)
- **Added**: 15-minute and 30-minute API cache timeout options for more frequent spot refreshes
- **Fixed**: Spot lookup "Use" button now updates visible Purchase Price field with currency conversion (STAK-65)
- **Fixed**: Clearing Retail Price field during editing now correctly reverts to melt value
- **Fixed**: Spot lookup price rounded to nearest cent
- **Fixed**: Sparkline Y-axis scaling and curve overshoot on 1-day view

---

## [3.24.06] - 2026-02-12

### Changed — STAK-56: Cyclomatic complexity reduction (batch 1 & 2)

- **Refactored**: `renderLogTab` — switch → dispatch map (CCN 9 → ~2)
- **Refactored**: `coerceFieldValue` — if-chain → dispatch map (CCN 13 → ~2)
- **Refactored**: `toggleGbDenomPicker` — extract `showEl` helper, drop redundant fallback (CCN 11 → ~7)
- **Refactored**: `renderItemPriceHistoryTable` — extract `preparePriceHistoryRows` and `attachPriceHistorySortHeaders` (CCN 11 → ~6)
- **Refactored**: `setupNoteAndModalListeners` — new `optionalListener` helper eliminates 16 if-guards, extract `dismissNotesModal` (CCN 17 → ~1)
- **Refactored**: `setupImportExportListeners` — new `setupFormatImport` triad helper, split into `setupVaultListeners` + `setupDataManagementListeners` (CCN 27 → ~3)
- **Added**: `optionalListener` utility — null-safe listener attachment without console.warn spam
- **Added**: `setupFormatImport` utility — reusable override/merge/file-input import triad
- **Net**: −301 lines from `events.js`, 6 of 9 Lizard violations resolved

---

## [3.24.05] - 2026-02-12

### Fixed — Code cleanup and minor fixes

- **Fixed**: `debugLog('warn', ...)` in custom API validation now uses `console.warn()` (debugLog has no level support)
- **Removed**: Unused `columns` parameter from `buildBulkItemRow()` in Bulk Edit
- **Fixed**: Stale `Updated:` comment on APP_VERSION docblock

---

## [3.24.04] - 2026-02-12

### Fixed — STAK-55: Bulk Editor retains selected items after close/reopen

- **Fixed**: Bulk Editor now starts with a clean selection every time it opens (STAK-55)
- **Removed**: `bulkEditSelection` localStorage persistence — selection no longer carries across sessions

---

## [3.24.03] - 2026-02-12

### Fixed — Goldback melt/retail/weight in Details Modal

- **Fixed**: Goldback melt values inflated 1000x in Details Modal — apply `GB_TO_OZT` conversion and denomination retail pricing

---

## [3.24.02] - 2026-02-11

### Added — STAK-44: Settings Log Tab Reorganization

- **Added**: Activity Log sub-tabs in Settings — Changelog, Metals, Catalogs, Price History (STAK-44)
- **Added**: Spot price history table with sortable columns (Timestamp, Metal, Spot Price, Source, Provider)
- **Added**: Catalog API call history table with failed entries highlighted in red
- **Added**: Per-item price history table with item name filter and sortable columns
- **Added**: Clear button with confirmation dialog for each log sub-tab
- **Added**: Lazy-rendering of sub-tab content on first activation

---

## [3.24.01] - 2026-02-11

### Fixed — Codacy code quality cleanup

- **Fixed**: Convert 8 `innerHTML` assignments to `textContent` where content is plain text from `formatCurrency()`
- **Fixed**: Remove stale `eslint-disable-line` comments referencing unloaded security plugin
- **Changed**: Add PMD `ruleset.xml` to exclude false-positive `InnaccurateNumericLiteral` rule
- **Changed**: Add `nosemgrep` suppression for 30 legitimate `innerHTML` uses in client-side rendering

---

## [3.24.00] - 2026-02-11

### Added — STAK-50: Multi-Currency Support

- **Added**: Multi-currency display with 17 supported currencies and exchange rate conversion (STAK-50)
- **Added**: Daily exchange rate fetching from open.er-api.com with localStorage caching and hardcoded fallback rates
- **Added**: Dynamic currency symbols in add/edit modal, Goldback denomination settings, and CSV export headers
- **Added**: Dynamic Gain/Loss labels — green "Gain:" or red "Loss:" on totals cards
- **Fixed**: Sticky header bleed-through when hovering table rows in first 4 columns
- **Fixed**: Codacy false positives via .eslintrc.json

---

## [3.23.02] - 2026-02-11

### Added — STAK-52: Bulk Edit pinned selections

- **Added**: Bulk Edit pinned selections — selected items stay visible at the top of the table when the search term changes (STAK-52)
- **Changed**: Extracted shared search filter helper and added master checkbox indeterminate state in Bulk Edit
- **Removed**: Dormant rEngine/rSynk/AI prototype files and references

---

## [3.23.01] - 2026-02-11

### Added — Goldback real-time estimation, Settings reorganization

- **Added**: Goldback real-time price estimation from gold spot (STAK-52)
- **Added**: User-configurable estimation premium modifier
- **Changed**: Settings sidebar — renamed Theme to Appearance, Tools to System
- **Changed**: Default estimation formula to pure 2x spot (modifier = 1.0)

---

## [3.23.00] - 2026-02-11

### Added — STAK-45: Goldback denomination pricing & type support

- **Added**: New `gb` weight unit option — Goldbacks stored as denomination value (1 gb = 0.001 ozt 24K gold)
- **Added**: New `js/goldback.js` module — save/load/record for manual denomination pricing
- **Added**: Settings > Goldback tab — enable/disable toggle, denomination price table, reference link
- **Added**: Goldback price history logging — timestamped data points per denomination on each save
- **Added**: `GOLDBACK_DENOMINATIONS` lookup table (0.5, 1, 2, 5, 10, 25, 50, 100 gb) with gold content
- **Added**: Denomination picker — swaps weight input for a select dropdown when gb unit is selected
- **Added**: Goldback Price History modal — filterable, sortable table with CSV export
- **Added**: Quick Fill — enter 1 Goldback rate to auto-calculate all denomination prices
- **Added**: Goldback exchange rate link opens in popup window (matches eBay pattern)
- **Added**: Bulk Edit — new Weight Unit field (oz/g/gb) for batch-converting items
- **Changed**: `computeMeltValue()` converts gb→ozt before spot multiplication
- **Changed**: `formatWeight()` accepts optional `weightUnit` param, displays "5 gb" for Goldback items
- **Changed**: Retail hierarchy updated: gb denomination > manual marketValue > melt (denomination pricing is authoritative for gb items)
- **Changed**: Bulk Edit weight column shows formatted weight with unit suffix
- **Changed**: CSV, ZIP CSV, and PDF exports include "Weight Unit" column
- **Changed**: CSV import reads "Weight Unit" column, defaults to 'oz'
- **Changed**: ZIP backup/restore includes goldback prices, price history, and enabled toggle
- **Changed**: Edit/duplicate item modal pre-fills gb weight unit correctly
- **Fixed**: Retail column and gain/loss display conditions now include gb denomination pricing
- **Fixed**: CSV, ZIP CSV, and PDF exports apply 3-tier retail hierarchy (manual > gb > melt)
- **Fixed**: Bulk edit denomination picker now applies correct weight value (was reading stale hidden input)

### Added — STAK-42: Persistent UUIDs for inventory items

- **Added**: Stable UUID v4 field on every inventory item — survives delete, reorder, and sort
- **Added**: `generateUUID()` helper with `crypto.randomUUID()` and RFC 4122 fallback for `file://`
- **Added**: Automatic UUID migration for existing items on load (no data loss)
- **Changed**: CSV, JSON, ZIP, and PDF exports now include UUID column
- **Changed**: CSV, JSON imports preserve existing UUIDs, generate for items without
- **Changed**: Bulk copy and add-item assign new UUIDs; edit preserves existing UUID
- **Fixed**: `sanitizeImportedItem()` safety net ensures no item lacks a UUID

### Added — STAK-43: Silent per-item price history recording

- **Added**: New `js/priceHistory.js` module — silently records timestamped retail/spot/melt data points per item
- **Added**: `item-price-history` localStorage key with UUID-keyed object structure
- **Added**: Recording triggers on item add, edit, inline edit, bulk edit, bulk copy, and spot price sync
- **Added**: Dedup rules — 24h throttle for spot-sync, 1% delta threshold, exact-duplicate suppression
- **Added**: ZIP backup includes `item_price_history.json`; restore uses union merge (not replace)
- **Added**: Vault backup/restore auto-included via `ALLOWED_STORAGE_KEYS`
- **Added**: `purgeItemPriceHistory()` and `cleanOrphanedItemPriceHistory()` for future storage management

---

## [3.22.01] - 2026-02-10

### Added — Form layout, bulk edit dropdowns, purity chips

- **Purity form layout**: Weight/Purity/Qty on single row
- **Bulk Edit**: Purity, Grade, Grading Authority as dropdowns
- Purity/fineness filter chips (enabled) and inline chips (disabled)
- Purity inline chip shows numerical value only

---

## [3.22.00] - 2026-02-10

### Added — STAK-22/24/25/27: Purity, PCGS quota, chart toggle, extraction

- **Added**: Purity (fineness) field — adjusts melt value formula across all calculation sites (STAK-22)
- **Added**: PCGS API daily quota usage bar in Settings (STAK-24)
- **Added**: Pie chart metric toggle — switch between Purchase, Melt, Retail, and Gain/Loss views (STAK-27)
- **Changed**: Extracted inline test loader to js/test-loader.js (STAK-25)
- **Changed**: CSV, PDF, and ZIP exports now include Purity column
- **Changed**: Seed data includes realistic purity values for sample items

---

## [3.21.03] - 2026-02-10

### Added — STAK-23: Search matches custom chip group labels

- **Fixed**: Search now matches items belonging to custom chip groups when searching by group label (STAK-23)

---

## [3.21.02] - 2026-02-10

### Added — Seed data, sample inventory & README overhaul

- **Seed spot history**: 6 months of baked-in price data (720 entries, 4 metals) — sparklines and price cards work from day one
- **Sample inventory**: 8 pre-configured items (3x ASE, 3x Gold Maple, Platinum Round, Palladium Bar) with grades, Numista IDs, and filter chips
- **Seed timestamp**: Spot cards show 'Seed · date' with shift+click hint for seeded users
- **Metals History**: Seed entries visible in history modal with StakTrakr source label
- **README overhaul**: Hero screenshot, feature showcase, Getting Started guide
- **Seed generator**: generate-seed-data.py processes CSV exports into seed JSON + embedded JS

---

## [3.21.01] - 2026-02-09

### Added — PCGS Verified Persistence & Lookup Enhancements

- **Persist verified**: Green checkmark survives reload, sort, and filter — `pcgsVerified` stored in data model with JSON/ZIP round-trip
- **Lookup fields**: PCGS lookup populates Name and Retail Price from API response
- **Cert icon**: Verified checkmark next to Cert# label in edit modal with dark/sepia theme support
- **History logging**: PCGS verify/lookup calls logged to Catalog History via `recordCatalogHistory()`

### Fixed

- **Numista icon**: Search icon no longer stripped after "Searching..." state (`textContent` → `innerHTML`)
- **Export fix**: `pcgsNumber` and `pcgsVerified` added to JSON and ZIP exports (was missing)
- **History label**: Renamed "Numista History" → "Catalog History" to reflect multi-provider support

---

## [3.21.00] - 2026-02-09

### Added — PCGS# Catalog Number & Cert Verification

- **PCGS# field**: New optional PCGS catalog number input on add/edit form with (i) info icon linking to PCGS Number Lookup. PCGS# included in item data model, normalization, CSV/JSON/PDF export, CSV/JSON import, and ZIP backup round-trip
- **PCGS# inline chip**: Blue `PCGS#786060` badge in the Name cell (disabled by default — enable in Settings > Table). Click to open PCGS CoinFacts page in popup window. Config-driven ordering via existing inline chip system
- **PCGS cert verification API**: New Settings > API > PCGS tab for bearer token configuration (1,000 requests/day). Save, Test Connection, and Clear Token buttons. Token stored locally with base64 encoding matching Numista pattern
- **Verify icon on grade tag**: PCGS-graded items with cert number + configured API show a small checkmark icon inside the grade tag. Click to verify cert — displays grade, population, pop higher, and price guide value in tooltip. Green checkmark on success, red flash on failure
- **PCGS# in search**: Search bar and advanced filters now match against PCGS catalog numbers
- **PCGS# in bulk edit**: New "PCGS Number" field in Settings > Tools > Bulk Edit

---

## [3.20.00] - 2026-02-09

### Added — Bulk Edit Tool, Change Log Settings Tab & Focus Group Fixes

- **Bulk Edit tool**: Full-screen modal in Settings > Tools to select multiple inventory items and edit fields, copy, or delete in bulk. Two-column layout with enable/disable field toggles (16 editable fields) on the left and searchable item table with checkboxes on the right. Numista Lookup button fills bulk edit fields from catalog data. Selection persists across modal open/close via localStorage
- **Change Log Settings tab**: Change Log relocated from standalone modal to new Settings > Log tab. Main page Log button now opens Settings at the Log tab directly. Font size and padding reduced to match Table/Chips tabs
- **Full Numista ID on chips**: Numista chips now display `N#12345` (full ID) instead of just `N#`
- **Year chip click-to-filter**: Clicking a year chip in the Name column now applies a year column filter

### Fixed

- **Chip word boundary matching**: Custom group patterns like "AW" no longer match inside words like "Silawa" — uses `\b` word boundary regex instead of substring matching
- **Shift-click chip hide**: Right-click blacklist and context menu popups now properly clean up document click listeners, fixing the issue where shift-click hide only worked once

---

## [3.19.00] - 2026-02-09

### Added — Filter Chip Enhancements

- **Category toggles**: Enable, disable, and reorder 10 filter chip categories (Metals, Types, Names, Custom Groups, Dynamic Names, Purchase Location, Storage Location, Years, Grades, Numista IDs) in Settings > Chips. Disabled categories are hidden from the filter bar. Order persists via `filterChipCategoryConfig` in localStorage
- **Chip sort order**: Sort chips within each category by Name (A-Z) or Qty (High→Low) from new inline dropdown or Settings > Chips. Bidirectional sync between both controls. Persists via `chipSortOrder` in localStorage
- **Config-driven chip rendering**: `renderActiveFilters()` refactored from 10 hard-coded category blocks to a single data-driven loop using category descriptor map — adding future categories requires only 2 entries instead of a new code block

---

## [3.18.00] - 2026-02-09

### Changed — API Settings Redesign

- **Numista first-class tab**: Numista API promoted from appended section to pinned first tab in unified API Configuration panel
- **Drag-to-reorder provider priority**: Metals provider tabs are drag-and-drop reorderable — tab position determines sync priority (position 1 = primary provider). Order persists across sessions via `apiProviderOrder` in localStorage
- **Header status row**: Compact per-provider connection indicators with last-used timestamps replace the old status summary
- **Clickable quota bars**: Usage bars in provider cards are now clickable to open the quota editor — dedicated Quota buttons removed
- **Streamlined provider cards**: Removed "Batch Optimized" badges, batch savings calculations, "Provider Information" links, Default/Backup buttons, and API base URL display
- **Unified button layout**: Each provider card simplified to Save, Save and Test, Clear Key
- **Renamed header actions**: "Sync All" → "Sync Metals", "Flush Cache" → "Flush Metals Cache", "History" → "Metals History", plus new "Numista History" button in header
- **Auto-select default provider**: Provider priority determined by tab order instead of manual Default/Backup button clicks

---

## [3.17.00] - 2026-02-09

### Added — Inline Name Chips, Search Expansion & Backup Fix

- **Inline Name chip settings**: New Settings > Table panel to enable/disable and reorder 6 inline chip types (Grade, Numista, Year, Serial #, Storage Location, Notes Indicator) in the Name cell. Config-driven rendering replaces hard-coded chip order
- **Table settings section**: New sidebar tab in Settings for table display controls (Visible rows, Inline Name chips). Grouping section renamed to "Chips"
- **3 new inline chips**: Serial # (purple badge with serial number), Storage Location (muted badge with truncated location), and Notes Indicator (document icon when item has notes) — all disabled by default, enable in Settings > Table
- **Search expansion**: 6 new fields searchable — Year, Grade, Grading Authority, Cert Number, Numista ID, and Serial Number. Works in both search bar and advanced filter text matching

### Fixed

- **ZIP backup/restore**: chipCustomGroups, chipBlacklist, chipMinCount, featureFlags, and inlineChipConfig now included in ZIP backup and properly restored. Also restores itemsPerPage, sortColumn, and sortDirection (previously backed up but never restored)

---

## [3.16.02] - 2026-02-09

### Added

- **Edit custom grouping rules**: Pencil icon on each rule row enables inline editing of label and patterns without deleting and recreating. Supports Enter to save, Escape to cancel

### Changed

- **Filter chip threshold relocated**: Moved from Settings > Site to Settings > Grouping alongside related chip controls

---

## [3.16.01] - 2026-02-09

### Fixed — API Settings & Numista Usage Tracking

- **Cache timeout persistence**: Per-provider cache timeout settings now persist across page reloads. Previously `cacheTimeouts` was written by the UI but never saved to localStorage or read by `getCacheDurationMs()`
- **Historical data for non-default providers**: `historyDays` default changed from `0` to `30` so Metals-API and MetalPriceAPI fetch historical data on first sync instead of current-only prices
- **Auto-sync all configured providers**: Page refresh now syncs all providers with API keys and stale caches, not just the default provider

### Added

- **Standalone "Save" button per provider**: Save API key, cache timeout, and history settings without triggering a connection test or price fetch. Brief "Saved!" confirmation replaces the alert dialog
- **Numista API usage progress bar**: Tracks API calls persistently across page reloads with automatic monthly reset. Shows `X/2000 calls` in Settings > API > Numista section

---

## [3.16.00] - 2026-02-09

### Added — Custom Chip Grouping & Smart Grouping Blacklist

- **Custom grouping rules**: Define chip labels with comma/semicolon-separated name patterns to create user-defined filter chips (e.g., "Washington Quarter" matching "Washington Quarter, America The Beautiful Quarter"). Managed in Settings > Grouping
- **Chip blacklist**: Right-click any name chip to suppress it from the chip bar. Blacklisted chips can be restored in Settings > Grouping
- **Dynamic name chips**: Auto-extract text from parentheses `()` and double quotes `""` in item names as additional filterable chips. Skips grade strings (BU, MS-XX) and text under 3 characters
- **Grouping settings panel**: New Settings > Grouping section consolidates Smart Name Grouping toggle (moved from Site), Dynamic Chips toggle, Blacklist management, and Custom Rules management
- **`DYNAMIC_NAME_CHIPS` feature flag**: Toggle dynamic chip extraction on/off, with URL override support (`?dynamic_name_chips=0`)

### Changed

- **Smart Grouping toggle relocated**: Moved from Settings > Site to Settings > Grouping for better organization with related chip features

---

## [3.14.01] - 2026-02-09

### Fixed

- **Name column truncation**: Added `max-width: 340px` constraint so long item names properly truncate with ellipsis instead of pushing the table wider than the viewport
- **Numista N# chips compacted**: Inline catalog tags shortened from `N#298883` to just `N#` — full catalog number shown on hover tooltip
- **Action icons clipped**: Reduced icon button size (2.4rem → 1.6rem) and tightened gap (0.25rem → 0.1rem) so Edit/Copy/Delete buttons fit within the Actions column without overflow

---

## [3.14.00] - 2026-02-09

### Added — Encrypted Portable Backup (.stvault)

- **Encrypted backup export**: New "Export Encrypted Backup" button in Settings > Files creates a password-protected `.stvault` file containing all inventory data, settings, API keys, and price history using AES-256-GCM encryption
- **Encrypted backup import**: "Import Encrypted Backup" reads a `.stvault` file, decrypts with the user's password, and restores all data with a full UI refresh
- **Password strength indicator**: Live strength bar (Weak → Very Strong) and password match validation in the vault modal
- **Crypto fallback**: Uses native Web Crypto API (PBKDF2 + AES-256-GCM); falls back to forge.js (~87KB) for Firefox on `file://` protocol where `crypto.subtle` is unavailable
- **Binary vault format**: 56-byte header (magic bytes, version, PBKDF2 iterations, salt, IV) followed by authenticated ciphertext — portable across devices and browsers

---

## [3.12.02] - 2026-02-08

### Fixed

- **NGC cert lookup**: Cert tag click now opens NGC with query params (`CertNum`, `Grade`, `lookup`) so the actual coin details display instead of the blank lookup form
- **Name column overflow**: Long item names no longer push Source and Actions columns off-screen. Name text truncates with ellipsis; Year, N#, and Grade tags always stay visible via flex layout
- **"- Route 66" chip**: Leading dash/punctuation stripped from normalized chip names after suffix removal
- **Source column display**: URL-like sources (e.g., "apmex.com") now display the domain name only ("apmex") with a link icon; plain text sources show without icon

### Added

- **"Lunar Series" chip**: Items with "Year of the" in the name (e.g., "Year of the Dragon") now group under a "Lunar Series" filter chip
- **Numista Sets support**: New "Set" inventory type with purple color. Numista S-prefix IDs (e.g., S4203) route to the correct `set.php` URL pattern instead of `pieces{ID}.html`

---

## [3.12.01] - 2026-02-08

### Fixed — Sticky header

- **Sticky header fix**: Column headers now correctly pin at the top of the scrollable table during vertical scroll. Removed inline `position: relative` set by column-resize JS that overrode CSS `position: sticky` on all non-Actions headers
- **Scroll container fallback**: Portal scroll container now has a CSS `max-height: 70vh` fallback so sticky headers work even before JS measures exact row heights
- **Specificity fixes**: Removed `position: relative` from `th[data-column="purchasePrice"]` and `th.icon-col` CSS rules that outranked the sticky rule
- **Overflow fix**: `.table-section` now uses `overflow: visible` to prevent base `section{overflow:hidden}` from creating a competing scroll context

---

## [3.12.00] - 2026-02-08

### Feature — Portal View (Scrollable Table)

#### Added

- **Portal view**: Inventory table now renders all items in a scrollable container with sticky column headers — replaces slice-based pagination
- **Visible rows control**: Dropdown (10 / 15 / 25 / 50 / 100) sets the viewport height of the scrollable table; users scroll to see remaining items
- **Sticky headers**: Column headers stay pinned at the top during vertical scroll via CSS `position: sticky`

#### Changed

- **"Items per page" → "Visible rows"**: Label updated in both the table footer dropdown and the Settings modal
- **Table footer simplified**: Item count + visible-rows dropdown only; pagination bar (first/prev/1/2/3.../next/last) removed entirely

#### Removed

- **Pagination controls**: `calculateTotalPages()`, `renderPagination()`, `goToPage()` functions removed from `pagination.js`
- **Placeholder rows**: Empty padding rows no longer rendered to maintain fixed table height
- **`currentPage` state**: Page tracking variable and all associated resets removed from state, events, search, filters, and settings modules
- **Pagination CSS**: All `.pagination-*` rules and responsive overrides deleted

---

## [3.11.00] - 2026-02-08

### Feature — Unified Settings Modal

#### Added

- **Settings modal**: Consolidated API, Files, and Appearance into a single near-full-screen modal with sidebar navigation (Site, API, Files, Cloud, Tools)
- **Settings button**: Gear icon replaces API, Files, and Theme buttons in the header — now just About + Settings
- **Theme picker**: 3-button theme selector (Light, Dark, Sepia) in Site Settings replaces the cycling toggle button
- **Items per page persistence**: Items-per-page setting now persists to localStorage via `ITEMS_PER_PAGE_KEY` — no longer resets to 25 on reload
- **Tabbed API providers**: API provider configuration uses tabbed panels (Metals.dev | Metals-API | MetalPriceAPI | Custom) instead of scrollable list
- **Settings footer**: Storage usage and app version displayed in the modal footer bar
- **Cloud & Tools placeholders**: Sidebar sections ready for future BYO-Backend sync and bulk operations
- **Bidirectional control sync**: Filter chip threshold and smart name grouping controls sync between inline controls and Settings modal

#### Changed

- **Header simplified**: 4 header buttons (About, API, Files, Theme) reduced to 2 (About, Settings)
- **API providers inline**: Provider configuration moved from separate `apiProvidersModal` into tabbed panels within the API section
- **Backup reminder**: Now opens Settings → Files section instead of standalone Files modal

#### Removed

- **`apiModal`**: Standalone API modal replaced by Settings → API section
- **`filesModal`**: Standalone Files modal replaced by Settings → Files section
- **`apiProvidersModal`**: Standalone providers modal replaced by inline tabbed panels
- **`appearanceBtn`**: Theme cycling button replaced by Settings → Site → Theme picker

## [3.10.01] - 2026-02-08

### Fix — Numista iframe blocked on hosted sites + column sort regression

#### Fixed

- **Numista iframe → popup**: Numista sets `X-Frame-Options: SAMEORIGIN`, which blocks iframe embedding on hosted deployments (worked on `file://` but not `www.staktrakr.com`). Replaced the iframe modal with a popup window that works everywhere. Removed modal HTML, iframe CSS, and navigation history code
- **Gain/Loss and Source column sorting**: Skip guard used `headers.length - 3` from when Edit/Notes/Delete were 3 separate columns — after merging into a single Actions column, Gain/Loss (index 9) and Source (index 10) were incorrectly skipped. Fixed to `headers.length - 1`
- **Gain/Loss and Source column resizing**: Same `length - 3` guard also blocked resize handles on these columns

## [3.10.00] - 2026-02-08

### Feature — Serial #, Numista UX, Filter Chips & Column Tweaks

#### Added

- **Serial # field**: New optional Serial Number input in the add/edit form (between Storage Location and Catalog N#) for bars and notes with physical serial numbers
- **Serial # in exports/imports**: Serial Number included in CSV, JSON, ZIP, and PDF exports; imported from CSV and JSON with `Serial Number` / `serialNumber` column fallbacks
- **Enhanced Numista no-results**: When Numista search returns no results, the modal now shows a retry search box (pre-filled with original query) and a quick-pick list of popular bullion items (Silver Eagles, Maple Leafs, Krugerrands, etc.)
- **Year/Grade/N# filter chips**: Year, Grade, and Numista ID values now generate clickable filter chips in the chip bar (respects minCount threshold)
- **Year sort tiebreaker**: Items with identical names now sub-sort by Year when sorting the Name column

#### Changed

- **Source column**: "Location" table header renamed to "Source" with storefront icon for clarity (data field unchanged: `purchaseLocation`)
- **eBay search includes year**: Year is now appended to eBay search URLs between metal and name for more precise results
- **Form layout**: Notes field moved to end of form (next to Catalog N#); Serial # takes its former position next to Storage Location

#### Fixed

- **Numista Aurum category**: Removed incorrect `'Aurum': 'banknote'` mapping — Goldbacks are "Embedded-asset notes" on Numista, which isn't a valid API category filter. Aurum items now search without a category constraint, returning correct results
- **eBay search attribute escaping**: Switched from `sanitizeHtml()` to `escapeAttribute()` for `data-search` attributes — item names with double quotes no longer truncate the search URL

## [3.09.05] - 2026-02-08

### Feature — Grade, Grading Authority & Cert # Fields + eBay Search Fix

#### Added

- **Grade field**: New optional Grade dropdown with 3 optgroups — Standard (AG through BU), Mint State (MS-60 through MS-70), and Proof (PF-60 through PF-70)
- **Grading Authority field**: Dropdown to select grading service — PCGS, NGC, ANACS, or ICG
- **Cert # field**: Free-text input for certification number
- **Inline Grade tag**: Color-coded grade badge on inventory table Name cell (after N# tag) — PCGS blue, NGC gold, ANACS green, ICG purple. Theme-aware across light/dark/sepia
- **Cert verification click**: Grade tags with cert numbers are clickable — opens grading service's cert lookup page in a popup window (PCGS and NGC direct lookup, ANACS and ICG generic verify pages)
- **Grade tooltip**: Hover shows grading details — authority + cert# when available, or just grade
- **Grade in CSV/JSON/PDF export**: Grade, Grading Authority, and Cert # columns added to all export formats
- **Grade in CSV/JSON import**: Reads grade, authority, and cert# from imported files with multiple column name fallbacks

#### Fixed

- **eBay search URL sanitization**: Item names containing quotes `"`, parentheses `()`, or backslashes `\` (allowed since v3.09.04) no longer act as eBay search operators. New `cleanSearchTerm()` strips these characters before building search URLs

## [3.09.04] - 2026-02-08

### Feature — Year Field + Inline Year Tag + Form Restructure

#### Added

- **Year field**: New optional Year field in add/edit form, stored as `year` in the data model. Accepts single years ("2024") or ranges ("2021-2026")
- **Inline Year tag**: Year badge displayed on the inventory table Name cell (before the N# tag) with muted informational styling and theme-aware colors
- **Year in Numista field picker**: Replaced Metal with Year in the "Fill Form Fields" picker — Numista's year range is editable before filling
- **Year in CSV/JSON export**: "Year" column added to standard CSV export after "Name"; `year` field added to JSON export
- **Year in CSV import**: Reads "Year", "year", or "issuedYear" columns from imported CSV files

#### Changed

- **Form layout restructured**: Name (wider, 60%) paired with Year (40%); purchase fields grouped together: Purchase Date | Purchase Price, Purchase Location | Retail Price
- **Removed Metal from Numista picker**: Numista returns "Alloy/Other" which never matches form options — removed to reduce confusion
- **Data migration**: Existing items with `issuedYear` (from Numista CSV imports) automatically migrate to `year` on load

## [3.09.03] - 2026-02-08

### Patch — Numista Field Picker Layout + Smart Category Search

#### Fixed

- **Numista field picker layout**: Replaced broken `<fieldset>` + flexbox with `<div>` + CSS Grid (`grid-template-columns: auto auto 1fr`) — fixes checkboxes centering and labels/inputs pushed off-screen across browsers
- **Numista search `category` param**: `searchItems()` now maps `filters.category` instead of `filters.metal` to the Numista API `category` parameter

#### Added

- **Smart category search**: Numista search now maps the form's Type field to Numista categories (Coin→coin, Bar/Round→exonumia, Note/Aurum→banknote) for more relevant results
- **Metal-augmented queries**: When Metal is set and not already in the search text, it's prepended to the query (e.g., Metal=Silver + "Eagle" → searches "Silver Eagle")

## [3.09.02] - 2026-02-08

### Patch — Numista API v3 Integration Fix

#### Fixed

- **Numista base URL**: Changed from `/api/v3` to `/v3` — the `/api` prefix does not exist in the Numista API
- **Numista lookup endpoint**: Changed from `/items/{id}?apikey=` to `/types/{id}?lang=en` with `Numista-API-Key` header authentication
- **Numista search endpoint**: Changed from `/items/search` to `/types` with `Numista-API-Key` header authentication
- **Numista search parameters**: `limit` → `count` (capped at 50), `country` → `issuer`, `metal` → `category`, added `page` and `lang=en`
- **Numista search response**: Changed from `data.items` to `data.types` to match actual API response structure
- **Numista field mapping**: `year` composed from `min_year`/`max_year`, `country` from `issuer.name`, `composition` handles string or object, `diameter` from `size`, `type` from `category`, `mintage` hardcoded to 0 (per-issue not per-type), `estimatedValue` from `value.numeric_value`, `imageUrl` from `obverse_thumbnail` with nested fallback, `description` from `comments`
- **localStorage whitelist**: Added `staktrakr.catalog.cache` and `staktrakr.catalog.settings` to `ALLOWED_STORAGE_KEYS` — without these, `cleanupStorage()` deleted catalog data on every page load

## [3.09.01] - 2026-02-07

### Patch — Name Chips + Silver Contrast Fix + Duplicate Chip Fix

#### Added

- **Normalized name chips**: Filter chip bar now shows grouped name chips (e.g., "Silver Eagle 15/164") that aggregate year variants, grades, and editions into a single clickable chip. Uses `normalizeItemName()` with the 280-entry `PREBUILT_LOOKUP_DATA` dictionary for grouping and `simplifyChipValue()` for display names. Respects the minCount dropdown threshold and the `GROUPED_NAME_CHIPS` feature flag (Smart Grouping toggle)
- **Name chip click filtering**: Clicking a name chip filters the inventory to all matching variants (e.g., clicking "Silver Eagle" shows all American Silver Eagle items regardless of year). Click again to toggle off. Uses the existing grouped filter path in `applyQuickFilter()`

#### Fixed

- **`normalizeItemName()` rewrite — precise starts-with matching**: Replaced the fuzzy matching algorithm (partial word match, reverse contains) with a precise "starts-with, longest match wins" strategy. The old algorithm matched any 2 shared words — causing "American Silver Eagle" to incorrectly match "American Gold Eagle" (sharing "American" + "Eagle"), since Gold came first in the lookup array. The new algorithm strips year prefixes (with mint marks like P/S/D), weight prefixes, then checks if the cleaned name starts with a `PREBUILT_LOOKUP_DATA` entry at a word boundary. For items not in the lookup, suffix stripping removes grading (PCGS, NGC, NCG), grades (MS70, PR69), condition (BU, Proof, Antiqued, Colorized), and packaging (In Capsule, TEP, Sealed) to produce a clean base name
- **Silver chip contrast on dark/sepia themes**: Silver metal chip text was nearly invisible on initial page load in dark and sepia themes — white text on a light gray background. Root cause: `renderActiveFilters()` computed contrast colors against `:root` CSS variables before the `data-theme` attribute was applied. Fix: apply the saved theme attribute before Phase 13 rendering, so `var(--silver)` resolves to the correct theme value when `getContrastColor()` runs
- **Duplicate location chips**: Clicking a purchase or storage location chip produced two chips — a category summary chip and an active filter chip. Expanded the dedup skip list in the active filters loop to include `purchaseLocation`, `storageLocation`, and `name` fields alongside the existing `metal` and `type`

## [3.09.00] - 2026-02-07

### Increment 8 — Filter Chips Cleanup + Spot Card Hint

#### Added

- **Spot card shift+click hint**: When no spot price data exists for a metal, the timestamp area shows "Shift+click price to set" instead of blank — serves as discoverability training for the shift+click manual entry pattern. Hint disappears once a price is entered (manual or API)

#### Changed

- **Default chip threshold**: Filter chips now appear at 3+ items by default (was 100+), making them immediately useful on typical inventories
- **Unified threshold application**: Purchase and storage location chips now respect the minCount dropdown — previously they showed all locations regardless of count
- **Date chips removed**: Date-based filter chips are removed entirely (too granular to be useful as filters)
- **"Unknown" location chips suppressed**: Empty and "Unknown" purchase/storage location values no longer produce filter chips
- **Dropdown filters migrated to activeFilters**: Type and Metal `<select>` dropdowns now write to the unified `activeFilters` system and update chips immediately

#### Removed

- **Dead `updateTypeSummary()` function**: Removed the legacy chip renderer and its `#typeSummary` container — fully replaced by `renderActiveFilters()`
- **Dead `columnFilters` state**: Removed the legacy filter object and all reads/writes across `state.js`, `filters.js`, `events.js`, and `search.js` — all filtering now uses the unified `activeFilters` system
- **Stale console.log statements**: Removed 9 debugging `console.log()` calls from chip rendering (opt-in `DEBUG_FILTERS` logging preserved)

#### Fixed

- **Chips update after all mutations**: `renderActiveFilters()` is now called after delete, backup restore, inventory wipe, and add/edit modal submit — previously chips could show stale counts after these operations

## [3.08.01] - 2026-02-07

### Patch — Move Metals Totals Above Inventory Table

#### Changed

- **Layout reorder**: Moved the per-metal portfolio summary cards (`.totals-section`) above the inventory table so the page flows: Spot Price Cards → Metals Totals → Search/Table/Pagination. Puts the portfolio bottom line closer to spot prices for an overview-first information hierarchy
- **Sparkline colors match metal accent**: Sparkline trend lines now read the active theme's CSS custom properties (`--silver`, `--gold`, `--platinum`, `--palladium`) instead of hardcoded colors, matching the totals card accent bars across all themes
- **Default rows per page**: Changed from 10 to 25; removed 10 and 15 row options from the dropdown (25 / 50 / 100 remain)

## [3.08.00] - 2026-02-07

### Increment 7 — Spot Price Card Redesign with Sparkline Trends

#### Added

- **Background sparkline charts**: Each spot price card now shows a Chart.js line chart with gradient fill behind the price, visualizing price trends from spot history. Minimum 2 data points required; empty state shows the card normally without a sparkline
- **Trend range dropdown**: Per-card `<select>` with 7d / 30d / 60d / 90d options. Preference saved to localStorage per metal, restored on load
- **Sync icon**: Compact SVG refresh icon in the card header replaces the old Sync button. Spins during API fetch via CSS animation. Disabled when no API is configured
- **Shift+click manual price entry**: Hold Shift and click the spot price value to open an inline `<input>` — same pattern as inventory table inline editing. Enter saves, Escape/blur cancels. New data point appears in sparkline immediately

#### Changed

- **Removed expandable button panel**: The old Sync / Add / History button row (`.spot-actions`) and manual input form (`.manual-input`) are removed entirely. Sync is now an icon, manual entry is shift+click, and history is the sparkline itself
- **Card layout**: Spot cards now use a header row (label + controls) above the price value, with an absolutely-positioned canvas behind all content for the sparkline
- **Spot history dedup**: `recordSpot()` now performs full-array dedup (via `.some()`) when an explicit timestamp is provided (historical backfill), preventing duplicate entries on repeated syncs with 30-day backfill

#### Fixed

- **Metals.dev timeseries endpoint**: Batch endpoint was using non-existent `/metals/spot?days=N` — replaced with actual `/timeseries?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`. Response parser rewritten to handle the real `{ rates: { "date": { metals: { gold: N } } } }` structure
- **History metal name mismatch**: `METALS[metal]?.name` used lowercase key (`"silver"`) against uppercase `METALS` keys (`"SILVER"`), causing history entries to record with wrong metal name. Fixed to use `Object.values(METALS).find()` lookup

#### Technical

- New `sparklineInstances` state object for Chart.js instance cleanup
- New `SPOT_TREND_RANGE_KEY` localStorage key with security whitelist entry
- `updateAllSparklines()` called from: init, sync, cache refresh, theme change, range dropdown change, manual price save
- Capture-phase shift+click listener for `.spot-card-value` elements

## [3.07.03] - 2026-02-07

### Patch — Spot History Deduplication Fix

#### Fixed

- **Duplicate spot history entries on repeated syncs**: `recordSpot()` only compared against the last array entry, so batch historical backfills (30 days × 4 metals) re-inserted the same timestamp+metal pair on every sync. Now performs full-array dedup via `.some()` when an explicit timestamp is provided (historical backfill), while keeping the fast O(1) tail check for real-time entries

## [3.07.02] - 2026-02-07

### Patch — Shift+Click Inline Editing

#### Added

- **Shift+click inline editing**: Power user shortcut — hold Shift and click any editable cell (Name, Qty, Weight, Purchase Price, Retail Price, Purchase Location) to edit in place. Enter saves, Escape cancels, clicking away cancels. No visible UI indicator — keyboard-only trigger
- **Blur-to-cancel**: Clicking outside an active inline edit now cancels it, matching standard spreadsheet UX

#### Changed

- **Removed pencil icon**: Name column no longer shows the pencil edit icon — shift+click replaces it for all 6 editable columns
- **Removed save/cancel icons**: Inline edit fields no longer show ✔️/✖️ buttons — Enter and Escape are the only controls, keeping the cell compact
- **Hidden number spinners**: Numeric fields (Qty, Weight, prices) no longer show browser-native up/down arrows that competed for space in narrow cells
- **Full table re-render on save**: Inline edits now trigger `renderTable()` instead of patching a single cell — ensures Gain/Loss recalculates, summary cards update, and eBay link structure restores correctly
- **Sort header shift guard**: Shift+clicking a column header no longer triggers a sort, preventing accidental sorts while aiming for cell edits

## [3.07.01] - 2026-02-07

### Patch — Light & Sepia Theme Contrast Pass

#### Changed

- **Light theme: clean backgrounds**: Replaced gray-blue layering (`#e7edf2` / `#d7dfe6` / `#bec7cf`) with a clean light palette (`#eef2f7` / `#e2e8f0` / `#d5dce6`). Cards now use pure white (`#ffffff`) for clear visual elevation against the cool gray page background. All text tokens pass WCAG AAA
- **Table zebra striping**: Replaced hardcoded dark-theme `rgba(30, 41, 59)` overlays with theme-aware `var(--bg-secondary)` / `var(--bg-tertiary)` tokens so row alternation and hover work correctly in all three themes
- **Table hover cleanup**: Removed `filter: brightness()` and cell-level hover transitions from inventory table — hover is now a simple row background change with no lag
- **Removed sticky action columns**: Edit/Copy/Delete columns no longer use `position: sticky` — table fits viewport without horizontal scroll, eliminating the z-index and background inheritance complexity
- **Confidence styling**: Replaced opacity-based dimming with `color: var(--text-muted)` for estimated Retail/Gain-Loss values — readable in all themes while italic style distinguishes from bold confirmed values
- **Metal/type text contrast**: Darkened metal (`--silver`, `--gold`, `--platinum`, `--palladium`) and type (`--type-coin-bg`, `--type-bar-bg`, etc.) color tokens for both light and sepia themes so they pass WCAG AA (4.5:1) when used as text colors in table cells
- **Sepia theme: removed global sepia filter**: Deleted `filter: sepia(30%)` that over-saturated the entire UI and made WCAG ratios unpredictable from CSS values alone. The warm palette is now controlled entirely by custom properties
- **Sepia theme: WCAG text contrast fix**: Darkened `--text-secondary` (`#5a4a36` → `#4f3f2c`) and `--text-muted` (`#6f604e` → `#5c4e3a`) — muted text was failing WCAG AA at 3:1 ratio, now passes at 6.7:1
- **Sepia theme: warm info color**: Changed `--info` from bright sky-blue (`#0ea5e9`) to desaturated warm teal (`#1d7a8a`) to match the warm palette
- **Sepia theme: visible borders and shadows**: Fixed `--border-hover` (was identical to `--bg-tertiary`, now `#a89878`), strengthened `--shadow-sm` opacity from 0.05 to 0.12, lightened `--bg-tertiary` (`#c0b198` → `#d0c4a8`) for better separation

## [3.07.00] - 2026-02-07

### Increment 6 — Portfolio Visibility Overhaul

#### Added

- **Retail/Gain-Loss confidence styling**: Retail and Gain/Loss columns now visually differentiate estimated values (melt fallback — italic, 65% opacity) from confirmed values (manual retail — bold). Estimated gains carry the same muted styling so users can see at a glance which items have researched retail prices vs spot-derived estimates
- **"All Metals" summary card**: New combined totals card showing portfolio-wide Items, Weight, Purchase Price, Melt Value, Retail Value, and Gain/Loss. Previously the JS calculated these but the HTML card was missing — totals silently failed to display
- **Avg Cost/oz metric**: Each metal card and the combined card now show average purchase cost per troy ounce (total purchase / total weight). Key stacker metric for evaluating cost basis across a position
- **Gain/Loss "bottom line" emphasis**: The Gain/Loss row in each summary card now has a top separator, bolder label, and larger font to visually anchor it as the portfolio's bottom line
- **Metal detail modal: full portfolio breakdown**: Clicking a metal card header now shows Purchase, Melt, Retail, and Gain/Loss per type and per purchase location in a compact 2x2 grid layout. Previously only showed purchase price as a single value. Chart tooltips also show the full quartet
- **All Metals breakdown modal**: Clicking the "All Metals" card header opens a portfolio-wide breakdown — left panel shows by-metal allocation (Silver, Gold, Platinum, Palladium) with full financial grid, right panel shows by-location across all metals. Pie charts and tooltips included

#### Changed

- Removed inline asterisk `*` indicator from Retail column in favor of CSS class-based confidence styling (`retail-confirmed`, `retail-estimated`, `gainloss-estimated`)
- Removed orphaned `.about-badge-static` CSS class
- Metal detail breakdown rows restructured: header (name + count/weight) + 2x2 financial grid replaces the old stacked single-value layout

## [3.06.02] - 2026-02-07

### Patch — eBay Search Split (Buy vs Sold)

#### Changed

- **eBay search split**: Purchase column search icon now opens eBay **active listings** (items for sale), Retail column search icon opens eBay **sold listings** (completed sales for price research)
- **New functions**: Split `openEbaySearch()` into `openEbayBuySearch()` (active, Buy It Now, best match) and `openEbaySoldSearch()` (completed, most recent) in `js/utils.js`
- **Retail column search icon**: Added magnifying glass SVG icon to the Retail column, matching the Purchase column icon style

## [3.06.01] - 2026-02-07

### Patch — CSS Cleanup, Icon Polish, About Modal Overhaul

#### Changed

- **Dead CSS cleanup**: Removed ~125 lines of orphaned `.collectable-*` selectors (toggle, card, status, icon theming) left over from Increment 1's collectable feature removal
- **eBay search icon**: Replaced oversized emoji-in-red-circle with a clean 12px monoline SVG magnifying glass using `currentColor` — themes automatically, matches the external-link icon style
- **About modal**: Rewrote description to mention open source, privacy, and live site link. Added GitHub, Community, and MIT License links
- **Version modal**: Removed duplicated privacy notice from the What's New popup (kept in the first-visit acknowledgment modal)
- **Ack modal**: Updated description text to match the About modal wording
- **JS cleanup**: Removed orphaned `.collectable-status` querySelector from `hideEmptyColumns()` in inventory.js

## [3.06.00] - 2026-02-07

### Rebrand — StackTrackr → StakTrakr

#### Changed

- **Full rebrand to StakTrakr**: Updated canonical brand name from "StackTrackr" to "StakTrakr" across the entire codebase — inline SVG banner (all 3 themes), standalone logo SVG, HTML titles, aria-labels, footer copyright, about/acknowledgment modals, debug log prefix, backup/export templates, PDF headers, storage reports, constants, Docker labels/service names, and all documentation
- **Domain-based auto-branding**: Updated domain map to support three domains — `staktrakr.com` (primary, shows "StakTrakr"), `stackrtrackr.com` (legacy, shows "StackrTrackr"), `stackertrackr.com` (shows "Stacker Tracker"). Each domain automatically displays its own brand name via the existing `BRANDING_DOMAIN_OPTIONS` system
- **localStorage key prefix migration**: Renamed `stackrtrackr.*` keys to `staktrakr.*` (debug, catalog cache, catalog settings). Debug flag checks both old and new keys for backwards compatibility
- **Footer domain**: Default domain now shows `staktrakr.com`, with auto-detection for all three owned domains
- **Reddit community link**: Hardcoded to `/r/stackrtrackr/` (subreddit name unchanged)
- **GitHub link**: Added link to `github.com/lbruton/StackTrackr` in footer
- **Dynamic SVG logo**: Logo tspan text and SVG viewBox width now update per domain at page load — prevents clipping on longer names like "Stacker Tracker"
- **Dynamic footer brand**: Footer "Thank you for using ..." text now updates to match the domain brand name

## [3.05.04] - 2026-02-07

### Increment 5 — Fraction Input + Duplicate Item Button

#### Added

- **Fraction input for weight field**: Weight input now accepts fractions like `1/1000` or `1 1/2` (mixed numbers), auto-converted to decimal before saving. Input changed from `type="number"` to `type="text"` with `inputmode="decimal"` for mobile numeric keyboard
- **Duplicate item button**: New copy icon in the table action column (between Edit and Delete). Opens the add modal pre-filled with all fields from the source item — date defaults to today, qty resets to 1, serial clears. Ideal for entering mixed-date sets of the same coin

#### Changed

- **Notes column removed from table**: Removed the Notes icon column (15 → 14 columns). Notes remain accessible in the add/edit modal. Fixed sticky column CSS offsets for the new 3-icon layout (edit/duplicate/delete)
- **Sticky column background fix**: Removed a later CSS rule that set `background: transparent` on sticky icon columns, which would have made headers see-through during horizontal scroll

## [3.05.03] - 2026-02-07

### Increment 4 — Date Bug Fix + Numista API Key Simplification

#### Fixed

- **Date display off by one day**: `formatDisplayDate()` used `new Date("YYYY-MM-DD")` which parses as UTC midnight — in US timezones this rolled back to the previous day. Now parses the date string directly via `split('-')` with no `Date` constructor, eliminating timezone ambiguity entirely
- **Numista API key never persisted**: `catalog_api_config` was missing from `ALLOWED_STORAGE_KEYS`, so `cleanupStorage()` deleted the saved config on every page load

#### Changed

- **Numista API key storage simplified**: Removed the non-functional AES-256-GCM encryption system (~115 lines of `CryptoUtils` class) that required a per-session password. Replaced with base64 encoding matching the metals API key pattern — one input, no password, persists across sessions
- **Numista settings UI**: Removed encryption password field and session-unlock flow. Added Numista API signup link with free tier info

## [3.05.02] - 2026-02-07

### Changed

- **Full rebrand**: Renamed "StackrTrackr" to "StackTrackr" across entire codebase — SVG banner (all 3 themes), standalone logo, HTML titles, aria-labels, debug logs, backup/export templates, PDF headers, storage reports, constants, Docker labels, documentation, and CLAUDE.md
- **Footer cleanup**: Removed outdated "previous build" and "alpha release" links, simplified to subreddit and GitHub Issues reporting
- **Copyright**: Updated footer from "2025" to "2025-2026"

## [3.05.01] - 2026-02-07

### Fixed

- **What's New modal**: Changelog and roadmap sections now populate correctly — fetch points to root `CHANGELOG.md` instead of missing `docs/changelog.md`
- **Changelog parser**: Updated regex to match Keep a Changelog format (`## [X.XX.XX]`) instead of legacy `### Version X.XX.XX` format
- **GitHub URLs**: All 3 repository links (aboutModal, versionModal, View Full Changelog) updated from `Precious-Metals-Inventory` to `StackTrackr`
- **Embedded fallbacks**: Updated What's New and Roadmap fallback data with current Increment 3 content
- **Created `docs/announcements.md`**: Primary data source for What's New and Development Roadmap modal sections

## [3.05.00] - 2026-02-07

### Increment 3 — Unified Add/Edit Modal

#### Changed

- Merged `#addModal` and `#editModal` into a single `#itemModal` that switches between "add" and "edit" mode via `editingIndex`
- Consolidated two separate form submit handlers into one unified handler with `isEditing` branch
- Removed ~100 lines of duplicated edit modal HTML, ~20 duplicate element declarations, ~20 duplicate element lookups
- Files touched: `index.html`, `js/state.js`, `js/init.js`, `js/events.js`, `js/inventory.js`, `css/styles.css`, `js/utils.js`

#### Fixed

- **Weight unit bug**: edit modal was missing the weight unit `<select>` — used a fragile `dataset.unit` attribute invisible to the user. Now both modes share the real `<select id="itemWeightUnit">`
- **Price preservation**: empty price field in edit mode now preserves existing purchase price instead of zeroing it out
- **Weight precision**: `toFixed(2)` to `toFixed(6)` for stored troy oz values — sub-gram weights (e.g., 0.02g Goldbacks = 0.000643 ozt) were being rounded to zero, causing validation failures
- **$0 purchase price display**: items with price=0 (free/promo) now show `$0.00` instead of a dash, and gain/loss correctly computes full melt as gain
- **Qty-adjusted financials**: Retail, Gain/Loss, and summary totals now multiply per-unit `marketValue` and `price` by `qty`. Previously showed single-unit values for multi-qty line items
- **Gain/Loss sort order**: `js/sorting.js` cases 8 (Retail) and 9 (Gain/Loss) now use qty-adjusted totals matching the display
- **Spot price card colors**: `updateSpotCardColor()` in `js/spot.js` now compares against the last API/manual entry with a different price, so direction arrows (green / red) persist across page refreshes instead of always resetting to unchanged

## [0.1.0] - 2024-08-31

### Initial Release

- Initial StackTrackr precious metals inventory tracking application
- Client-side localStorage persistence with file:// protocol support
- Multiple spot price API providers (metals-api.com, fcsapi.com, etc.)
- CSV import/export functionality with ZIP backup support
- Premium calculation system for precious metals (spot price + premium)
- Responsive theme system with four modes (light/dark/sepia/system)
- Real-time search and filtering capabilities across inventory
- PDF export with customizable formatting and styling
- Comprehensive debugging and logging system
- Security-focused development patterns and file protocol compatibility
- RESTful API abstraction layer supporting multiple data providers
- Advanced data manipulation utilities for date parsing and currency conversion
