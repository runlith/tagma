---
id: 01a16eba-ee0f-70a7-abf3-e60d48eacba0
title: "The inspection worker spawns children via `Bun.spawn`, not `node:child_process`: a `ChildProcessSpawner` adapter with shared conformance"
ord: 83
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16f50-ac27-7545-b867-3f41680429fa",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e63-dd41-7533-993a-539ece21892a
  - kind: relates
    to: 01a16eb1-9263-71d7-9fa6-8fe326f52110
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
---
`BunChildProcessSpawner` from `@effect/platform-bun` 4.0.1 is a re-export of `NodeChildProcessSpawner`, i.e. `node:child_process`. Under `bun test`, Bun 1.4.3 loses its `exit` event on a file's first spawn in 4–11% of cases, while `Bun.spawn(...).exited` in the same scheme loses none ([[26f52110]]). So the inspection worker ([[ce21892a]]) sometimes waits for an exit that already happened. The `kill(pid, 0)` detector from ce21892a recognizes such a loss in about 1.5 s and hands the ask to a fresh worker — but the loss price, a stopped worker and a retry, stays.

The root on our side: the inspection worker layer on POSIX gets a `ChildProcessSpawner` over `Bun.spawn`; Windows keeps the old Node adapter with tree kill via `taskkill`. The workspace native spawner moved into `packages/executions/src/bunSpawner.ts` so two consumers share one mechanism; other Node spawners don't switch. The adapter passes one conformance suite together with the Node adapter: stdin/stdout/stderr streams, exit code, signal, kill, piped commands, `isRunning` and scope completion.

Done when the original eight-file enforcement/HTTP batch passes on seeds 1–3 with no "never saw the exit", and the shared conformance is green on both adapters. The original refusal is kept in command `cea19b77-a1f9-4721-9ab6-96250e301758:167`, seed 2: `finishDebt.itest.ts` gets `inspection-failed` after losing a git exit in the worker and a fresh worker's repeated refusal. The batch passes on seeds 1–3 with no WARN exit loss (`5709fbc4-89d0-4b6c-b896-89c4094e31d8:167`, 11 tests each). Review found a lost immediate cleanup of children after a non-zero exit: a shared test with `unref` and a held pipe fails before the callback fix (`bf438a24-f3a2-468d-b33d-e554a9c4ac86:167`, Bun timeout 10000 ms, Node green), after it the conformance passes on both adapters on seeds 1–3 (`9a2beeca-a62a-4ead-8190-b658f2c5eea9:167`, 8 tests each).
