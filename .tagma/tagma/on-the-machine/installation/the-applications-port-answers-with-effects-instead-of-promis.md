---
id: 01a1a2bd-7ec0-70a7-be5a-3c99e252bac9
title: The Applications port answers with effects instead of promises
ord: 84
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a43-7a67-8046-6e8a2efb5b64",
    "status": "done"
  }
---
Review finding L7, first part. `installation/contract/service/applications.ts` declares `verify`, `copy`, `unquarantine` and `signature` as promises with `AbortSignal`s. Callers wrap them in `Effect.promise` and `Effect.tryPromise`, so a rejected `copy` and an interrupted `verify` have no typed shape. The port declares effects: interruption replaces the signal, and refusals are typed. The macOS adapter (`mac-applications/placement.ts`) and the test doubles fill them.