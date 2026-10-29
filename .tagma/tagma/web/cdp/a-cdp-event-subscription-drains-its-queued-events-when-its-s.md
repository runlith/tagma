---
id: 01a1854e-8a60-7688-84eb-63d10b7298ab
title: A CDP event subscription drains its queued events when its scope ends
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/cdp/src/session.ts
  - kind: file
    ref: packages/cdp/src/stream.ts
---
A snapshot command's answer follows its chunk events on the wire, but the worker can still be writing those chunks when the command answers. Ending the listener therefore stops admission and drains its queue; shutting that queue down would discard the snapshot's tail. The heap writer releases its listener after the command answers and joins the draining writer before handing over the file.