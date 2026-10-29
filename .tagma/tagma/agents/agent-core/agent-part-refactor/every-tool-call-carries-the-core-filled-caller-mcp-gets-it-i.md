---
id: 01a118eb-3e7e-7085-8f2e-2ccdb771b4db
title: Every tool call carries the core-filled caller; MCP gets it in _meta
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/tool.ts
  - kind: file
    ref: packages/mcp/src/sdk.ts
---
Goal: every tool call carries a caller filled by the core from the run — not by the model and not by a closure. An outside tool source (an MCP server, later a plugin process) learns which thread, run, agent, and seat call it, and answers different players differently.

## Now

`ToolCallIdentity` is `{ toolCallId, step?, messages, abortSignal?, progress? }` (`agent/tool.ts:95-100`). Thread, run, and agent reach a tool only through the closure the catalog was built with. The door knows `runId` and `threadId` (`AgentToolDoor.ts:93-113`) but passes neither further.

The MCP path loses what Tagma has:

`ThreadContext.caller.actor` → `McpToolsContext` → `McpToolCaller.call(..., {signal})` (`packages/mcp/src/mcpToolCatalog.ts:15-21,141-145`) → `sdk.ts:281` `callTool({ name, arguments }, ...)`

The request object carries no `_meta`. Pool sessions are shared per project across all threads. There is no notion of seat: `ThreadHostBinding {kind, id}` is the execution world (sandbox), not a plugin's seat.

## What gets built

- `ToolCaller = { agentId, ownerId, thread: { threadId, runId, bindings } | null }` in `contracts`.
  - `thread: null` is the `AgentRunner` caller with no thread (`AgentRunner.ts:66-72`): that entry stays, and no fake thread id is created.
- `bindings: Record<ContributorId, string>` — the thread's bindings to outside contributors. For example, a seat at a table: `poker → "t3/s5"`.
  - Written by the birther, in the birth act, and stored on the thread row.
  - Fork inherits them only on the birther's explicit word.
  - Repeating a birth key with different `bindings` is a typed conflict.
- One immutable caller is filled by the host from the accepted launch. The door passes it into every operation of one call:
  - preparation (`ToolPreparationCall`, today only `toolCallId`, `agent/tool.ts:91-100`);
  - execution;
  - settlement;
  - recovery of the same call.

  Tool input never sets it.
- The MCP adapter maps `caller` into `params._meta` under the key declared by module [[13756ad0]] (one name, no versions). `McpCallOptions` gains a `caller` field, not a bag.
- Pool sessions stay shared per project: identity travels in every call and needs no separate connection per thread or contributor.
- The Tagma side of the path is `native-harness/tools/mcpServers.ts` ([[ab05dfec]]).
- Pre-call `ping` and per-run server reconcile are [[9035b0a1]]'s subject. Untouched here.

## Acceptance criteria

- Door test: preparation and execution of one call get the same run `caller`; `bindings` match what birth recorded. A call recovered after a restart gets the same caller.
- Birth test: fork without an explicit word does not inherit `bindings`; a birth-key repeat with different `bindings` is a typed conflict.
- `packages/mcp` test on the `tools/call` wire request: `params._meta` holds thread, run, agent, and `bindings`.
- Birth test: `bindings` passed by spawn read back from the thread row after a store restart (conformance, both adapters).
- No core tool takes thread or run from a `ctx` closure where the same fact exists in `caller` — checked by diff review, not by test.
