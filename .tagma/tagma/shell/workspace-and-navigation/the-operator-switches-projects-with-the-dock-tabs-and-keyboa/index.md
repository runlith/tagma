---
id: 01a14c05-9e8f-7c75-a633-b2a43cf80c5f
title: The operator switches projects with the dock, tabs and keyboard and sees their pulse
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Dock.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Prefetch.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/ProjectKeys.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Pulse.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Strip.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/TabRow.svelte
---
**Value.** The operator keeps several projects before their eyes, switches them with one press, and notices working or waiting agents before moving.

**How.** A dock in the rail or tabs above the header; the look is picked in the app menu and the bar's context menu. Projects are also in the palette and the full list.

**Behaviour.** A visited project joins one shared model of set and order. Dragging changes the order, removing from the bar neither unregisters nor moves off the current project. Set, order, look and recents live on the server and follow the operator to every window and device; only the projects a window itself visited since it opened are its own. Pulse comes from the server; the dock also shows activity of projects past the scroll edge. Hovering pre-readies the move's code without opening the project's data.

**Limits.** The bar appears only with several plain projects. Numeric chords and the recents switcher are on desktop macOS; browser keeps the bar and the palette. Opening a separate window uses the desktop-host capability.
