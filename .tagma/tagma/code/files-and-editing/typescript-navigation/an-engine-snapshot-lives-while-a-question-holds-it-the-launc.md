---
id: 01a16195-4cc9-75a0-b60e-39680101ae8a
title: "An engine snapshot lives while a question holds it: the launcher releases revisions, not the process"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
  - kind: file
    ref: packages/navigation-ts/src/launcher.ts
---
The kit asks one question as several adapter calls — `locate`, then `judge` by target and by each alias — and `Subject.id` and the changed-file sifting are true only on the revision the holder read `served` from. So `served` takes the snapshot into the question's scope, and the adapter sends every request from the same `Served` with that revision.

The launcher counts holders, per checkout, synchronously at read time, and only it may release a revision: the process holds a revision while every checkout it was announced to has not sent `drop` and while it is current for no checkout — a worktree without its own snapshot is served by the base's current revision. The launcher sends `drop` when the revision is no longer current for that checkout and no holders remain on it. If the process released it itself, the snapshot would vanish under a question between reading `served` and holding.

A revision is not a TypeScript snapshot: touching only paths TypeScript never reads yields a new revision on the same snapshot, so a snapshot closes only when no held revision shares it.

A new snapshot builds only on a question's demand ([[61d1db53]]), warms next to the serving one (by repeating the last questions), and replaces it ready. While it warms, changed programs have two checkers — the old one answers, the new one warms; that is the process's memory peak after an edit, and `GOMEMLIMIT` holds it at garbage-collection cost. There is no build from scratch on out-of-memory: it left questions unanswered for the parse time and handed the next ones to a cold checker — trading the peak for multi-second pauses, and on runlith with 4 GiB granted it fired on every edit.

After a HEAD shift and `rescan` (observer overflow), changed paths stay unknown until the process counts them through git ([[6324930f]]); until then `served` is `null`, so the old snapshot never confirms places in files that are already different.
