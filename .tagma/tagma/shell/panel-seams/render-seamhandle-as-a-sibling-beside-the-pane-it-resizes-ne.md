---
id: 01a0c83f-4fa8-7bb4-9120-d9f627700384
title: Render `SeamHandle` as a sibling beside the pane it resizes, never inside the pane
ord: 3
tags: ["rule"]
sources:
  - kind: file
    ref: packages/seam/src/SeamHandle.svelte
---
The handle lies over the pane's border with negative margins, so it sits in the same row as the pane.