---
id: 01a1a76d-604b-7cce-95ed-4c6e6aa15337
title: The Electron window host branches on darwin for hide, show and focus behaviour
ord: 13
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: packages/window-behavior/src/host-electron/ElectronWindowBehaviorHost.ts
  - kind: file
    ref: packages/window-behavior/src/host-electron/ElectronNoFocusStealRuntime.ts
  - kind: file
    ref: packages/window-behavior/src/host-electron/electron-defaults.ts
---
The package's contract is a window behaviour state; its macOS addon is a separate native adapter (`src/native/no-focus-steal.ts` and the Objective-C++ source) and is fine. The Electron host over the contract still knows the OS: it takes `platform` as an option defaulting to `process.platform` and branches behaviour on `darwin`.

Read at ee24295b8e:
- `ElectronWindowBehaviorHost.ts:24` platform default; `:78` application show on darwin; `:106` application hide on darwin.
- `ElectronNoFocusStealRuntime.ts:33` platform default; `:191,203` restore the previous application's focus on darwin, blur elsewhere.
- `electron-defaults.ts:37,41` app show and hidden state are darwin-only.

Done when the host asks an application-bridge contract for hide, show and focus restoration, the macOS behaviour is an adapter composition supplies, and the host's tests no longer pass platform literals.