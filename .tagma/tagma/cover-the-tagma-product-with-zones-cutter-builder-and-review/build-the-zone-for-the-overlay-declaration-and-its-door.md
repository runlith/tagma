---
id: 01a0c83d-a8ed-7f04-996f-1ab7d0c43539
title: Build the zone for the overlay declaration and its door
ord: 79
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c841-46f7-76c9-ab6a-4fdb7442a0d8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/primitives/src/overlay-policy.ts
  - kind: file
    ref: packages/primitives/src/Overlay.svelte.ts
---
Fill [[cea5253f]] with the claims its code establishes. Read `src/Overlay.svelte.ts` and `src/overlay-policy.ts` whole, with `src/Overlay.test.ts` and `src/door-laws.test.ts` for the behaviour the door promises; the queue those calls land in is [[0886e86e]], so claim nothing of it. Watch the distinctions a reader cannot infer: why a presenter key is declared eager and what a lazy graph would leave unbound; why the member layer keys a binding by the object rather than by the id, and what two overlapping scopes of one rung would otherwise do to it; what `ExactPolicy` refuses and why a generator's return needs it; which overlays a leaving rung takes with it and which outlive every handoff; what `foreignDialogOpen` subtracts and why it subtracts by what a key is rather than by what the queue is doing with it; and the asymmetry in `relate` — an arbitrated candidate never displaces an unarbitrated showing, even where the two could have shared. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[de36c9fd]]; the reference shape is the Layer kit [[59cc3c49]], whose granularity [[1a712a78]] and [[33d7f6dd]] show.