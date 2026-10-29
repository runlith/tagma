---
id: 01a184fd-77a5-70ea-a3a0-4aba10db83ff
title: Picked source paths are verified against the page's project checkouts
ord: 25
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/contract/service/sources.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/source.ts
---
The picked document's frame origin selects the serving terminal, not the outer tab's origin. A loopback listener's retained terminal working directory is a candidate dev root, not a root declared by the compiler; it is used only if that candidate file exists and belongs to a registered checkout of the page's project. Absolute framework paths keep their own checkout, and unknown or ambiguous serving roots remain unresolved, so a worktree pick never silently falls back to the main checkout.