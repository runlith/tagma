---
id: 01a0d007-1987-7572-9661-898cd2a7785c
title: "Build requested compaction in the thread core: the requested pass, the compaction inbox item and its delivery, the anchor's take, the queue barrier, pending rows and the compact verb"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d007-aa86-70c3-b208-55766631866c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d007-194a-7976-97d6-11296ad506f4
---
Build the core of [[6ad506f4]] in `packages/agent`: §4 whole, the verb of §10, the pending rows of §10, §13's lifecycle.

Start from the owners §5 names: `ThreadCompaction.prepare` / `prepareContinuation` (the requested pass and its cause), `thread/storage/inbox.ts` and `thread/inboxItems.ts` (the kind), `ThreadRunInbox` (the run's `step` slot and its take-back window), `ThreadContextAnchor.project` (the take), `ThreadCompactionRuns` (acknowledgement in the settle's unit, the compaction run taking an `end` item), `ThreadAggregate.compact` and `followUpAfterSettle` (routing and the barrier), `ThreadSnapshots` with `transcript/live.ts` (pending rows).

Done when acceptance criteria 1–9 and 12 of [[6ad506f4]] hold as tests over the thread core's real composition, the claims §8 names are written or revised from the code, and [[de3e52c9]] is finished.
