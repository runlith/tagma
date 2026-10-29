---
id: 01a154d0-e067-7cb3-b902-9f38fcc7dbc0
title: "Rail selects project and section in one language: shared edge tick, 32 px body, neutral section selection"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a154b2-1f0d-743a-839c-8bad15654f3e",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a43cf80c5f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NavigationRail.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Dock.svelte
---
A project in the dock is marked with a 4×20 white tick with a hover stub and a filled 32 px tile; a section with a 2×16 yellow line and `bg-brand/10` highlight across all 36 px. The brand yellow almost matches the “agent working” amber on tiles in the same column, while the rest of the app selects neutrally (`bg-selected`).

Do: one rail tick for projects, sections, and settings; the selected and hovered section — a 32 px `rounded-lg` square inside the 36 px press zone, `bg-selected` and text color; section step 6 px, as with projects. Color in the rail stays only on meaning: project tint, work, waiting.

Proof — a landed change and app typecheck.
