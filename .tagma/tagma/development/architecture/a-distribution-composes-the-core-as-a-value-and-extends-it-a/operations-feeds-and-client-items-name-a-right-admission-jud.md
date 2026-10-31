---
id: 01a193d9-9a1f-79e8-9f71-7aa0f78707fb
title: Operations, feeds and client items name a right; admission judges it once through the `Access` port, and the client renders the same answer
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a19371-bc70-7ecd-b2c5-96b9f492b72c
  - kind: waits-on
    to: 01a193d9-9a1f-79e8-9f71-7a9bcf84aabf
---
Item 9 of [[0ac072c1]] and item 10 of [[d4b30c0c]], with one owner because they share the right's wire shape and the `right-missing` refusal. The core declares the ports and binds no filler; a declared right with no filler fails assembly.

Settle before the gate is built: `TabLayouts` judges a saved tab `undeclared` on its first read, keeps the filtered layout, and persists it on the next write. Its `sweep()` applies `SurfaceRegistry.named` once, at construction. So a pane kind, surface or former name that joins later through a chunk, a `Layer.when` that flips, or `register` loses its saved tabs and visits for good. Today every `Panes` and `Surfaces` member joins when the app scope starts, before any project-tier layout restores, but nothing enforces that. Either those points accept members only at app-scope start, or a point exposes a settled moment and the sweep waits for it. A gated tab kind kept in a restored layout depends on that choice.