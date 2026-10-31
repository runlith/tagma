---
id: 01a19119-9cdf-71bc-9152-cc84fb0154f7
title: Server typecheck stands red on column.e2e.ts DOM globals and reflections/operations.ts undeclaredRefusal
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19119-cb11-7bf4-8f43-86a186983b46",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19107-6f1f-79c8-ad79-582909e79b08
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/column.e2e.ts
  - kind: file
    ref: apps/tagma/server/src/reflections/operations.ts
---
For hours `bun run typecheck` in `apps/tagma/server` has failed on two files that no working agent holds: `composition/testing/column.e2e.ts` cannot find `requestAnimationFrame`, `HTMLElement` and `document`, and `reflections/operations.ts:31` lacks the required `undeclaredRefusal` (the routed-operation guard in `platform/contract/service/routed.ts` naming a refusal the operation does not declare). Every agent's typecheck reads red because of them. Find what made each one fail — a tsconfig or lib change for the e2e file, an error-union change for the reflections operation — and fix each at its cause.