---
doc_type: research
source: manual
status: exploratory
project: staktrakr
created: "2026-04-11"
updated: "2026-04-11"
related-issues: []
tags: [api, database]
---

# StakTrakr API Sponsor Tier — Monetization Research

Phase 0 research brief exploring an optional sponsor-funded API tier for StakTrakr. Core app stays free forever; free API tier stays daily; sponsor-keyed API tier unlocks hourly retail vendor market data. Captures the internal audit of prior public promises, the market research on FOSS+paid precedents, competitor API pricing, legal posture for republishing scraped bullion prices, architectural open questions, and messaging direction. **Not a decision document** — input material for a future `/discover` pass when this moves from theory to plan.

## Context

StakTrakr is a free, open-source, privacy-first precious metals portfolio tracker. Runs as a single-page app on localStorage, zero backend from the user's perspective. Behind the scenes there is a substantial data infrastructure: a home-lab retail price scraper, a Fly.io publisher, a Turso DR mirror, and a dual GitHub-Pages-fronted API (`api.staktrakr.com` + `api1.staktrakr.com`) providing spot prices and retail vendor price feeds to the app. See ../../Projects/StakTrakr/Depreciated/Architecture (archived), ../../Projects/StakTrakr/Depreciated/Home Poller (archived), ../../Projects/StakTrakr/Depreciated/Remote Poller (archived), [../../Projects/StakTrakr/Depreciated/API Reference](/Volumes/DATA/GitHub/HexTrackr/DocVault/API%20Reference.md), ../../Projects/StakTrakr/Depreciated/API Consumption (archived).

A conversation with a peer raised the point that **the real market value of StakTrakr is the API + scraper fleet**, not the free web app. This triggered a strategic reconsideration: should there be an optional paid tier on the API to offset Fly.io and MetalpriceAPI costs, while keeping the app itself free forever and the scraper code open source?

The owner was initially concerned this would break a "free forever" promise. Research shows **the promise was written with a carve-out specifically for the API side**, and the architecture (`api1.staktrakr.com` GitHub Pages fallback + alternative spot providers in `api-consumption.js`) was pre-emptively designed to support exactly this split. This brief exists to move the conversation past the ethical question (resolved) and onto the tactical, architectural, and messaging questions that actually need work.

## Prior Commitments Audit

Two places of record were checked: the public site copy shipping in `index.html` / `about.html`, and the `lbruton` mem0 corpus tagged `project: staktrakr`.

### Public site copy (shipping in production)

