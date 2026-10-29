---
id: 01a0c8cb-0496-70bf-8c94-ce71c482c387
title: "A vendor asking us to slow down is never heard: the poll's slow_down flag is dropped before any surface can obey it"
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/llm/src/oauth/ProviderSignIn.ts
    symbol: ProviderSignIn
---
Rule [[7992b85a]] obliges a caller polling the device grant one step at a time to raise its own interval, because the poll reports the flag and changes no cadence. `ProviderSignIn.complete` reads only `status === 'pending'` and discards `result.slowDown`, so nothing downstream can comply — and `slow_down` appears nowhere in `apps/`.

This is a violation of a rule this package states, not an exception to record.