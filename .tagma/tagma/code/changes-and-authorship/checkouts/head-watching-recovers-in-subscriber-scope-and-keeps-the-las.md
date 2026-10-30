---
id: 01a1351f-a3af-7f9a-9ddf-f296bc691b94
title: HEAD watching recovers in subscriber scope and keeps the last proven read on failure
ord: 14
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/watch/heads.ts
    symbol: makeHeadWatches
---
A HEAD shift changes authorship judgement and retirement even without file changes, so subscribers keep watching independent of checkout status. After a watcher loss the owner frees the group and restores it with a growing pause; releasing the last subscription ends both watching and recovery. The read after opening closes the event gap from the outage. A read error keeps the last proven HEAD and the live watcher: the read repeats, and the group reopens only after watching is lost. The observation stream also reports each failed attempt so lifecycle consumers can recheck deletion; the movement projection delivers only proven reads. Both share one watcher and recovery lifetime. `null` is delivered only as a proven absence of a commit, including to the first and late subscribers.
