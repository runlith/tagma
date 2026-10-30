---
id: 01a0c702-47cc-7517-9fc4-eb3a61d1a8f9
title: Create a window that uses these behaviors with the BrowserWindow options from `behaviorWindowOptions`
ord: 9
tags: ["rule"]
sources:
  - kind: file
    ref: packages/window-behavior/src/host-electron/ElectronWindowBehaviorHost.ts
  - kind: symbol
    ref: packages/window-behavior/src/host-electron/bootstrap.ts
    symbol: behaviorWindowOptions
---
The behaviors depend on those window options being set when the window is created.