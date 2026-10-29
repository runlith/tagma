---
id: 01a144e1-7105-77b8-b01f-592d3149e889
title: Move native fs.watch/close into the watch Worker and announce a stream restart only when native watchers change
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14492-18f7-70ac-8da3-4cd5f7ca19be",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a144b2-e660-7c7d-88fc-f7b26ad2af90
sources:
  - kind: dir
    ref: apps/tagma/server/src/platform/watch
---
Do what the [[6ad2af90|spec]] describes: `native.worker.ts` holds all process `fs.watch`/`FSWatcher.close`, `native.ts` is the native-watcher table by `(at, recursive)` with a place count, `watchAll` and the `live.ts` probe go through it, `withholding` waits for `closed`, a lost Worker gives places `error`. The probe is asked once per series — together with the [[b2fb89d9|probe task]].

Start from `platform/watch/tree.ts` (`watchAll`) and `live.ts`. Done when `tree.itest.ts`, `live.itest.ts`, `restarts.test.ts` and the spec's new contracts pass, there is a before/after measurement (main loop lag, `streamRestarts`), and the [[a315b656]] and [[0a116765]] notes are fixed.
