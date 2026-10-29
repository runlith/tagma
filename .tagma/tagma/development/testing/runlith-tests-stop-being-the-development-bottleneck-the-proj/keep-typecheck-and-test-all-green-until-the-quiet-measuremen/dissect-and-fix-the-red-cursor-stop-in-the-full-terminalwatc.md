---
id: 01a16ece-3211-7993-9e0e-a846aceda7e7
title: Dissect and fix the red Cursor Stop in the full terminalWatch
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-5b72-77e0-b64e-010b3887cd2d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
Sequential red reproduced: the full terminalWatch seed1 hung on error-only Stop past 10000ms, while the single case passed (9c23c20c-36b3-4c78-9192-681da3f2538f:167). Releasing the seeded CLI in the test scope alone did not help: metadata-jobs held for 30s (73b0ce66-c6b9-4ac1-a583-59dbe62dc487:167). Root cause: observed waited for the worker to finish under jobsHeld while the worker published back into observed through the store. Per git blame this join came from 407c26afacb (October 11); the exact first red commit was not established by running: no bisection was done because the refined condition permitted it only under an unconfirmed ordering hypothesis. The interrupt request is now atomic with the job switch, and the wait happens after releasing the lock. The finalizer identity check is preserved; the seeded CLI is fully released in the test scope, Seat.born declares Scope, Watch registers the shared fixture and uses plainProject. Final check 0225e99a-b1d6-48b9-a202-4752ff1e4450:167: bun run typecheck green; Watch/Core/Delivery/Conformance individually seeds 1–3 — 54/54 pass. --no-isolate, timeout, assertions and the 6 Watch scenarios preserved; no new helpers/ports. Independent source-only review [[01a16efc-e708-7073-8dd1-331044478f9d|metadata-review]] on openai-oauth/gpt-6.1-sol xhigh: no findings; all four files, reentrant publication and lifecycle readers checked. This does not prove the overall CPU/wall goal of the whole suite.
