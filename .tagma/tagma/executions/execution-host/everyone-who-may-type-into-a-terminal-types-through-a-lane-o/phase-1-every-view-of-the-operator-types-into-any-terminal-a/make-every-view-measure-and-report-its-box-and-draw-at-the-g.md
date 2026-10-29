---
id: 01a0cf4b-e145-75fe-9035-2347893509b3
title: Make every view measure and report its box, and draw at the grid the server applied
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d01f-4af3-7ca0-93e1-695681797232",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-281d-7ffa-a766-934722097468
  - kind: waits-on
    to: 01a0cf4b-e139-76b4-80cc-af9f930e0cfb
  - kind: waits-on
    to: 01a0cf4b-e143-70f4-9a38-34e752c27ff4
---
Build the app's grid part of [[22097468]] (section 5, Grid), on the lane road only: `TerminalFit` measuring with no gate and reporting the box to the server; the engine resized only to the grid the server sent, except the view the server last named decider, which refits at once; `TerminalGrids`' page publish gone from this road. The server's decider and grid lane are [[52d67932]]'s. Done when the grid cases of section 7 are checked live — splits, divider drags, window resizes, the panel, two windows, hover — a reviewer on the builder's own rung found nothing left open, and doctor over the touched paths is clean.