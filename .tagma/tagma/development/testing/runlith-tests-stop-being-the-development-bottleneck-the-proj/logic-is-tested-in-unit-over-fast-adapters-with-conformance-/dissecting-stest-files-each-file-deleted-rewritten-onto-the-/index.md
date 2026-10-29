---
id: 01a16c99-f00e-7823-9cd1-9ae91c6e2051
title: "Dissecting stest files: each file deleted, rewritten onto the shared world and renamed to itest, or its logic moved to unit; red stests fixed or deleted; test:system removed"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16c9a-4da0-760e-8744-be0e429392c9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Implements [[4dbd9a84]]. Per the "after" measurement [[08f81bea]] server stest is 2185 s CPU of 3831 (57% of the set): bodies 1493 s, world builds 714 s; 148 of 256 stest files build their fixtures past the world registry. Red stests are 36 plus the new `submitDeletion.stest.ts`.

Total on 2026-10-24: every file of 294 has an outcome (283 itest, 11 deleted), `test:system` and the system CI job removed in f18c2a9420. Outcome table and handoff state — [[3e4db078]]. `--randomize` not returned: no full green run on seeds 1–3. The remaining red the operator handed to the owners of modules rewriting the expensive itests.
