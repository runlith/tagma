---
id: 01a0f2c3-4b0e-7961-97f1-e18e1d2ab703
title: "Rewind residue: a retry after a crash between stop and settle, the process-local landing hold and lineage race, rewind points in a branch child, and the delivered-words take-back test"
ord: 171
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0f262-5685-7e97-b058-bd0ba1b50e86
---
Left open by the kernel review of thread rewind ([[4263865b]]):
- A retried rewind after a crash between the stop and the settle answers `stopped: null` instead of the run it stopped.
- The landing hold the rewind takes is process-local, and the descendant-lineage check of `rewind_agent` can race a concurrent re-parenting; harmless while one server process owns a thread's writes, wrong the day two do.
- A branch child's inherited turns are not rewind points: the seed carries no run attribution, so they cannot be rewound in the child.
- Words already delivered to a rewound run but unread are taken back (a269e76366) with no conformance test of their own.

Start at `packages/agent/src/thread/rewind` and `thread/run/ThreadBranch.ts`. Done when each item is fixed with its contract test, or closed with the reason it does not hold.