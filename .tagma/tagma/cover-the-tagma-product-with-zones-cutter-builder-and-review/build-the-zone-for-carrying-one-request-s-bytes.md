---
id: 01a0c83e-7220-7337-bfe5-607589cc9263
title: Build the zone for carrying one request's bytes
ord: 100
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c865-94de-7f83-8fd1-35d4fc9a63d2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/llm/src/llm/route/transport
---
Write the claims of [[e8f0056e]] from `packages/llm/src/llm/route/transport`. Parent [[249ce587]], reference shape [[6c81c6f3]]. The verbatim writer is the claim worth the most: why a route that must reproduce a measured client cannot reach the wire through `fetch`, and which two header values a writer alone may fill. Note that other writers hold uncommitted changes under this directory — read the current files.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.