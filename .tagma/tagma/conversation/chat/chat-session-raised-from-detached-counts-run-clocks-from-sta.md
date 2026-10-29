---
id: 01a15b87-fe42-7050-a1fe-ca0f4059886a
title: Chat session raised from detached counts run clocks from stale `state.now`
ord: 56
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b88-e3d8-78e6-b60b-f1bc7906da0f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/chat-ui/src/session/ThreadSession.svelte.ts
    symbol: ThreadSession
---
`ThreadSession.make` applies `detached.state` with the client current time, and `stampRunClocks` derives the clock offset from `state.now` of the moment the session detached. Run time shifts by the absence: on October 20 in thread `01a15ac1-2b9a-7fc6-b993-3b1f606e8186` the row showed "run 21m 9s" on a true 34 minutes — about 13 minutes passed between detach and return. Do: the detached state's clock offset is taken at the client moment when that state was read.
