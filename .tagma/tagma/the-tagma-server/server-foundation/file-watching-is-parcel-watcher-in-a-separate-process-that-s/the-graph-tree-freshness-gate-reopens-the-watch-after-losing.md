---
id: 01a14c8f-286c-7298-97b0-9f0112f46407
title: The graph-tree freshness gate reopens the watch after losing it instead of reading the whole tree on every act before re-registration
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea99-75cf-80ea-5e561320d6d3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c68-75fc-7268-bf0d-39b2d620c9b9
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
---
`FreshnessGate.register` (`graph/serving/freshness.ts`) opens `watchingCheckout` once. When the watch ends (`error` after the watch process loss, `lost`, `polling`), the gate is left with no watcher until unregister: every `settled` treats the tree as unknown and reads it with a full status. Verified on a trial server on 2026-10-18: after `SIGKILL` of the watch process the checkout row (`CheckoutWatch`) reopened itself, while the graph-tree and HEAD-watch places never came back — `read_watches` no longer showed them, although the graph read on.

Reopen the watch on the `workspace/watch/shared.ts#heal` model (a pause, growing to a ceiling, while the tree stays registered) and treat the return as a rescan. Proof: the gate's itest — after a watch loss the next block-file event gives a refresh on the named path again.
