---
id: 01a1031e-d5ce-7656-be01-1b1cc154b23f
title: Show `search_threads` matches as an 'In conversations' group in the thread-column filter
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10354-3369-73c5-b2a5-242c5f28a9d3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff2b-54ff-7f7f-91d2-8f56f07ab3f2
  - kind: waits-on
    to: 01a1031e-d5ce-7656-be01-1b1bce263514
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Column.svelte
---
Builds [[f07ab3f2]] whole. UI work — Claude models only.

Start with `apps/tagma/app/src/lib/features/threads/Column.svelte` and `tree.ts`.

Done when the spec's acceptance is met.
