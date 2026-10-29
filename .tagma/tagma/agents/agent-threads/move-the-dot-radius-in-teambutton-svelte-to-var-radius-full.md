---
id: 01a108f2-badf-702f-8f8c-08b56ac8dcd4
title: Move the dot radius in TeamButton.svelte to var(--radius-full)
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a108da-24a4-71a3-b8a6-7d081646b6ac",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a108a0-1765-74f2-b42a-3d583a5e55a9
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThisThread.svelte
---
In `apps/tagma/app/src/lib/features/threads/TeamButton.svelte` the `.dot` style sets `border-radius: 9999px`; the tightened design-token inspection rejects the literal. Replace with `var(--radius-full)`. Done when the inspection finds no violations in the file and the rule debt is lifted.
