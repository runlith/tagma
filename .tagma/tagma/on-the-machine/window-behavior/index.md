---
id: 01a0c700-8018-7e8b-b5d6-367efdc8aed8
title: Window behavior
ord: 32
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/contract/state.ts"
      },
      {
        "at": "src/host-electron/ElectronWindowBehaviorHost.ts"
      },
      {
        "at": "src/host-electron/bootstrap.ts"
      }
    ],
    "id": "@runlith/window-behavior",
    "kind": "kit"
  }
edges:
  - kind: imports-tests
    to: 01a1835e-fd16-7556-8288-d03ba287d79f
sources:
  - kind: dir
    ref: packages/window-behavior
---
Runlith desktop products — overlays and floating panels — lie above other apps without taking focus, pass clicks through to what is beneath, and stay out of screen recording. The package owns this behaviour as one state with one vocabulary: the fields and the commands that change them, pure steps from command to state and from state to what the view shows, a headless controller the renderer drives over the product transport, and an Electron host turning state into acts on a real window — plus an optional native macOS addon where Electron has no built-in activation ban. It creates no windows and supplies no controls: the BrowserWindow and its parameters, the transport between main and renderer, and the moment of native setup stay with the caller. The addon source is written in Objective-C++, which the server does not parse, so the package's declared dependencies over it are not measured.
