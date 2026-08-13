---
title: "StakTrakr — Webscale Cookie Re-Solve Runbook"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/webscale-cookie-re-solve.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Webscale Cookie Re-Solve.md" # historical provenance; migrated 2026-08-12
updated: "2026-07-30"
---

# Webscale Cookie Re-Solve Runbook

**When:** ~weekly, or whenever `retail-poller.log` shows `⚠️ WEBSCALE CHALLENGE … RE-SOLVE NEEDED`, or JM Bullion / Provident drop to "no price". The `wspc` cookie lasts ~7 days.

**Why:** JM Bullion + Provident sit behind **Webscale Protection Mode** (Google reCAPTCHA v2 on product pages — NOT Cloudflare). The poller injects a human-solved `wspc` cookie. Background: STRK-230 (PR #1303). Automation plan: STRK-231 (CapSolver). Full diagnosis: Home Poller, `infrastructure.md`.

**Must run on a machine sharing the poller's public IP** (your home network / same Cox IP). The cookie is bound to IP + UA.

---

## Step 0 — Probe first: is there a challenge to solve? (added 2026-07-30)

```bash
curl -s -o /tmp/ws.html -w "%{http_code} %{size_download}\n" --max-time 25 \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  "https://www.jmbullion.com/1-oz-american-gold-eagle/"
grep -o -m1 -E "grecaptcha.render|i-am-a-human" /tmp/ws.html
```

| Result                                                      | Meaning                                       | Action                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `401` + `i-am-a-human` marker                               | Normal Protection Mode challenge              | Proceed to Step 1                                                                                      |
| **bare `403`** (~10-byte body) or **TLS reset** (`curl 35`) | Webscale's escalated deny for a **burned IP** | **Rotate the router IP first**, then re-probe — a solve is impossible until the challenge page returns |

**A hard 403 is reversible, not terminal.** Confirmed 2026-07-30: rotating the home IP restored the ordinary 401 interstitial on both hosts. Rotation is however only an _unblock probe_ — it was re-flagged after ~one scrape cycle, so plan on rotate **then** solve, not rotate-and-hope.

---

## Step 1 — Solve & capture (your Mac terminal)

Pass **explicit product URLs** — do not rely on the built-in defaults:

```bash
cd /Volumes/DATA/GitHub/StakTrakr
git checkout dev && git pull origin dev
node devops/pollers/shared/webscale-solve.mjs \
  "https://www.jmbullion.com/1-oz-american-gold-eagle/" \
  "https://www.providentmetals.com/1-oz-american-silver-eagle-coin.html"
```

> ⚠️ **Why explicit URLs matter (2026-07-30):** the tool's built-in default target for `providentmetals.com` is the **bare homepage**, which does _not_ throw the challenge. Solving there captures an **uncleared** `wspc` that fails silently on the poller. Only a page that returns the 401 interstitial yields a cleared cookie — verify with Step 0 before solving.

A real Chrome window opens. For each site: go to **any product page**, solve the "confirm your humanity" check so the product loads, then press **Enter** in the terminal. After both sites it prints 4 paste-ready lines:

```text
WEBSCALE_WSPC_WWW_JMBULLION_COM=<token>
WEBSCALE_UA_WWW_JMBULLION_COM=<base64 UA>
WEBSCALE_WSPC_WWW_PROVIDENTMETALS_COM=<token>
WEBSCALE_UA_WWW_PROVIDENTMETALS_COM=<base64 UA>
```

> **Browser error?** If it fails with `dlopen … Google Chrome for Testing Framework (no such file)`, the shared Playwright's browser is broken. Quick fix — point it at the root install's working browser:
>
> ```bash
> cd /Volumes/DATA/GitHub/StakTrakr/devops/pollers/shared/node_modules
> [ -L playwright ] || mv playwright playwright-1.58.2.bak
> ln -sfn /Volumes/DATA/GitHub/StakTrakr/node_modules/playwright playwright
> ```
>
> (Only `webscale-solve.mjs` uses full `playwright`; the poller uses `playwright-core`, unaffected.)

---

## Step 2 — Update Portainer env (stack 7, `home-poller`)

`https://192.168.1.81:9443` → Stacks → home-poller → Environment variables.

- **Advanced mode:** the textarea must already list the existing **15** vars. **Append** the 4 new lines → **19 total**. Do NOT replace (env is _replaced, not merged_ on save — a partial paste wipes `SQLD_URL`, `METAL_PRICE_API_KEY`, etc.).
- If the textarea is empty, use simple mode and add the 4 one at a time.

---

## Step 3 — Redeploy (recreate the container) ⚠️ REQUIRED

Updating the stack env alone does **not** change the running container. You must **Update the stack** / recreate so the entrypoint regenerates `/etc/environment` with the new vars.

> **Stack 7 has `AutoUpdate: None`** (confirmed 2026-07-30) — there is **no GitOps auto-poll**, so an env-only change will _never_ self-apply. Use the **Web UI Pull-and-redeploy**. Do not use the API `/git/redeploy`: it _replaces_ the env array and would drop the other 15 vars.

**Verify via read-only inspect** — prefer this over `exec`, which the Claude Code permission classifier blocks:

```bash
# from a shell with PORTAINER_TOKEN (Infisical project lbruton.cc, dev)
CID=$(curl -sk -H "X-API-Key: $PORTAINER_TOKEN" "https://192.168.1.81:9443/api/endpoints/3/docker/containers/json" | jq -r '.[]|select(.Names[]|test("home-poller")).Id')
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" "https://192.168.1.81:9443/api/endpoints/3/docker/containers/$CID/json" \
  | jq -r '.Config.Env[]|select(startswith("WEBSCALE_"))'
```

`.Config.Env` is exactly what the entrypoint dumps into `/etc/environment`.

> ⚠️ **The silent failure mode is an EMPTY value, not a missing key.** After an IP rotation the `WEBSCALE_*` vars are typically blanked, so all four still _appear_ — as empty strings. `loadWebscaleCookie` gates on `envWspc.length > 0` and treats empty as absent **with no error**. Check values, not just names. Likewise, container `StartedAt` advancing is **not** proof the vars landed (the PR #1304 trap).

---

## Step 4 — Trigger a manual run (optional, if you missed the `:30` cron)

In Portainer → home-poller → Console (or exec):

```bash
rm -f /tmp/retail-poller.lock      # clear a stale lock if present
. /etc/environment; /app/run-home.sh
```

`run-home.sh` re-exports the `WEBSCALE_*` vars itself (cron-sourced vars aren't exported to children — STRK-230), so the cookie reaches node.

---

## Step 5 — Verify

`tail -f /data/logs/retail-poller.log` — JM/Provident should show prices, and you should see
`(playwright-direct) injected Webscale wspc for jmbullion …`. If you see `⚠️ WEBSCALE CHALLENGE`, the cookie didn't take (stale or wrong IP).

**If you can't reach that logfile** (container stdout is only supervisord noise, and `exec` may be blocked), use the **public feed** as the practical success signal:

```bash
curl -s "https://api.staktrakr.com/data/v2/retail/latest.json" \
  | jq '{generated_at, ase: .data.coins.ase.vendor_count, age: .data.coins.age.vendor_count}'
```

`vendor_count` reference points for ASE/AGE: **7** = both blocked · **9** = both working (2026-07-29) · **10** = both working (2026-07-30). Also confirm both vendors are exported to `providers.json` — the poller reads that **file**, not live sqld, so a dashboard toggle only takes effect after the `*/5` `export-providers-json.js` cron.

---

## Key facts (don't re-learn these)

- UA env value is **base64** (`/etc/environment` is sourced as shell; a raw UA breaks it).
- Env vars: **replaced not merged** on Portainer redeploy → always keep the full set.
- Cookie per-host (`www.jmbullion.com`, `www.providentmetals.com`). The ~7-day life appears to be **browser-side**; the cookie injected into the headless Linux poller has run ~3 weeks without a re-solve, so don't treat "weekly" as a hard requirement — re-solve when it actually fails.
- Manual env-var override always beats the dev-only file store (`WEBSCALE_COOKIE_FILE`).
- **TLS/JA3 pinning is ruled out** (2026-07-30). A macOS-solved cookie replays fine from Linux headless Chromium; the earlier "open unknown" is closed. Failures are IP reputation or a stale/uncleared cookie — not fingerprinting.
- Both hosts' vars are already in the `docker-compose.home.yml` allow-list. **Any _new_ Webscale host needs its vars added to compose too**, or the Portainer value never reaches the container.
