---
id: 01a0c702-47e3-7172-8dbb-6b3db48b9d05
title: Show and hide the overlay through the host's `reveal` and `conceal`, never through the window itself
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
The host keeps the concealed state that `isShown` reports; hiding the window directly leaves it out of step.