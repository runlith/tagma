---
id: 01a118eb-3e7e-7085-8f2e-2cd669dafa08
title: Core contracts and store ports speak Effect; failures never become defects or silence
ord: 12
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/ThreadBorder.ts
---
Goal: core contracts speak only Effect. Interruption, fiber context, tracing, and typed failures cross every boundary, including stores. Promise and `AbortSignal` stay only on provider edges, adapted once. No failure turns into a defect or into silence on the way.

## Now

- **Promise members in core contracts:**
  - `Tool.settleEffect` and `toModelOutput` (`tool.ts:196-207`);
  - `Agent.instructions` and `stopWhen` (`Agent.ts:10,15`);
  - `AgentToolOutputs.project`.

  Each forces `tryPromise`/`runPromise`. Example: `spawnSettlement` = `Effect.runPromise(... .pipe(Effect.orDie))` (`ThreadSpawnTree.ts:170-180`) — a floating promise whose typed failures become fiber deaths.
- **Store ports** are declared twice:
  - a Promise interface (`thread/storage/*`, e.g. `ThreadRunStorage`);
  - Effect "faces" derived from it by the `PortFaces` type (`ThreadPorts.ts:55-63`).

  `AgentHarness` takes the faces (`AgentHarness.ts:148-159`), and Tagma's SQLite adapters already implement them on Effect (e.g. `native-harness/runs/reaping.ts`). The Promise shapes plus the `portFaces` Proxy serve the rest:
  - `InMemory*` adapters;
  - the `promise/` Promise surface for Tagma fixtures;
  - the workflow-run store (`native-harness/kernel.ts:367`);
  - the default observation cache (`AgentHarness.ts:257`).

  The Proxy reruns transaction callbacks through `Effect.runPromise(threadBorderOut(...))` and selects them by the positional `CALLBACK_AT` table (`ThreadPorts.ts:67-114`). `threadBorderOut` turns every typed failure into a defect (`ThreadBorder.ts:61-63`).
- **Runtimes and cancellation.** Two `ManagedRuntime`s (harness and `AgentRunner`). Cancellation races twice: `AbortSignal` next to Effect interruption.
- **Markers in the package's production code:**
  - 20 `Effect.run*`;
  - 24 `console.*`;
  - 98 `AbortController`/`AbortSignal`;
  - 14 `Effect.ignore`;
  - 11 `as unknown as`.
- **A typed failure becomes a defect:**
  - `ThreadAggregate.create` dies on a policy refusal (`ThreadAggregate.ts:483-484`);
  - not-found is served as generic `ThreadCallBroke`;
  - synchronous throws inside generators (`ThreadAggregate.ts:89-96`).

## What gets built

- Core contracts' Promise members become Effect-returning, and `spawnSettlement` returns a verdict instead of dying.
- One runtime per host. `AbortSignal` lives only where a provider SDK or fetch demands it.
- `console.*` becomes activity plus Effect logging.
- A response-changing failure arrives as a typed refusal or is handled by its own condition. The exact `swallowed-failures` check allowance is permitted only for best-effort cleanup, telemetry, or release-after-failure — with a place and a why ([[ea465bed]]).
- `ThreadBorder` stops turning typed failures into defects: an operation's refusal reaches the caller with its own type.
- **Store ports** (the operator's decision). Each port's contract is declared on Effect directly. Deleted:
  - Promise interfaces;
  - the `PortFaces` type;
  - the `portFaces` Proxy;
  - `CALLBACK_AT`;
  - the `promise/` surface.

  The `InMemory*` adapters, the workflow-run store, and the Tagma fixtures are rewritten onto Effect. The thread's SQLite adapters in Tagma are already that shape and only change their declared type. Transactions carry interruption and the typed refusal.

## Named edges

Cancellation in the core is only fiber interruption: stopping a run (`RunStop` in `RunExecution`) and stopping a call (`AgentCalls.stop`/`halt`) interrupt their fibers; a tool reads the stop through the executions contract's `CallStopping`, not through a signal. `AbortSignal` is born only where Effect calls a Promise-side provider, once:
- **Model SDK and `fetch`** (`packages/llm`): `Effect.tryPromise({ try: (signal) => ... })`; the vendor page-read adds `AbortSignal.timeout` to it, and the `WebPages.fetch` port wraps `fetch`.
- **MCP SDK, client** (`packages/mcp/src/sdk.ts`): `requestOptions(signal, ...)` from each `tryPromise` request.
- **MCP SDK, server** (`packages/mcp/src/sdkServer.ts` → `external-harnesses/runner/claude/bridge.ts`): the SDK request's signal passes into `Effect.runPromise(..., { signal })` — the edge where the SDK calls us.
- **Tool `fetch`** (`packages/agent-tools/src/webfetch.ts`): the `AbortController` that the call scope's finalizer removes.
- **PDF** (`packages/agent-tools/src/read.ts`): `readPdf` under `tryPromise(signal)`.
- **Child processes** take no signal: fiber interruption drives the stop ladder (`executions/stopLadder.ts`, `agent-tools/localLadder.ts`, `executionSpawner.ts`).

`Effect.run*` in `packages/agent` production code is one synchronous edge: `ThreadLiveFeed` logs a subscriber failure from the `@runlith/utils/event` emitter callback (`Effect.runSync(Effect.logWarning(...))`). There is no `ManagedRuntime` in `packages/agent`: runs and calls go in the host runtime (in Tagma, `composition/runtime.ts`). `threadPromise` for tests lives in `thread/conformance/border.ts`, outside production. No `console.*` in production code.

Post-work production-code measurement of `packages/agent` (no tests, bench, `conformance/`, `testing/`): `AbortController`/`AbortSignal` — 0, `Effect.run*` — 1, `console.*` — 0, `ManagedRuntime` — 0, `Effect.ignore` — 8 (each an [[ea465bed]] allowance with a why), `as unknown as` — 10. The `swallowed-failures` check over the package finds no violation outside allowance and debt; the debt is two question-input parses (`readyAnswersFromToolCall`, `userQuestionFromToolCall`), removed by [[106d8606]].

## Acceptance criteria

- `rg` over core contracts and store ports (`Tool`, `Agent`, `AgentToolOutputs`, `thread/` services and ports): no member returning `Promise`. `portFaces`, `PortFaces`, `CALLBACK_AT`, and `promise/` do not exist.
- `rg` over the package's production code: no `console.*`, no `Effect.run*` except the named provider edges and the host's one entry point.
- Test: a typed refusal inside `transaction()` reaches the caller with its own type, not as a defect.
- Test: fiber interruption aborts the transaction and leaves no partial write.
- The `swallowed-failures` check passes over the package; each allowance is cleanup, telemetry, or release with a why.
