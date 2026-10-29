---
id: 01a0e8ff-7ec0-7ac4-80cf-f6e7c251e820
title: After the v34 rollback window, retire the codec and operation shadow without reviving spent keys
ord: 36
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0e8c3-b71d-730a-9c27-889e556fc1a5
  - kind: implements
    to: 01a0e134-d622-7eef-b19a-5c2070083b67
sources:
  - kind: file
    ref: packages/execution-host/src/db/schema.ts
  - kind: file
    ref: packages/execution-host/src/store/ExecutionStore.ts
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
---
The wire half is done: no v34 dialect stands in `wire.ts` any more ([[3283ebae]]). In the following release, remove the host's legacy `operation` shadow only after a bounded, resumable background pass has copied **every** remaining `operation` key into `spent_key`. Legacy `call` rows whose key has no `operation` row are also spent-key read-through for this window. The next release must copy those keys and retire evicted executions' orphaned call/decision detail by a bounded, resumable pass over `call`'s existing primary key; introduce an empty execution-key index table for new calls if it is needed for future constant-time eviction. The upgrade must admit without scanning, reindexing or rewriting either legacy table; removal waits for a durable completion witness. A previous-binary rollback may write and then blank a key without ever writing `spent_key`; this release refuses it through the shadow, so dropping the shadow first would permit a duplicate act. Prove fresh v35 behavior, no old-host interoperability after the window, and rollback-created blank-only keys staying spent across pass interruption and completion.