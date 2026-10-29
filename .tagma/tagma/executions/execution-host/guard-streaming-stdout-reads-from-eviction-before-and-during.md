---
id: 01a12c92-9c5d-7a2f-b645-7a716a5ec421
title: Guard streaming stdout reads from eviction before and during subscription
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4df8ba91d8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12c87-3ce1-77a1-b29c-cb5e536ffde9
sources:
  - kind: file
    ref: packages/execution-host/src/RecordReaders.ts
  - kind: file
    ref: packages/execution-host/src/subscriptions.ts
  - kind: file
    ref: packages/executions/src/executionSpawner.ts
---
Streaming is declared at launch and holds unread output until the first reader, then by its frontier; ordinary commands keep bounded eviction and an honest gap. Pressure/admission now stand ahead of the bounded native read, and stopCapture with the native stop keeps the unread fd tail at handover. Two public-spawner tests went red gap→green; the handover system test went red with 1024 of 9216 bytes lost→green; verified: final drain, end/seal, reopen and no-reader stop→retire. Landed 39035be8b2; types execution-host/executions, 30 host/record, 48 wire/spawner, 29 surface and 4 native tests green, 10 rules violation-free. After the neighbouring work's imports fix the server bun check passed over 4415 files; a home-grown tagma:try on 17424 built and confirmed the compiled pipeline: ended/exit7, exact stdout-proof/stderr-proof, gap=false, then stopped. The operator's server untouched. The historic State loss of a large diff [[f5bacc7b|stays unproven]], and the [[77e29940|retirement check]] has another cause and never changed.
