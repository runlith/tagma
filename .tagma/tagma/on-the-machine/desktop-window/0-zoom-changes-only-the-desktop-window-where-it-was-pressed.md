---
id: 01a155d4-e525-7952-a3ec-daedac903427
title: ⌘+/⌘−/⌘0 zoom changes only the desktop window where it was pressed
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a155cf-8a52-7565-9f39-ef8a14d6efef",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/desktop/src/preload.ts
  - kind: file
    ref: apps/tagma/desktop/src/quitting.ts
---
Zoom currently plays the `viewMenu` role of Electron: it calls `webContents.setZoomLevel`, and Chromium keeps the zoom per origin, while every Tagma window loads one origin — so zoom in a window on one monitor also zooms the window on another (measured by trial on Electron 44.8.0). As in VS Code, zoom should change only the window where it was pressed and survive that window's reload and navigation.

Proof: a trial on Electron with two windows of one origin — zooming one does not change the other, persists across `loadURL`, `reload`, and the waiting page; desktop typecheck.
