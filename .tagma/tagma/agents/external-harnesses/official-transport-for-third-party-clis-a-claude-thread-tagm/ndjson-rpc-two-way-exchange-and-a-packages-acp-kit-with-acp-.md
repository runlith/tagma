---
id: 01a1089e-978d-7423-bc88-3a1c07a91ddd
title: "ndjson-rpc: two-way exchange and a packages/acp kit with ACP v1 schemas and the client machine"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Decision 4 and "Architecture" 1–2 of spec [[adb9cd5b]]. Extend `@runlith/ndjson-rpc` (agent-to-client requests, many pending requests, externally issued string ids, envelope parsing, a worker for lines longer than 1 MiB, a caller-set line ceiling) while keeping the `JsonRpcExchange.request` API for `prepareRoot.ts`. A new module-kit `packages/acp` with a #module card: Effect Schema of the ACP v1 subset and a pure client machine (frame or intent in, frames, projection events and new state out), including resume from a cursor, unclaimed requests and late answers. Done: the machine's contract unit tests are green, module links set via set_module.
