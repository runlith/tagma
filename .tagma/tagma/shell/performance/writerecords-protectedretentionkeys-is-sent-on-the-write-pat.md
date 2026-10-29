---
id: 01a0c987-b5ac-78da-a715-b0d2055539d3
title: WriteRecords.protectedRetentionKeys is sent on the write path and read by nothing, and the ring's floor is seeded only by the write that carries the key
ord: 40
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c969-92c1-784e-a46e-e13575270b80
---
Found reviewing [[75270b80]]'s fix (`88b7726180`).

`WriteRecords.protectedRetentionKeys` is produced at `packages/performance/src/PerformanceStore.ts:173,706` and read by no one: the only consumer of any protected list is `worker.ts:210` on the `MaintainStore` road. A held key with no write has no segment on disk for the field to point at, so there is no honest use for it on the write road. Pre-existing since `bb7d706e04`.

A field in a protocol type that is sent and never read is a contract that lies about what travels. Delete it from `WriteRecords` and its producer, or bind it to the reader that needs it — the same rule the repo applies to unimplemented surfaces elsewhere.

Beside it, the same review measured two smaller facts worth keeping while this file is open:
- `openGroup` and `closeGroup` skip the `closed` check that `submit` and `submitDurable` carry (`PerformanceStore.ts:774-780` against `:782-788`), so a group opened after the scope closes records a depth and takes a hold nothing releases and `activeGroups` over-reports. Unreachable from the one in-repo producer, which pairs open/submit/close inside one call.
- The invariant this fix's safety rests on — that a never-written open pins nothing — has no test at all, and the reviewer could not confirm the eviction half of the surviving test as a discriminator without running it.