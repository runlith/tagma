---
id: 01a15646-817d-7e1e-b00a-d1cac9d19b86
title: Trackpad swipe on desktop takes only finger-phase boundaries from AppKit; deltas and the step decision come from DOM wheel
ord: 22
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1562f-8dce-70fe-9ee1-c66bb9f9e8dc
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/HistorySwipe.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Swipe.svelte.ts
  - kind: file
    ref: apps/tagma/desktop/native/swipe.m
  - kind: file
    ref: apps/tagma/desktop/src/swipe.ts
---
A “release-to-go” swipe needs to know when fingers leave the trackpad. Electron does not give it: `input-event` for wheels and gestures carries only the event type, no deltas and no phase, and the window `swipe` event arrives only for the old three-finger swipe. So `native/swipe.m` puts a local AppKit monitor on the wheel and reports only finger-phase boundaries to main: `began`, `ended`, `cancelled`. Main forwards them to every project window. A window with no gesture under it receives boundaries with no wheel events and does nothing.

Deltas and the decision stay in the renderer, on DOM `wheel` between `began` and `ended`. Only the DOM knows whether the element under the cursor can scroll sideways and whether its handler took the wheel (graph, page translation). And only in the DOM are deltas in the same CSS pixels the arrow is drawn in, at any window zoom. Content is checked on every wheel until the axis is decided. That is why a gesture whose early motion the content took stays a scroll even at the edge. The exception is content that reached the edge on the very first wheel: as Chromium reads it, the compositor scrolls before the page sees the wheel, and such a gesture can become a step. The right to a history step is checked once, when the axis is decided.

Boundaries and wheels travel different channels, and their ordering is not guaranteed. Usually the end boundary arrives before the inertia, and inertia does not count: it comes as events after the finger phase ends. The main-side delay is not measured; if main delays the boundary longer, inertia adds to the stroke. Inertia continues the fingers' last motion, so a step gets only a fling toward the step, and cancelling by moving back is not broken by it. Finger frames arriving after the end are dropped, though the arrow never showed them either.

An exact single-finger stroke would require sending every trackpad wheel event from main to the window. The content-scroll decision would still rest with the DOM, and the two streams would have to be reconciled. For a rare fling, that is not done.
