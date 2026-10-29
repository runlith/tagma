---
id: 01a1562f-8dce-70fe-9ee1-c66bb9f9e8dc
title: Two-finger trackpad swipe on desktop flips window history with an edge arrow, like Chrome
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a155f9-4752-789c-b188-fb618640cd13",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/BackForward.svelte
---
On the web, a horizontal two-finger swipe turns the window history over, by Chrome's own hand. On desktop there is no such gesture: Chrome keeps it in its own `HistorySwiper`, which Electron does not have. We build the same gesture in the desktop window: it walks the same history as the `BackForward` arrows, `⌘[`/`⌘]`, and the side mouse buttons.

Behaviour:
- as the swipe goes, an arrow slides out at the edge and grows with the gesture;
- past the threshold it fills in: “release and it goes”;
- pulling the fingers back before release cancels the gesture;
- when there is nowhere to go, there is no arrow.

The gesture fires only on overscroll. If the element under the cursor can still scroll that way or took the wheel itself (graph, page translation), that is a scroll, not a gesture. If “Swipe between pages” is off in macOS, there is no gesture. A three-finger swipe (the window `swipe` event) leads to the same place.

Start with `apps/tagma/app/src/lib/app/chrome/BackForward.svelte` and the `apps/tagma/desktop/src/bridge.ts` bridge. The renderer does not learn the end of the gesture from `wheel`; main brings it from the `webContents` `input-event`.

Proof is a landed change plus a gesture-recognition test over a sequence of wheel events and the gesture end.
