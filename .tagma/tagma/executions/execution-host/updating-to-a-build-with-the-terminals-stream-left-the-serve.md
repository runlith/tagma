---
id: 01a17d09-b00b-797b-8a6e-b8daa1009819
title: "Updating to a build with the terminals stream left the server hostless: the departing logic rejected the terminals role in the candidate manifest"
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ae0-48f6-7cff-9adb-353003be8a0d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17aff-0013-783e-93b0-82167556936c
sources:
  - kind: file
    ref: packages/execution-host/src/buildArtifact.ts
  - kind: file
    ref: packages/ndjson-rpc/src/exchange.ts
---
Spotted 2026-10-27 on the operator's install during the 8f453f0 → head update: `bundle.next.refused` with `Expected "runtime" | … at ["parts"][4]["role"]`, the window — "the host writer claim is held; no holder was started … ActivationDeferred", terminals do not open, the ACP drive falls over. The `terminals` role added in 7556936c is missing from the dictionary the departing logic reads the candidate manifest with ([[99e0a462]]). Fix: the terminals worker carries the `sampler` role, the `terminals` role leaves the protocol. Along the way `ExchangeFailed`, `ExchangeTimeout` and `ExchangeEof` yield `detail` as `message`: the ACP-drive failure showed as "ExchangeFailed carried no message".
