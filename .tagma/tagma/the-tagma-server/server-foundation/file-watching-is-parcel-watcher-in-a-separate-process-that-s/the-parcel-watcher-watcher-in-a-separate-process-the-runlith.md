---
id: 01a14c68-75fc-7268-bf0d-39b2d620c9b9
title: "The @parcel/watcher watcher in a separate process: the @runlith/watch kit, a port in platform, OS-side exclusions, removing the Worker and the Bun stream probe"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea98-7334-8861-317dd11a1f05",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14c5a-4c1f-719c-8aa5-3b838d8a01b6
sources:
  - kind: dir
    ref: apps/tagma/server/src/platform/watch
---
Steps 1 and 2 of the [[8d8a01b6]] spec: the parcel watch process, the `@runlith/watch` kit, the `platform/contract/service` port, composition binds. The `platform/watch` public contract (`watchAll`, `watchTree`, `withholding`, tickets) stays, consumers do not change. `native.ts`, `native.worker.ts`, `live.ts`, `restarts.ts`, `leaveToExit`, `streamRestarts` go; the 0a116765, 07a7171a, a315b656 explanations go to the trash, a new explanation of the watch process and its loss rules is written.

The process in this task lives with its own server; surviving restarts is a separate step-4 task. But the channel and protocol are designed so step 4 lies down without rewriting: the process is found by a channel in the data directory, a subscription by root is idempotent.

Start with `platform/watch/tree.ts` and `packages/sqlite-process` (the child-process and native-asset model). Proof: the spec's acceptance 1–5, 9, 12.
