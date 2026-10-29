---
id: 01a0ef65-4e5e-7cc4-97bd-049fc54d6c45
title: "Build the native per-process sampler: libproc/proc/Windows reads, partial rates in rateOf, installation and machine sets, driven by the load subscription"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ef66-2a26-7f38-81a4-60d76af61214",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ef62-bd2c-75a6-9efa-3ad2b5f88bb9
---
Deliver [[b5f88bb9]] §4 in its §9 order: native reads in `packages/execution-host/native` (Rust) and `src/native/Abi.ts`, `rateOf` on partial semantics, the sampler over execution, installation and machine sets driven by the server's load subscription, and the performance ring's `Installation`/`Machine` load records. Publish the protocol fields (`@runlith/executions`: `UsageReading` memory kind + footprint + partial population/gaps, `MachineReading`) first and tell the orchestrator, because the load feed ([[49826c62]]) consumes them. Done when §7 of the decision holds and its claims (§8) are rewritten and verified.