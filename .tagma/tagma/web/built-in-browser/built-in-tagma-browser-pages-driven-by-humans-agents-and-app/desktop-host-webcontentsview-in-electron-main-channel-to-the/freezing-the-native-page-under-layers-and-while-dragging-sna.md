---
id: 01a147d6-7ef4-7c9c-9e39-feac6e97df1d
title: "Freezing the native page under layers and while dragging: snapshot on intent, frame in place of the view, parking"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18444-f995-7b52-b098-bbdec51b2fd0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a0e255c4582
  - kind: relates
    to: 01a13d48-9aa9-71d0-a2d8-68fc313c7343
  - kind: waits-on
    to: 01a147d6-7ef4-7c9c-9e39-feab93cb7437
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490bb2ab8869
---
Freezing the native page view under layers and while dragging: a snapshot on intent, a frame in place of the view, parking.

The desktop [[255c4582|host]] freezes the native view of the page under layers and while the seam and panel drag: a snapshot on the intent to open a layer, a frame in place of the page, the view to parking, return after closing. It needs the open layers' rectangles, the notification-step rectangles, and the intent signal from the [[313c7343|layer stack]]; they go into its spec, and this work starts after the stack is built (it has no task yet).

Done when: a panel contract test — an intersecting layer freezes the view, a non-intersecting one does not, closing returns; the operator checks palette, menu, and notifications over the page.
