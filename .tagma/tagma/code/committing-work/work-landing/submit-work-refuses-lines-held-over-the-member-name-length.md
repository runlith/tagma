---
id: 01a19889-ec5e-7878-9891-a8c57cef8507
title: submit_work refuses lines-held over the member name `length`
ord: 192
tags: ["reflection"]
fields:
  {
    "actual": "refused[lines-held]: selected references require uncommitted declarations: length in packages/agent/src/transcript/live.ts:49, held by 01a197fd (entry-window)",
    "command": "submit_work paths=[19 files incl. packages/agent/src/thread/run/ThreadSnapshots.ts, ThreadLiveFeed.ts] in /Users/teunlao/runlith/tagma",
    "expected": "My lines land: none of them reads a declaration a peer holds"
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T18:50:58.888Z, from f6801a854.

`length` is the member name of every array and string; the matching by imported member name without a proven receiver type turns any `.length` in a selected file into a dependency on a peer's new `length` field. Landing is blocked until the peer lands or its unfinished lines are carried.