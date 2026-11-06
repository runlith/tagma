---
id: 01a0c837-97b4-73fc-bc40-b92b59160e8b
title: Desktop host
ord: 33
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/ExternalLinks.ts"
      },
      {
        "at": "src/WindowPlacement.ts"
      },
      {
        "at": "src/GlobalShortcuts.ts"
      }
    ],
    "id": "@runlith/desktop-host",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
sources:
  - kind: dir
    ref: packages/desktop-host
---
Desktop products need a window that remembers its place, lets no foreign pages out, and answers global shortcuts. The kit owns three main-process Electron mechanisms: window placement between runs, the policy of which addresses may leave it, and the one registrar of tap shortcuts, which registers a set of chords, drops what left it and reports each refusal as taken by another app or refused instead of logging it. It creates no windows: the caller builds the BrowserWindow itself and picks the placement file, the shortcut set and app origins.
