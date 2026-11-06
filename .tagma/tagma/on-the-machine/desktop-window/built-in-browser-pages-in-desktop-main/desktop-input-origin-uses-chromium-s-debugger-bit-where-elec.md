---
id: 01a18500-e722-7828-8d79-f5c773cdfd5a
title: Desktop input origin uses Chromium's debugger bit where Electron exposes it
ord: 7
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a184e9-acb7-7aa5-b270-ce2073c47652
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/driven.ts
  - kind: file
    ref: apps/tagma/desktop/src/browser/host.ts
---
Desktop main reports the operator's input from Electron's `input-event`, which observes the page's widget host. Where Electron exposes native `_modifiers`, Chromium's `kFromDebugger` bit identifies injected events even after their CDP command has been acknowledged. Mouse event shapes that omit those native bits use the pending command's dispatched event types (`Driven.injects`). This fallback can miss the operator's event of that same type while the command is pending; native provenance does not share that ambiguity. Scroll and pinch gestures are not counted at all: Chromium derives them from wheel events after the wheel's answer, including the engine's own, and a native scroll reaches main as a wheel event first.

The shared engine scenarios on the desktop host confirm this routing under Electron 44.8: an agent's consecutive actions on a page are never held for operator quiet, which they would be if the event arrived after the command's answer.

Reports are throttled to one a second per page, which the engine's quiet bound must outlast.
