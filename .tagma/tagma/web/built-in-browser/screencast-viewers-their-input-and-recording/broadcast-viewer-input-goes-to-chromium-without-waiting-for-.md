---
id: 01a1488e-00ad-708e-8b08-0438cae2cf9e
title: Broadcast-viewer input goes to Chromium without waiting for an answer, and seq holds the order
ord: 2
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/browser/engine/screencast.ts
    symbol: makeScreencast
---
The RPC server runs each `browser.input` call in its own fiber; the call waits until its `seq` is next for the viewer, then posts its `Session` events without waiting for Chromium's answer. The `Input.*` answer arrives after the renderer has handled the event, so on a hung page or one sitting in a dialog, waiting calls would pile up without end. Order holds because one session's posts travel to the host one after another over its transport. Only `copy` waits for an answer — `Runtime.evaluate` in the engine's isolated world.

A missed `seq` holds later calls until the viewer leaves; on a call failure the client subscribes anew — a new viewer, `seq` from zero. Coordinates arrive as frame fractions and are recalculated to the latest frame's size, so before the first frame the viewer's mouse and wheel do nothing.
