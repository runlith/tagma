---
id: 01a0e532-c9a8-7f8d-a36f-20419df3c009
title: "thread-record M3: closed"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e5c4-94b9-7fed-bbb0-6060db0ffafa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c977-7ae5-ba79-c0cedb416adf
---
§7.2.2 milestone `M3` of the `thread-record` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]].

**As built (59e06cc3c4).** Acceptance read against the code: `thread-record/` imports only `platform`, `projects` and the kernel's `ThreadStatus`; no production file outside it writes `thread` (the record); `native_thread` carries no status and `thread_run.status` is the run ledger's own; title adoption goes through `external-harnesses/titles.ts`; both events publish after commit; `db/thread.ts` is gone; `modules` and `names` debt for thread-record is zero, over the full inspection too. The export-collision audit found `StatusMove` declared by both graph (tag status transition) and thread-record; the record's became `ThreadStatusMove`. The service id `tagma/thread-record/ThreadRecords` is unique.

**Not done here:** the `#module` and zone are deferred to the merge (listed in [[4a9013bf]]); the D4 and M2 itests that prove acceptance items 2–5 at runtime are unrun, listed there as well.