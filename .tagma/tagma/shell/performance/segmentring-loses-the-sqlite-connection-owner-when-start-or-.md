---
id: 01a13da9-0ff7-71b6-9d30-2db32cbc6afc
title: SegmentRing loses the SQLite connection owner when start or seal fails during prepare
ord: 41
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-3989-7140-b4b7-a20c407453a6
sources:
  - kind: file
    ref: packages/performance/src/SegmentRing.ts
---
`start` publishes the segment connection into `opened` only after `prepareWriter` and `catalog.add`; an error in either leaves the connection's scope ownerless. `seal` zeroes `opened` before `readWindow`, checkpoint and `catalog.seal`, so an error there bypasses `closeConnection`; on `openSegmentRing → reopen → seal` the failure finalizer calls `ring.close()`, which no longer sees the segment connection. The defect stood on HEAD before the Effect-style port, and the port does not change it.

Fix at the connection's owner: close it on error (`Effect.onError`) in `start` and `seal`. Red test: a ring whose `prepareWriter` or `catalog.seal` fails leaves a Bun Database open; green: after the error the segment file can be deleted/opened exclusively.
