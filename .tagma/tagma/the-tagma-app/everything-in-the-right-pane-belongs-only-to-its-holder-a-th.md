---
id: 01a15706-a735-7d88-a8bc-392b19b8fd8a
title: Everything in the right pane belongs only to its holder — a thread, its draft, or a section; what is shared across a branch/worktree lives outside it
ord: 57
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/app/panes
  - kind: dir
    ref: apps/tagma/app/src/lib/features/executions
---
Branch terminals live in the bottom terminal panel, visible from any thread on that branch. Right-pane tabs never mix with it or with other holders: no lists of other holders' items, no moving of shared tools into tabs.
