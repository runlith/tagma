---
id: 01a17e2e-8a2d-762d-a173-7332d45fdc72
title: Remaining current-generation records — ended call, held and pty plus ones left half-deleted when the logic left — also count toward the shelf quota and are evicted
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17e19-3452-71aa-a697-3177d5ec942a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17e18-541d-7f45-bf95-ef85c2da3d6f
  - kind: implements
    to: 01a17e18-334d-79d8-9477-6b9e908f3f65
sources:
  - kind: file
    ref: packages/execution-host/src/RecordShelf.ts
---
Task c2da3d6f (commit 956669f65a) counted only ended pipe-command records shelved by the previous logic toward the quota. Two groups remain unbounded. First — ended `call`, `held` and `pty` records left behind by a logic replacement: they were never shelved. Second — records marked `unavailable` whose deletion was cut short by the departing logic: their files stay on disk, and the next logic never sees them. Item 5 of the spec requires every current-generation record to count toward the quota, and deletion started by one logic to be finished by the next.
