---
id: 01a10cb2-b8fe-7e40-8ca0-932b54c5fcd2
title: "`callers` sets the call right; `tool` offers the operation as a tool to the native agent and over MCP"
ord: 1
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/invocation/nativeDoor.ts
    symbol: nativeOffers
  - kind: symbol
    ref: apps/tagma/server/src/invocation/registry.ts
    symbol: doorsOf
  - kind: symbol
    ref: apps/tagma/server/src/platform/contract/wire/operation.ts
    symbol: OperationDoors
---
`callers` sets the call right regardless of transport and tool. An operator operation called from a thread refuses `operator-only` in every mode, including bypass; the operator passes without a question. An operator's protocol call with `callers: 'thread'` gets `thread-required` before preparation and execution.

`tool` decides whether the operation is offered to the native agent and over MCP. With `callers: 'any'` or `'thread'`, the declaration explicitly picks `AgentTool` or nothing; with `'operator'`, the type forbids a tool. `doors` holds only HTTP and socket, so copying the transport does not carry the tool along. Git-panel actions stay HTTP operations, and checkout reads stay agent tools.

`runtime: true` hands the verb to the native agent through its runtime; the operation serves it over MCP and `tagma op`, and the native tool is never mounted twice. MCP offers the tools reachable over HTTP; a socket-only tool is available to the native agent alone. `composeAgent.itest.ts` checks that these sets match and where the offering boundary runs.