| Location                                             | Text                                                                                                                                                                                                                         | Interpretation                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html:3989` (About modal)                      | "**No subscription** — the core app is free forever; optional sponsor perks cover infrastructure costs"                                                                                                                      | Explicit escape hatch. Sponsors are named. Infrastructure-cost framing matches current thinking exactly.                                                                                                                            |
| `index.html:4008` (About modal, API section)         | "The hourly API spot prices are provided on a best-effort basis. If infrastructure costs become unsustainable, that service may be reduced — but the app itself, and Dropbox sync, will always remain free and open source." | Explicit "best effort" SLA on hourly API. Explicit possibility of reduction. App + Dropbox sync carved out as unconditional.                                                                                                        |
| `about.html:423` (marketing page)                    | "Every feature is free. No paywalls, no premium tiers, no 'upgrade to unlock.'"                                                                                                                                              | Strongest absolute promise. Refers to **app features**, not external data service. Probably requires a light rephrase if sponsor tier ships — "upgrade to unlock" is the specific phrase that could feel violated if not re-framed. |
| `index.html:46` / `about.html:7` (meta descriptions) | "Free, open source, no data collected"                                                                                                                                                                                       | No conflict with API tier — says nothing about API pricing.                                                                                                                                                                         |

### mem0 corpus findings (tagged `topic: monetization`)

Two memories, both dated **2026-02-21**, authored by past-self:

1. _"StakTrakr software remains free forever."_
2. _"StakTrakr Tier 1 costs $0.99 per month and includes settings sync; core app and Dropbox sync remain free."_

These two memories coexist in the active corpus, neither marked superseded. **Past-self explicitly reconciled "free forever" with "$0.99 tier"** and was comfortable enough to save both. Notable scope difference: past-self scoped the $0.99 tier to _settings sync_, not API throughput — a different wedge than the one being considered now, but within the same monetization boundary.

### Conclusion

There is no broken promise. The API was never promised; it was explicitly called "best-effort" in the About modal. The site copy has a carve-out naming sponsors and infrastructure costs. Past-self already committed to the same price point. The alternative-spot-provider architecture in the frontend exists specifically so StakTrakr's own API is not load-bearing for the free-app promise.

The single copy line that needs a rewrite before any sponsor tier ships: `about.html:423` — "No paywalls, no premium tiers, no 'upgrade to unlock.'" This was written about in-app feature gating, not external data services, but the phrase "upgrade to unlock" is close enough to what a sponsor key does that it should be re-worded to make the distinction explicit.

## Product Definition

Captured verbatim from the 2026-04-11 ideation session, because the framing is unusually clean and should be preserved before it decays:

> "I'm offering an alternative: a tracker that you can use to track your own metals, with that website's core draw built in, and I'll give you a daily snapshot for free. If you toss me a buck a month, I'll give you my best efforts at hourly updates."

> "The core thing was free forever. The API has never been promised. It's why we built in support for other providers for spot data. And the market plugins, well, we are the only API provider, so yes I'll want to provide something for free. As long as I'm running the app for myself I'll feed the market data into the API — but I'm gathering it hourly, and there are ways to slice that up to have both a free model and a perk."

> "A dollar a month keeps your hourly updates intact and helps keep the API online for the entire community."

### The sustainability pitch (unique to StakTrakr's posture)

> "I'm scraping this data for myself anyway. Sponsors aren't buying my labor — they're buying a share of the server cost to keep me running it publicly."

This is architecturally honest and materially different from a SaaS pitch. It maps closer to Wikipedia's "keep the lights on" appeal or a community-garden donation box than to a typical open-core subscription. It is load-bearing for community trust and should be preserved in any launch copy.

### What's actually monetized

- **Free tier (daily snapshot):** Retail vendor market data refreshed once per day. Served from `api1.staktrakr.com` (GitHub Pages, zero marginal cost). Spot prices continue to come from existing alternative providers the frontend already supports.
- **Sponsor tier (hourly, best-effort):** Retail vendor market data refreshed hourly. Spot prices at hourly cadence as a convenience. Served from a key-gated endpoint (Fly.io or direct-from-home-poller — not GitHub Pages, which cannot gate). Key delivered via GitHub Sponsors or Stripe, stored client-side in localStorage.
- **Not monetized (ever):** The app itself, user inventory storage, Dropbox sync, image storage, vendor-aware retail comparisons against the user's own data, scraper source code, API reference documentation, OpenAPI schema.

### The actual moat

External research confirms that **spot prices are not a moat** — `GoldAPI.io` offers free real-time spot data, and [MetalpriceAPI](https://metalpriceapi.com/pricing/) / [Metals-API](https://metals-api.com/pricing) have free tiers with generous limits. Anyone can get free spot prices with minimal friction.

**The retail vendor price aggregation is the moat.** Nobody else is running the scraper fleet StakTrakr runs across SD Bullion, APMEX, Monument Metals, JM Bullion, Bullion Exchanges, and Hero Bullion. Nobody else has done the vendor-quirk normalization documented in ../../Projects/StakTrakr/Depreciated/Vendor Quirks (archived) (Magento 2 GraphQL endpoint mapping, CF bypass tactics, TLS fingerprint matching, tiered payment-method price extraction). That work took real time and real reverse-engineering, and it is genuinely unique.

Any monetization story should lead with retail vendor data. Spot prices are a convenience rider, not the product.

## Market Research — FOSS + Optional Paid Tier Precedents

Five precedents in the $1–$9/mo range, surveyed for positioning, pricing, and community sentiment. Source: firecrawl research pass 2026-04-11.

| Project                              | Free Tier                                       | Paid Tier                                           | Framing                                           | Community Sentiment                                                   | Source                                                        |
| ------------------------------------ | ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Bitwarden**                        | Unlimited passwords forever, self-hostable      | **$1/mo** Premium (authenticator, security reports) | "Optional QoL upgrade"                            | Positive — treated as tip with benefits                               | [bitwarden.com/pricing](https://bitwarden.com/pricing/)       |
| **Obsidian**                         | App free forever                                | Sync $4/mo (annual), Publish $8/mo                  | "Optional utility"                                | Positive — zero backlash                                              | [obsidian.md/pricing](https://obsidian.md/pricing)            |
| **Home Assistant Cloud** (Nabu Casa) | Core HA free, self-hostable                     | $6.50/mo (monthly) or $65/yr                        | "Supports the project + convenience"              | Mixed-but-stable — "worth it if you value voice"                      | [nabucasa.com/pricing](https://www.nabucasa.com/pricing/)     |
| **Sentry**                           | 5K errors/mo Developer tier                     | $26/mo Team, self-host free                         | Open-core; self-host has no licensing enforcement | Positive for self-host, neutral for paid                              | [sentry.io/pricing](https://sentry.io/pricing/)               |
| **Plausible Analytics**              | **No free cloud tier** (self-host free forever) | $9/mo cloud                                         | "Pay or self-host"                                | **Friction** — public threads call it "non-starter for FOSS projects" | [plausible/analytics](https://github.com/plausible/analytics) |

### Key patterns

1. **The Bitwarden model is the closest fit.** Free forever core, open source, self-hostable, $1/mo for optional QoL. Price point matches past-self's mem0 commitment. Community reaction to Bitwarden Premium is the reaction StakTrakr would want. This is the template to copy.
2. **Price floor is not the issue — perceived value is.** Obsidian charges 4× what Bitwarden does for Sync and has zero backlash. The right price is whatever feels like a fair trade for the feature, not whatever is lowest.
3. **Plausible is the cautionary tale.** Their mistake was _eliminating_ the free cloud tier while charging $9/mo for paid. StakTrakr is structurally immune: `api1.staktrakr.com` costs zero to run (GitHub Pages) and will always exist as the free path. Plausible-style friction cannot happen here.
4. **"Sponsor" beats "subscriber" for community sentiment.** Nabu Casa's entire posture is "support the project." StakTrakr's sustainability-pitch framing extends this even further.
5. **Self-hostability is trust insurance.** All five precedents either are self-hostable or offer self-hosting. StakTrakr's scraper is open source and self-hostable today — that asset should be loudly advertised alongside any paid-tier launch, with a genuine `docker compose up` path documented so the self-host option is real, not theoretical.

## Market Research — Precious Metals API Competitive Pricing

| API               | Free Tier                         | Cheapest Paid                            | Notes                                                   | Source                                                          |
| ----------------- | --------------------------------- | ---------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| **GoldAPI.io**    | 100% real-time, free forever      | No paid tier advertised                  | Direct competitor on **spot**, not retail vendor prices | [goldapi.io](https://www.goldapi.io/)                           |
| **MetalpriceAPI** | 100 requests/mo, no CC            | Custom enterprise tiers only at 500K+/mo | Gatekeeper for real volume                              | [metalpriceapi.com/pricing](https://metalpriceapi.com/pricing/) |
| **Metals-API**    | 2,500 requests/mo + 10-min delays | $0.032/request pay-as-you-go             | Closest published per-request pricing                   | [metals-api.com/pricing](https://metals-api.com/pricing)        |
| **Metals.Dev**    | 100 requests/mo, 60-sec delay     | Pay-as-you-go beyond free                | Developer-focused                                       | [metals.dev/pricing](https://metals.dev/pricing)                |

### Positioning findings

- **$0.99/mo would be below every published paid tier** in the precious metals API space. It is a legitimate price-leader.
- **GoldAPI.io provides free real-time spot data.** This is the single most important competitive finding: spot prices are commoditized to zero. Any monetization pitch leading with "pay for hourly spot prices" will be correctly dismissed by anyone who knows the space.
- **No competitor publishes normalized retail vendor market data as an API.** StakTrakr's retail market matrix has no direct API-accessible equivalent anywhere on the public internet. Sites like findbullionprices.com offer similar data but are ad-supported web homepages, not APIs.
- **The "ad-covered homepage that feels like malware" framing is real marketing leverage.** StakTrakr's positioning against that experience ("same core market data in a clean, private, ad-free tracker you own") is a genuine product differentiator and should anchor the launch pitch.

## Legal Posture — Republishing Scraped Bullion Vendor Prices

Source: firecrawl pass on public vendor ToS + class-action / precedent search.

| Vendor         | Public ToS Relevant Language                                                                                                                                                                                                                                              | Red Flags  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **SD Bullion** | No anti-scraping clauses found. Ongoing class action re: false "lowest price" claims ([topclassactions.com](https://topclassactions.com/lawsuit-settlements/lawsuit-news/sd-bullion-class-action-claims-company-falsely-advertises-its-prices/)) — unrelated to scraping. | None found |
| **APMEX**      | Refund + market-loss policies documented. No "automated access" or "reproduction" prohibitions in public policy. ([apmex.com/orderingpolicy](https://www.apmex.com/orderingpolicy))                                                                                       | None found |
| **JM Bullion** | No anti-scraping clause found in public ToS.                                                                                                                                                                                                                              | None found |

### Industry context

- Apify maintains public, documented scrapers for SD Bullion, APMEX, JM Bullion, and Monument Metals. They have no takedown history.
- Industry practice among bullion dealers is **passive tolerance** of price aggregators.
- Price-comparison aggregation of publicly posted prices is a well-trodden legal path in other commodity markets (flights, hotels, electronics).

### Caveats and gating conditions

1. **Republishing prices only** (not product descriptions, images, catalog structure, or proprietary identifiers) is the defensible posture. StakTrakr already does this.
2. **Free republishing and paid republishing are legally different conversations.** This research was a first pass on free redistribution. Before any paid launch — meaning any launch where a user exchanges money for access to retail vendor data — a fresh per-vendor ToS read is required, and a short lawyer opinion is probably cheap insurance once revenue becomes non-trivial.
3. **Scale matters.** A free tool serving a "small handful of users" is different from a commercial API serving enterprise customers. As long as StakTrakr stays small and the sponsor tier is framed as cost recovery, risk remains minimal.

### Conclusion

**No known legal blocker for Phase 0 or Phase 1 work.** A real per-vendor ToS re-read is required before any v1 launch that takes money. Flagged as required homework, not a blocker for architecture planning.

## Architecture Considerations

### Endpoint routing

The existing dual-endpoint architecture maps naturally onto a free/sponsor split, but one constraint is load-bearing:

**GitHub Pages cannot gate access to anything.** Any path on `api1.staktrakr.com` is publicly downloadable by definition. Therefore the sponsor-only path cannot live on GitHub Pages. It must live on Fly.io, on a new dedicated endpoint (e.g. `api3.staktrakr.com`), or on a direct-exposed home-poller endpoint.

| Option                                                             | Pros                                                        | Cons                                                                                                      |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **A. New `api3.staktrakr.com` on Fly.io**                          | Clean separation, obvious naming, room for future expansion | Another app to maintain, more DNS, more TLS certs                                                         |
| **B. Key-gated `/sponsor/*` path on existing `api.staktrakr.com`** | No new infrastructure, uses existing Fly.io app             | Harder to reason about caching, risk of accidentally exposing gated content through existing cache layers |
| **C. Direct-expose home poller**                                   | Zero cloud cost, data lives where it's scraped              | Home IP exposed, residential ISP reliability, needs reverse proxy + TLS                                   |

**Preliminary lean: Option A.** Clean conceptual split, no entanglement with existing free-tier endpoints, and the naming convention (`api1` free, `api` hourly, `api3` sponsor-hourly) is legible even without documentation.

### Frontend Promise.any() racing compatibility

The frontend currently races `api.staktrakr.com` and `api1.staktrakr.com` via `Promise.any()` for spot hourly data (see ../../Projects/StakTrakr/Depreciated/API Consumption (archived)). A sponsor key adds a third racer that only sponsor-key-holding browsers know about. Free users race two endpoints, sponsors race three. No change required to the racing pattern itself — just a conditional third entry in the endpoint list when a sponsor key is present in localStorage.

### Sponsor key distribution mechanism

This is the least-solved and most weekend-consuming part of the plan.

| Option                      | Fit                                                               | Risk                                                      |
| --------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| **GitHub Sponsors**         | FOSS-native, matches brand, webhook-driven auto-issuance possible | Manual key delivery unless webhook plumbing is built      |
| **Stripe subscription**     | Standard, reliable, good tooling                                  | Requires a minimal backend, account management, invoicing |
| **Buy Me a Coffee / Ko-fi** | Minimal ops, community-friendly                                   | Manual key delivery, weaker recurring-billing primitives  |
| **Patreon**                 | Community-friendly                                                | Platform lock-in, manual delivery                         |

**Client-side key format:** The zero-backend pattern of StakTrakr suggests a signed token (JWT or HMAC) stored in `localStorage`, with signature verification at the endpoint. The app's existing allowed-storage-keys guard in `constants.js:871` is the pattern to extend.

**Preliminary lean: GitHub Sponsors primary + Stripe fallback.** GitHub Sponsors is FOSS-native and brand-aligned; Stripe is the escape hatch if GitHub Sponsors cannot automate key delivery cleanly enough.

### Fallback UX — when "best effort" hourly fails

When the sponsor hourly endpoint is unavailable, what does the user see?

- **Silent fallback to daily** — simplest, but violates the honesty-in-communication posture.
- **Explicit "hourly unavailable, showing daily" banner** — honest, matches the "best-effort SLA" messaging, preserves trust.
- **Explicit error + no data** — worst option, breaks user experience for something they paid for.

**Preliminary lean: explicit banner.** Honesty-in-communication is load-bearing for the whole sustainability pitch.

### Non-sponsor experience at the sponsor endpoint

What happens when a non-sponsor's browser hits the gated endpoint? Three options:

- **404** — hostile, feels closed
- **401 with bare error** — technically correct, unfriendly
- **401 with human-readable upgrade prompt** — welcome mat with a sign

**Preliminary lean: 401 with upgrade prompt.** Matches the welcome-mat posture consistent with the sustainability pitch.

## Open Questions

These are the five questions that a future `/discover` pass needs to resolve before any implementation work.

1. **Sponsor tier scope.** Past-self (2026-02-21) scoped the $0.99 tier to _settings sync_. This brief scopes it to _hourly API refresh for retail vendor data_. These are different products with different audiences. Is the answer (a) pivot to API-only, (b) merge both under one sponsor key, (c) tier them separately, or (d) drop settings sync and just do API? Decision required before any tech work.
2. **Actual user count.** There is currently no reliable measurement of how many people use StakTrakr. Every pricing math, break-even calculation, and "will this offset Fly.io?" answer depends on knowing this. **Candidate solution: self-hosted Plausible Analytics** — FOSS, privacy-respecting, brand-aligned, free to run on existing infrastructure. Standing this up is probably a prerequisite to any serious monetization discussion.
3. **Payment rail choice.** GitHub Sponsors (FOSS-native, manual or webhook-driven key delivery) vs. Stripe (standard, more control, minimal backend). Or both, sequenced.
4. **StakTrakrApi repo retirement.** The ideation conversation mentioned possibly retiring the repo. **Recommendation: decouple this from the monetization discussion entirely.** The repo is load-bearing for the current free-tier racing pattern; retiring it has real fallout that should not be decided alongside a monetization decision. Monetization and repo consolidation need separate briefs.
5. **Timing.** The `project_v1_shutdown_target.md` mem0 note targets the v1 API shutdown for the week of 2026-03-30, which is the current working period. Does sponsor-tier work sit on that timeline, or is it explicitly deferred to a later phase? The owner stated "none of this is short term" during the ideation session — suggesting this brief should be shelved for a quarter or two after v1 shutdown stabilizes.

## Messaging Direction

The launch announcement (CTA post) is not in scope for this brief, but the raw ingredients are captured here so a future drafting pass does not start from scratch.

**Core framing phrases to preserve verbatim:**

- "Best efforts at hourly updates"
- "Sponsorship, not subscription"
- "A dollar a month keeps your hourly updates intact and helps keep the API online for the entire community"
- "I'm scraping this data for myself anyway — sponsors aren't buying my labor, they're buying a share of the server cost to keep me running it publicly"
- "An alternative to the ad-covered homepages that feel like they're going to infect your PC with malware"

**What the announcement must contain:**

1. The continuity promise: app + daily API stay free forever.
2. The honest framing: hourly is "a little costly, but not a ton," and most people care about daily.
3. The escape hatch: if hourly matters, $1/mo preserves it and funds the free tier for everyone.
4. The self-hosting link: for anyone who does not want to participate financially, the scraper is open source with a working `docker compose up` path.
5. The differentiation: clean, private, ad-free, your-data-your-machine, no malware-feeling homepage.

**What the announcement must NOT contain:**

1. Any language that implies existing functionality is being taken away. If hourly is downshifted to daily as a cost-saving move, frame it as "here is why the costs don't work," not "you need to pay now."
2. Any "upgrade to unlock" phrasing that echoes the `about.html:423` absolute promise.
3. Any urgency tactics or limited-time framing. Sponsors are signing up because they want to; that is the whole pitch.

## Sustainability Math (Back of Napkin)

| Cost Line                    | Approximate Monthly Cost                | Sponsors @ $1/mo to Break Even |
| ---------------------------- | --------------------------------------- | ------------------------------ |
| Fly.io hosting               | $5/mo (prepaid 1yr, marginal cost sunk) | 5 sponsors                     |
| MetalpriceAPI subscription   | ~$5/mo (based on mem0 context)          | 5 sponsors                     |
| Home poller electricity      | Negligible / already paid               | 0 sponsors                     |
| Domain + DNS                 | ~$1–2/mo amortized                      | 1–2 sponsors                   |
| **Total target (own words)** | **~$10–12/mo**                          | **~10–12 sponsors**            |

**Meaningful targets:**

- **1 sponsor** = validates the model exists.
- **5 sponsors** = offsets MetalpriceAPI.
- **10 sponsors** = offsets full monthly infrastructure.
- **25+ sponsors** = funds potential home-poller relocation (owner flagged "one day maybe needing to move the home poller somewhere a little more permanent than my office").

This is not a quit-your-day-job model. It is a don't-bleed-money model. That is the right anchor — it matches the sustainability-pitch framing and sets expectations that will not be disappointed.

## Recommendation — Next Steps

This brief is Phase 0 input material. It does not recommend a launch or an implementation. It recommends the following sequence:

1. **Shelf this brief with an `exploratory` status** and come back to it after v1 API shutdown stabilizes (post-2026-03-30 working period).
2. **Stand up self-hosted Plausible Analytics** on the StakTrakr site as a prerequisite to any monetization math. Without user-count data, every subsequent decision is speculation. This is independent of the monetization question and has value on its own.
3. **Preserve the product-pitch paragraph and sustainability-pitch framing in mem0** as a `project` memory so it survives memory decay. The verbatim phrasing is the single most reusable artifact from this research pass.
4. **Do not retire StakTrakrApi in the same discussion as monetization.** Separate brief if that comes up again.
5. **When this brief is picked up again, move to `/discover`** — the open questions are bounded and resolvable, and the architecture considerations are concrete enough to turn into tasks.

## Sources

- Internal: `lbruton` mem0 memories tagged `project: staktrakr, topic: monetization` (2026-02-21)
- Internal: `index.html:3989`, `index.html:4008`, `about.html:423` (public site copy)
- Internal: ../../Projects/StakTrakr/Depreciated/Architecture (archived), [../../Projects/StakTrakr/Depreciated/API Reference](/Volumes/DATA/GitHub/HexTrackr/DocVault/API%20Reference.md), ../../Projects/StakTrakr/Depreciated/API Consumption (archived), ../../Projects/StakTrakr/Depreciated/Vendor Quirks (archived), ../../Projects/StakTrakr/Depreciated/Home Poller (archived), ../../Projects/StakTrakr/Depreciated/Remote Poller (archived)
- External: [bitwarden.com/pricing](https://bitwarden.com/pricing/), [obsidian.md/pricing](https://obsidian.md/pricing), [nabucasa.com/pricing](https://www.nabucasa.com/pricing/), [sentry.io/pricing](https://sentry.io/pricing/), [github.com/plausible/analytics](https://github.com/plausible/analytics)
- External: [metalpriceapi.com/pricing](https://metalpriceapi.com/pricing/), [metals-api.com/pricing](https://metals-api.com/pricing), [goldapi.io](https://www.goldapi.io/), [metals.dev/pricing](https://metals.dev/pricing)
- External: [topclassactions.com SD Bullion coverage](https://topclassactions.com/lawsuit-settlements/lawsuit-news/sd-bullion-class-action-claims-company-falsely-advertises-its-prices/), [apmex.com/orderingpolicy](https://www.apmex.com/orderingpolicy)
- Research pass: `firecrawl-scraper` subagent run 2026-04-11 (FOSS precedents, precious metals API pricing, bullion vendor ToS)

## Related

- ../../Projects/StakTrakr/Depreciated/Architecture (archived) — dual-endpoint API design, sqld + Turso DR, Fly.io publisher
- [../../Projects/StakTrakr/Depreciated/API Reference](/Volumes/DATA/GitHub/HexTrackr/DocVault/API%20Reference.md) — current endpoint catalog (informs Phase 1 endpoint routing decisions)
- ../../Projects/StakTrakr/Depreciated/Vendor Quirks (archived) — the retail-vendor moat, documented in full
- ../../Projects/SpecFlow/Research/SpecFlow Distribution - North Star Vision (archived) — sibling brief on long-term distribution strategy for a different project, referenced for format
