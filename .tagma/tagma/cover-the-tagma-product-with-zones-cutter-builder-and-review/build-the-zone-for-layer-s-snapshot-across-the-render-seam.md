---
id: 01a0c702-18fa-72e5-9265-b91eb2789357
title: Build the zone for layer's snapshot across the render seam
ord: 63
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c706-7851-7068-9ac1-38447854f7a8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/Snapshot.ts
---
Fill [[ebcfb470]] with the claims its code establishes. Read `src/Snapshot.ts` whole; the doors that carry the payload are in `src/sveltekit/index.ts`, owned by [[816a06c2]]. Watch: what a part that has not joined yet is held for and when the held value is spent, what makes the same record applied twice one payload, and what a part's own key contributes to the payload's shape. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].