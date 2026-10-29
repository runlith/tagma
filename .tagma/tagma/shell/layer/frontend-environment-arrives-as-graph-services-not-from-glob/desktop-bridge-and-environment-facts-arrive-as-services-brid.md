---
id: 01a14fe9-9f2a-77a2-b527-f53e41d18ce7
title: "Desktop bridge and environment facts arrive as services: bridge ports, Host knows ios, touch and installed, /pair mounted into the graph"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14ff7-5493-7d72-a4da-9080d33bf5a7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14fd8-3e41-7f9d-909a-f909b96e483e
  - kind: waits-on
    to: 01a14fd8-68cd-7412-b239-945d0da3edb9
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/runtime.ts
  - kind: file
    ref: packages/layer/src/Host.ts
---
Task 4 of spec [[b96e483e]], the "Desktop bridge" section, the `Host` and "touch" rows of the audit [[dbf104d3]]. Ports `DesktopTabs`, `DesktopBrowser`, `DesktopDictation`, `DesktopFolders`, `ProjectWindows`, `MainWindow` on `@tagma/desktop/bridge` contracts, `runtime.ts` fills them; optional conditional-key reading in `make` in Layer (replacing filler classes); `Host.os` gains `ios`, new `Host.touch` and `Host.installed`; `Host` duplicates (ViewFrame, settingsPages, TreeMenu, iOS-from-userAgent, the `host` constant in loads and components) move to `Host`; the `/pair` route under `App.mount`; `ExternalLinks` instead of `window.open`. The `Host` changes in Layer go in this task. Work per the frontend skill [[0da3edb9]]. Proof: only `runtime.ts` reads `window.tagmaDesktop`, the typecheck, app and desktop builds pass.
