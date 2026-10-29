---
id: 01a16b1a-6df9-73cf-987f-0c04e9c03207
title: "Server typecheck is red at HEAD: nativeCatalog.ts:58 — OpenRefusal carries candidate-stale, missing from CallerRefusal"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16b1a-8c6f-77c0-ab19-e69c1054828e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16b11-a77b-79e3-a167-9b598e8f8477
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/nativeCatalog.ts
---
`bun run typecheck` in `apps/tagma/server` on 2026-10-24 fails only at `apps/tagma/server/src/composition/testing/nativeCatalog.ts:58`: `OpenRefusal` includes `"candidate-stale"`, which is never assigned to `CallerRefusal`. `refusal.ts` and `OpenRefusal` consumers were last changed in `7e6d9ec276` (tasks [[bb30754e]], 23d522fe, 244e002a); there are no uncommitted edits in `refusal.ts`. Found while landing [[8e8f8477]].
