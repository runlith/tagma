---
id: 01a18500-e722-7828-8d79-f5c773cdfd5a
title: Desktop main counts page input as the operator's unless a pending debugger Input command of the page dispatches that event type
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
Desktop main reports the operator's input on a page from Electron's `input-event`, which observes the page's widget host. Input the engine dispatches through the debugger reaches the renderer through that same widget host between the `Input.*` command and its answer, so main does not count an event whose type a pending `Input.*` debugger command of the page dispatches (`Driven.injects`: a pending press hides presses, a pending key hides keys). The window lasts until the renderer acknowledges the command, so only the operator's events of that same type inside it are missed; his other input is counted. Scroll and pinch gestures are not counted at all: Chromium derives them from wheel events after the wheel's answer, including the engine's own, and a native scroll reaches main as a wheel event first.

This reading of Chromium's routing is not verified by a run under Electron: if the event arrived after the command's answer, every agent action would hold the agent itself, and the shared scenarios under Electron (task 6febfab1) are where that shows first.

Reports are throttled to one a second per page, which the engine's quiet bound must outlast.
