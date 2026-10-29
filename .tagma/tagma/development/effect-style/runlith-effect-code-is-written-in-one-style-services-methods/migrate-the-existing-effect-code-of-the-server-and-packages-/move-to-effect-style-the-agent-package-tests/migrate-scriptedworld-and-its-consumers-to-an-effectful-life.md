---
id: 01a13fd6-6e12-7b96-b83d-56c45408b4e0
title: Migrate scriptedWorld and its consumers to an effectful lifecycle
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523d-71cd-acb6-4295df9398b1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
  - kind: waits-on
    to: 01a13fd9-f91d-7923-89d2-6a4ca8735d64
sources:
  - kind: file
    ref: packages/agent/src/thread/conformance/runLog/world.ts
---
Migrate thread/conformance/runLog/world.ts to Effect wholesale: scriptedWorld creation with no runSync, effectful start/boundary/dispose/wait helpers and lifetime under the owner scope. In one delivery update all consumers in the agent package and the server, including native-harness/settlementRestart.itest.ts, contextReceipt.itest.ts and bench-turn-ack.ts; declaration and consumers move together. Keep outcomes, lifecycle order, spans, recovery and the awaiting/settled contract; Promise wrappers hide no runtime or scope. Read the changed files whole and measure test runners per file. Checks are narrow serial --parallel=1 runs of the touched contracts, package-only bun check -p packages/agent and the matching package-only server check, scoped law and one Sol+Muse round. Leave a01ffa22 alone.
