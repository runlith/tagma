---
id: 01a10bb4-14bf-76ff-8ee5-b6b93a3d1025
title: Desktop input
ord: 34
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/DesktopInputHost.ts"
      },
      {
        "at": "src/contract/types.ts"
      },
      {
        "at": "src/preflight.ts"
      }
    ],
    "id": "@runlith/desktop-input",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
sources:
  - kind: dir
    ref: packages/desktop-input
---
A desktop product needs to hold a key while another app is active, and paste text where the cursor stands — Electron can do neither. The kit owns the macOS native helper: an active event tap that itself matches presses against one binding and reports only its holds (and `Esc`, while requested), swallows its chord on request, watches Accessibility permission via system notification, and pastes text with ⌘V with clipboard swap and restore; plus the lifecycle of that helper in the main process and reporting its loss. Which binding to hold, what to do on hold, whether to restore the clipboard and where the binary lives — the caller decides.
