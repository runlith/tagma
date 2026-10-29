---
id: 01a11901-470f-7498-99ae-69e71df77ec3
title: "Kit: EntryKinds entry-kind registry, pinned region, live rows, view-held feed memory"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e18d75d711
---
Per [[8d75d711]]: `EntryKinds` (descriptor, typed payload, four refusal cases — the third and fourth; the first two await the producer), tool renderers by name from declarations, the `pinned` region outside the scroller with clearance, `keepAlive` rows (4 per surface, inert outside the window, rangeExtractor), slot feed memory (LRU 8, key with expansion, width reset), in-feed message navigation. `beforeEntries`/`footer` go away. Patch/splice is a separate task.

Done: typecheck; the registry and region tests from [[8d75d711]].
