---
id: 01a11ca5-7ddf-7f42-a891-bd62a5a90bb8
title: "Tagma doors with no transport branching for native and acp: ThreadTurns, ThreadAsks, EndingWalk and ThreadRuns are core acts"
ord: 13
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60ae0f8d8726
---
What: [[0f8d8726]], act table and value summary, for native and acp: `withExternalRuns`, the `contribution.ts` branches, `Harness` selection by name in `threads/turns/acts.ts`, `turns/asks.ts`, `ending.ts`; stop writes `stoppedBy` and sweeps commands and calls on every run; one archive rule by `RunStatus`; keyed replay at every door; `stop_agent` stops the run.

Ready `send/queue/steer/unqueue/stop/continue/answer` move onto the existing core acts in one cut. Archive/delete complete once `TransportResource` lands in [[ed0d0e0a]]; history and compaction use `TransportHistory`/`TransportCompaction` per [[2121a95f]], keeping no parallel hosted port. Until the terminal road is removed in [[6232d2bb]], only its existing entry stays; no new capability or "on-core" flag is introduced.
