---
title: Reply to PumpkinCrouton — 2026-06-03
type: draft
project: StakTrakr
source: 'https://www.reddit.com/r/Silverbugs/comments/1r1aerl/comment/opkhp3m/'
tags:
  - staktrakr
  - beta-feedback
  - reddit-reply
---
Paste-ready reply (plain text below the line — no markdown wrapping, copy from "Good questions" onward).

Related issues: STRK-145 (purity label), STRK-146 (image quota squares).

---

Good questions, and good detective work as usual.

Fonts: Nope — you're safe to leave remote fonts blocked in uBlock. StakTrakr ships its own fonts inside the app folder, so nothing's pulled from Google or any CDN. That's by design for the offline/thumb-drive use case. Block away.

The "90% Silver" on a gold coin: You nailed it — purely cosmetic, the melt math is unaffected. The fineness menu was lazily labeling .900 as "90% Silver" regardless of metal. I've logged it and the fix is to drop the metal name from those labels so .900 just reads .900 whether it's gold, silver, or platinum.

The disappearing images / colored squares: That was you hitting the image storage ceiling, and the app did a lousy job of telling you so — it just silently failed and left broken squares instead of popping up "you're out of room." Logged that too; it should warn you before it fills up. Two things worth knowing: your images are stored separately from your inventory data (different storage bucket, usually a few GB of room), and the "95.5% local storage / 96.3% user images" you saw are two different meters. Going with smaller/Numista images was exactly the right move.

Generic Morgan image — your instinct is correct. If you upload the same picture to 900 Morgans one at a time, that's 900 copies and yes, it eats your limit 900 times. BUT — go to Settings → Pattern Image Rules → New Rule, set the name pattern to "Morgan" and upload the image once. It stores a single image and every matching item points at it. One image, 900 items, basically no storage cost. (Per-item uploads still override the pattern on any specific coin you want to special-case.) That's the trick you were reaching for.

Attachments not restoring / Storage 0.0%: That one I can't reproduce yet — the backup definitely includes attachments, so something odd happened. If it crops up again, tell me whether it was the encrypted backup or a CSV/JSON, and whether you used auto name/date or picked the file directly. Glad the "specify the file" option got you sorted in the meantime.

Gold not updating in the background — noted, I'll look at the refresh cadence. And the GSR-alarm idea is genuinely cool; I've thought about a threshold/alert system. Way better than stuffing 65k lines of JS into a bookmark, though I respect the hustle. 6.25%, huh — sometimes the universe just wants you to know it's paying attention.
