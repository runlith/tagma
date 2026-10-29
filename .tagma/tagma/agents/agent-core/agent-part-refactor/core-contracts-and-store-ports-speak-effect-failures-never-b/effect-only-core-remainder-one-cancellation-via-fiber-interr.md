---
id: 01a126f4-1128-7f6b-874c-dd005b569767
title: "Effect-only core remainder: one cancellation via fiber interruption, AbortSignal and Effect.run* only on named edges, one runtime per host"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126f4-468e-7368-9111-dba397533bc0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd669dafa08
---
Task [[c5a63020]] moved the store ports to Effect and closed; the remaining [[69dafa08]] criteria are not met. Production-code measurement of `packages/agent` on 2026-10-10 (no tests, conformance, or testing):
- `AbortController`/`AbortSignal` — 99;
- `Effect.runPromise/runSync/runFork` — 66;
- `console.*` — 9;
- `Effect.ignore` — 9;
- `as unknown as` — 10.

What to do:
- **One cancellation.** Cancellation is fiber interruption. `AbortSignal` is created only at the edge where Effect calls a Promise-side provider: model SDK, MCP SDK, `fetch`, child process. `Effect.tryPromise` or the edge adapter creates it, once. Core contracts (`Tool`, tool-call options, `AgentCalls`, the run) carry no signal. Every consumer of the contract, including tools in `packages/agent-tools`, `packages/mcp`, and Tagma, changes in the same cut.
- **One runtime per host.** `AgentRunner`'s `ManagedRuntime` merges into the host runtime.
- `Effect.run*` only on the provider edges and in the host's one named entry point.
- No `console.*`: activity and Effect logging instead.
- The `swallowed-failures` check passes over the package; each allowance is cleanup, telemetry, or release with a why.

Done when every [[69dafa08]] criterion is proven (`rg` plus the tests from its section), typecheck and the affected suites are green, review under the model rule passes. The spec closes after that.
