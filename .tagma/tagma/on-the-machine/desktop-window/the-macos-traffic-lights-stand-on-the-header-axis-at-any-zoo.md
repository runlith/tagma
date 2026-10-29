---
id: 01a1503b-7bfa-7f58-a288-321715c313b7
title: "The macOS traffic lights stand on the header axis at any zoom: Electron centers them in the titleBarOverlay, the header takes height and inset from env(titlebar-area-*)"
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15035-aff9-7bfd-bd74-30aad08926e8",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/TopBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/TabRow.svelte
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
---
The window buttons stood at `trafficLightPosition { x: 14, y: 12 }`, the header at the `--topbar: 2.25rem` token. At page zoom (⌘− from the View menu) the header shrinks but the buttons do not — the traffic lights drift off the axis of the arrows and the project pill. Start with `apps/tagma/desktop/src/projectWindows.ts`, `apps/tagma/app/src/app.css`, `TopBar.svelte`, `TabRow.svelte`. Proof is Electron 44 window snapshots on macOS 26 at zoom 1 and 0.8.
