---
id: 01a17eb0-7162-70be-bd54-bafba8539513
title: "The thread Changes tab does not switch layout by width: file list and diff stay in place at any pane width"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ea9-9a47-78c1-8434-854a22de8156",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17ea8-ed9f-724b-9732-678dba2e90a2
  - kind: relates
    to: 01a15ae1-974d-77c6-8b35-2408e7449703
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/Changes.svelte
---
`features/checkout/Changes.svelte` picks the layout by pane width on its own. From 768 px (`LIST + DIFF_MIN`) list and diff stand side by side; narrower — the open diff covers the list and offers a "back". The right area narrows with the window (`AreaFrame.room`, explanation f4f557ea), so the Changes layout changes with no user action. This breaks [[e7449703]], like the Checkout column's narrow mode removed in [[ba2e90a2]].

Needed: one layout at any width, the seam holding part sizes with the same mechanism as the Checkout column (`SeamHandle` `contained`).
