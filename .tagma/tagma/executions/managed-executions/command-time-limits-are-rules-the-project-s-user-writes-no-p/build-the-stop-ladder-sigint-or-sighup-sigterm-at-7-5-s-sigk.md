---
id: 01a0cfab-71f2-7cd2-bd1b-64755edc3914
title: "Build the stop ladder: SIGINT or SIGHUP, SIGTERM at 7.5 s, SIGKILL at 10 s, with StopPolicy gone from every door"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cfac-2266-781f-9235-781b8997a4f0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf92-69a2-70c8-b0f6-4430f86edb6b
---
This implements [[f86edb6b]] whole, as the first part of stage 1. It lands before the vocabulary part, while the profiles still stand, and removes their stop field.
- **Start from:** `packages/execution-host/src/ExecutionStop.ts`, the backends `native/Pty.ts`, `nativeLaunch.ts` and `PipeProcess.ts`, and `StopPolicy` in `packages/executions/src/protocol/call.ts`.
- **Wire:** raise `WIRE_VERSION` by one. The vocabulary part in the same release does not raise it again.
- **Proof:** the decision's acceptance criteria 1–8; `runlith-typecheck` clean for executions, execution-host, agent-tools, the server, the app and llm; the host suites and the stop and terminal integration suites green.