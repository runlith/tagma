---
id: 01a16a33-ca7b-75cf-9bee-24abba55df52
title: Native submit_work in nativeLanding hangs on the first call after two session landings
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The test ends at its own 60000 ms ceiling with 2 expect() calls (both landings). The first doors.atNative('submit_work', …) never returns; over 61.94 s the report holds only periodic WireUnavailable host-feed and, at the end, sqlite-process/writer hold-threshold for Projects.ensureGlobal and project.birth.",
    "command": "bun test --parallel=1 ./src/composition/testing/landing/submitReferences.stest.ts (apps/tagma/server)",
    "expected": "The first native submit_work after nativeLanding, born of two threads and two ChangeRecord.land calls returns landed; the test reaches the foreign-type reference check."
  }
---
Filed from project `runlith`.

Reproduced on the working tree after the pool reported a clean server typecheck, HEAD during the run acc73f2063097ca60bcd3b8b2900712702e25ef3 → 4d00060ee5affef044ce3fd8c232db5037c0e5cc. Load average before start 8.96 on 12 logical cores. The dependencies check was temporarily off for red, but the call hung before it; the initial run with it on also hung on the first submit. The operator's running server untouched: the test assembles its own in-process DoorWorld.
