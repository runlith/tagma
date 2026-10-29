---
id: 01a0daf8-90f5-71ce-81e7-e9ce5f829a5f
title: The worktree feed re-reads the whole listing on every thread activity and tree movement, about 1.3 times a second while agents work
ord: 12
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/worktrees/listing/rowReader.ts
    symbol: WorktreeRowReader
---
The live worktree feed (`WorktreeListing.subscribe`) reads the whole listing again 400 ms after any poke: every thread-list event (`threadsMoved` is `ThreadList.subscribe`, which fans a row for every activity change of a streaming agent — phase, tool call, tool title, tool result), every published checkout row of a tree it follows, every record move. A read re-establishes the project's coverage (`ProjectRoots.established` → `FileRoots.probe/check/judge`), reads records, standings and pending merges, and per recorded worktree asks git for the base tip (`commitOf`) and the divergence.

**Measured** (server booted 2026-09-25 23:18:23Z, 23:19:26–23:26:26Z, one `worktrees.subscribe`): 562 listing reads (`WorktreeStore.records`, `PendingMergeStore.ofProject`, `Git.divergence` 562 each) — ≈ 1.3 a second, the most the 400 ms wait plus a read allows, so the pokes outrun it. That is 618 `ProjectRoots.established`, 1,851 `FileRoots.probe`, 1,677 `FileRoots.check`, 2,745 `FileRoots.judge` and ≈ 1,100 git processes through the host in 7 minutes, and a row frame to every tab whenever main's uncommitted count moved — which is what drove the archived-worktree storm on the surface (decided separately).

**Why it is not decided here:** filtering the activity events alone does not lower the rate, because run-state events and checkout movements alone still arrive faster than a read completes. The fix is an incremental feed: a movement re-reads only what it touches — a checkout movement the rows over that tree, a thread's standing the placings, a record move the membership — and coverage and the base distance only when what they depend on moved (the watch's blind spot on shared refs, claim 0b899468, is the constraint to design around). That is a redesign of `WorktreeListing.subscribe` large enough for its own builder and decision.

**What would inform it:** how often each poke source fires (the feed does not count them yet), and whether the divergence can ride the base tip the merge check already resolves.
