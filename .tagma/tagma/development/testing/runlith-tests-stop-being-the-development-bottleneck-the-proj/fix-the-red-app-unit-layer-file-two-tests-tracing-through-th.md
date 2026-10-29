---
id: 01a16aff-9b7d-7228-ba5b-5d2cc2ad3cd7
title: "Fix the red app unit-layer file: two tests tracing through threadSlot.svelte.ts"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16aff-dd8f-7407-8e70-9bc1a6b189af",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
`bun run --bun vitest run --project unit` in `apps/tagma/app` on 2026-10-23: 1 file, 2 tests; trace through `src/lib/app/panes/threadSlot.svelte.ts:20` and `packages/layer/src/Graph.ts` (`owner.instances.set`).
