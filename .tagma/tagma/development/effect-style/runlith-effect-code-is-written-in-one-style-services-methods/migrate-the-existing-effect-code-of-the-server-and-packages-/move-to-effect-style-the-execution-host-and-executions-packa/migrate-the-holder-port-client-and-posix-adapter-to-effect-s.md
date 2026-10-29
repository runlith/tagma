---
id: 01a13d7c-3a24-7b95-9e76-75f8a518f9e1
title: Migrate the holder port, client and POSIX adapter to Effect shape with no frame or channel changes
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d2f-a3e1-7eb6-b786-be39dc244afb",
    "status": "done"
  }
sources:
  - kind: dir
    ref: packages/execution-host/src/holder
  - kind: dir
    ref: packages/execution-host/src/holder-client
  - kind: dir
    ref: packages/execution-host/src/posix
---
Migrate the execution-host package's `src/holder/`, `src/holder-client/` and `src/posix/` TS code to effect4 shape, including testing entries: internal Data errors, Effect fn/fnUntraced functions, previous spans and fd/wait ownership stay; Rust and the frame format do not change. The linked testing-layer contracts and FileSystem consumers update in the same delivery: `composition/testing`, direct native tests at the package root and `apps/tagma/server/src/composition/children.ts`. Read the modules whole, classify errors by real consumers, and verify holder conformance, descriptor/readiness, departure/succession, typecheck, style 0 and check_law; one Sol and Muse-lens round. Independently prove whether the ps PRI instability relates to the already recorded task-summary/thread-base-priority difference, fixing a clear observation defect at its owner. Commit after the parent reviews.
