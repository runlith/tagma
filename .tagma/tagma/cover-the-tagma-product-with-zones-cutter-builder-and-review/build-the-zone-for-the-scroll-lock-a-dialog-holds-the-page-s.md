---
id: 01a0c83d-a919-7de5-854d-9cd001efd39b
title: Build the zone for the scroll lock a dialog holds the page still with
ord: 83
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c847-8782-7034-a377-ecebd05a81d3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/primitives/src/dialog/scroll-lock.ts
---
Fill [[342afbc8]] with the claims its code establishes. Read `src/dialog/dialog-scroll-lock.ts` whole, and `src/dialog/dialog-root.svelte` for the one caller inside the package, whose effect keys the lock to the content element rather than to `open`. Watch: what the two kinds mean and how a set of held locks mixing them resolves; why iOS takes a fixed body where every other browser takes only hidden overflow, and what a fixed body costs a sticky header — the code names the defect; where the scroll position is kept, when it is restored, and what becomes of it when the last lock leaves; and what the scrollbar compensation custom property is for. Both doors are exported at the package boundary, so state what a page lock promises a caller that is not a dialog. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[de36c9fd]]; the reference shape is the Layer kit [[59cc3c49]].