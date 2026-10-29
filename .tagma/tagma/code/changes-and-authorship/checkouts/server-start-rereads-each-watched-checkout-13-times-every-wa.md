---
id: 01a1401c-b7a1-79ae-adaf-979487097634
title: "Server start rereads each watched checkout ~13 times: every watcher opening on macOS rescans all the rest"
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13fd0-aafb-7c4c-bb78-cce3611ba91a",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0db59-6036-7f53-979d-471d2393aff1
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/watch/tree.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/feed.ts
---
**What:** after the server starts, each watched checkout should be reread once (plus on real changes), not ~13 times in the first minutes.

**Why:** startup on October 15 (pid 84526, instance 76401e34) over ~6 minutes: 270 `CheckoutStatus.reading` across ~20 checkouts, 636 `Git.status` (334 s total), 4168 git processes (`Git.spawn` 514 s), 208 `Holdings.judge` with a `Holdings.probe` each (58 s). The machine ran up to 4.7 of 12 cores, load up to 20; spawning one `git status` takes 1.8 of 2 s — queuing on the machine, not git work.

**Mechanism (from code):**
- `platform/watch/tree.ts` `restarted`: on darwin, every opening or closing of a watch group marks all other standing groups `rescan: 'unnamed'` after 1 s (note 0a116765). The window is fixed from the first restart; the next opening starts a new window.
- `WorktreeFeed.open` (`worktrees/listing/feed.ts`) opens the checkouts of every worktree in the project; the openings stretched over 16:56:42–16:57:25 (33 `watch.watchingCheckout` and 9 `watch.watchingHead` in 5 minutes) because each `take` waits on `FileRoots.read` (~1.2 s of SQL) and the watcher itself 0.3–0.8 s. Each opening is a stream restart — a full reread of every already-open checkout. The slower the reads, the longer the openings take: a loop.
- `CheckoutRows.mark` calls listeners with `paths` undefined on every `unnamed`: `change-record/serving.ts` → `judges.marked` judges the whole root with its own `git status` (`Holdings.probe`), `threadFiles/authorship.ts` drops the root cache.
- Parallelism: `CheckoutRows` holds 3 read permits, with up to 2 git processes inside one read (numstat ‖ publishRemote) → up to 6 git; `Holdings.probe`, `Git.commitOf` (272), `Git.locations`, `ignoredAmong` run outside these permits. Mean git occupancy over the window is ~1.7 processes, higher in the first 2–3 minutes; the peak cannot be recovered from the stored telemetry.

**Where to look, by owner:**
- `platform/watch/tree.ts`: openings arriving back to back produce one rescan per group after the burst, not one per opening; for a group whose first read is still ahead, `unnamed` adds nothing.
- `worktrees/listing/feed.ts`: open watching of all project checkouts in one burst.
- `change-record` Holdings: judge by the change `CheckoutRows` already reported (rule 51c66cb6), not with a second `git status` on every unnamed event.

**Proof:** a platform test — N consecutive openings give each standing group exactly one `unnamed`; a startup measurement on its own world: `CheckoutStatus.reading` and `Holdings.probe` counts per checkout, before and after.
