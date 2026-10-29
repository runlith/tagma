---
id: 01a14735-72e3-7def-9e6a-b167b16c72e1
title: Bump Electron 41.1.0 → 44.8.0
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14733-5f42-79a9-a127-c52a98184a8e",
    "status": "done"
  }
---
Branch 41 is out of support (last release 41.10.7 — 2026-08-24); the current stable is 44.8.0 (Chrome 152, Node 24.22).

What 42–44 break for us:
- 44: `clipboard.readText/writeText` in main return a Promise — `apps/tagma/desktop/src/Dictation.ts`.
- 43: `dialog.showOpenDialog` without `defaultPath` always opens in Downloads and does not remember the last folder — project folder choice in `apps/tagma/desktop/src/folders.ts`.
- 42: the binary downloads on the first `require('electron')`, not in postinstall — `electronBinary()` in `build-host.ts` survives this.

Unaffected: Node stays 24, the window-behavior addon is on N-API, `LSMinimumSystemVersion` is already 13.0, signing skips the bundle without ANGLE library names, Notification/login items/offscreen/net are unused.

Done when: catalog and lockfile are on 44.8.0, the desktop packages' typecheck is green, `build-host` builds and signs Tagma.app, the app starts.
