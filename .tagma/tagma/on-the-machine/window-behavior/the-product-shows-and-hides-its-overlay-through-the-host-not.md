---
id: 01a0c702-47e3-7172-8dbb-6b3db48b9d05
title: The product shows and hides its overlay through the host, not through the window
ord: 10
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/window-behavior/src/host-electron
  - kind: symbol
    ref: packages/window-behavior/src/host-electron/ElectronWindowBehaviorHost.ts
    symbol: conceal
  - kind: symbol
    ref: packages/window-behavior/src/host-electron/ElectronWindowBehaviorHost.ts
    symbol: isShown
  - kind: symbol
    ref: packages/window-behavior/src/host-electron/ElectronWindowBehaviorHost.ts
    symbol: reveal
---
