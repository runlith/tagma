---
id: 01a0ca7c-8c14-708d-b1d7-c2079d65d54f
title: Mount map only where rows are the whole document
ord: 34
tags: ["rule"]
fields:
  {
    "enabled": false
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/entries/ToolDiff.svelte
---
Mount map only where rows are the whole document.

Positions on the map are row order, not file rows: over a patch with holes the thumbnail is not the file.
