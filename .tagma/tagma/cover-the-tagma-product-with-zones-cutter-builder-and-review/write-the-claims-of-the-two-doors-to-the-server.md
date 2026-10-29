---
id: 01a0ca95-30ed-77f0-a06e-dd46f794fd8c
title: Write the claims of the two doors to the server
ord: 180
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
The area is [[a75173f7]]; read `apps/tagma/app/src/lib/wire` whole — `Live.ts` is 875 lines and is the hard part — together with its six tests, which are where the closing, pausing, reopening and resuming behaviour is actually pinned.

Two things belong to the module above and not here: [[0df385f7]] already states that the client binds to the page's origin and carries no session. And the server measures its own browser boundary against this app's tree — `apps/tagma/server/src/boundary.test.ts` declares `browserConsumers: ['../app/src']` and fails when the app opens a door its entry-point list forgot. That is the server's claim to write; find it under the server's module and RELATE to it rather than restating it. If it does not exist yet, say so in your report and leave the reference unwritten.

The module above is [[cc59eadf]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over `apps/tagma/app/src/lib/wire` is clean, and a review passes.