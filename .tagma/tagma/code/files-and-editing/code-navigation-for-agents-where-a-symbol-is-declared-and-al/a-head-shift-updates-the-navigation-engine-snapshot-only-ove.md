---
id: 01a1651e-ecba-7806-b331-17c0d5041faf
title: A HEAD shift updates the navigation engine snapshot only over changed paths, with no full recompute
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1651f-6434-7015-aa7e-1bcebd1e4c4d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
sources:
  - kind: file
    ref: apps/tagma/server/src/navigation/holder.ts
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
---
A HEAD shift currently updates the navigation engine snapshot only over changed paths, with no full recompute. Any HEAD shift (`heads` in `apps/tagma/server/src/navigation/holder.ts`) sends the engine a `rescan`. `renewBase` in `packages/navigation-ts/src/engine/workspace.ts` answers it with `invalidateAll: true` and opens all checkout programs (112 tsconfigs on runlith), although an agent commit changes no file contents: the changed content already arrived from the watcher, and the engine already computes differences from the previous HEAD (`driftOf`). A worktree with its own snapshot re-derives itself from the base after its own HEAD shift. Live measurement with navigation on runlith: 1–3 cores and 7–8 GB constantly while agents commit; that is why navigation is off (operator decision).

First measure on runlith under committing agents how much of the engine's CPU and memory goes to HEAD shifts vs new checkers and warm-up after file edits. If edits dominate, that is named to the operator as the next lever; this task is done either way.

Then a HEAD shift hands TypeScript only paths whose contents differ from the taken snapshot: differences from the previous HEAD plus files changed at the snapshot moment and since returned to the new HEAD's contents. Closed programs do not open except catalog-stale ones. A full recompute stays only where paths are truly unknown (watcher overflow). On its own HEAD shift a worktree with known differences updates its layer instead of re-deriving from the base.

Acceptance:
- a commit changing no files creates no new TypeScript snapshot and opens no programs;
- after checkout, rebase, and reset to another revision, in the base and in a worktree, verdicts match a fresh engine's verdicts on the same tree, including a file returned to HEAD contents;
- a before/after measurement on runlith under committing agents is recorded in the task.

## Before/after measurement

One sample: macOS arm64, 12 cores / 32 GB, TypeScript 7.1.0-beta, `GOMEMLIMIT` 8 GiB, `GOMAXPROCS` 4, `GOGC` 50; machine under others' load (load average 15–65), so wall time is only an order of magnitude — comparison uses engine-tree process CPU time (client and `tsc`; short-lived `git` excluded) and `phys_footprint`.

Scenario (`bench.ts` in the scratch of thread 01a1651f-6434-7015-9a7e-1bcebd1e4c4d, raw rows in `bench-*.jsonl` there): a local runlith clone with `bun install` and a copy of `.svelte-kit`, the engine through the launcher, a repeat of 40 real commits `ed83ab2b06^..e1a8111b26` by first parent — 9 with code edits and 31 graph-only commits (`.tagma/*.md`), as they appear in runlith. Per commit: the commit's files are written into the tree and reach the engine as path touches (as from the watcher), after code edits two `uses` questions go through the navigation kit, then `git reset --mixed` to the commit and a HEAD touch; each phase waits until the snapshot takes everything and warms up. Before starting: a cold and a warm question round on `release`, `ended`, and `deliver` in `packages/agent`. "Before" is an engine copy from before the change (a `rescan` touch); "after" is the changed one (a `head` touch). A full "before" repeat does not fit the command's 10 minutes under load, so "before" is sampled in windows (4 HEAD shifts, 3 code edits, 3 graph edits) while "after" covers all 40 commits.

CPU time per event:

| Event | Before | After |
|---|---|---:|
| HEAD shift (commit) | 67–109 s, average 94 (n=4) | 0.02–0.27 s (n=40) |
| code edit, receive and warm-up | 27–59 s (n=3) | 7.5–36 s, average 26 (n=9) |
| graph-only edit | 1.2–4.8 s | 0.01–0.17 s |
| two questions after an edit | 0.3–2.1 s | 0.1–1.2 s |

Share in the stream of these 40 commits: before, about 3 700 of 4 200 s (≈90%) went to HEAD shifts (estimated from per-event averages); after, 2.6 of 241 s (≈1%); 232 of 241 s (≈97%) are now code edits: new checkers for changed programs plus warm-up by repeating last questions. That is the next lever.

Memory (`phys_footprint`): before — 4.0–4.4 GiB after warm-up, 6.2–6.4 after the first HEAD shift (`rescan` opens all programs), 7.9 after the second, peak 8.1 on the next edit. After — 4.0–4.1 GiB after warm-up, peak 6.6 over 37 commits, 5.3–6.4 at the end. Wall time of one HEAD shift: before 145–264 s, after 0.3–11 s (`git` under load).
