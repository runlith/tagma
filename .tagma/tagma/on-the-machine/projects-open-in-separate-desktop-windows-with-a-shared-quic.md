---
id: 01a14c05-71a7-71c8-88a1-ee53a451092b
title: Projects open in separate desktop windows with a shared quick hide
ord: 26
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4aba458262
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/projectWindow.ts
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
  - kind: file
    ref: packages/desktop-host/src/GlobalShortcuts.ts
  - kind: file
    ref: packages/desktop-host/src/WindowPlacement.ts
---
**Value.** The operator keeps different projects or places of one project in independent windows, for example on different monitors.

**How.** Open in new window on a project, a new desktop window from the keyboard, native macOS tabs; a shared chord for quick-hiding the app.

**Behaviour.** Each window has its own renderer, connection and current address. A new app launch reveals the existing instance, which may hold several windows. Reconnecting returns each to its address; installation questions are asked once over the last focused window. The first window's position persists across launches, the rest cascade. Quick hide hides and reveals the whole set. It is an action of main's own: its chord is the person's to move or keep inside Tagma, and pressed in a window it still has main hide the set. The ⌘+/⌘−/⌘0 zoom is per window: a window on another monitor zooms separately, its zoom survives reload and window navigation, a new window opens at 100%.

**Limits.** A fresh launch restores one window, not the whole previous set, and window zooms are not preserved. The projects bar and some saved keys are shared; a separate renderer does not make them independent. The old `tagma desktop` help still promises one window per app. Overlay capabilities from the shared kit do not become settings of a plain Tagma window.
