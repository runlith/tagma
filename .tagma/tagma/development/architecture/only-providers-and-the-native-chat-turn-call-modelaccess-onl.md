---
id: 01a18d50-f2c0-700f-86f0-c72a93f04f23
title: Only providers and the native chat turn call ModelAccess; only ThreadAsks calls an aside; harness owners alone read rows
ord: 26
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "ask-calls",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
edges:
  - kind: relates
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
sources:
  - kind: dir
    ref: apps/tagma/server/src
  - kind: file
    ref: apps/tagma/server/src/providers/contract/service/access.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/service/asides.ts
---
ModelAccess.request and returned request calls stay in providers or the native chat turn (native-harness/kernel.ts, native-harness/assembly.ts and native-harness/turns/runWebs.ts). An aside's ask stays in threads/asks.ts. Harness rows are read only in external-harnesses and threads/harness. Other server code asks through ModelAsks or ThreadAsks; provision, publication, watch, clear and metadata reads remain allowed.