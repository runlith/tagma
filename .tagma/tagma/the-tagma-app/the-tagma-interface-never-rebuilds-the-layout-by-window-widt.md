---
id: 01a15ae1-974d-77c6-8b35-2408e7449703
title: "The Tagma interface never rebuilds the layout by window width on its own: panels never overlay, hide, or move without the user's action"
ord: 58
tags: ["rule"]
fields:
  {
    "delivery": "prompt"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src
---
Tagma is a desktop app, not an adaptive dashboard. When the window narrows, panels stay in place and only resize within their bounds. Only the human changes the layout.
