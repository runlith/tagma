---
id: 01a155d6-3c66-70fe-80ed-fbfe91b1d2af
title: "Desktop surface windows are created with zoomMode: 'isolated', so each window has its own zoom"
ord: 20
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
  - kind: file
    ref: apps/tagma/desktop/src/viewWindows.ts
---
In the default mode Chromium keeps zoom per origin, and all Tagma windows load one surface origin: ⌘+ in a window on one monitor would also zoom the window on another. In `isolated` mode the `zoomIn`/`zoomOut`/`resetZoom` menu roles change only the focused window, and Electron itself carries its level across document navigations — `loadURL`, reload, the waiting page and back. This was verified by a probe on Electron 44.8.0. So there is no own level storage or preload restoration. The mode is set on every window that loads the surface: project windows, view windows, and the dictation pill. A window created without this mode would share zoom with all again.

The built-in browser pages and DevTools stay in the default mode, and their zoom is tied to their origin.
