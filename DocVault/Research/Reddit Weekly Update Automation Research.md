---
title: Reddit Weekly Update Automation — Research & Plan
type: research
project: StakTrakr
status: draft
source: web-research
tags:
  - staktrakr
  - reddit
  - announcements
  - automation
  - release-workflow
  - feature-planning
---

# Reddit Weekly Update Automation — Research & Plan

> **Status:** DRAFT — Research + implementation plan (no code written yet)
> **Date:** 2026-06-07
> **Context:** Goal — ship `dev → main` every weekend and post a **casual, blog-style** weekly update to the StakTrakr subreddit, semi-automated, after the release PR lands. Posts should read like "here's what we worked on and what's new since last time," **not** a technical bullet-list changelog. This doc captures (1) how to give the agent Reddit posting access, (2) the tooling decision, (3) the proposed `reddit-weekly` skill, (4) `/ship` integration, and (5) how to keep it from feeling robotic.
> **Voice exemplar:** [[2026-06-03 reply to PumpkinCrouton]] — the existing first-person, self-deprecating, specific tone is exactly the target. Don't reinvent it.

## TL;DR — Recommendation

- **Access:** A regular Reddit account + a **"script"-type app** registered at `reddit.com/prefs/apps`. Reddit's own docs name this exact use case ("make a weekly post to a subreddit that you moderate"). No karma/age gate applies because we own/moderate the target sub.
- **Auth:** Prefer a **refresh token** over storing the account password. Secrets live in **Infisical** (`stak-trakr-94m4`), never in the repo or the `file://` app bundle.
- **Tooling:** Two viable paths. **PRAW** (Python, most robust) or a **thin `curl`/bash skill** (zero new dependency, fits StakTrakr's zero-build ethos). For a single weekly post, volume is trivial; the choice is about robustness vs. dependency footprint — see [Part 3](#part-3--tooling-decision).
- **Anti-robotic:** Post from the **owner's aged personal account** (a fresh bot account is the #1 shadowban risk), keep a **human approval gate** before posting, lead with the _why_ not the version number, and vary titles. Feed the draft from `getEmbeddedWhatsNew()` (already plain-language), not raw commit subjects.
- **Cadence:** Weekly, tied to the `dev → main` ship. Keep posts ≥24h apart; never burst.

---

## Part 1 — Goal & Workflow Shape

The end-state chain the owner described:

```
Saturday/Sunday:
  /ship  (dev → main, PR merges, GitHub Release published)
     │
     ▼
  /reddit-weekly  ──draft──▶  [human reads & tweaks]  ──approve──▶  post to r/StakTrakr
```

Two new pieces are needed:

1. **A drafting skill** (`reddit-weekly`) that turns "what shipped since the last update" into a casual post + picks screenshots.
2. **A posting mechanism** (PRAW script or curl skill) that submits the approved draft to the subreddit.

Everything else (`/ship`, `/release`, the GitHub Release) already exists. This is additive tooling, not runtime code — it never touches the `file://` app.

---

## Part 2 — Reddit Posting Access (research)

### Account, karma, and age

- **A regular Reddit account is required.** Every API _write_ acts on behalf of a logged-in user; there is no app-only way to submit a post. (App-only auth exists but is read-only.)
- **No sitewide karma or account-age minimum to submit a text post.** Minimums are set per-subreddit by each sub's AutoModerator — and **we control our own sub's config**, so no gate binds the owner.
- **The real risk is the sitewide spam filter / shadowban system**, which targets _new/cold accounts behaving like bots_ — not the act of posting to your own sub. See [Part 6](#part-6--anti-robotic-playbook).

### App type — register a "script" app

Register at **`https://www.reddit.com/prefs/apps/`**. Reddit has three OAuth2 app types:

| Type          | Has secret? | Default flow       | Use case                                                                                         |
| ------------- | ----------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| Web app       | Yes         | Authorization Code | Backend acting on _other users'_ accounts                                                        |
| Installed app | No          | Code / Implicit    | Distributed to devices you don't control                                                         |
| **Script**    | Yes         | **Password**       | "YOU are the only user… a simple bot to **make a weekly post to a subreddit that you moderate**" |

**→ "script" is the textbook-correct choice.** Reddit's own documentation describes our exact use case under this type.

### Auth: refresh token over password

Reddit requires OAuth for all API access. Two viable flows for unattended posting:

- **Password flow (simplest):** credentials = `client_id`, `client_secret`, `username`, `password`. No browser dance. **Downside:** stores the account's real password in the secret store and **breaks if 2FA is ever enabled** (token then expires hourly and you must also store the TOTP secret).
- **Refresh-token flow (recommended):** do a **one-time** browser authorization with `duration=permanent`, capture the long-lived `refresh_token`, then authenticate with only `client_id` + `client_secret` + `refresh_token`. **No password stored, survives 2FA, and the token can be scoped** (e.g. only `submit identity flair`) to limit blast radius if leaked.

> ⚠️ **Refresh-token rotation caveat:** Reddit may hand back a _new_ refresh token each time the access token refreshes (single-use rotation). For unattended runs you must **write the rotated token back into Infisical** via a token-refresh callback. If the token turns out to be stable across refreshes for our low-frequency use, a `curl` skill stays simple; if it rotates, PRAW's `token_manager` handles write-back for you. **Action: test rotation behavior before committing to a pure-bash approach.**

### Rate limits & API terms

- **Free tier: 100 queries/minute per OAuth client** (averaged over 10 min, since 2023-07-01). A few posts/week + occasional reads is _orders of magnitude_ within free tier.
- **The Data API Terms permit free, non-commercial, low-volume self-posting to your own sub**, provided it isn't spammy and isn't cross-posted to many subs. The commercial boundary is defined by _purpose and rate-limit excess_, not a published call-count. (StakTrakr is free; posting release notes isn't monetization. Revisit the "derive revenues" clause only if the app ever monetizes.)
- **A descriptive `User-Agent` is mandatory** and format-enforced: `<platform>:<appid>:<version> (by /u/<username>)` — e.g. `python:com.staktrakr.release-bot:v1.0 (by /u/<owner>)`. Default agents (`python:urllib`) are throttled. _Never_ spoof it.

### Secrets (Infisical)

Store under project `stak-trakr-94m4` (suggest a `/reddit` folder), inject at runtime via `mcp__infisical__get-secret` or the Infisical CLI. Never commit; never let them reach the front-end bundle (they only run in the release/poller/CI context).

| Secret                 | Refresh-token flow                     | Password flow |
| ---------------------- | -------------------------------------- | ------------- |
| `REDDIT_CLIENT_ID`     | ✅                                     | ✅            |
| `REDDIT_CLIENT_SECRET` | ✅                                     | ✅            |
| `REDDIT_REFRESH_TOKEN` | ✅                                     | —             |
| `REDDIT_USERNAME`      | —                                      | ✅            |
| `REDDIT_PASSWORD`      | —                                      | ✅            |
| `REDDIT_USER_AGENT`    | ✅ (not secret, store for consistency) | ✅            |

---

## Part 3 — Tooling Decision

| Option                                | Maturity                                                                                | Effort      | Fit for StakTrakr                                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PRAW** (Python Reddit API Wrapper)  | Reference impl, actively maintained (7.8.1 stable; **8.0.0 in RC — pin `praw==7.8.1`**) | ~15 lines   | Most robust: handles rate limits, User-Agent contract, and refresh-token write-back for free. Adds a **Python dependency** to dev tooling.                                                            |
| **Raw `curl`/bash skill**             | N/A (you own it)                                                                        | 2 API calls | **Zero new dependency** — best fit for the zero-build ethos. You re-implement backoff/UA discipline, but for one weekly post that's negligible. Refresh-token rotation write-back is awkward in bash. |
| `jordanburke/reddit-mcp-server` (MCP) | 125★, MIT, active                                                                       | Config only | Best **write-capable** Reddit MCP (has `create_post`, safe-mode + bot-disclosure guardrails). But **password-flow only** and a young dependency.                                                      |
| `Big-Comfy/community-scout-mcp` (MCP) | New, 0★, unlicensed                                                                     | Config only | Conceptually ideal (approval-gated, dry-run → approve → post) but unproven/unlicensed.                                                                                                                |

> **There is no battle-tested, widely-adopted Reddit _posting_ MCP.** The popular Reddit MCPs are read-only.

**Recommendation for StakTrakr:** lean **`curl`/bash skill** to honor the zero-dependency philosophy, _or_ a small standalone **PRAW script invoked only at release time** if we want the robustness (rate-limit handling, token rotation, image/gallery helpers) and don't mind a Python dev-tool dependency. Both keep posting credentials entirely out of the runtime app.

### Reference: PRAW submit (self/text post + flair)

```python
import praw

reddit = praw.Reddit(
    client_id="…", client_secret="…",
    refresh_token="…",                       # preferred over username/password
    user_agent="python:com.staktrakr.release-bot:v1.0 (by /u/<owner>)",
)
sub = reddit.subreddit("StakTrakr")
flair_id = next(t for t in sub.flair.link_templates
                if t["flair_text"] == "Release")["flair_template_id"]
submission = sub.submit(
    title="This week: faster mobile charts + safer Numista imports",
    selftext="Markdown body…",               # selftext ⇒ self/text post
    flair_id=flair_id, send_replies=True,
)
print(submission.permalink)
```

### Reference: raw `curl` (script app, password grant)

```bash
TOKEN=$(curl -s -X POST https://www.reddit.com/api/v1/access_token \
  -A "$REDDIT_USER_AGENT" --user "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=password -d username="$RUSER" -d password="$RPASS" | jq -r .access_token)

curl -s -X POST https://oauth.reddit.com/api/submit \
  -A "$REDDIT_USER_AGENT" -H "Authorization: bearer $TOKEN" \
  -d sr=StakTrakr -d kind=self -d title="This week: …" \
  --data-urlencode text="Markdown body…" -d flair_id="$FLAIR_ID"
```

(Refresh-token variant swaps step 1 for `grant_type=refresh_token&refresh_token=…`.)

---

## Part 4 — The `reddit-weekly` skill (proposed design)

A drafting skill that produces an approval-ready post. **It drafts; a human approves; the posting mechanism submits.**

### Inputs (what "new since last update" means)

1. **Primary source — `getEmbeddedWhatsNew()`** in `js/about.js`. These entries are _already_ plain-language, user-facing summaries that `/release` curates (e.g. "duplicate coins from Numista imports now get caught and merged safely"). This is the ideal feed — **not** raw `git log` / commit subjects.
2. **Secondary — git range** `main@{last-release}..main` for anything not captured in What's New (and to confirm the version range).
3. **Last-post anchor** — the date/version of the previous Reddit update, so the post covers only the delta. Store posted updates in `Projects/StakTrakr/Reddit Replies/` (or a new `Reddit Updates/` folder) for the anchor + an archive.

### Draft generation

- Translate the What's New deltas into 2–4 casual highlights (what changed + why a user cares).
- Lead paragraph = the single most user-visible improvement, in the [[2026-06-03 reply to PumpkinCrouton]] voice.
- Optional "under the hood / nerd corner" for the technical crowd.
- End with a question to invite replies (engagement is itself an anti-bot signal).

### Screenshots

The repo ships canonical screenshots in `screenshots/` (e.g. `07-settings-about.png`). The skill should let the human pick 1–2 relevant ones. **Important Reddit mechanic** (see Part 6): a text post can't embed markdown images — use a Reddit-hosted **inline image** (`InlineImage` in PRAW) or a **gallery post**.

### Output & approval gate

- Write the draft to `Projects/StakTrakr/Reddit Updates/<date> weekly.md` (paste-ready, like the existing reply drafts).
- Present title + body + chosen screenshots for human review.
- **Only after explicit approval** does the posting step run. (Approval gate is both an anti-robotic safeguard and a shadowban safeguard.)

---

## Part 5 — `/ship` Integration & Cadence

### Where it hooks in

`/ship` already merges `dev → main` and publishes the GitHub Release. The natural sequence:

1. `/ship` completes → PR merged to `main`, Release tagged.
2. `/ship` (or the user) invokes `reddit-weekly`, which reads the just-shipped What's New delta.
3. Human approves the draft.
4. Posting mechanism submits to the sub; the permalink is saved back to the archive note.

**Phased rollout (mirrors the [[Spot Deals Feature Research]] phasing style):**

### Phase 0 — Manual (validate the voice)

- `reddit-weekly` drafts the post; **human copies & posts manually**. No credentials yet.
- Goal: confirm the auto-draft reads human and is worth automating.

### Phase 1 — Semi-automated post (human-in-the-loop)

- Register the script app, store secrets in Infisical, build the `curl`/PRAW poster.
- `reddit-weekly` drafts → human approves → skill posts. **Dry-run by default.**

### Phase 2 — `/ship`-triggered

- `/ship` chains into `reddit-weekly` after the Release publishes.
- Still human-approved before the actual submit (keep the gate — see anti-robotic). A fully hands-off post-merge hook is possible later but **not recommended initially** given shadowban risk.

---

## Part 6 — Anti-Robotic Playbook

### Voice

First-person, conversational, a little self-deprecating and opinionated — exactly [[2026-06-03 reply to PumpkinCrouton]]. Matches the brand ("sharp, capable, empowering"). Admit tradeoffs and what's still rough. No marketing superlatives.

### Structure of a weekly post

- **Lead with the _why_, not the version number.** "Spot prices were lagging on mobile — fixed, plus here's what else landed" ≫ "v3.35.14 — STRK-167…".
- Short intro → 2–4 plain-language highlights (what + why) → optional nerd corner → a question to the community.
- **Length:** a few hundred words — handwritten-feeling, skimmable.
- **Vary titles week to week.** Templated titles ("StakTrakr Weekly Update #14") are a spam signal. "This week: faster mobile charts + Libertad support" reads human.
- **Never paste the raw CHANGELOG or commit subjects.** Translate `STRK-167` → "duplicate Numista coins now merge safely."

### Self-promotion norms (90/10)

The sitewide "1-in-10" rule governs behavior across _other_ subs you don't run. **On your own dedicated subreddit it largely doesn't bind you** — that's the sanctioned outlet the rule itself points to. Subscribers are there for StakTrakr news.

### Screenshots — how they actually embed

A Reddit text/self post **does not render `![](url)` markdown images.** Real options:

- **Native image post** — single screenshot _as_ the post.
- **Gallery post** — multiple screenshots, one post (PRAW `submit_gallery`, per-image captions).
- **Reddit-hosted inline media in a self post** — PRAW `InlineImage` + `{placeholder}` tokens in `selftext`; uploads to i.redd.it and embeds inline. **Best for a blog-style update with 1–2 hero screenshots.**
- Text post + `i.redd.it`/imgur **links** — renders as a link, not an embed.

### Markdown, flair, cadence

- Works on Reddit: headers, bold/italic, lists, `>` blockquotes, code fences, tables, and **superscript** (`^(text)`) — the idiomatic way to add a small bot-disclosure footer.
- Create a consistent **"Release"/"Update" flair** so subscribers can filter.
- **Cadence:** weekly, tied to the ship. Posts ≥24h apart; never burst.

### ⚠️ The biggest pitfall — cold-account auto-posting → shadowban

- 2026 sources converge: a brand-new account that immediately auto-posts links is the **highest-risk category** for a silent shadowban. Shadowbans are **invisible** — you see your post, nobody else does; no error is returned.
- **Mitigations:**
  - **Post from the owner's aged, real account** — not a freshly minted bot account. Account age + karma form a trust score. (~30 days + ~100 karma clears most filters.)
  - If a dedicated bot account is required, **warm it up** (1–2 weeks of genuine activity) and make it a mod of the sub.
  - **Avoid URL shorteners** (heavily flagged) — link `staktrakr.com` directly.
  - **Don't duplicate** the same post/links across multiple subs (spam trigger + Terms violation).
  - **Keep the human approval gate** and **sanity-check visibility** after the first few posts (view logged-out or via a shadowban checker).
  - Append a small **bot-disclosure footer** (superscript) — good etiquette, builds trust.

---

## Decisions Needed From You

- [ ] **Which subreddit** is the target (confirm the exact `r/…` name and that the owner moderates it).
- [ ] **Posting account:** owner's personal aged account (recommended) vs. a dedicated warmed-up bot account.
- [ ] **Auth flow:** refresh token (safer, recommended) vs. password (simpler). Decide before registering the app.
- [ ] **Posting tool:** `curl`/bash skill (zero-dep, on-ethos) vs. PRAW script (robust, +Python).
- [ ] **Approval gate:** keep human-in-the-loop indefinitely (recommended) vs. eventually fully auto post-merge.
- [ ] **Screenshot strategy:** inline images in a self post vs. gallery post as the default format.
- [ ] **Archive location:** new `Projects/StakTrakr/Reddit Updates/` folder for posted-update history + last-post anchor?
- [ ] File a Plane **epic** for the `reddit-weekly` skill + poster once these are settled?

---

## Implementation Phases (summary)

| Phase | Deliverable                                      | Credentials needed             |
| ----- | ------------------------------------------------ | ------------------------------ |
| **0** | `reddit-weekly` drafts; human posts manually     | None                           |
| **1** | Skill posts via approved draft (dry-run default) | Script app + Infisical secrets |
| **2** | `/ship` chains into `reddit-weekly` post-Release | Same; keep approval gate       |

---

## References

- Reddit Data API Wiki (rate limits, OAuth requirement, User-Agent format): `https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki`
- Reddit Data API Terms (fees §3.1, spam restrictions §3.2): `https://www.redditinc.com/policies/data-api-terms`
- Reddit "Key Facts" API update (100 QPM since 2023-07-01): `https://redditinc.com/news/apifacts`
- Reddit OAuth2 App Types (script = "weekly post to a subreddit you moderate"): `https://github.com/reddit-archive/reddit/wiki/OAuth2-App-Types`
- Reddit `API:submit` endpoint: `https://github.com/reddit-archive/reddit/wiki/API:-submit`
- PRAW authentication (password vs refresh flows): `https://praw.readthedocs.io/en/stable/getting_started/authentication.html`
- PRAW refresh-token tutorial: `https://praw.readthedocs.io/en/stable/tutorials/refresh_token.html`
- PRAW Subreddit model (`submit`, `submit_image`, `submit_gallery`, flair, `InlineImage`): `https://praw.readthedocs.io/en/latest/code_overview/models/subreddit.html`
- PRAW on PyPI (versions/maintenance): `https://pypi.org/project/praw/`
- Reddit self-promotion wiki (90/10): `https://www.reddit.com/r/reddit.com/wiki/selfpromotion/`
- Shadowban / cold-account guidance (2026): `https://www.reddireach.com/blog/shadowbanned-on-reddit-2026-fixes-and-safe-posting-system`
- Write-capable Reddit MCP `jordanburke/reddit-mcp-server`: `https://github.com/jordanburke/reddit-mcp-server`
- Approval-gated Reddit MCP `Big-Comfy/community-scout-mcp-for-reddit`: `https://github.com/Big-Comfy/community-scout-mcp-for-reddit`

**Uncertainty notes:** (1) The API Terms' commercial boundary is defined by purpose + rate-limit excess, not a published call count — the often-quoted "$0.24/1k calls" is the negotiated enterprise rate, not a free-tier cutoff. (2) Whether Reddit issues a new refresh token on every refresh (single-use rotation) can vary — build any unattended poster to write the rotated token back to Infisical defensively, or test rotation before choosing a pure-bash approach.
