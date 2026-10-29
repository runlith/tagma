---
id: 01a1220b-c29f-7eb2-9ec8-206533674dd9
title: "Fix the eff497e9da fan-out review findings: double interruption, keyed InMemory act, repeat by recorded act, partial delivery"
ord: 183
tags: ["task"]
fields:
  {
    "holder": "tagma:01a121d6-3d32-71e9-bb7e-606acf893aa6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a121e5-2700-7b99-ae65-295557f1fef4
---
Check the 16 findings of four fan-out reviewers (eff497e9da; the orchestrator's summary in `review-findings.md`) against the code. Fix confirmed ones at the owner, decline unconfirmed ones with a reason. Priority: double interruption on late delivery and the keyed `InMemoryInboxStorage.control` act with conformance replay and `key-reused` on both adapters.

Where the contract changes (partial delivery with a failure receipt, compact atomicity, the repeat's answer by recorded act), edit [[5add92f2]] in the same change.

Start with `packages/agent/src/collaboration/ThreadEnvelopes.ts` (`fanOut`, `deliverEach`, `settleFanOut`) and `packages/agent/src/thread/storage/InMemoryInboxStorage.ts`.

## Result (commit e497b9cbba)

Left unproven:
- the question window and the feed row with the `pending` receipt were not checked by eye;
- system tests were not run;
- the `compact` transition between two keyed acts is still not atomic: recovery is described in [[5add92f2]], and a break between the acts was not reproduced by a test.

Found along the way and moved to [[586c8f6e]]: on SQLite conformance, "a restarted process seats the spawned run it adopts" fails on clean HEAD too.

Done when typecheck and the `packages/agent` suites, the server's unit and integration tests on SQLite pass, and the work has landed as a commit.
